/**
 * 目标管理器
 * 负责目标的增删改查、自动检测、格式化显示
 */

import type { Goal, GoalStatus, GoalCompletedBy, CreateGoalParams, UpdateGoalParams } from './Goal';
import type { Tracker } from '../trackers/types';
import { logger } from '@/utils/Logger';
import * as fs from 'fs/promises';
import * as path from 'path';

export class GoalManager {
  private goals: Map<string, Goal> = new Map();

  /**
   * 添加目标
   */
  addGoal(params: CreateGoalParams): Goal {
    // 检查是否已有活动目标
    const activeGoals = this.getActiveGoals();
    if (activeGoals.length > 0) {
      logger.warn(`[GoalManager] 已有 ${activeGoals.length} 个活动目标，不允许添加新目标`);
      logger.warn(`[GoalManager] 当前活动目标: ${activeGoals.map(g => `[${g.id}] ${g.content}`).join(', ')}`);
      throw new Error(`已有活动目标，请先完成或放弃当前目标: ${activeGoals[0].id}`);
    }

    // 生成语义化ID：优先使用LLM传入的ID，否则自动生成
    const id = params.id || this.generateId();
    const uniqueId = this.ensureUniqueId(id);

    const goal: Goal = {
      id: uniqueId,
      content: params.content,
      tracker: params.tracker,
      status: 'active',
      priority: params.priority ?? 3,
      createdAt: Date.now(),
      metadata: params.metadata ?? {},
    };

    this.goals.set(uniqueId, goal);
    logger.info(`[GoalManager] 添加目标: ${uniqueId} - ${params.content}`);

    return goal;
  }

  /**
   * 更新目标
   */
  updateGoal(id: string, updates: UpdateGoalParams): void {
    const goal = this.goals.get(id);
    if (!goal) {
      logger.warn(`[GoalManager] 目标不存在: ${id}`);
      return;
    }

    if (updates.content !== undefined) {
      goal.content = updates.content;
    }
    if (updates.tracker !== undefined) {
      goal.tracker = updates.tracker;
    }
    if (updates.priority !== undefined) {
      goal.priority = updates.priority;
    }
    if (updates.metadata !== undefined) {
      goal.metadata = { ...goal.metadata, ...updates.metadata };
    }

    logger.info(`[GoalManager] 更新目标: ${id}`);
  }

  /**
   * 删除目标
   */
  removeGoal(id: string): void {
    const goal = this.goals.get(id);
    if (!goal) {
      logger.warn(`[GoalManager] 目标不存在: ${id}`);
      return;
    }

    this.goals.delete(id);
    logger.info(`[GoalManager] 删除目标: ${id} - ${goal.content}`);
  }

  /**
   * 完成目标
   */
  completeGoal(id: string, completedBy: GoalCompletedBy): void {
    const goal = this.goals.get(id);
    if (!goal) {
      logger.warn(`[GoalManager] 目标不存在: ${id}`);
      return;
    }

    goal.status = 'completed';
    goal.completedAt = Date.now();
    goal.completedBy = completedBy;

    logger.info(`[GoalManager] ✅ 目标完成: ${id} - ${goal.content} (完成方式: ${completedBy})`);
  }

  /**
   * 放弃目标
   */
  abandonGoal(id: string): void {
    const goal = this.goals.get(id);
    if (!goal) {
      logger.warn(`[GoalManager] 目标不存在: ${id}`);
      return;
    }

    goal.status = 'abandoned';
    logger.info(`[GoalManager] 放弃目标: ${id} - ${goal.content}`);
  }

  /**
   * 自动检测目标完成（后台每次循环调用）
   */
  checkCompletion(context: any): void {
    for (const goal of this.goals.values()) {
      // 只检查活动的、有Tracker的目标
      if (goal.status === 'active' && goal.tracker) {
        try {
          if (goal.tracker.checkCompletion(context)) {
            this.completeGoal(goal.id, 'tracker');
          }
        } catch (error) {
          logger.error(`[GoalManager] 检测目标完成时出错: ${goal.id}`, undefined, error as Error);
        }
      }
    }
  }

