/**
 * 主决策循环
 *
 * 参考原maicraft的run_execute_loop设计
 * 职责：
 * - 检查中断
 * - 通知游戏状态更新
 * - 执行当前模式逻辑
 * - 定期评估任务
 */

import type { AgentState } from '@/core/agent/types';
import { LLMManager } from '@/llm/LLMManager';
import { BaseLoop } from './BaseLoop';
import { promptManager, initAllTemplates } from '@/core/agent/prompt';
import { ModeManager } from '@/core/agent/mode/ModeManager';
import { StructuredOutputManager } from '@/core/agent/structured';
import { PromptDataCollector } from '@/core/agent/prompt/PromptDataCollector';
import { ActionPromptGenerator } from '@/core/actions/ActionPromptGenerator';

export class MainDecisionLoop extends BaseLoop<AgentState> {
  private llmManager: LLMManager;
  private structuredOutputManager: StructuredOutputManager;
  private promptsInitialized: boolean = false;
  private dataCollector: PromptDataCollector;

  constructor(state: AgentState, llmManager: LLMManager) {
    super(state, 'MainDecisionLoop');

    // 必须传入 llmManager，不允许创建新实例
    this.llmManager = llmManager;

    // 初始化结构化输出管理器
    this.structuredOutputManager = new StructuredOutputManager(llmManager, {
      useStructuredOutput: true,
    });

    // 初始化数据收集器（复用主模式的数据收集逻辑）
    const actionPromptGenerator = new ActionPromptGenerator(state.context.executor);
    this.dataCollector = new PromptDataCollector(state, actionPromptGenerator);

    // 初始化提示词模板（只初始化一次）
    if (!this.promptsInitialized) {
      console.log('🔧 MainDecisionLoop: 初始化提示词模板...');
      initAllTemplates();
      this.promptsInitialized = true;
      this.logger.info('✅ 提示词模板初始化完成');
      console.log('✅ MainDecisionLoop: 提示词模板初始化完成');
    }
  }

  /**
   * 执行一次循环迭代
   * 采用ReAct模式：观察 → 思考 → 工具调用 → 观察结果
   */
  protected async runLoopIteration(): Promise<void> {
    // 1. 检查中断
    if (this.state.interrupt.isInterrupted()) {
      const reason = this.state.interrupt.getReason();
      this.state.interrupt.clear();
      this.logger.warn(`⚠️ 决策循环被中断: ${reason}`);
      await this.sleep(1000);
      return;
    }

    // 2. 自动检测目标和任务完成（每次循环）
    try {
      const goalManager = this.state.context.goalManager;
      const taskManager = this.state.context.taskManager;
      const gameContext = {
        gameState: this.state.context.gameState,
      } as any;

      if (goalManager) {
        goalManager.checkCompletion(gameContext);
      }
      if (taskManager) {
        taskManager.checkCompletion(gameContext);
      }
    } catch (error) {
      this.logger.error('❌ 目标/任务自动检测失败:', undefined, error as Error);
    }

    // 3. 通知游戏状态更新
    await this.notifyGameStateUpdate();

    // 4. 检查是否需要进入规划模式
    const needsPlanning = this.checkNeedsPlanning();
    if (needsPlanning && this.state.modeManager.getCurrentMode() !== 'planning_mode') {
      this.logger.info('🎯 检测到需要规划，切换到规划模式');
      await this.state.modeManager.setMode(ModeManager.MODE_TYPES.PLANNING, '有目标但无任务，需要规划');
      // 模式切换后，跳过本次决策，让规划模式在下次循环中执行
      await this.sleep(500);
      return;
    }

    // 5. 检查模式自动切换
    const modeSwitched = await this.state.modeManager.checkAutoTransitions();
    if (modeSwitched) {
      this.logger.debug('✨ 模式已自动切换');
      // 模式切换后，跳过本次决策，让新模式在下次循环中执行
      await this.sleep(500);
      return;
    }

    // 6. 执行当前模式逻辑
    await this.executeCurrentMode();

    // 7. 定期总结经验（每10次循环）
    // 注意：删除了任务评估，改为自动检测
    // TODO: 添加循环计数器（如需要）

    // 7. 根据当前模式调整等待时间
    await this.adjustSleepDelay();
  }

  /**
   * 通知游戏状态更新
   * 替代原maicraft的环境监听器机制
   */
  private async notifyGameStateUpdate(): Promise<void> {
    try {
      const gameState = this.state.context.gameState;
      await this.state.modeManager.notifyGameStateUpdate(gameState);
    } catch (error) {
      this.logger.error('❌ 游戏状态通知失败:', undefined, error as Error);
    }
  }

  /**
   * 检查是否需要进入规划模式
   * 触发条件：有活动目标但没有任务时
   */
  private checkNeedsPlanning(): boolean {
    const goalManager = this.state.context.goalManager;
    const taskManager = this.state.context.taskManager;

    if (!goalManager || !taskManager) {
      return false;
    }

    // 获取当前目标
    const currentGoal = goalManager.getCurrentGoal();
    if (!currentGoal) {
      return false; // 没有目标，不需要规划
    }

    // 获取当前目标的活动任务
    const activeTasks = taskManager.getActiveTasks(currentGoal.id);

    // 如果有目标但没有任务，需要规划
    if (activeTasks.length === 0) {
      this.logger.debug(`🎯 检测到目标 [${currentGoal.id}] 没有任务，需要规划`);
      return true;
    }

    return false;
  }

