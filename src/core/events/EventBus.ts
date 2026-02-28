/**
 * 事件总线 - 应用内部事件通信
 *
 * 设计目标:
 * 1. 解耦应用组件（记忆系统、集成适配器等）
 * 2. 类型安全的事件发布/订阅
 * 3. 支持同步和异步事件分发
 * 4. 使用 Node.js 原生 EventEmitter
 */

import { EventEmitter } from 'events';
import type { MemoryEventType } from './types';

/**
 * 事件总线类
 * 使用 Node.js 原生 EventEmitter 封装，提供类型安全的事件发布/订阅
 */
export class EventBus extends EventEmitter {
  private static instance: EventBus | null = null;

  /**
   * 获取单例实例
   */
  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * 静态方法：重置单例（用于测试）
   */
  static resetInstance(): void {
    EventBus.instance = null;
  }

  constructor() {
    super();
    // 设置最大监听器数量，避免内存泄漏警告
    this.setMaxListeners(100);
  }

  /**
   * 订阅记忆事件
   */
  onMemory(eventType: MemoryEventType, handler: (data: any) => void): void {
    this.on(eventType, handler);
  }

  /**
   * 订阅记忆事件一次
   */
  onceMemory(eventType: MemoryEventType, handler: (data: any) => void): void {
    this.once(eventType, handler);
  }

  /**
   * 取消订阅记忆事件
   */
  offMemory(eventType: MemoryEventType, handler: (data: any) => void): void {
    this.off(eventType, handler);
  }

  /**
   * 发布记忆事件
   */
  emitMemory(eventType: MemoryEventType, data: any): void {
    this.emit(eventType, data);
  }

  /**
   * 移除所有监听器
   */
  removeAllMemoryListeners(): void {
    this.removeAllListeners();
  }
}

/**
 * 创建独立的事件总线实例（不推荐，用于需要多实例的场景）
 */
export function createEventBus(): EventBus {
  return new EventBus();
}
