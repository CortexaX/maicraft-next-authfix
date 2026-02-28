import type { ListenerHandle } from '@/core/events/EventManager';
import { CancellationError } from './CancellationError';
import type { InterruptHandler, InterruptConfig } from './types';
import type { GameState } from '@/core/state/GameState';
import type { EventManager } from '@/core/events/EventManager';
import { getLogger, type Logger } from '@/utils/Logger';

const DEFAULT_CONFIG: InterruptConfig = {
  enabled: true,
  maxHandlingTime: 5 * 60 * 1000,
};

export class InterruptManager {
  private controller = new AbortController();
  private handlers: InterruptHandler[] = [];
  private status: 'idle' | 'handling' = 'idle';
  private gameState: GameState;
  private events: EventManager;
  private logger: Logger;
  private config: InterruptConfig;
  private eventCleanups: Array<ListenerHandle> = [];

  constructor(gameState: GameState, events: EventManager, config?: Partial<InterruptConfig>) {
    this.gameState = gameState;
    this.events = events;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = getLogger('InterruptManager');
    this.setupEventListeners();
  }

  beginScope(): AbortSignal {
    if (!this.controller.signal.aborted) {
      this.controller.abort(new CancellationError('新的作用域'));
    }
    this.controller = new AbortController();
    return this.controller.signal;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  interrupt(reason: string): void {
    this.logger.warn(`中断触发: ${reason}`);
    if (!this.controller.signal.aborted) {
      this.controller.abort(new CancellationError(reason));
    }
  }

  detect(): InterruptHandler | null {
    if (!this.config.enabled || this.status === 'handling') return null;
    for (const handler of this.handlers) {
      try {
        if (handler.detect(this.gameState)) return handler;
      } catch (error) {
        this.logger.error(`处理器 ${handler.name} 检测异常`, undefined, error as Error);
      }
    }
    return null;
  }

  async handleInterrupt(handler: InterruptHandler): Promise<void> {
    if (this.status === 'handling') {
      this.logger.warn(`正在处理中断，忽略: ${handler.name}`);
      return;
    }
    this.status = 'handling';
    this.logger.info(`开始处理中断: ${handler.name} (优先级: ${handler.priority})`);

    this.interrupt(`中断处理: ${handler.name}`);

    const handlerController = new AbortController();
    const timeoutId = setTimeout(() => {
      handlerController.abort(new CancellationError('中断处理超时'));
    }, this.config.maxHandlingTime);

    try {
      await handler.handle(handlerController.signal);
      this.logger.info(`中断处理完成: ${handler.name}`);
    } catch (error) {
      if (error instanceof CancellationError) {
        this.logger.warn(`中断处理被取消/超时: ${handler.name}`);
      } else {
        this.logger.error(`中断处理失败: ${handler.name}`, undefined, error as Error);
      }
    } finally {
      clearTimeout(timeoutId);
      this.status = 'idle';
    }
  }

  register(handler: InterruptHandler): void {
    const existingIndex = this.handlers.findIndex(h => h.name === handler.name);
    if (existingIndex !== -1) {
      this.logger.warn(`替换已存在的处理器: ${handler.name}`);
      this.handlers.splice(existingIndex, 1);
    }
    this.handlers.push(handler);
    this.handlers.sort((a, b) => b.priority - a.priority);
    this.logger.info(`注册中断处理器: ${handler.name} (优先级: ${handler.priority})`);
  }

  unregister(name: string): boolean {
    const index = this.handlers.findIndex(h => h.name === name);
    if (index === -1) return false;
    this.handlers.splice(index, 1);
    this.logger.info(`注销中断处理器: ${name}`);
    return true;
  }

  private setupEventListeners(): void {
    const onDeath = () => this.interrupt('玩家死亡');
    const handle = this.events.on('death', onDeath);
    this.eventCleanups.push(handle);
  }

  get isHandling(): boolean {
    return this.status === 'handling';
  }

  dispose(): void {
    this.interrupt('系统关闭');
    for (const cleanup of this.eventCleanups) cleanup.remove();
    this.eventCleanups = [];
  }
}
