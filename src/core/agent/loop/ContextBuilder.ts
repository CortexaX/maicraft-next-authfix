/**
 * ContextBuilder - 上下文构建器
 *
 * 负责动态构建每轮 LLM 调用所需的完整上下文
 * 复用 PromptDataCollector 的数据收集逻辑
 */

import type { AgentState } from '@/core/agent/types';
import { PromptDataCollector } from '@/core/agent/prompt/PromptDataCollector';
import { ActionPromptGenerator } from '@/core/actions/ActionPromptGenerator';

/**
 * 上下文构建结果
 */
export interface BuiltContext {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * 上下文构建器
 * 负责动态构建每轮 LLM 调用所需的完整上下文
 */
export class ContextBuilder {
  private dataCollector: PromptDataCollector;
  private state: AgentState;

  constructor(state: AgentState) {
    this.state = state;

    // 复用 PromptDataCollector
    const actionPromptGenerator = new ActionPromptGenerator(state.context.executor!);
    this.dataCollector = new PromptDataCollector(state, actionPromptGenerator);
  }

  /**
   * 构建完整的上下文（system + user prompts）
   */
  buildContext(): BuiltContext {
    return {
      systemPrompt: this.buildSystemPrompt(),
      userPrompt: this.buildUserPrompt(),
    };
  }

  /**
   * 构建 system prompt
   * 动态追加上下文相关提示
   */
  buildSystemPrompt(): string {
    const gameState = this.state.context.gameState;
    const parts: string[] = [];

    // 基础 system prompt
    parts.push(this.getBaseSystemPrompt());

    // 动态追加部分
    if (this.isLowHealth(gameState)) {
      parts.push('\n⚠️ 警告：你的生命值很低，请优先考虑安全！');
    }

    if (this.isLowFood(gameState)) {
      parts.push('\n⚠️ 警告：你的饥饿值很低，请尽快进食！');
    }

    if (this.recentlyFailedToFindBlock()) {
      parts.push('\n💡 提示：你刚才找不到目标方块，请**立即调用移动工具**（如 move）去更远的地方探索寻找！');
    }

    if (this.hasGoalButOnlyPlanning()) {
      parts.push('\n⚠️ 警告：你一直在更新计划，但从未执行实际动作！请**立即停止制定计划**，直接调用 find_block、move、mine_block 等工具执行任务！');
    }

    return parts.join('\n');
  }

  private hasGoalButOnlyPlanning(): boolean {
    const recentDecisions = this.state.memory.decision.getRecent(3);
    if (recentDecisions.length < 3) return false;

    const allPlanning = recentDecisions.every(d => d.intention.includes('plan_action'));
    return allPlanning;
  }

  /**
   * 构建 user prompt（环境观察）
   *
   * 注意：使用 Function Calling 时，工具 schema 通过 tools 参数传递，
   * 不需要在 prompt 里重复。这里只提供环境状态和上下文信息。
   */
  buildUserPrompt(): string {
    // 复用 PromptDataCollector 收集环境数据
    const allData = this.dataCollector.collectAllData();

    // 构建环境观察提示
    const parts: string[] = [];

    // 当前状态
    parts.push('## 当前环境观察\n');
    parts.push(this.formatBasicInfo(allData.baseInfo));

    if (allData.actionData.eat_action) {
      parts.push('\n### ⚠️ 饥饿警告\n');
      parts.push('你的饥饿值较低，请考虑使用 eat 工具进食。');
    }
    if (allData.actionData.kill_mob_action) {
      parts.push('\n### ⚠️ 敌对生物警告\n');
      parts.push('附近有敌对生物，请考虑使用 kill_mob 工具或 move 工具逃离。');
    }

    // 最近的聊天记录
    parts.push('\n## 最近聊天\n');
    parts.push(this.getRecentConversationSummary());

    // 最近的决策历史（从 DecisionMemory 获取）
    parts.push('\n## 最近决策历史\n');
    parts.push(this.getRecentDecisionSummary());

    // 最近的思考记录
    parts.push('\n## 最近思考\n');
    parts.push(this.getRecentThoughtSummary());

    // 当前目标和任务
    parts.push('\n## 当前目标与任务\n');
    parts.push(this.getGoalAndTaskSummary());

    return parts.join('\n');
  }

  /**
   * 获取基础 system prompt
   *
   * 明确指示 LLM 优先使用工具而非纯文本回复
   */
  private getBaseSystemPrompt(): string {
    return `你是一个 Minecraft 游戏AI助手。通过**调用工具**与世界交互并完成任务。

## 核心规则

1. **先思考后行动**：每次回复先用简短的一句话说明你的分析和决策，然后调用工具。
2. **持续行动**：每轮必须调用至少一个工具推进任务。
3. **安全第一**：生命值低时优先躲避或治疗。
4. **探索策略**：找不到资源时立即移动探索，不要重复相同的查找。

## 回复格式示例

思考：附近16格内没有橡木，需要向远处探索。
[调用 move 工具]

记住：思考 + 行动！`;
  }

  // 辅助方法

  private isLowHealth(gameState: any): boolean {
    return gameState.health / gameState.healthMax < 0.3;
  }

  private isLowFood(gameState: any): boolean {
    return gameState.food / gameState.foodMax < 0.3;
  }

  private recentlyFailedToFindBlock(): boolean {
    const recentDecisions = this.state.memory.decision.getRecent(3);
    return recentDecisions.some(d => d.intention.includes('find_block') && d.result === 'failed');
  }

  private formatBasicInfo(baseInfo: any): string {
    return `位置: ${baseInfo.position}
状态: ${baseInfo.self_status_info}
物品栏: ${baseInfo.inventory_info}
附近实体: ${baseInfo.nearby_entities_info}`;
  }

  private getRecentDecisionSummary(): string {
    const recentDecisions = this.state.memory.decision.getRecent(5);
    if (recentDecisions.length === 0) {
      return '暂无最近决策';
    }
    return recentDecisions
      .map((d, i) => {
        const icon = d.result === 'success' ? '✅' : d.result === 'failed' ? '❌' : '⚠️';
        return `${i + 1}. ${icon} ${d.intention} → ${d.feedback || d.result}`;
      })
      .join('\n');
  }

  private getRecentThoughtSummary(): string {
    const recentThoughts = this.state.memory.thought.getRecent(3);
    if (recentThoughts.length === 0) {
      return '暂无最近思考';
    }
    return recentThoughts.map((t, i) => `${i + 1}. ${t.content}`).join('\n');
  }

  private getRecentConversationSummary(): string {
    const conversations = this.state.memory.conversation.getRecent(10);
    if (conversations.length === 0) {
      return '暂无最近聊天';
    }
    const botName = this.state.config.minecraft.username || this.state.context.gameState.playerName || '麦麦';
    return conversations
      .map(c => {
        const speaker = c.speaker === botName ? '[我]' : `[${c.speaker}]`;
        return `${speaker}: ${c.message}`;
      })
      .join('\n');
  }

  private getGoalAndTaskSummary(): string {
    const goalManager = this.state.context.goalManager;
    const currentGoal = goalManager?.getCurrentGoal();

    if (!currentGoal) {
      return '当前没有活动目标。使用 plan_action 工具创建目标。';
    }

    const planSection = currentGoal.plan ? `\n计划: ${currentGoal.plan}` : '\n计划: 暂无执行计划';

    return `目标: ${currentGoal.content}${planSection}`;
  }
}
