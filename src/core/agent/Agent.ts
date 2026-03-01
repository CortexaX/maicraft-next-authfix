/**
 * Agent 主类
 * 整个 AI 系统的入口和协调者
 *
 * 新架构：ReAct + 中断 + 工具
 * - 使用 AgentLoop 替代 MainDecisionLoop
 * - 使用 InterruptSystem 替代 ModeManager
 * - 使用 ToolRegistry 将 Action 转换为 function-calling
 */

import { getLogger } from '@/utils/Logger';
import type { Logger } from '@/utils/Logger';
import type { Bot } from 'mineflayer';
import type { AppConfig as Config } from '@/utils/Config';
import type { AgentState, AgentStatus } from './types';
import type { MemoryService } from './memory/MemoryService';
import { MemoryManager } from './memory/MemoryManager';
import { AgentLoop } from './loop/AgentLoop';
import { ChatLoop } from './loop/ChatLoop';
import { ActionExecutor } from '@/core/actions/ActionExecutor';
import { PromptDataCollector } from './prompt/PromptDataCollector';
import { ActionPromptGenerator } from '@/core/actions/ActionPromptGenerator';
import { ToolRegistry } from './tool/ToolRegistry';
import { InterruptManager } from '@/core/interrupt';
import { CombatHandler } from '@/core/interrupt/handlers/CombatHandler';
import type { LLMManager } from '@/llm/LLMManager';
import { initAllTemplates } from './prompt';

export class Agent {
  // 共享状态（只读）
  readonly state: AgentState;

  // 决策系统（作为内部组件，不暴露）
  private agentLoop: AgentLoop;
  private chatLoop: ChatLoop;

  // 新架构组件
  private toolRegistry: ToolRegistry;
  private interruptManager: InterruptManager;

  // 数据收集器
  private dataCollector: PromptDataCollector;

  // 外部传入的组件
  private bot: Bot;
  private executor: ActionExecutor;
  private llmManager: LLMManager;
  private memoryManager: MemoryManager;
  private externalLogger: Logger;

  // 生命周期
  private isRunning: boolean = false;

  private logger: Logger;

  constructor(
    bot: Bot,
    executor: ActionExecutor,
    llmManager: LLMManager,
    config: Config,
    memory: MemoryService,
    memoryManager: MemoryManager,
    interruptManager: InterruptManager,
    logger?: Logger,
  ) {
    this.bot = bot;
    this.executor = executor;
    this.llmManager = llmManager;
    this.memoryManager = memoryManager;
    this.externalLogger = logger || getLogger('Agent');
    this.logger = this.externalLogger;

    // 从外部注入的组件构建状态
    const context = this.executor.getContextManager().getContext();

    // 创建新架构组件
    this.toolRegistry = new ToolRegistry(executor, context);
    this.interruptManager = interruptManager;

    this.state = {
      goal: config.agent?.goal || '探索世界',
      isRunning: false,
      context: { ...context, memory },
      memory,
      llmManager: this.llmManager,
      interruptManager: this.interruptManager,
      toolRegistry: this.toolRegistry,
      config,
    };

    // 创建决策循环（依赖 AgentState，在这里创建）
    this.agentLoop = new AgentLoop(this.state, this.llmManager, this.toolRegistry, this.interruptManager);
    this.chatLoop = new ChatLoop(this.state, this.llmManager);

    // 初始化数据收集器
    const actionPromptGenerator = new ActionPromptGenerator(this.executor);
    this.dataCollector = new PromptDataCollector(this.state, actionPromptGenerator);

    // 设置事件监听
    this.setupEventListeners();

    // 设置定期保存记忆
    this.setupPeriodicSave();
  }

  /**
   * 获取记忆服务
   */
  getMemoryService(): MemoryService {
    return this.state.memory;
  }

  /**
   * 获取内部记忆管理器（用于需要直接访问的地方）
   */
  getMemoryManager(): any {
    return this.state.memory;
  }

