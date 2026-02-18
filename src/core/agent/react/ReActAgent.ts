// src/core/agent/react/ReActAgent.ts

import type { AgentState } from '@/core/agent/types';
import type { Observation, RetrievedMemories, ActionResult } from './types';
import type { StructuredAction, StructuredLLMResponse } from '@/core/agent/structured/ActionSchema';
import { getLogger } from '@/utils/Logger';
import { UrgentChecker } from './UrgentChecker';
import { ObservationCollector } from './ObservationCollector';
import { ReActHistory } from './ReActHistory';
import { PlanningChecker } from './PlanningChecker';
import { StructuredOutputManager } from '@/core/agent/structured/StructuredOutputManager';
import { promptManager } from '@/core/agent/prompt/prompt_manager';
import { ActionPromptGenerator } from '@/core/actions/ActionPromptGenerator';

const logger = getLogger('ReActAgent');

/**
 * ReAct Agent - 基于 ReAct 模式的决策代理
 *
 * 实现经典的 Thought-Action-Observation 循环：
 * 1. 观察当前游戏状态
 * 2. 检索相关记忆
 * 3. 思考并做出决策
 * 4. 执行动作
 * 5. 记录结果到历史和记忆
 */
export class ReActAgent {
  private state: AgentState;

  // 组件
  private urgentChecker: UrgentChecker;
  private observationCollector: ObservationCollector;
  private reactHistory: ReActHistory;
  private planningChecker: PlanningChecker;
  private structuredOutputManager: StructuredOutputManager;
  private actionPromptGenerator: ActionPromptGenerator;

  constructor(state: AgentState) {
    this.state = state;
    this.urgentChecker = new UrgentChecker(state);
    this.observationCollector = new ObservationCollector(state);
    this.reactHistory = new ReActHistory();
    this.planningChecker = new PlanningChecker(state);
    this.structuredOutputManager = new StructuredOutputManager(state.llmManager);
    this.actionPromptGenerator = new ActionPromptGenerator(state.context.executor!);
  }

  /**
   * 运行一次 ReAct 迭代
   * @returns 动作执行结果，如果需要规划则返回 null
   */
  async runIteration(): Promise<ActionResult | null> {
    logger.debug('开始 ReAct 迭代');

    // 1. 检查是否需要规划
    if (this.planningChecker.check()) {
      logger.info('检测到需要规划，暂停当前迭代');
      return null;
    }

    // 2. 检查紧急情况
    const urgentAction = await this.urgentChecker.check();
    if (urgentAction) {
      logger.info('处理紧急情况');
      return this.executeAction(urgentAction, 'urgent');
    }

    // 3. 收集观察
    const observation = await this.observationCollector.collect();
    logger.debug('观察收集完成', { position: observation.position });

    // 4. 检索相关记忆
    const memories = this.retrieveMemories(observation);

    // 5. 构建提示词并调用 LLM
    const { userPrompt, systemPrompt } = this.buildPrompt(observation, memories);

    let response: StructuredLLMResponse | null = null;
    try {
      response = await this.structuredOutputManager.requestMainActions(userPrompt, systemPrompt);
    } catch (error) {
      logger.error('LLM 请求失败', undefined, error as Error);
      return {
        success: false,
        message: 'LLM 请求失败',
        observation: '无法获取决策',
        source: 'planned',
      };
    }

    if (!response || !response.action) {
      logger.warn('LLM 未返回有效动作');
      return {
        success: false,
        message: 'LLM 未返回有效动作',
        observation: '决策无效',
        source: 'planned',
      };
    }

    // 6. 执行动作
    const result = await this.executeAction(response.action, 'planned');

    // 7. 记录到 ReAct 历史和记忆
    const thought = response.thinking || '无思考过程';
    this.recordToMemory(thought, response.action, result);
    this.reactHistory.add({
      thought,
      action: response.action,
      observation: result.observation,
    });

    logger.info('ReAct 迭代完成', {
      action: response.action.action_type,
      success: result.success,
    });

    return result;
  }

