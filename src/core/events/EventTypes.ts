/**
 * 事件类型定义
 *
 * 提供类型安全的事件系统:
 * - GameEvents: 来自 mineflayer 的游戏事件
 * - ActionEvents: 动作执行相关事件
 * - SystemEvents: 系统级事件
 */

import type { Player } from 'mineflayer';
import type { Entity } from 'prismarine-entity';
import type { Vec3 } from 'vec3';
import type { Item } from 'prismarine-item';
import type { Block } from 'prismarine-block';
import type { ActionResult } from '@/core/actions/types';
import type { ThoughtEntry, ConversationEntry, DecisionEntry, ExperienceEntry } from '@/core/agent/memory/types';

// ============== 命名空间常量 ==============

export const EVENT_NAMESPACE = {
  GAME: 'game',
  ACTION: 'action',
  SYSTEM: 'system',
  MEMORY: 'memory',
} as const;

// ============== Game Events (来自 mineflayer) ==============

/**
 * 游戏事件类型映射
 * 所有事件名使用 `game:` 前缀
 */
export interface GameEvents {
  // 生命/状态事件
  'game:entityHurt': { entity: Entity; source?: Entity };
  'game:health': { health: number; food: number; foodSaturation: number };
  'game:death': Record<string, never>;
  'game:spawn': Record<string, never>;
  'game:kicked': { reason: string };

  // 聊天/玩家事件
  'game:chat': { username: string; message: string };
  'game:playerJoined': { player: Player };
  'game:playerLeft': { player: Player };
  'game:playerCollect': { collector: Entity; collected: Entity };

  // 方块/物品事件
  'game:blockUpdate': { oldBlock: Block | null; newBlock: Block | null };
  'game:windowUpdate': { slot: number; oldItem: Item | null; newItem: Item | null };
  'game:itemDrop': { entity: Entity };

  // 环境/时间事件
  'game:experience': { points: number; level: number; progress: number };
  'game:weather': { isRaining: boolean; thunderState: number };
  'game:time': { timeOfDay: number; day: number; age: number };
  'game:move': { position: Vec3; onGround: boolean };

  // 睡眠事件
  'game:sleep': Record<string, never>;
  'game:wake': Record<string, never>;

  // 区块事件
  'game:chunkColumnLoad': { point: Vec3 };
  'game:chunkColumnUnload': { point: Vec3 };

  // 窗口事件 (Action 内部使用)
  'game:windowOpen': { window: unknown };
  'game:windowClose': { window: unknown };

  // 错误事件
  'game:error': { error: Error };
  'game:end': { reason: string };
}

// ============== Action Events (自定义) ==============

/**
 * 动作事件类型映射
 * 所有事件名使用 `action:` 前缀
 */
export interface ActionEvents {
  'action:complete': {
    actionId: string;
    actionName: string;
    result: ActionResult;
    duration: number;
  };
  'action:error': {
    actionId: string;
    actionName: string;
    error: Error;
  };
}

// ============== System Events (配置/系统) ==============

/**
 * 系统事件类型映射
 * 所有事件名使用 `system:` 前缀
 */
export interface SystemEvents {
  'system:configChanged': { key: string; oldValue: unknown; newValue: unknown };
  'system:configReloaded': { config: unknown };
}

// ============== Memory Events (记忆系统) ==============

/**
 * 记忆事件类型映射
 * 所有事件名使用 `memory:` 前缀
 */
export interface MemoryEvents {
  'memory:thought:recorded': { entry: ThoughtEntry };
  'memory:conversation:recorded': { entry: ConversationEntry };
  'memory:decision:recorded': { entry: DecisionEntry };
  'memory:experience:recorded': { entry: ExperienceEntry };
  'memory:updated': { type: 'thought' | 'conversation' | 'decision' | 'experience'; action: 'add' | 'update' | 'delete'; id?: string };
  'memory:deleted': { type: 'thought' | 'conversation' | 'decision' | 'experience'; id: string };
}

// ============== 合并所有事件 ==============

/**
 * 所有事件的联合类型
 */
export type AllEvents = GameEvents & ActionEvents & SystemEvents & MemoryEvents;

// ============== 事件名类型 ==============

/**
 * 所有事件名类型
 */
export type EventName = keyof AllEvents;

/**
 * 游戏事件名类型
 */
export type GameEventName = keyof GameEvents;

/**
 * 动作事件名类型
 */
export type ActionEventName = keyof ActionEvents;

/**
 * 系统事件名类型
 */
export type SystemEventName = keyof SystemEvents;

export type MemoryEventName = keyof MemoryEvents;

export const MemoryEventTypes = {
  THOUGHT_RECORDED: 'memory:thought:recorded',
  CONVERSATION_RECORDED: 'memory:conversation:recorded',
  DECISION_RECORDED: 'memory:decision:recorded',
  EXPERIENCE_RECORDED: 'memory:experience:recorded',
  MEMORY_UPDATED: 'memory:updated',
  MEMORY_DELETED: 'memory:deleted',
} as const;

export type MemoryEventType = (typeof MemoryEventTypes)[keyof typeof MemoryEventTypes];

// ============== 旧事件名到新事件名的映射 ==============

/**
 * 旧事件名到新事件名（带命名空间）的映射
 * 用于迁移期间的兼容性处理
 */
export const EVENT_NAME_MIGRATION_MAP: Record<string, EventName> = {
  // Game events
  entityHurt: 'game:entityHurt',
  health: 'game:health',
  death: 'game:death',
  spawn: 'game:spawn',
  kicked: 'game:kicked',
  chat: 'game:chat',
  playerJoined: 'game:playerJoined',
  playerLeft: 'game:playerLeft',
  playerCollect: 'game:playerCollect',
  blockUpdate: 'game:blockUpdate',
  windowUpdate: 'game:windowUpdate',
  itemDrop: 'game:itemDrop',
  experience: 'game:experience',
  weather: 'game:weather',
  time: 'game:time',
  move: 'game:move',
  sleep: 'game:sleep',
  wake: 'game:wake',
  chunkColumnLoad: 'game:chunkColumnLoad',
  chunkColumnUnload: 'game:chunkColumnUnload',
  windowOpen: 'game:windowOpen',
  windowClose: 'game:windowClose',
  error: 'game:error',
  end: 'game:end',
  // Action events
  actionComplete: 'action:complete',
  actionError: 'action:error',
  // System events
  configChanged: 'system:configChanged',
  configReloaded: 'system:configReloaded',
  // Memory events (from old EventBus)
  'memory:thought:recorded': 'memory:thought:recorded',
  'memory:conversation:recorded': 'memory:conversation:recorded',
  'memory:decision:recorded': 'memory:decision:recorded',
  'memory:experience:recorded': 'memory:experience:recorded',
  'memory:updated': 'memory:updated',
  'memory:deleted': 'memory:deleted',
};
