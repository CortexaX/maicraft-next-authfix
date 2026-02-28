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
    const actionPromptGenerator = new ActionPromptGenerator(state.context.executor);
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

    // 有目标但无任务的提示
    if (this.hasGoalButNoTasks()) {
      parts.push('\n💡 提示：你有目标但没有任务，考虑使用 plan_action 工具来规划具体任务。');
    }

    return parts.join('\n');
  }

  /**
   * 构建 user prompt（环境观察）
   */
  buildUserPrompt(): string {
    // 复用 PromptDataCollector 收集环境数据
    const allData = this.dataCollector.collectAllData();

    // 构建环境观察提示
    const parts: string[] = [];

    // 当前状态
    parts.push('## 当前环境观察\n');
    parts.push(this.formatBasicInfo(allData.baseInfo));

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
   */
  private getBaseSystemPrompt(): string {
    return `你是一个 Minecraft 游戏助手。你可以使用工具来与世界交互。

核心原则：
1. 安全第一：生命值低时优先躲避或治疗
2. 效率优先：选择最优路径和方法
3. 计划先行：复杂目标需要先规划任务

你可以使用多种工具来完成任务。每次调用工具后，你会看到执行结果，然后可以决定下一步行动。`;
  }

  // 辅助方法

  private isLowHealth(gameState: any): boolean {
    return gameState.health / gameState.healthMax < 0.3;
  }

  private isLowFood(gameState: any): boolean {
    return gameState.food / gameState.foodMax < 0.3;
  }

  private hasGoalButNoTasks(): boolean {
    const goalManager = this.state.context.goalManager;
    const taskManager = this.state.context.taskManager;
    const currentGoal = goalManager?.getCurrentGoal();
    if (!currentGoal) return false;
    const activeTasks = taskManager?.getActiveTasks(currentGoal.id) || [];
    return activeTasks.length === 0;
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
    const taskManager = this.state.context.taskManager;
    const currentGoal = goalManager?.getCurrentGoal();

    if (!currentGoal) {
      return '当前没有活动目标。使用 plan_action 工具创建目标。';
    }

    const activeTasks = taskManager?.getActiveTasks(currentGoal.id) || [];
    const taskLines = activeTasks.slice(0, 5).map((t: any) => {
      const status = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳';
      return `  ${status} ${t.content}`;
    });

    return `目标: ${currentGoal.content}
任务:
${taskLines.length > 0 ? taskLines.join('\n') : '  暂无任务'}`;
  }
}
