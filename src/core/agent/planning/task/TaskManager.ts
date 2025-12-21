/**
 * 任务管理器
 * 负责任务的增删改查、自动检测、格式化显示
 */

import type { Task, TaskStatus, TaskCompletedBy, CreateTaskParams, UpdateTaskParams } from './Task';
import type { Tracker } from '../trackers/types';
import type { GameContext } from '../../types';
import { logger } from '@/utils/Logger';
import * as fs from 'fs/promises';
import * as path from 'path';

export class TaskManager {
  private tasks: Map<string, Task> = new Map();

  /**
   * 添加任务
   */
  addTask(params: CreateTaskParams): Task {
    // 生成语义化ID：优先使用LLM传入的ID，否则自动生成
    const id = params.id || this.generateId();
    const uniqueId = this.ensureUniqueId(id);

    const task: Task = {
      id: uniqueId,
      content: params.content,
      goalId: params.goalId,
      tracker: params.tracker,
      status: 'pending',
      priority: params.priority ?? 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: params.metadata ?? {},
    };

    this.tasks.set(uniqueId, task);
    logger.info(`[TaskManager] 添加任务: ${uniqueId} - ${params.content} (目标: ${params.goalId})`);

    return task;
  }

  /**
   * 更新任务
   */
  updateTask(id: string, updates: UpdateTaskParams): void {
    const task = this.tasks.get(id);
    if (!task) {
      logger.warn(`[TaskManager] 任务不存在: ${id}`);
      return;
    }

    if (updates.content !== undefined) {
      task.content = updates.content;
    }
    if (updates.tracker !== undefined) {
      task.tracker = updates.tracker;
    }
    if (updates.priority !== undefined) {
      task.priority = updates.priority;
    }
    if (updates.status !== undefined) {
      task.status = updates.status;
    }
    if (updates.metadata !== undefined) {
      task.metadata = { ...task.metadata, ...updates.metadata };
    }

    task.updatedAt = Date.now();
    logger.info(`[TaskManager] 更新任务: ${id}`);
  }