  /**
   * 检索相关记忆
   */
  private retrieveMemories(observation: Observation): RetrievedMemories {
    const memory = this.state.memory;

    // 获取最近的各类记忆
    const thoughts = memory.thought.getRecent(5);
    const decisions = memory.decision.getRecent(5);
    const conversations = memory.conversation.getRecent(3);
    const experiences = memory.experience.getRecent(3);

    // 构建格式化摘要
    const formattedSummary = memory.buildContextSummary({
      includeThoughts: 5,
      includeDecisions: 5,
      includeConversations: 3,
      includeExperiences: 3,
    });

    return {
      thoughts,
      decisions,
      experiences,
      conversations,
      formattedSummary,
    };
  }

  /**
   * 记录到记忆系统
   */
  private recordToMemory(thought: string, action: StructuredAction, result: ActionResult): void {
    const memory = this.state.memory;

    // 记录思考
    memory.recordThought(thought, {
      source: 'react_agent',
      action_type: action.action_type,
    });

    // 记录决策
    memory.recordDecision(
      action.intention || `执行 ${action.action_type}`,
      action,
      result.success ? 'success' : 'failed',
      result.message,
    );
  }

  /**
   * 构建提示词
   */
  private buildPrompt(
    observation: Observation,
    memories: RetrievedMemories,
  ): { userPrompt: string; systemPrompt: string } {
    // 构建当前目标描述
    const currentGoal = this.formatCurrentGoal(observation);

    // 构建观察描述
    const observationStr = this.formatObservation(observation);

    // 获取格式化的历史
    const reactHistoryStr = this.reactHistory.getFormattedHistory();

    // 尝试使用模板生成提示词
    let userPrompt: string;
    let systemPrompt: string;

    try {
      // 使用 react_thinking 模板生成用户提示词
      userPrompt = promptManager.generatePrompt('react_thinking', {
        observation: observationStr,
        react_history: reactHistoryStr,
        relevant_memories: memories.formattedSummary,
        current_goal: currentGoal,
      });
    } catch (error) {
      logger.warn('使用模板生成提示词失败，使用默认格式');
      userPrompt = this.buildDefaultUserPrompt(observation, memories, currentGoal);
    }

    try {
      // 获取可用动作
      const availableActions = this.actionPromptGenerator.generatePrompt(this.state.context);

      // 使用 react_system 模板生成系统提示词
      const botName = this.state.config?.minecraft?.username || '麦麦';
      systemPrompt = promptManager.generatePrompt('react_system', {
        bot_name: botName,
        available_actions: availableActions,
      });
    } catch (error) {
      logger.warn('使用模板生成系统提示词失败，使用默认格式');
      systemPrompt = this.buildDefaultSystemPrompt();
    }

    return { userPrompt, systemPrompt };
  }

  /**
   * 执行动作
   */
  private async executeAction(action: StructuredAction, source: 'urgent' | 'planned'): Promise<ActionResult> {
    const executor = this.state.context.executor;
    if (!executor) {
      return {
        success: false,
        message: '执行器未初始化',
        observation: '无法执行动作',
        source,
      };
    }

    const actionType = action.action_type as any;

    // 构建 action params (移除 action_type 和 intention)
    const params: Record<string, any> = { ...action };
    delete params.action_type;
    delete params.intention;

    try {
      logger.info(`执行动作: ${actionType}`, params);
      const result = await executor.execute(actionType, params);

      return {
        success: result.success,
        message: result.message,
        observation: result.message,
        source,
      };
    } catch (error) {
      const err = error as Error;
      logger.error(`动作执行失败: ${actionType}`, undefined, err);
      return {
        success: false,
        message: err.message,
        observation: `执行失败: ${err.message}`,
        source,
      };
    }
  }

