import type { Bot } from 'mineflayer';
import type { Item } from 'prismarine-item';
import { getLogger, type Logger } from '@/utils/Logger';
import type { AllEvents } from './EventTypes';

export type EventHandler<T> = (data: T) => void | Promise<void>;

export interface ListenerHandle {
  remove: () => void;
}

interface EventListener {
  id: string;
  handler: EventHandler<unknown>;
  once: boolean;
}

export class EventBus {
  private static instance: EventBus | null = null;

  private bot: Bot | null = null;
  private listeners: Map<string, EventListener[]> = new Map();
  private listenerIdCounter: number = 0;
  private logger: Logger;
  private botEventsBridged: boolean = false;

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  static resetInstance(): void {
    if (EventBus.instance) {
      EventBus.instance.removeAllListeners();
    }
    EventBus.instance = null;
  }

  constructor(bot?: Bot) {
    this.logger = getLogger('EventBus');
    if (bot) {
      this.attachBot(bot);
    }
  }

  attachBot(bot: Bot): void {
    if (this.botEventsBridged && this.bot) {
      this.logger.warn('Bot already attached, skipping re-attachment');
      return;
    }
    this.bot = bot;
    this.bridgeBotEvents();
    this.botEventsBridged = true;
  }

  on<K extends keyof AllEvents>(eventName: K, handler: EventHandler<AllEvents[K]>): ListenerHandle;
  on(eventName: string, handler: EventHandler<unknown>): ListenerHandle;
  on(eventName: string, handler: EventHandler<unknown>): ListenerHandle {
    const listener: EventListener = {
      id: this.generateId(),
      handler: handler as EventHandler<unknown>,
      once: false,
    };

    const listeners = this.listeners.get(eventName) || [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);

    return { remove: () => this.off(eventName, listener.id) };
  }

  once<K extends keyof AllEvents>(eventName: K, handler: EventHandler<AllEvents[K]>): ListenerHandle;
  once(eventName: string, handler: EventHandler<unknown>): ListenerHandle;
  once(eventName: string, handler: EventHandler<unknown>): ListenerHandle {
    const listener: EventListener = {
      id: this.generateId(),
      handler: handler as EventHandler<unknown>,
      once: true,
    };

    const listeners = this.listeners.get(eventName) || [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);

    return { remove: () => this.off(eventName, listener.id) };
  }

  emit<K extends keyof AllEvents>(eventName: K, data: AllEvents[K]): void;
  emit(eventName: string, data: unknown): void;
  emit(eventName: string, data: unknown): void {
    const listeners = this.listeners.get(eventName);
    if (!listeners) return;

    for (let i = listeners.length - 1; i >= 0; i--) {
      const listener = listeners[i];

      try {
        const result = listener.handler(data);
        if (result instanceof Promise) {
          result.catch(err => {
            this.logger.error(`Event ${eventName} handler error:`, undefined, err instanceof Error ? err : new Error(String(err)));
          });
        }
      } catch (err) {
        this.logger.error(`Event ${eventName} handler error:`, undefined, err instanceof Error ? err : new Error(String(err)));
      }

      if (listener.once) {
        listeners.splice(i, 1);
      }
    }
  }

  private off(eventName: string, listenerId: string): void {
    const listeners = this.listeners.get(eventName);
    if (!listeners) return;

    const index = listeners.findIndex(l => l.id === listenerId);
    if (index !== -1) {
      listeners.splice(index, 1);
    }

    if (listeners.length === 0) {
      this.listeners.delete(eventName);
    }
  }

  removeAllListeners(eventName?: string): void {
    if (eventName) {
      this.listeners.delete(eventName);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(eventName: string): number {
    const listeners = this.listeners.get(eventName);
    return listeners ? listeners.length : 0;
  }

  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

  private generateId(): string {
    return `listener_${++this.listenerIdCounter}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private bridgeBotEvents(): void {
    if (!this.bot) return;

    const bot = this.bot;

    bot.on('health', () => {
      this.emit('game:health', {
        health: bot.health,
        food: bot.food,
        foodSaturation: bot.foodSaturation,
      });
    });

    bot.on('death', () => {
      this.emit('game:death', {});
    });

    bot.on('spawn', () => {
      this.emit('game:spawn', {});
    });

    bot.on('kicked', reason => {
      this.emit('game:kicked', { reason });
    });

    bot.on('entityHurt', entity => {
      this.emit('game:entityHurt', { entity, source: undefined });
    });

    bot.on('playerCollect', (collector, collected) => {
      const isSelf = bot.entity && collector.id === bot.entity.id;
      if (isSelf) {
        this.emit('game:playerCollect', { collector, collected });
      }
    });

    bot.on('chat', (username, message) => {
      this.emit('game:chat', { username, message });
    });

    bot.on('playerJoined', player => {
      this.emit('game:playerJoined', { player });
    });

    bot.on('playerLeft', player => {
      this.emit('game:playerLeft', { player });
    });

    bot.on('blockUpdate', (oldBlock, newBlock) => {
      this.emit('game:blockUpdate', { oldBlock, newBlock });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bot as any).on?.('windowUpdate', (slot: number, oldItem: Item | null, newItem: Item | null) => {
      this.emit('game:windowUpdate', { slot, oldItem, newItem });
    });

    bot.on('itemDrop', entity => {
      this.emit('game:itemDrop', { entity });
    });

    bot.on('experience', () => {
      this.emit('game:experience', {
        points: bot.experience.points,
        level: bot.experience.level,
        progress: bot.experience.progress,
      });
    });

    (bot as unknown as { on?: (event: string, handler: () => void) => void }).on?.('weather', () => {
      this.emit('game:weather', {
        isRaining: bot.isRaining,
        thunderState: bot.thunderState,
      });
    });

    bot.on('time', () => {
      this.emit('game:time', {
        timeOfDay: bot.time.timeOfDay,
        day: bot.time.day,
        age: bot.time.age,
      });
    });

    bot.on('move', () => {
      if (bot.entity) {
        this.emit('game:move', {
          position: bot.entity.position,
          onGround: bot.entity.onGround,
        });
      }
    });

    bot.on('sleep', () => {
      this.emit('game:sleep', {});
    });

    bot.on('wake', () => {
      this.emit('game:wake', {});
    });

    bot.on('chunkColumnLoad', point => {
      this.emit('game:chunkColumnLoad', { point });
    });

    bot.on('chunkColumnUnload', point => {
      this.emit('game:chunkColumnUnload', { point });
    });

    bot.on('error', error => {
      this.emit('game:error', { error });
    });

    bot.on('end', reason => {
      this.emit('game:end', { reason });
    });
  }
}

export type { AllEvents, EventName, GameEvents, ActionEvents, SystemEvents, MemoryEvents } from './EventTypes';