  /**
   * 删除任务
   */
  removeTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      logger.warn(`[TaskManager] 任务不存在: ${id}`);
      return;
    }

    this.tasks.delete(id);
    logger.info(`[TaskManager] 删除任务: ${id} - ${task.content}`);
  }

  /**
   * 完成任务
   */
  completeTask(id: string, completedBy: TaskCompletedBy): void {
    const task = this.tasks.get(id);
    if (!task) {
      logger.warn(`[TaskManager] 任务不存在: ${id}`);
      return;
    }

    task.status = 'completed';
    task.completedAt = Date.now();
    task.updatedAt = Date.now();
    task.completedBy = completedBy;

    logger.info(`[TaskManager] ✅ 任务完成: ${id} - ${task.content} (完成方式: ${completedBy})`);
  }

  /**
   * 取消任务
   */
  cancelTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      logger.warn(`[TaskManager] 任务不存在: ${id}`);
      return;
    }

    task.status = 'cancelled';
    task.updatedAt = Date.now();
    logger.info(`[TaskManager] 取消任务: ${id} - ${task.content}`);
  }

  /**
   * 开始任务
   */
  startTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      logger.warn(`[TaskManager] 任务不存在: ${id}`);
      return;
    }

    task.status = 'in_progress';
    task.updatedAt = Date.now();
    logger.info(`[TaskManager] 开始任务: ${id} - ${task.content}`);
  }

  /**
   * 自动检测任务完成（后台每次循环调用）
   */
  checkCompletion(context: GameContext): void {
    for (const task of this.tasks.values()) {
      // 只检查未完成的、有Tracker的任务
      if ((task.status === 'pending' || task.status === 'in_progress') && task.tracker) {
        try {
          if (task.tracker.checkCompletion(context)) {
            this.completeTask(task.id, 'tracker');
          }
        } catch (error) {
          logger.error(`[TaskManager] 检测任务完成时出错: ${task.id}`, error);
        }
      }
    }
  }

  /**
   * 获取指定目标的所有任务
   */
  getTasksByGoal(goalId: string): Task[] {
    return Array.from(this.tasks.values()).filter(task => task.goalId === goalId);
  }

  /**
   * 获取指定目标的未完成任务
   */
  getActiveTasks(goalId?: string): Task[] {
    const tasks = Array.from(this.tasks.values()).filter(task => task.status === 'pending' || task.status === 'in_progress');

    if (goalId) {
      return tasks.filter(task => task.goalId === goalId);
    }

    return tasks;
  }

  /**
   * 获取任务
   */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /**
   * 格式化任务列表（用于Prompt）
   */
  formatTasks(goalId?: string, context?: GameContext): string {
    let tasks = Array.from(this.tasks.values());

    // 如果指定了goalId，只显示该目标的任务
    if (goalId) {
      tasks = tasks.filter(task => task.goalId === goalId);
    }

    // 过滤掉已取消的任务
    tasks = tasks.filter(task => task.status !== 'cancelled');

    if (tasks.length === 0) {
      return '无任务';
    }

    // 按优先级和状态排序
    const sortedTasks = tasks.sort((a, b) => {
      // 优先级高的在前
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // 进行中的在前，然后是待处理，最后是已完成
      const statusOrder: Record<string, number> = {
        in_progress: 0,
        pending: 1,
        completed: 2,
        cancelled: 3
      };
      return statusOrder[a.status] - statusOrder[b.status];
    });

    const lines: string[] = [];
    for (const task of sortedTasks) {
      let emoji = '⏳'; // 默认待处理
      if (task.status === 'completed') {
        emoji = '✅';
      } else if (task.status === 'in_progress') {
        emoji = '🔄';
      }

      let line = `${emoji} [${task.id}] ${task.content}`;

      // 如果有Tracker，显示进度
      if (task.tracker && context && task.status !== 'completed') {
        try {
          const progress = task.tracker.getProgress(context);
          line += ` (${progress.description})`;
        } catch (error) {
          // 忽略进度获取错误
        }
      }

      // 显示优先级（如果不是默认值3）
      if (task.priority !== 3) {
        line += ` [优先级: ${task.priority}]`;
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
    return `task_${Date.now().toString(36)}`;
  }

  /**
   * 确保ID唯一，如果重复则添加序号
   */
  private ensureUniqueId(baseId: string): string {
    if (!this.tasks.has(baseId)) {
      return baseId;
    }

    // 添加数字后缀，从2开始
    let counter = 2;
    while (this.tasks.has(`${baseId}_${counter}`)) {
      counter++;
    }

    return `${baseId}_${counter}`;
  }

  /**
   * 删除指定目标的所有任务
   */
  removeTasksByGoal(goalId: string): void {
    const tasksToRemove = Array.from(this.tasks.values()).filter(task => task.goalId === goalId);

    for (const task of tasksToRemove) {
      this.tasks.delete(task.id);
    }

    logger.info(`[TaskManager] 删除目标 ${goalId} 的所有任务`);
  }

  /**
   * 序列化
   */
  toJSON(): any {
    return {
      tasks: Array.from(this.tasks.values()).map(task => ({
        ...task,
        tracker: task.tracker?.toJSON(),
      })),
    };
  }

  /**
   * 反序列化
   */
  static fromJSON(json: any, trackerFactory: any): TaskManager {
    const manager = new TaskManager();

    if (json.tasks) {
      for (const taskData of json.tasks) {
        const task: Task = {
          ...taskData,
          tracker: taskData.tracker ? trackerFactory.fromJSON(taskData.tracker) : undefined,
        };
        manager.tasks.set(task.id, task);
      }
    }

    return manager;
  }

  /**
   * 清空所有任务
   */
  clear(): void {
    this.tasks.clear();
    logger.info('[TaskManager] 清空所有任务');
  }

  /**
   * 保存到文件
   */
  async save(dataDir: string = './data'): Promise<void> {
    try {
      const filePath = path.join(dataDir, 'tasks.json');
      const data = this.toJSON();
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      logger.debug('[TaskManager] 任务数据已保存');
    } catch (error) {
      logger.error('[TaskManager] 保存任务数据失败:', error);
    }
  }

  /**
   * 从文件加载
   */
  async load(dataDir: string = './data', trackerFactory: any): Promise<void> {
    try {
      const filePath = path.join(dataDir, 'tasks.json');
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(fileContent);

      // 清空当前数据
      this.tasks.clear();

      // 加载数据
      if (data.tasks) {
        for (const taskData of data.tasks) {
          const task: Task = {
            ...taskData,
            tracker: taskData.tracker ? trackerFactory.fromJSON(taskData.tracker) : undefined,
          };
          this.tasks.set(task.id, task);
        }
      }

      logger.info(`[TaskManager] 从文件加载了 ${this.tasks.size} 个任务`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.debug('[TaskManager] 任务数据文件不存在，跳过加载');
      } else {
        logger.error('[TaskManager] 加载任务数据失败:', error);
      }
    }
  }
}
