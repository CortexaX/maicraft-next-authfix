/**
 * Agent 主类
 * 整个 AI 系统的入口和协调者
 */

import { getLogger } from '@/utils/Logger';
import type { Logger } from '@/utils/Logger';
import type { Bot } from 'mineflayer';
import type { AppConfig as Config } from '@/utils/Config';
import type { AgentState, AgentStatus, GameContext } from './types';
import { InterruptController } from './InterruptController';
import { MemoryManager } from './memory/MemoryManager';
import { ModeManager } from './mode/ModeManager';
import { MainDecisionLoop } from './loop/MainDecisionLoop';
import { ChatLoop } from './loop/ChatLoop';
import { ActionExecutor } from '@/core/actions/ActionExecutor';
import { PromptDataCollector } from './prompt/PromptDataCollector';
import { ActionPromptGenerator } from '@/core/actions/ActionPromptGenerator';

export class Agent {
  // 共享状态（只读）
  readonly state: AgentState;

  // 决策系统（作为内部组件，不暴露）
  private mainLoop: MainDecisionLoop;
  private chatLoop: ChatLoop;

  // 数据收集器
  private dataCollector: PromptDataCollector;

  // 外部传入的组件
  private bot: Bot;
  private executor: ActionExecutor;
  private llmManager: any; // LLMManager 类型
  private externalLogger: Logger;

  // 生命周期
  private isRunning: boolean = false;

  private logger: Logger;

