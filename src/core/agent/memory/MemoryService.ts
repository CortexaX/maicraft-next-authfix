/**
 * MemoryService 门面接口
 *
 * 统一访问入口，封装 MemoryManager 的存储功能
 * 外部集成通过事件订阅解耦
 */

import type { ThoughtEntry, ConversationEntry, DecisionEntry, ExperienceEntry, MemoryStats } from './types';

export interface MemoryService {
  recordThought(content: string, context?: Record<string, any>): void;
  recordConversation(speaker: string, message: string, context?: Record<string, any>): void;
  recordDecision(intention: string, action: any, result: 'success' | 'failed' | 'interrupted', feedback?: string): void;
  recordExperience(lesson: string, context: string, confidence?: number): void;

  buildContextSummary(options: {
    includeThoughts?: number;
    includeConversations?: number;
    includeDecisions?: number;
    includeExperiences?: number;
    includeCustom?: Record<string, number>;
  }): string;

  getAllStats(): Record<string, MemoryStats>;

  initialize(): Promise<void>;
  saveAll(): Promise<void>;
  loadAll(): Promise<void>;

  updateMemory(memoryType: 'thought' | 'conversation' | 'decision' | 'experience', id: string, updates: any): boolean;
  deleteMemory(memoryType: 'thought' | 'conversation' | 'decision' | 'experience', id: string): boolean;
  findMemory(memoryType: 'thought' | 'conversation' | 'decision' | 'experience', id: string): any;

  readonly thought: {
    getRecent(count: number): ThoughtEntry[];
    query(options: any): ThoughtEntry[];
  };
  readonly conversation: {
    getRecent(count: number): ConversationEntry[];
    query(options: any): ConversationEntry[];
  };
  readonly decision: {
    getRecent(count: number): DecisionEntry[];
    query(options: any): DecisionEntry[];
  };
  readonly experience: {
    getRecent(count: number): ExperienceEntry[];
    query(options: any): ExperienceEntry[];
  };

  readonly internal: {
    thought: {
      getRecent(count: number): ThoughtEntry[];
      add(entry: ThoughtEntry): void;
    };
    conversation: {
      getRecent(count: number): ConversationEntry[];
      add(entry: ConversationEntry): void;
    };
    decision: {
      getRecent(count: number): DecisionEntry[];
      add(entry: DecisionEntry): void;
    };
    experience: {
      getRecent(count: number): ExperienceEntry[];
      add(entry: ExperienceEntry): void;
    };
  };
}
