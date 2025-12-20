/**
 * 任务数据结构
 * Task 是具体的、可用单一动作完成的任务
 * 示例："收集20个橡木原木"、"制作工作台"、"到达坐标(100, 64, 200)"
 */

import type { Tracker } from '../trackers/types';

/**
 * 任务状态
 */
export type TaskStatus =
  | 'pending' // 待处理
  | 'in_progress' // 进行中
  | 'completed' // 已完成
  | 'cancelled'; // 已取消

/**
 * 任务完成方式
 */
export type TaskCompletedBy = 'tracker' | 'llm';

/**
 * 任务接口
 */
export interface Task {
  /** 语义化ID，如 "find_village_explore_east" */
  id: string;

  /** 任务描述 */
  content: string;

  /** 所属目标ID（必需） */
  goalId: string;

  /** 可选的自动检测Tracker */
  tracker?: Tracker;

  /** 任务状态 */
  status: TaskStatus;

  /** 优先级 1-5，默认3 */
  priority: number;

  /** 创建时间戳 */
  createdAt: number;

  /** 更新时间戳 */
  updatedAt: number;

  /** 完成时间戳 */
  completedAt?: number;

  /** 完成方式：tracker自动检测 或 LLM手动标记 */
  completedBy?: TaskCompletedBy;

  /** 元数据，用于存储额外信息 */
  metadata: Record<string, any>;
}

/**
 * 创建Task的参数
 */
export interface CreateTaskParams {
  id?: string;
  content: string;
  goalId: string;
  tracker?: Tracker;
  priority?: number;
  metadata?: Record<string, any>;
}

/**
 * 更新Task的参数
 */
export interface UpdateTaskParams {
  content?: string;
  tracker?: Tracker;
  priority?: number;
  status?: TaskStatus;
  metadata?: Record<string, any>;
}
