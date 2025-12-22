/**
 * 收集追踪器（事件型Tracker）
 * 基于 playerCollect 事件，追踪新收集的物品数量
 *
 * 使用场景：
 * - 收集任务：追踪新获取的物品数量（如"收集64个原木"）
 * - 资源收集：统计采集进度，避免背包已有物品的干扰
 */

import type { Tracker, TrackerProgress } from './types';
import type { GameContext } from '@/core/agent/types';
import type { EventManager, ListenerHandle } from '@/core/events/EventManager';

export class CollectionTracker implements Tracker {
  readonly type = 'collection';

  private collectedCount: number = 0;
  private eventHandle?: ListenerHandle;

  constructor(
    private itemName: string,
    private targetCount: number,
    private eventManager: EventManager,
  ) {
    this.setupEventListener();
  }

  /**
   * 设置事件监听器
   */
  private setupEventListener(): void {
    this.eventHandle = this.eventManager.on('playerCollect', (data: any) => {
      // 从 collected.metadata 提取物品信息
      const items = this.extractItems(data.collected);
      const collected = items.filter((item: any) => item.name === this.itemName).reduce((sum: number, item: any) => sum + item.count, 0);

      if (collected > 0) {
        this.collectedCount += collected;
      }
    });
  }

  /**
   * 从 collected 对象提取物品信息
   * collected.metadata 包含物品数组
   */
  private extractItems(collected: any): any[] {
    if (!collected || !collected.metadata) {
      return [];
    }

    // 过滤掉 null 项，提取物品信息
    return collected.metadata
      .filter((item: any) => item !== null)
      .map((item: any) => {
        // 尝试从 bot.registry 获取物品名称
        // 如果没有 registry，则使用 itemId
        return {
          id: item.itemId,
          name: item.name || `item_${item.itemId}`,
          count: item.itemCount || 1,
        };
      });
  }

  checkCompletion(context: GameContext): boolean {
    return this.collectedCount >= this.targetCount;
  }

  getProgress(context: GameContext): TrackerProgress {
    return {
      current: this.collectedCount,
      target: this.targetCount,
      percentage: Math.min((this.collectedCount / this.targetCount) * 100, 100),
      description: `已收集 ${this.collectedCount}/${this.targetCount} ${this.itemName}`,
    };
  }

  getDescription(): string {
    return `收集 ${this.targetCount} 个 ${this.itemName}`;
  }

  /**
   * 重置收集计数（用于重新开始任务）
   */
  reset(): void {
    this.collectedCount = 0;
  }

  /**
   * 清理资源（移除事件监听器）
   */
  destroy(): void {
    if (this.eventHandle) {
      this.eventHandle.remove();
      this.eventHandle = undefined;
    }
  }

  toJSON(): any {
    return {
      type: 'collection',
      itemName: this.itemName,
      targetCount: this.targetCount,
      collectedCount: this.collectedCount,
    };
  }

  static fromJSON(json: any, eventManager: EventManager): CollectionTracker {
    const tracker = new CollectionTracker(json.itemName, json.targetCount, eventManager);
    // 恢复已收集的数量
    if (json.collectedCount !== undefined) {
      tracker.collectedCount = json.collectedCount;
    }
    return tracker;
  }
}
