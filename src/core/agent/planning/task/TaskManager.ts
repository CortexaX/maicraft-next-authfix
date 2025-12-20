/**
 * 任务管理器
 * 负责任务的增删改查、自动检测、格式化显示
 */

import type { Task, TaskStatus, TaskCompletedBy, CreateTaskParams, UpdateTaskParams } from './Task';
import type { Tracker } from '../trackers/types';
import type { GameContext } from '@/core';
import { logger } from '@/utils/Logger';
import * as fs from 'fs/promises';
import * as path from 'path';

export class TaskManager {
  private tasks: Map<string, Task> = new Map();

  /**
   * 添加任务
   */
  addTask(params: CreateTaskParams): Task {
    // 生成语义化ID
    const id = params.id || this.generateId(params.goalId, params.content);
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

    logger.success(`[TaskManager] 任务完成: ${id} - ${task.content} (完成方式: ${completedBy})`);
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
      const statusOrder = { in_progress: 0, pending: 1, completed: 2 };
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
   * 生成语义化ID
   * 格式：goalId + "_" + 关键词
   */
  private generateId(goalId: string, content: string): string {
    // 简单映射常见词
    const simpleMap: Record<string, string> = {
      收集木材: 'collect_wood',
      收集原木: 'collect_logs',
      收集圆石: 'collect_cobblestone',
      收集石头: 'collect_stone',
      收集铁矿: 'collect_iron',
      收集煤炭: 'collect_coal',
      收集钻石: 'collect_diamond',
      制作工作台: 'craft_table',
      制作木镐: 'craft_wooden_pickaxe',
      制作石镐: 'craft_stone_pickaxe',
      制作铁镐: 'craft_iron_pickaxe',
      制作钻石镐: 'craft_diamond_pickaxe',
      制作熔炉: 'craft_furnace',
      向东探索: 'explore_east',
      向西探索: 'explore_west',
      向南探索: 'explore_south',
      向北探索: 'explore_north',
      寻找村庄: 'find_village',
      寻找洞穴: 'find_cave',
      建造避难所: 'build_shelter',
    };

    // 优先使用映射表
    if (simpleMap[content]) {
      return `${goalId}_${simpleMap[content]}`;
    }

    // 提取关键词（去除特殊字符）
    let keywords = content
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
      .replace(/^_|_$/g, '');

    // 如果包含中文，尝试提取动词+名词的组合
    if (/[\u4e00-\u9fa5]/.test(keywords)) {
      // 尝试匹配常见模式
      const actionMap: Record<string, string> = {
        收集: 'collect',
        制作: 'craft',
        建造: 'build',
        寻找: 'find',
        探索: 'explore',
        前往: 'goto',
        挖掘: 'mine',
        种植: 'plant',
        砍伐: 'chop',
      };

      // 提取中文部分的前几个字作为关键词
      const chineseChars = keywords.match(/[\u4e00-\u9fa5]+/g);
      if (chineseChars && chineseChars.length > 0) {
        const firstWord = chineseChars[0];
        // 检查是否包含动作词
        for (const [cn, en] of Object.entries(actionMap)) {
          if (firstWord.includes(cn)) {
            const obj = firstWord.replace(cn, '');
            if (obj) {
              keywords = `${en}_${obj}`;
              break;
            }
          }
        }
        // 如果仍是中文，使用拼音首字母或简短描述
        if (/[\u4e00-\u9fa5]/.test(keywords)) {
          keywords = `task_${firstWord.substring(0, 2)}`;
        }
      }
    }

    // 限制长度
    if (keywords.length > 20) {
      keywords = keywords.substring(0, 20);
    }

    return `${goalId}_${keywords}`;
  }

  /**
   * 确保ID唯一
   */
  private ensureUniqueId(baseId: string): string {
    if (!this.tasks.has(baseId)) {
      return baseId;
    }

    // 添加数字后缀
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