  /**
   * 格式化当前目标
   */
  private formatCurrentGoal(observation: Observation): string {
    const goal = observation.currentGoal;
    if (!goal) {
      return '暂无明确目标';
    }

    if (typeof goal === 'string') {
      return goal;
    }

    if (goal.title) {
      return `${goal.title}${goal.description ? `: ${goal.description}` : ''}`;
    }

    return JSON.stringify(goal);
  }

  /**
   * 格式化观察
   */
  private formatObservation(observation: Observation): string {
    const lines: string[] = [];

    // 位置
    lines.push(`## 位置`);
    lines.push(`坐标: (${observation.position.x.toFixed(1)}, ${observation.position.y.toFixed(1)}, ${observation.position.z.toFixed(1)})`);

    // 健康状态
    lines.push(`\n## 健康状态`);
    lines.push(`生命值: ${observation.health}/20`);
    lines.push(`饥饿值: ${observation.food}/20`);
    lines.push(`饱和度: ${observation.saturation.toFixed(1)}`);

    // 附近实体
    if (observation.nearbyEntities && observation.nearbyEntities.length > 0) {
      lines.push(`\n## 附近实体`);
      const entityStrs = observation.nearbyEntities.slice(0, 10).map((e: any) => {
        const name = e.name || 'unknown';
        const distance = e.distance ? ` (${e.distance.toFixed(1)}m)` : '';
        return `${name}${distance}`;
      });
      lines.push(entityStrs.join(', '));
    }

    // 附近方块
    lines.push(`\n## 附近方块`);
    lines.push(observation.nearbyBlocks);

    // 物品栏
    lines.push(`\n## 物品栏`);
    lines.push(observation.inventory);

    // 时间
    const timeOfDay = observation.timeOfDay;
    const timeStr = timeOfDay < 6000 ? '早晨' :
                    timeOfDay < 12000 ? '白天' :
                    timeOfDay < 18000 ? '傍晚' : '夜晚';
    lines.push(`\n## 时间`);
    lines.push(`${timeStr} (${timeOfDay})`);

    return lines.join('\n');
  }

  /**
   * 构建默认用户提示词
   */
  private buildDefaultUserPrompt(
    observation: Observation,
    memories: RetrievedMemories,
    currentGoal: string,
  ): string {
    return `# 当前观察

${this.formatObservation(observation)}

# 最近的历史

${this.reactHistory.getFormattedHistory()}

# 相关记忆

${memories.formattedSummary}

# 当前目标

${currentGoal}

---

请基于以上信息：
1. 分析当前情况
2. 思考下一步应该做什么
3. 选择一个动作执行`;
  }

  /**
   * 构建默认系统提示词
   */
  private buildDefaultSystemPrompt(): string {
    const botName = this.state.config?.minecraft?.username || '麦麦';
    const availableActions = this.actionPromptGenerator.generatePrompt(this.state.context);

    return `你是 ${botName}，一个在 Minecraft 世界中的 AI 代理。

你使用 ReAct 模式进行决策：
1. **观察**: 理解当前游戏状态
2. **思考**: 分析情况并制定计划
3. **行动**: 选择并执行一个动作

## 可用动作

${availableActions}

## 决策原则

1. 优先处理紧急情况（低血量、敌对生物靠近）
2. 持续推进当前目标
3. 如果遇到困难，可以调整策略
4. 保持行动的连贯性

## 输出格式

返回 JSON 格式：
{
  "thinking": "你的思考过程",
  "action": {
    "action_type": "动作名称",
    ...参数
  }
}`;
  }

  /**
   * 获取 ReAct 历史记录
   */
  getHistory(): ReActHistory {
    return this.reactHistory;
  }

  /**
   * 获取紧急检查器
   */
  getUrgentChecker(): UrgentChecker {
    return this.urgentChecker;
  }

  /**
   * 获取规划检查器
   */
  getPlanningChecker(): PlanningChecker {
    return this.planningChecker;
  }

  /**
   * 清空历史记录
   */
  clearHistory(): void {
    this.reactHistory.clear();
  }
}
