/**
 * WebSocket 记忆适配器
 *
 * 订阅记忆事件，将记忆推送到 WebSocket 客户端
 */

import { EventBus } from '@/core/events/EventBus';
import type { WebSocketServer } from '@/api/WebSocketServer';

export class WebSocketAdapter {
  private eventBus: EventBus;
  private wsServer: WebSocketServer;
  private logger: any;

  constructor(eventBus: EventBus, wsServer: WebSocketServer) {
    this.eventBus = eventBus;
    this.wsServer = wsServer;
    this.logger = console;
  }

  initialize(): void {
    this.eventBus.on('memory:thought:recorded', (data: any) => {
      this.pushMemory('thought', data.entry);
    });

    this.eventBus.on('memory:conversation:recorded', (data: any) => {
      this.pushMemory('conversation', data.entry);
    });

    this.eventBus.on('memory:decision:recorded', (data: any) => {
      this.pushMemory('decision', data.entry);
    });

    this.eventBus.on('memory:experience:recorded', (data: any) => {
      this.pushMemory('experience', data.entry);
    });

    this.logger.info('📡 WebSocket 记忆适配器已初始化');
  }

  private pushMemory(memoryType: 'thought' | 'conversation' | 'decision' | 'experience', entry: any): void {
    const message = {
      type: 'memory_push',
      timestamp: Date.now(),
      data: {
        memoryType,
        entry,
      },
    };

    this.logger.debug(`📤 推送记忆: ${memoryType} - ${entry.id}`);
    this.wsServer.broadcastToSubscribed('memory', message);
  }
}
