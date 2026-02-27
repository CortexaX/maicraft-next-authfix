/**
 * 中断系统类型定义
 *
 * 取代被动模式切换，实现主动中断机制
 */

import type { GameState } from '@/core/state/GameState';

/**
 * 中断处理器接口
 *
 * 每个处理器负责检测和响应特定类型的中断事件
 * 例如：战斗、健康危机、物品掉落等
 */
export interface InterruptHandler {
  /**
   * 处器名称（用于日志和调试）
   */
  readonly name: string;

  /**
   * 优先级（数字越大优先级越高）
   * 同一时间只执行优先级最高的中断
   */
  readonly priority: number;

  /**
   * 检测是否需要中断
   *
   * 轻量级检测，每轮主循环调用
   * 必须快速返回，不应执行耗时操作
   *
   * @param gameState 当前游戏状态
   * @returns 是否需要触发中断
   */
  detect(gameState: GameState): boolean;

  /**
   * 处理中断
   *
   * 阻塞执行，直到处理完成
   * 可以执行耗时操作（战斗、逃跑、治疗等）
   *
   * @returns Promise<void> 处理完成时resolve
   */
  handle(): Promise<void>;
}

/**
 * 中断状态
 */
export type InterruptStatus =
  | 'idle' // 空闲，无中断
  | 'detecting' // 检测中
  | 'handling' // 处理中
  | 'paused'; // 暂停（由外部控制）

/**
 * 中断系统事件
 */
export interface InterruptEvent {
  type: 'interrupt_started' | 'interrupt_completed' | 'interrupt_failed';
  handlerName: string;
  priority: number;
  timestamp: number;
  error?: Error;
}

/**
 * 中断系统配置
 */
export interface InterruptSystemConfig {
  /**
   * 是否启用中断系统
   */
  enabled: boolean;

  /**
   * 中断检测间隔（毫秒）
   * 默认：每次主循环都检测（0）
   */
  detectionInterval: number;

  /**
   * 最大处理时间（毫秒）
   * 超时后强制返回
   */
  maxHandlingTime: number;

  /**
   * 是否记录详细日志
   */
  verboseLogging: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_INTERRUPT_CONFIG: InterruptSystemConfig = {
  enabled: true,
  detectionInterval: 0, // 每次循环都检测
  maxHandlingTime: 5 * 60 * 1000, // 5分钟超时
  verboseLogging: true,
};
