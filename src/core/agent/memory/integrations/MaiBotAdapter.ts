/**
 * MaiBot 记忆适配器
 *
 * 订阅记忆事件，将记忆发送到 MaiBot
 * 处理 MaiBot 回复并记录为思考记忆
 */

import { EventBus } from '@/core/events/EventBus';
import { MemoryEventTypes } from '@/core/events/types';
import type { MaiBotClient } from '../../communication/MaiBotClient';
import type { MemoryService } from '../MemoryService';

export class MaiBotAdapter {
  private eventBus: EventBus;
  private maiBotClient: MaiBotClient;
  private memoryService: MemoryService;
  private logger: any;

  constructor(eventBus: EventBus, maiBotClient: MaiBotClient, memoryService: MemoryService) {
    this.eventBus = eventBus;
    this.maiBotClient = maiBotClient;
    this.memoryService = memoryService;
    this.logger = console;
  }

  initialize(): void {
    this.maiBotClient.setOnReplyCallback((reply: string) => {
      this.memoryService.recordThought(`[MaiBot回复] ${reply}`, {
        source: 'maibot',
        type: 'reply',
      });
    });

    this.eventBus.onMemory(MemoryEventTypes.THOUGHT_RECORDED as any, (data: any) => {
      if (data.entry.context?.source !== 'maibot') {
        this.maiBotClient.sendThoughtMemory(data.entry);
      }
    });

    this.eventBus.onMemory(MemoryEventTypes.DECISION_RECORDED as any, (data: any) => {
      this.maiBotClient.sendDecisionMemory(data.entry);
    });

    this.logger.info('🤖 MaiBot 记忆适配器已初始化');
  }
}
