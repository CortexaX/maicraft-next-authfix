/**
 * 中断系统
 *
 * 取代被动模式切换，实现主动中断机制
 * 主循环每次检查是否有中断需要处理
 * 如果有，暂停当前活动，处理中断，然后继续
 */

import type { GameState } from '@/core/state/GameState';
import type { InterruptHandler, InterruptEvent, InterruptStatus, InterruptSystemConfig } from './types';
import { DEFAULT_INTERRUPT_CONFIG } from './types';
import { getLogger, type Logger } from '@/utils/Logger';

export class InterruptSystem {
  private handlers: InterruptHandler[] = [];
  private activeHandler: InterruptHandler | null = null;
  private status: InterruptStatus = 'idle';
  private gameState: GameState;
  private logger: Logger;
  private config: InterruptSystemConfig;
  private eventHistory: InterruptEvent[] = [];
  private lastDetectionTime: number = 0;

  constructor(gameState: GameState, config: Partial<InterruptSystemConfig> = {}) {
    this.gameState = gameState;
    this.config = { ...DEFAULT_INTERRUPT_CONFIG, ...config };
    this.logger = getLogger('InterruptSystem');

    if (this.config.verboseLogging) {
      this.logger.info('中断系统初始化', { config: this.config });
    }
  }

  /**
   * 注册中断处理器（按优先级排序）
   *
   * @param handler 中断处理器
   */
  register(handler: InterruptHandler): void {
    // 检查是否已存在同名处理器
    const existingIndex = this.handlers.findIndex(h => h.name === handler.name);
    if (existingIndex !== -1) {
      this.logger.warn(`替换已存在的处理器: ${handler.name}`);
      this.handlers.splice(existingIndex, 1);
    }

    this.handlers.push(handler);
    this.handlers.sort((a, b) => b.priority - a.priority);

    if (this.config.verboseLogging) {
      this.logger.info(`注册中断处理器: ${handler.name} (优先级: ${handler.priority})`);
    }
  }

  /**
   * 注销中断处理器
   *
   * @param name 处理器名称
   */
  unregister(name: string): boolean {
    const index = this.handlers.findIndex(h => h.name === name);
    if (index === -1) {
      return false;
    }

    this.handlers.splice(index, 1);

    if (this.config.verboseLogging) {
      this.logger.info(`注销中断处理器: ${name}`);
    }

    return true;
  }

  /**
   * 检查是否有中断需要处理
   *
   * 按优先级顺序检查所有处理器
   * 返回第一个需要处理的处理器
   *
   * @returns 需要处理的处理器，如果没有返回 null
   */
  check(): InterruptHandler | null {
    // 检查是否启用
    if (!this.config.enabled) {
      return null;
    }

    // 检查是否正在处理中断
    if (this.status === 'handling') {
      return null;
    }

    // 检查检测间隔
    const now = Date.now();
    if (this.config.detectionInterval > 0 && now - this.lastDetectionTime < this.config.detectionInterval) {
      return null;
    }

    this.lastDetectionTime = now;
    this.status = 'detecting';

    try {
      // 按优先级顺序检查
      for (const handler of this.handlers) {
        try {
          if (handler.detect(this.gameState)) {
            this.status = 'idle';
            return handler;
          }
        } catch (error) {
          this.logger.error(`处理器 ${handler.name} 检测异常:`, undefined, error as Error);
        }
      }
    } finally {
      this.status = 'idle';
    }

    return null;
  }

  /**
   * 处理中断（阻塞执行）
   *
   * @param handler 需要处理的处理器
   */
  async handleInterrupt(handler: InterruptHandler): Promise<void> {
    if (this.status === 'handling') {
      this.logger.warn(`正在处理中断，忽略新的中断请求: ${handler.name}`);
      return;
    }

    this.activeHandler = handler;
    this.status = 'handling';

    const startTime = Date.now();
    const event: InterruptEvent = {
      type: 'interrupt_started',
      handlerName: handler.name,
      priority: handler.priority,
      timestamp: startTime,
    };

    this.recordEvent(event);
    this.logger.info(`⚠️ 开始处理中断: ${handler.name} (优先级: ${handler.priority})`);

    try {
      // 设置超时
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error(`中断处理超时: ${this.config.maxHandlingTime}ms`)), this.config.maxHandlingTime);
      });

      // 执行处理
      await Promise.race([handler.handle(), timeoutPromise]);

      const duration = Date.now() - startTime;
      this.logger.info(`✅ 中断处理完成: ${handler.name} (耗时: ${duration}ms)`);

      this.recordEvent({
        type: 'interrupt_completed',
        handlerName: handler.name,
        priority: handler.priority,
        timestamp: Date.now(),
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ 中断处理失败: ${handler.name} (耗时: ${duration}ms)`, undefined, error as Error);

      this.recordEvent({
        type: 'interrupt_failed',
        handlerName: handler.name,
        priority: handler.priority,
        timestamp: Date.now(),
        error: error as Error,
      });
    } finally {
      this.activeHandler = null;
      this.status = 'idle';
    }
  }

  /**
   * 获取当前活动的处理器
   */
  getActiveHandler(): InterruptHandler | null {
    return this.activeHandler;
  }

  /**
   * 获取当前状态
   */
  getStatus(): InterruptStatus {
    return this.status;
  }

  /**
   * 检查是否正在处理中断
   */
  isHandling(): boolean {
    return this.status === 'handling';
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 启用中断系统
   */
  enable(): void {
    this.config.enabled = true;
    this.logger.info('中断系统已启用');
  }

  /**
   * 禁用中断系统
   */
  disable(): void {
    this.config.enabled = false;
    this.logger.info('中断系统已禁用');
  }

  /**
   * 获取已注册的处理器列表
   */
  getHandlers(): InterruptHandler[] {
    return [...this.handlers];
  }

  /**
   * 获取事件历史
   */
  getEventHistory(limit?: number): InterruptEvent[] {
    if (limit) {
      return this.eventHistory.slice(-limit);
    }
    return [...this.eventHistory];
  }

  /**
   * 清空事件历史
   */
  clearEventHistory(): void {
    this.eventHistory = [];
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<InterruptSystemConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('中断系统配置已更新', { config: this.config });
  }

  /**
   * 获取配置
   */
  getConfig(): InterruptSystemConfig {
    return { ...this.config };
  }

  /**
   * 记录事件
   */
  private recordEvent(event: InterruptEvent): void {
    this.eventHistory.push(event);

    // 限制历史记录数量（最多100条）
    if (this.eventHistory.length > 100) {
      this.eventHistory.shift();
    }
  }

  /**
   * 获取系统状态摘要
   */
  getStatusSummary(): {
    status: InterruptStatus;
    enabled: boolean;
    activeHandler: string | null;
    handlerCount: number;
    eventCount: number;
  } {
    return {
      status: this.status,
      enabled: this.config.enabled,
      activeHandler: this.activeHandler?.name ?? null,
      handlerCount: this.handlers.length,
      eventCount: this.eventHistory.length,
    };
  }
}
