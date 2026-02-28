/**
 * 目标数据结构
 * Goal 是抽象的、可能需要多步骤完成的长期目标
 * 示例："找到村庄"、"挖到钻石"、"到达下界"
 */

import type { Tracker } from '../trackers/types';

/**
 * 目标状态
 */
export type GoalStatus = 'active' | 'completed' | 'abandoned';

/**
 * 目标完成方式
 */
export type GoalCompletedBy = 'tracker' | 'llm';

/**
 * 目标接口
 */
export interface Goal {
  /** 语义化ID，如 "find_village", "get_diamond" */
  id: string;

  /** 目标描述 */
  content: string;

  /** 执行计划（自然语言描述的执行步骤） */
  plan?: string;

  /** 可选的自动检测Tracker */
  tracker?: Tracker;

  /** 目标状态 */
  status: GoalStatus;

  /** 优先级 1-5，默认3 */
  priority: number;

  /** 创建时间戳 */
  createdAt: number;

  /** 完成时间戳 */
  completedAt?: number;

  /** 完成方式：tracker自动检测 或 LLM手动标记 */
  completedBy?: GoalCompletedBy;

  /** 元数据，用于存储额外信息 */
  metadata: Record<string, any>;
}

/**
 * 创建Goal的参数
 */
export interface CreateGoalParams {
  /** LLM传入的语义化ID，可选 */
  id?: string;
  content: string;
  plan?: string;
  tracker?: Tracker;
  priority?: number;
  metadata?: Record<string, any>;
}

/**
 * 更新Goal的参数
 */
export interface UpdateGoalParams {
  content?: string;
  plan?: string;
  tracker?: Tracker;
  priority?: number;
  metadata?: Record<string, any>;
}