  /**
   * 检查并生成计划（已废弃 - 新系统使用ReAct模式）
   */
  private async checkAndGeneratePlan(): Promise<void> {
    // 新系统中不需要预先生成计划
  }

  /**
   * 执行当前模式逻辑
   * 参考原maicraft：直接调用当前模式的执行方法
   */
  private async executeCurrentMode(): Promise<void> {
    try {
      await this.state.modeManager.executeCurrentMode();
    } catch (error) {
      this.logger.error('❌ 模式执行失败:', undefined, error as Error);

      // 安全机制：严重错误时强制恢复到主模式
      if (this.state.modeManager.getCurrentMode() !== ModeManager.MODE_TYPES.MAIN) {
        this.logger.warn('🔄 检测到模式执行异常，尝试恢复到主模式');
        await this.state.modeManager.forceRecoverToMain('模式执行异常恢复');
      }
    }
  }

  /**
   * 根据当前模式调整等待时间
   */
  private async adjustSleepDelay(): Promise<void> {
    const currentMode = this.state.modeManager.getCurrentMode();

    switch (currentMode) {
      case ModeManager.MODE_TYPES.COMBAT:
        // 战斗模式需要快速响应
        await this.sleep(200);
        break;
      case ModeManager.MODE_TYPES.MAIN:
        // 主模式正常间隔
        await this.sleep(100);
        break;
      default:
        // 其他模式默认间隔
        await this.sleep(500);
        break;
    }
  }

  /**
   * 评估任务（已废弃 - 新系统使用自动检测）
   */
  private async evaluateTask(): Promise<void> {
    // 新系统中使用Tracker自动检测任务完成，不需要定期评估
  }

  /**
   * 总结经验教训
   * 通过LLM分析最近的决策历史，提取多条简短的经验教训
   */
  private async summarizeExperience(): Promise<void> {
    try {
      const { memory } = this.state;

      // 获取最近的决策记录
      const recentDecisions = memory.decision.getRecent(20);
      const recentThoughts = memory.thought.getRecent(10);

      this.logger.info(`📊 经验总结: 决策记录 ${recentDecisions.length} 条, 思维记录 ${recentThoughts.length} 条`);

      if (recentDecisions.length === 0) {
        this.logger.info('⚠️ 没有足够的决策记录，跳过经验总结');
        return;
      }

      // 检查模板是否存在
      try {
        const template = promptManager.getTemplate('experience_summary');
        if (!template) {
          this.logger.error('❌ 经验总结模板不存在');
          return;
        }
      } catch (error) {
        this.logger.error('❌ 检查经验总结模板失败', undefined, error as Error);
        return;
      }

      // 构建经验总结提示词
      const experienceData = {
        recent_decisions: recentDecisions
          .map(d => {
            const resultIcon = d.result === 'success' ? '✅' : d.result === 'failed' ? '❌' : '⚠️';
            const feedback = d.feedback ? ` | ${d.feedback}` : '';
            return `${resultIcon} ${d.intention}${feedback}`;
          })
          .join('\n'),
        recent_thoughts: recentThoughts.map((t, i) => `${i + 1}. ${t.content}`).join('\n'),
        current_goal: this.state.goal,
        current_task: '无任务', // 新系统中不再有单一currentTask
      };

      this.logger.debug('经验总结数据构建完成', {
        decisionsCount: recentDecisions.length,
        thoughtsCount: recentThoughts.length,
        goal: experienceData.current_goal,
        task: experienceData.current_task,
      });

      const prompt = promptManager.generatePrompt('experience_summary', experienceData);
      const systemPrompt = promptManager.generatePrompt('experience_summary_system', {
        bot_name: this.state.context.gameState.playerName || 'Bot',
      });

      this.logger.debug('经验总结提示词生成完成', {
        promptLength: prompt.length,
        systemPromptLength: systemPrompt.length,
      });

      // 使用结构化输出管理器
      const summaryResponse = await this.structuredOutputManager.requestExperienceSummary(prompt, systemPrompt);

      if (summaryResponse && summaryResponse.lessons && summaryResponse.lessons.length > 0) {
        // 记录总体分析（如果有）
        if (summaryResponse.analysis) {
          this.logger.info(`📊 总体分析: ${summaryResponse.analysis}`);
        }

        // 记录每条经验
        let successCount = 0;
        for (const lesson of summaryResponse.lessons) {
          try {
            memory.recordExperience(lesson.lesson, lesson.context, lesson.confidence);
            successCount++;

            this.logger.info(`📚 经验 ${successCount}: ${lesson.lesson} (置信度: ${(lesson.confidence * 100).toFixed(0)}%)`);
          } catch (error) {
            this.logger.error('❌ 记录单条经验失败', { lesson }, error as Error);
          }
        }

        this.logger.info(`✅ 成功记录 ${successCount}/${summaryResponse.lessons.length} 条经验`);
      } else {
        this.logger.warn('⚠️ 未能从LLM响应中提取到有效的经验教训');
      }
    } catch (error) {
      this.logger.error('❌ 经验总结异常', undefined, error as Error);
    }
  }
}
