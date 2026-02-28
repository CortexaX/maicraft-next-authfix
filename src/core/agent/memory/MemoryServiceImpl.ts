/**
 * MemoryService 门面实现
 *
 * 统一访问入口，封装 MemoryManager 的存储功能
 * 外部集成通过事件订阅解耦
 */

import { MemoryManager } from './MemoryManager';
import { EventBus } from '@/core/events/EventBus';
import type { MemoryService as IMemoryService } from './MemoryService';
import type { MemoryStats } from './types';

export class MemoryServiceImpl implements IMemoryService {
  private memoryManager: MemoryManager;
  private eventBus: EventBus;

  constructor(memoryManager: MemoryManager, eventBus?: EventBus) {
    this.memoryManager = memoryManager;
    this.eventBus = eventBus ?? EventBus.getInstance();
  }

  recordThought(content: string, context?: Record<string, any>): void {
    this.memoryManager.recordThought(content, context);
  }

  recordConversation(speaker: string, message: string, context?: Record<string, any>): void {
    this.memoryManager.recordConversation(speaker, message, context);
  }

  recordDecision(intention: string, action: any, result: 'success' | 'failed' | 'interrupted', feedback?: string): void {
    this.memoryManager.recordDecision(intention, action, result, feedback);
  }

  recordExperience(lesson: string, context: string, confidence: number = 0.5): void {
    this.memoryManager.recordExperience(lesson, context, confidence);
  }

  buildContextSummary(options: {
    includeThoughts?: number;
    includeConversations?: number;
    includeDecisions?: number;
    includeExperiences?: number;
    includeCustom?: Record<string, number>;
  }): string {
    return this.memoryManager.buildContextSummary(options);
  }

  getAllStats(): Record<string, MemoryStats> {
    return this.memoryManager.getAllStats();
  }

  async initialize(): Promise<void> {
    await this.memoryManager.initialize();
  }

  async saveAll(): Promise<void> {
    await this.memoryManager.saveAll();
  }

  async loadAll(): Promise<void> {
    await this.memoryManager.loadAll();
  }

  updateMemory(memoryType: 'thought' | 'conversation' | 'decision' | 'experience', id: string, updates: any): boolean {
    return this.memoryManager.updateMemory(memoryType, id, updates);
  }

  deleteMemory(memoryType: 'thought' | 'conversation' | 'decision' | 'experience', id: string): boolean {
    return this.memoryManager.deleteMemory(memoryType, id);
  }

  findMemory(memoryType: 'thought' | 'conversation' | 'decision' | 'experience', id: string): any {
    return this.memoryManager.findMemory(memoryType, id);
  }

  get thought() {
    return this.memoryManager.thought;
  }

  get conversation() {
    return this.memoryManager.conversation;
  }

  get decision() {
    return this.memoryManager.decision;
  }

  get experience() {
    return this.memoryManager.experience;
  }

  get internal() {
    return this.memoryManager;
  }
}
