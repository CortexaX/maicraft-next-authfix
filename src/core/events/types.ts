/**
 * 记忆事件类型定义
 */

import type { ThoughtEntry, ConversationEntry, DecisionEntry, ExperienceEntry } from '../agent/memory/types';

/**
 * 记忆事件类型常量
 */
export const MemoryEventTypes = {
  THOUGHT_RECORDED: 'memory:thought:recorded',
  CONVERSATION_RECORDED: 'memory:conversation:recorded',
  DECISION_RECORDED: 'memory:decision:recorded',
  EXPERIENCE_RECORDED: 'memory:experience:recorded',
  MEMORY_UPDATED: 'memory:updated',
  MEMORY_DELETED: 'memory:deleted',
} as const;

/**
 * 记忆事件类型
 */
export type MemoryEventType = (typeof MemoryEventTypes)[keyof typeof MemoryEventTypes];

/**
 * 思考记忆事件 payload
 */
export interface ThoughtRecordedPayload {
  entry: ThoughtEntry;
}

/**
 * 对话记忆事件 payload
 */
export interface ConversationRecordedPayload {
  entry: ConversationEntry;
}

/**
 * 决策记忆事件 payload
 */
export interface DecisionRecordedPayload {
  entry: DecisionEntry;
}

/**
 * 经验记忆事件 payload
 */
export interface ExperienceRecordedPayload {
  entry: ExperienceEntry;
}

/**
 * 记忆更新事件 payload
 */
export interface MemoryUpdatedPayload {
  type: 'thought' | 'conversation' | 'decision' | 'experience';
  action: 'add' | 'update' | 'delete';
  id?: string;
}

/**
 * 记忆删除事件 payload
 */
export interface MemoryDeletedPayload {
  type: 'thought' | 'conversation' | 'decision' | 'experience';
  id: string;
}

/**
 * 记忆事件 payload 联合类型
 */
export type MemoryEventPayload =
  | ThoughtRecordedPayload
  | ConversationRecordedPayload
  | DecisionRecordedPayload
  | ExperienceRecordedPayload
  | MemoryUpdatedPayload
  | MemoryDeletedPayload;