  /**
   * 获取当前目标（优先级最高的活动目标）
   */
  getCurrentGoal(): Goal | null {
    const activeGoals = this.getActiveGoals();
    if (activeGoals.length === 0) {
      return null;
    }

    // 按优先级排序，返回优先级最高的
    return activeGoals.sort((a, b) => b.priority - a.priority)[0];
  }

  /**
   * 获取所有活动目标
   */
  getActiveGoals(): Goal[] {
    return Array.from(this.goals.values()).filter(goal => goal.status === 'active');
  }

  /**
   * 获取目标
   */
  getGoal(id: string): Goal | undefined {
    return this.goals.get(id);
  }

  /**
   * 格式化目标列表（用于Prompt）
   */
  formatGoals(context?: any): string {
    const activeGoals = this.getActiveGoals();

    if (activeGoals.length === 0) {
      return '无活动目标';
    }

    // 按优先级排序
    const sortedGoals = activeGoals.sort((a, b) => b.priority - a.priority);

    const lines: string[] = [];
    for (const goal of sortedGoals) {
      let line = `🎯 [${goal.id}] ${goal.content}`;

      // 如果有Tracker，显示进度
      if (goal.tracker && context) {
        try {
          const progress = goal.tracker.getProgress(context);
          line += ` (${progress.description})`;
        } catch (error) {
          // 忽略进度获取错误
        }
      }

      // 显示优先级（如果不是默认值3）
      if (goal.priority !== 3) {
        line += ` [优先级: ${goal.priority}]`;
      }

      lines.push(line);
    }

    return lines.join('\n');
  }

  /**
   * 生成ID（当LLM未提供时使用）
   * 使用时间戳确保唯一性
   */
  private generateId(): string {
    // 直接使用时间戳，简单可靠
    return `goal_${Date.now().toString(36)}`;
  }

  /**
   * 确保ID唯一，如果重复则添加序号
   */
  private ensureUniqueId(baseId: string): string {
    if (!this.goals.has(baseId)) {
      return baseId;
    }

    // 添加数字后缀，从2开始
    let counter = 2;
    while (this.goals.has(`${baseId}_${counter}`)) {
      counter++;
    }

    return `${baseId}_${counter}`;
  }

  /**
   * 序列化
   */
  toJSON(): any {
    return {
      goals: Array.from(this.goals.values()).map(goal => ({
        ...goal,
        tracker: goal.tracker?.toJSON(),
      })),
    };
  }

  /**
   * 反序列化
   */
  static fromJSON(json: any, trackerFactory: any): GoalManager {
    const manager = new GoalManager();

    if (json.goals) {
      for (const goalData of json.goals) {
        const goal: Goal = {
          ...goalData,
          tracker: goalData.tracker ? trackerFactory.fromJSON(goalData.tracker) : undefined,
        };
        manager.goals.set(goal.id, goal);
      }
    }

    return manager;
  }

  /**
   * 清空所有目标
   */
  clear(): void {
    this.goals.clear();
    logger.info('[GoalManager] 清空所有目标');
  }

  /**
   * 保存到文件
   */
  async save(dataDir: string = './data'): Promise<void> {
    try {
      const filePath = path.join(dataDir, 'goals.json');
      const data = this.toJSON();
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      logger.debug('[GoalManager] 目标数据已保存');
    } catch (error: any) {
      logger.error('[GoalManager] 保存目标数据失败:', undefined, error as Error);
    }
  }

  /**
   * 从文件加载
   */
  async load(dataDir: string = './data', trackerFactory: any): Promise<void> {
    try {
      const filePath = path.join(dataDir, 'goals.json');
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(fileContent);

      // 清空当前数据
      this.goals.clear();

      // 加载数据
      if (data.goals) {
        for (const goalData of data.goals) {
          const goal: Goal = {
            ...goalData,
            tracker: goalData.tracker ? trackerFactory.fromJSON(goalData.tracker) : undefined,
          };
          this.goals.set(goal.id, goal);
        }
      }

      logger.info(`[GoalManager] 从文件加载了 ${this.goals.size} 个目标`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.debug('[GoalManager] 目标数据文件不存在，跳过加载');
      } else {
        logger.error('[GoalManager] 加载目标数据失败:', undefined, error as Error);
      }
    }
  }
}