  constructor(
    bot: Bot,
    executor: ActionExecutor,
    llmManager: any,
    config: Config,
    memory: MemoryManager,
    modeManager: ModeManager,
    interrupt: InterruptController,
    logger?: Logger,
  ) {
    this.bot = bot;
    this.executor = executor;
    this.llmManager = llmManager;
    this.externalLogger = logger || getLogger('Agent');
    this.logger = this.externalLogger;

    // 从外部注入的组件构建状态
    const context = this.executor.getContextManager().getContext();

    this.state = {
      goal: config.agent?.goal || '探索世界',
      isRunning: false,
      context,
      modeManager,
      memory,
      llmManager: this.llmManager,
      interrupt,
      config,
    };

    // 绑定状态到 ModeManager
    this.state.modeManager.bindState(this.state);

    // 创建决策循环（依赖 AgentState，在这里创建）
    this.mainLoop = new MainDecisionLoop(this.state, this.llmManager);
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
   * 设置WebSocket服务器（用于记忆推送）
   */
  setWebSocketServer(webSocketServer: any): void {
    this.state.memory.setWebSocketServer(webSocketServer);
    this.logger.info('📡 Agent 已连接到WebSocket服务器');
  }

  /**
   * 获取记忆管理器
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
      // 初始化游戏状态（如果还没初始化）
      if (!(this.state.context.gameState as any).initialized) {
        this.state.context.gameState.initialize(this.state.context.bot);
      }

      // 初始化记忆系统
      await this.state.memory.initialize();

      // 加载目标和任务持久化数据
      if (this.state.context.goalManager && this.state.context.taskManager) {
        const context = this.executor.getContextManager().getContext();
        const { TrackerFactory } = await import('@/core/agent/planning/trackers/TrackerFactory');
        const trackerFactory = new TrackerFactory(context.eventManager);

        await this.state.context.goalManager.load('./data', trackerFactory);
        await this.state.context.taskManager.load('./data', trackerFactory);

        this.logger.info('✅ 目标和任务数据加载完成');
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

      // 注册所有模式
      await this.state.modeManager.registerModes();

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
      // 设置初始模式
      await this.state.modeManager.setMode(ModeManager.MODE_TYPES.MAIN, '初始化');

      // 启动决策循环
      this.mainLoop.start();
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
    this.mainLoop.stop();
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
   * 处理目标完成事件（已废弃 - 新系统使用自动检测）
   * 保留空方法以兼容旧代码引用
   */
  private handleGoalCompletion(_goal: any): void {
    // 新系统中目标完成由goalManager自动检测和记录
    // LLM会在prompt中看到goal_completed_hint并自主设定新目标
  }

  /**
   * 基于完成的目标自动生成新目标（已废弃 - 新系统使用LLM自主决策）
   */
  private async generateNewGoalAfterCompletion(_completedGoal: any): Promise<void> {
    // 新系统中，LLM会在看到goal_completed_hint后自主设定新目标
    // 不需要程序主动生成
  }

  /**
   * 收集当前环境数据，用于目标生成
   */
  private collectEnvironmentData(): any {
    const gameState = this.state.context.gameState;
    // 使用PromptDataCollector收集的基础信息，获得格式化的数据
    const basicInfo = this.dataCollector.collectBasicInfo();

    return {
      position: basicInfo.position, // "位置: (x, y, z)"
      health: gameState.health || 20,
      food: gameState.food || 20,
      inventory: basicInfo.inventory_info, // 格式化的物品栏信息
      time: gameState.timeOfDay > 12000 ? '夜晚' : '白天',
      environment: gameState.getStatusDescription(), // 完整的状态描述
    };
  }

  /**
   * 获取已完成目标的历史（已废弃）
   */
  private getCompletedGoalsHistory(): any[] {
    // 新系统中可以从goalManager获取，但目前不需要
    return [];
  }

  /**
   * 使用LLM生成新目标（已废弃）
   */
  private async generateGoalWithLLM(_completedGoal: any, _environmentData: any, _completedGoalsHistory: any[]): Promise<any> {
    // 新系统中由LLM通过plan_action自主创建目标
    return null;
  }

  /**
   * 创建新目标并自动生成计划（已废弃）
   */
  private async attemptToCreateNewGoal(): Promise<void> {
    // 新系统中由LLM通过plan_action自主创建目标
  }

  /**
   * 为新目标生成计划
   */
  private async generatePlanForNewGoal(goal: Goal): Promise<void> {
    try {
      this.logger.info('📋 正在为新目标生成计划...');

      // 调用规划管理器的计划生成方法
      const success = await this.state.planningManager.generatePlanForCurrentGoal();

      if (success) {
        this.logger.info('✅ 新目标的计划已生成完成');
      } else {
        this.logger.warn('⚠️ 新目标的计划生成失败');
        this.state.memory.recordThought('⚠️ 新目标计划生成失败，可能需要手动规划', {
          goal: goal.description,
        });
      }
    } catch (error) {
      this.logger.error('为新目标生成计划失败:', {}, error as Error);
    }
  }

  /**
   * 设置事件监听（游戏逻辑相关）
   */
  private setupEventListeners(): void {
    const { context, interrupt, modeManager } = this.state;

    // 受伤事件 - 切换到战斗模式
    context.events.on('entityHurt', async (data: any) => {
      if (data.entity?.id === context.bot.entity?.id) {
        // 只有当受伤的是自己时才切换模式
        await modeManager.trySetMode(ModeManager.MODE_TYPES.COMBAT, '受到攻击');
        this.state.memory.recordThought('⚔️ 受到攻击，切换到战斗模式', { entity: data.entity });
      }
    });

    // 死亡事件 - 触发中断
    context.events.on('death', () => {
      interrupt.trigger('玩家死亡');
      this.logger.warn('💀 玩家死亡');
      this.state.memory.recordThought('💀 玩家死亡，需要重生', {});
    });

    // 重生事件 - 恢复正常状态
    context.events.on('spawn', () => {
      this.logger.info('🎮 玩家重生');
      this.state.memory.recordThought('🎮 玩家重生，恢复正常活动', {});
    });

    // 健康和饥饿状态变化 - AI决策相关
    context.events.on('health', (data: any) => {
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
        this.state.context.blockCache.save?.(),
        this.state.context.containerCache.save?.(),
        this.state.context.locationManager.save?.(),
        this.state.context.goalManager?.save?.('./data'),
        this.state.context.taskManager?.save?.('./data'),
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
      currentMode: this.state.modeManager.getCurrentMode(),
      goal: currentGoal?.content || this.state.goal,
      currentTask: null, // 新系统中不再有单一的currentTask概念
      interrupted: this.state.interrupt.isInterrupted(),
      interruptReason: this.state.interrupt.getReason(),
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
