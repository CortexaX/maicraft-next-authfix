/**
 * 规划模式
 *
 * 专门用于目标分析和任务规划的模式
 * 触发条件：
 * 1. 有活动目标但没有任务时
 * 2. 所有任务完成但目标未完成时
 */

import { BaseMode } from '@/core/agent/mode/BaseMode';
import { ModeManager } from '@/core/agent/mode/ModeManager';
import type { RuntimeContext } from '@/core/context/RuntimeContext';
import type { AgentState } from '@/core/agent/types';
import { LLMManager } from '@/llm/LLMManager';
import { promptManager } from '@/core/agent/prompt';
import { ActionPromptGenerator } from '@/core/actions/ActionPromptGenerator';
import { getLogger } from '@/utils/Logger';
import { StructuredOutputManager } from '@/core/agent/structured/StructuredOutputManager';
import type { StructuredAction } from '@/core/agent/structured/ActionSchema';

export class PlanningMode extends BaseMode {
  readonly type = 'planning_mode';
  readonly name = '规划模式';
  readonly description = '专注于目标分析和任务规划';
  readonly priority = 5; // 较高优先级，但低于战斗模式
  readonly requiresLLMDecision = true;
  readonly maxDuration = 120; // 最多规划2分钟
  readonly autoRestore = true; // 规划完成后自动返回主模式

  // GameStateListener 实现
  readonly listenerName = 'PlanningMode';
  readonly enabled = false; // 不需要监听游戏状态

  private llmManager: LLMManager | null = null;
  private structuredOutputManager: StructuredOutputManager | null = null;
  private actionPromptGenerator: ActionPromptGenerator | null = null;
  private planningRounds: number = 0;
  private maxPlanningRounds: number = 3; // 最多规划3轮

  constructor(context: RuntimeContext) {
    super(context);
    this.logger = getLogger(this.name);
  }

  /**
   * 绑定Agent状态并初始化LLM组件
   */
  bindState(state: AgentState): void {
    super.bindState(state);

    if (state) {
      this.llmManager = state.llmManager;
      if (this.llmManager) {
        this.actionPromptGenerator = new ActionPromptGenerator(state.context.executor);
        // 禁用结构化输出，使用降级解析
        this.structuredOutputManager = new StructuredOutputManager(this.llmManager, {
          useStructuredOutput: false,
        });
      }
    }
  }

  /**
   * 激活模式
   */
  protected async onActivate(reason: string): Promise<void> {
    this.logger.info(`🎯 进入规划模式: ${reason}`);
    this.planningRounds = 0;

    // 记录到思考日志
    if (this.state?.memory) {
      this.state.memory.recordThought(`🎯 进入规划模式: ${reason}`);
    }
  }

  /**
   * 停用模式
   */
  protected async onDeactivate(reason: string): Promise<void> {
    this.logger.info(`✅ 退出规划模式: ${reason}`);

    // 记录到思考日志
    if (this.state?.memory) {
      this.state.memory.recordThought(`✅ 退出规划模式: ${reason}，共规划了${this.planningRounds}轮`);
    }
  }

  /**
   * 模式主逻辑 - 执行规划
   */
  async execute(): Promise<void> {
    if (!this.state || !this.llmManager || !this.structuredOutputManager) {
      this.logger.warn('⚠️ 规划模式缺少必要组件');
      return;
    }

    try {
      this.planningRounds++;
      this.logger.info(`🤔 开始第 ${this.planningRounds} 轮规划...`);

      // 执行规划决策
      await this.executePlanningDecision();

      // 检查是否应该结束规划
      if (this.shouldExitPlanning()) {
        await this.exitPlanning();
      }
    } catch (error) {
      this.logger.error('❌ 规划模式执行异常:', undefined, error as Error);
      await this.exitPlanning();
    }
  }

  /**
   * 检查自动转换
   */
  async checkTransitions(): Promise<string[]> {
    // 如果超时或超过最大轮数，返回主模式
    if (this.isExpired() || this.planningRounds >= this.maxPlanningRounds) {
      return [ModeManager.MODE_TYPES.MAIN];
    }

    // 如果已经有任务了，返回主模式
    if (this.hasActiveTasks()) {
      return [ModeManager.MODE_TYPES.MAIN];
    }

    return [];
  }

