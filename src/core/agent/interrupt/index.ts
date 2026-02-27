/**
 * 中断系统模块
 *
 * 取代被动模式切换，实现主动中断机制
 *
 * @module core/agent/interrupt
 */

// 类型定义
export type { InterruptHandler, InterruptStatus, InterruptEvent, InterruptSystemConfig } from './types';

// 常量
export { DEFAULT_INTERRUPT_CONFIG } from './types';

// 中断系统
export { InterruptSystem } from './InterruptSystem';

// 战斗处理器
export { CombatHandler, DEFAULT_COMBAT_CONFIG } from './CombatHandler';
export type { CombatHandlerConfig } from './CombatHandler';
