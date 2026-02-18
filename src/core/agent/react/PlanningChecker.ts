// src/core/agent/react/PlanningChecker.ts

import type { AgentState } from '@/core/agent/types';
import { getLogger } from '@/utils/Logger';

/**
 * 规划需求检查器
 *
 * 替代原 MainDecisionLoop.checkNeedsPlanning() 和 PlanningMode 的自动检测逻辑
 * 检测条件：有活动目标但没有任务时触发规划
 */
export class PlanningChecker {
  private state: AgentState;
  private lastCheckTime: number = 0;
  private checkInterval: number = 5000; // 5秒检查一次
  private logger = getLogger('PlanningChecker');

  constructor(state: AgentState) {
    this.state = state;
  }

  /**
   * 检查是否需要规划
   * @returns true 表示需要规划
   */
  check(): boolean {
    // 限制检查频率
    const now = Date.now();
    if (now - this.lastCheckTime < this.checkInterval) {
      return false;
    }
    this.lastCheckTime = now;

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
      this.logger.info(`🎯 检测到目标 [${currentGoal.id}] 没有任务，需要规划`);
      this.state.memory?.recordThought(
        `🎯 检测到目标 [${currentGoal.id}] 没有任务，需要规划`,
        { source: 'planning_checker' }
      );
      return true;
    }

    return false;
  }
}
