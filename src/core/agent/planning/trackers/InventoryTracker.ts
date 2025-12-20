/**
 * 背包追踪器（状态型Tracker）
 * 检查背包中的物品数量
 */

import type { Tracker, TrackerProgress } from './types';
import type { GameContext } from '@/core/agent/types';

export class InventoryTracker implements Tracker {
  readonly type = 'inventory';

  constructor(
    private itemName: string,
    private targetCount: number,
    private minCount?: number, // 最小数量（可选）
    private maxCount?: number, // 最大数量（可选）
  ) {}

  checkCompletion(context: GameContext): boolean {
    const currentCount = this.getCurrentCount(context);

    // 检查最小值
    if (this.minCount !== undefined && currentCount < this.minCount) {
      return false;
    }

    // 检查最大值
    if (this.maxCount !== undefined && currentCount > this.maxCount) {
      return false;
    }

    // 检查目标值（默认为至少达到目标值）
    return currentCount >= this.targetCount;
  }

  getProgress(context: GameContext): TrackerProgress {
    const current = this.getCurrentCount(context);
    const target = this.targetCount;

    return {
      current,
      target,
      percentage: Math.min((current / target) * 100, 100),
      description: `${current}/${target} ${this.itemName}`,
    };
  }

  getDescription(): string {
    if (this.minCount !== undefined && this.maxCount !== undefined) {
      return `背包中有 ${this.minCount}-${this.maxCount} 个 ${this.itemName}`;
    } else if (this.minCount !== undefined) {
      return `背包中至少有 ${this.minCount} 个 ${this.itemName}`;
    } else {
      return `背包中至少有 ${this.targetCount} 个 ${this.itemName}`;
    }
  }

  private getCurrentCount(context: GameContext): number {
    const inventory = context.gameState.inventory || [];

    return inventory.filter((item: any) => item.name === this.itemName).reduce((sum: number, item: any) => sum + item.count, 0);
  }

  toJSON(): any {
    return {
      type: 'inventory',
      itemName: this.itemName,
      targetCount: this.targetCount,
      minCount: this.minCount,
      maxCount: this.maxCount,
    };
  }

  static fromJSON(json: any): InventoryTracker {
    return new InventoryTracker(json.itemName, json.targetCount, json.minCount, json.maxCount);
  }
}
