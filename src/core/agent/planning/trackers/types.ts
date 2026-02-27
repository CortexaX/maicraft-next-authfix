/**
 * Tracker系统类型定义
 *
 * Tracker分类（MECE原则）：
 * - StateTracker（状态型）：检查游戏状态是否达成
 *   - InventoryTracker: 背包物品状态
 *   - LocationTracker: 位置状态
 *   - EntityTracker: 实体状态
 *   - EnvironmentTracker: 环境状态
 *
 * - EventTracker（事件型）：基于事件追踪动作
 *   - CollectionTracker: 收集物品事件（基于 playerCollect）
 *   - CraftTracker: 制作物品事件（基于背包增量检测）
 *
 * - CompositeTracker（组合型）：组合多个Tracker
 *   - logic: 'and' | 'or' | 'sequence'
 */

import type { GameContext } from '@/core/agent/types';

/**
 * Tracker进度信息
 * 提供详细的进度追踪
 */
export interface TrackerProgress {
  /** 当前进度值 */
  current: number;

  /** 目标值 */
  target: number;

  /** 百分比 0-100 */
  percentage: number;

  /** 进度描述，如 "15/20 oak_log" */
  description: string;

  /** 额外细节信息 */
  details?: any;
}

/**
 * Tracker基础接口
 * 所有Tracker都必须实现此接口
 */
export interface Tracker {
  /** Tracker类型标识 */
  readonly type: string;

  /**
   * 检查是否完成
   * @param context 游戏上下文
   * @returns 是否完成
   */
  checkCompletion(context: GameContext): boolean;

  /**
   * 获取当前进度
   * @param context 游戏上下文
   * @returns 进度信息
   */
  getProgress(context: GameContext): TrackerProgress;

  /**
   * 获取Tracker描述（用于显示和日志）
   * @returns 描述字符串
   */
  getDescription(): string;

  /**
   * 序列化为JSON（用于持久化）
   * @returns JSON对象
   */
  toJSON(): any;

  /**
   * 清理资源（用于事件型Tracker）
   * 可选方法，用于移除事件监听器等资源
   */
  destroy?(): void;
}

/**
 * CollectionTracker配置
 * 基于 playerCollect 事件追踪新收集的物品
 */
export interface CollectionTrackerConfig {
  type: 'collection';
  itemName: string;
  targetCount: number;
}

/**
 * LocationTracker配置
 */
export interface LocationTrackerConfig {
  type: 'location';
  x: number;
  y?: number; // 可选，不限制Y坐标
  z: number;
  radius: number; // 到达半径
}

/**
 * EntityTracker配置
 */
export interface EntityTrackerConfig {
  type: 'entity';
  entityType?: string; // 如 'villager', 'zombie'
  entityCategory?: 'hostile' | 'passive' | 'neutral' | 'player';
  minCount?: number; // 最小实体数量
  maxCount?: number; // 最大实体数量
  distance: number; // 检测距离
  mustSee?: boolean; // 是否必须在视线内
}

/**
 * EnvironmentTracker配置
 */
export interface EnvironmentTrackerConfig {
  type: 'environment';
  timeOfDay?: { min?: number; max?: number }; // 时间范围 0-24000
  weather?: 'clear' | 'rain' | 'thunder';
  biome?: string; // 生物群系
  dimension?: 'overworld' | 'nether' | 'end';
  lightLevel?: { min?: number; max?: number }; // 光照等级 0-15
}

/**
 * CraftTracker配置
 */
export interface CraftTrackerConfig {
  type: 'craft';
  itemName: string;
  targetCount: number;
}

/**
 * CompositeTracker配置
 */
export interface CompositeTrackerConfig {
  type: 'composite';
  logic: 'and' | 'or' | 'sequence';
  trackers: TrackerConfig[];
  weights?: number[]; // 各子Tracker的权重（用于进度计算）
}

/**
 * 所有Tracker配置的联合类型
 */
export type TrackerConfig =
  | CollectionTrackerConfig
  | LocationTrackerConfig
  | EntityTrackerConfig
  | EnvironmentTrackerConfig
  | CraftTrackerConfig
  | CompositeTrackerConfig;

/**
 * Tracker工厂接口
 */
export interface ITrackerFactory {
  /**
   * 从配置创建Tracker
   */
  createTracker(config: TrackerConfig): Tracker;

  /**
   * 从JSON反序列化Tracker
   */
  fromJSON(json: any): Tracker;
}
