// src/core/agent/react/types.ts

import type { StructuredAction } from '@/core/agent/structured/ActionSchema';

/**
 * 观察结果
 */
export interface Observation {
  position: { x: number; y: number; z: number };
  health: number;
  food: number;
  saturation: number;
  nearbyEntities: any[];
  nearbyBlocks: string;
  inventory: string;
  timeOfDay: number;
  currentGoal: any;
  promptData: any;
}

/**
 * 检索到的记忆（包含原始数据和格式化摘要）
 */
export interface RetrievedMemories {
  thoughts: any[];
  decisions: any[];
  experiences: any[];
  conversations: any[];
  formattedSummary: string;
}

/**
 * ReAct 历史条目
 */
export interface ReActEntry {
  thought: string;
  action: StructuredAction;
  observation: string;
  timestamp?: number;
}

/**
 * 动作执行结果
 */
export interface ActionResult {
  success: boolean;
  message: string;
  observation: string;
  source: 'urgent' | 'planned';
}