  /**
   * 执行规划决策
   */
  private async executePlanningDecision(): Promise<void> {
    if (!this.structuredOutputManager) {
      return;
    }

    // 获取当前目标
    const goalManager = this.state!.context.goalManager;
    const taskManager = this.state!.context.taskManager;
    const currentGoal = goalManager?.getCurrentGoal();

    if (!currentGoal) {
      this.logger.warn('⚠️ 没有当前目标，退出规划模式');
      await this.exitPlanning();
      return;
    }

    // 生成规划提示词
    const prompt = this.generatePlanningPrompt(currentGoal);

    // 生成系统提示词，包含plan_action和可用动作列表（仅名称和描述）
    const planActionPrompt = this.actionPromptGenerator!.generateActionPrompt('plan_action' as any);
    const availableActionsSimplified = this.actionPromptGenerator!.generateSimplifiedActionList(this.state!.context);
    const systemPrompt = promptManager.generatePrompt('planning_system', {
      bot_name: this.state!.context.gameState.playerName || 'Bot',
      plan_action: planActionPrompt,
      available_actions: availableActionsSimplified,
    });

    this.logger.debug('💭 生成规划提示词完成');

    // 请求LLM
    const structuredResponse = await this.structuredOutputManager.requestMainActions(prompt, systemPrompt);

    if (!structuredResponse) {
      this.logger.warn('⚠️ LLM规划响应获取失败');
      return;
    }

    this.logger.info('🤖 LLM 规划响应完成');

    // 记录LLM的思维过程
    if (structuredResponse.thinking) {
      this.state!.memory.recordThought(`🎯 规划思维: ${structuredResponse.thinking}`, {
        context: 'planning',
        mode: 'planning',
        round: this.planningRounds,
      });
    }

    // 执行plan_action
    if (structuredResponse.action) {
      await this.executePlanAction(structuredResponse.action);
    } else {
      this.logger.warn('⚠️ LLM规划响应中没有action字段');
    }
  }

  /**
   * 生成规划提示词
   */
  private generatePlanningPrompt(currentGoal: any): string {
    const goalManager = this.state!.context.goalManager;
    const taskManager = this.state!.context.taskManager;
    const gameState = this.state!.context.gameState;

    // 获取现有任务
    const activeTasks = taskManager?.getActiveTasks(currentGoal.id) || [];
    const taskList = activeTasks.length > 0 ? taskManager!.formatTasks(currentGoal.id, { gameState } as any) : '无任务';

    // 构建提示词数据
    const promptData = {
      bot_name: gameState.playerName || 'Bot',
      current_goal: `🎯 [${currentGoal.id}] ${currentGoal.content}`,
      task_list: taskList,
      inventory: gameState.getInventoryDescription(),
      position: `(${gameState.position?.x.toFixed(1)}, ${gameState.position?.y.toFixed(1)}, ${gameState.position?.z.toFixed(1)})`,
      health: gameState.health,
      food: gameState.food,
      planning_round: this.planningRounds,
      max_rounds: this.maxPlanningRounds,
    };

    return promptManager.generatePrompt('planning_thinking', promptData);
  }

  /**
   * 执行plan_action
   */
  private async executePlanAction(action: StructuredAction): Promise<void> {
    if (!action || action.action_type !== 'plan_action') {
      this.logger.warn('⚠️ 规划模式只能执行plan_action');
      return;
    }

    const actionIntention = action.intention || '执行规划操作';
    this.logger.info(`🎬 执行规划动作: ${actionIntention}`);
    this.logger.debug(`🔍 动作详情: ${JSON.stringify(action, null, 2)}`);

    try {
      const result = await this.state!.context.executor.execute('plan_action' as any, action);

      if (result.success) {
        this.logger.info(`✅ 规划动作成功: ${result.message}`);
        this.state!.memory.recordDecision(actionIntention, { actionType: 'plan_action', params: action }, 'success', result.message);
      } else {
        this.logger.warn(`⚠️ 规划动作失败: ${result.message}`);
        this.state!.memory.recordDecision(actionIntention, { actionType: 'plan_action', params: action }, 'failed', result.message);
      }
    } catch (error) {
      this.logger.error('❌ 规划动作执行异常:', undefined, error as Error);
      this.state!.memory.recordDecision(
        actionIntention,
        { actionType: 'plan_action', params: action },
        'failed',
        `执行异常: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 判断是否应该退出规划
   */
  private shouldExitPlanning(): boolean {
    // 如果已经有任务了，退出规划
    if (this.hasActiveTasks()) {
      this.logger.info('✅ 已创建任务，准备退出规划模式');
      return true;
    }

    // 如果达到最大轮数，退出规划
    if (this.planningRounds >= this.maxPlanningRounds) {
      this.logger.warn('⚠️ 达到最大规划轮数，强制退出规划模式');
      return true;
    }

    return false;
  }

  /**
   * 检查是否有活动任务
   */
  private hasActiveTasks(): boolean {
    const taskManager = this.state?.context.taskManager;
    const goalManager = this.state?.context.goalManager;
    const currentGoal = goalManager?.getCurrentGoal();

    if (!taskManager || !currentGoal) {
      return false;
    }

    const activeTasks = taskManager.getActiveTasks(currentGoal.id);
    return activeTasks.length > 0;
  }

  /**
   * 退出规划模式
   */
  private async exitPlanning(): Promise<void> {
    if (!this.state?.modeManager) {
      return;
    }

    await this.state.modeManager.setMode(ModeManager.MODE_TYPES.MAIN, '规划完成，返回主模式');
  }
}