  /**
   * 初始化 Agent（加载资源、设置状态等，但不启动决策循环）
   */
  async initialize(): Promise<void> {
    this.logger.info('🔧 Agent 初始化中...');

    try {
      // 初始化所有提示词模板
      initAllTemplates();

      // 初始化游戏状态（如果还没初始化）
      if (!(this.state.context.gameState as any).initialized) {
        this.state.context.gameState.initialize(this.state.context.bot, this.state.context.events);
      }

      // 初始化记忆系统
      await this.state.memory.initialize();

      // 加载目标持久化数据
      if (this.state.context.goalManager) {
        const context = this.executor.getContextManager().getContext();
        const { TrackerFactory } = await import('@/core/agent/planning/trackers/TrackerFactory');
        const trackerFactory = new TrackerFactory(context.events);

        await this.state.context.goalManager.load('./data', trackerFactory);

        this.logger.info('✅ 目标数据加载完成');
      }

      // 如果配置中有初始目标且当前无活动目标，创建初始目标
      if (this.state.goal && this.state.context.goalManager) {
        const goalManager = this.state.context.goalManager;
        if (goalManager.getActiveGoals().length === 0) {
          this.logger.info(`🎯 从配置创建初始目标: ${this.state.goal}`);
          goalManager.addGoal({
            content: this.state.goal,
            priority: 5, // 初始目标优先级最高
          });
        }
      }

      // 注册中断处理器（取代模式注册）
      const combatHandler = new CombatHandler(this.executor, this.memoryManager, this.state.context.gameState);
      this.interruptManager.register(combatHandler);
      this.logger.info('战斗中断处理器已注册');

      this.logger.info('✅ Agent 初始化完成');
    } catch (error) {
      this.logger.error('❌ Agent 初始化失败:', undefined, error as Error);
      throw error;
    }
  }

  /**
   * 启动 Agent（开始决策循环）
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Agent 已在运行');
      return;
    }

    this.isRunning = true;
    this.state.isRunning = true;

    this.logger.info('🚀 Agent 启动中...');

    try {
      // 直接启动决策循环，不再需要设置初始模式
      this.agentLoop.start();
      this.chatLoop.start();

      this.logger.info('✅ Agent 启动完成');
    } catch (error) {
      this.logger.error('❌ Agent 启动失败:', undefined, error as Error);
      this.isRunning = false;
      this.state.isRunning = false;
      throw error;
    }
  }

  /**
   * 停止 Agent
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Agent 未在运行');
      return;
    }

    this.logger.info('🛑 Agent 停止中...');

    this.isRunning = false;
    this.state.isRunning = false;

    // 停止决策循环
    this.agentLoop.stop();
    this.chatLoop.stop();

    // 保存状态
    await this.saveState();

    this.logger.info('✅ Agent 已停止');
  }

  /**
   * 设置定期保存记忆
   */
  private setupPeriodicSave(): void {
    // 每30秒保存一次记忆
    setInterval(async () => {
      try {
        await this.state.memory.saveAll();
      } catch (error) {
        this.logger.error('定期保存记忆失败', undefined, error as Error);
      }
    }, 30 * 1000);
  }

  /**
   * 设置事件监听（游戏逻辑相关）
   */
  private setupEventListeners(): void {
    const { context } = this.state;

    context.events.on('game:entityHurt', async (data: { entity: { id: number }; source?: unknown }) => {
      if (data.entity?.id === context.bot.entity?.id) {
        this.state.memory.recordThought('受到攻击', { entity: data.entity });
      }
    });

    context.events.on('game:spawn', () => {
      this.logger.info('玩家重生');
      this.state.memory.recordThought('玩家重生，恢复正常活动', {});
    });

    context.events.on('game:health', (data: { health: number; food: number }) => {
      const { health, food } = data;

      // 低血量警告
      if (health < 6) {
        this.state.memory.recordThought('⚠️ 生命值过低，需要回血或进食', { health });
      }

      // 低饥饿值警告
      if (food < 6) {
        this.state.memory.recordThought('⚠️ 饥饿值过低，需要进食', { food });
      }

      // 记录健康状态变化
      this.logger.debug(`健康状态更新: 生命值 ${health}/20, 饥饿值 ${food}/20`);
    });
  }

  /**
   * 保存状态
   */
  private async saveState(): Promise<void> {
    this.logger.info('💾 保存 Agent 状态...');

    try {
      await Promise.all([
        this.state.memory.saveAll(),
        this.state.context.blockCache.save(),
        this.state.context.containerCache.save(),
        this.state.context.locationManager.save(),
        this.state.context.goalManager?.save?.('./data'),
      ]);

      this.logger.info('✅ Agent 状态保存完成');
    } catch (error) {
      this.logger.error('❌ 保存 Agent 状态失败:', {}, error as Error);
    }
  }

  /**
   * 获取状态摘要
   */
  getStatus(): AgentStatus {
    const goalManager = this.state.context.goalManager;
    const currentGoal = goalManager?.getCurrentGoal();

    return {
      isRunning: this.isRunning,
      currentMode: this.interruptManager.isHandling ? 'interrupt' : 'normal',
      goal: currentGoal?.content || this.state.goal,
      currentTask: null,
      interrupted: this.state.context.signal.aborted,
      interruptReason: (this.state.context.signal.reason as Error)?.message || '',
    };
  }

  /**
   * 设置目标
   */
  setGoal(description: string): void {
    (this.state as any).goal = description;
    const goalManager = this.state.context.goalManager;
    if (goalManager) {
      goalManager.addGoal({ content: description, priority: 5 });
      this.logger.info(`🎯 设置新目标: ${description}`);
    }
  }
}
