/**
 * 位置追踪器（状态型Tracker）
 * 检查是否到达指定位置
 */

import type { Tracker, TrackerProgress } from './types';
import type { GameContext } from '@/core/agent/types';

export class LocationTracker implements Tracker {
  readonly type = 'location';

  constructor(
    private targetX: number,
    private targetY: number | undefined, // Y坐标可选，不限制高度
    private targetZ: number,
    private radius: number = 3, // 到达半径
  ) {}

  checkCompletion(context: GameContext): boolean {
    const pos = context.gameState.blockPosition;
    if (!pos) return false;

    // 计算距离（如果Y坐标未指定，则忽略Y轴）
    let distance: number;
    if (this.targetY === undefined) {
      // 只计算水平距离
      distance = Math.sqrt(Math.pow(pos.x - this.targetX, 2) + Math.pow(pos.z - this.targetZ, 2));
    } else {
      // 计算3D距离
      distance = Math.sqrt(Math.pow(pos.x - this.targetX, 2) + Math.pow(pos.y - this.targetY, 2) + Math.pow(pos.z - this.targetZ, 2));
    }

    return distance <= this.radius;
  }

  getProgress(context: GameContext): TrackerProgress {
    const pos = context.gameState.blockPosition;
    if (!pos) {
      return {
        current: 0,
        target: this.radius,
        percentage: 0,
        description: '位置未知',
      };
    }

    // 计算距离
    let distance: number;
    if (this.targetY === undefined) {
      distance = Math.sqrt(Math.pow(pos.x - this.targetX, 2) + Math.pow(pos.z - this.targetZ, 2));
    } else {
      distance = Math.sqrt(Math.pow(pos.x - this.targetX, 2) + Math.pow(pos.y - this.targetY, 2) + Math.pow(pos.z - this.targetZ, 2));
    }

    // 计算百分比：距离越近，百分比越高
    const maxDistance = 100; // 假设最大距离
    const percentage = Math.max(0, Math.min(100, (1 - distance / maxDistance) * 100));

    return {
      current: Math.floor(distance),
      target: this.radius,
      percentage,
      description: `距离目标 ${distance.toFixed(1)} 格`,
      details: {
        currentPosition: pos,
        targetPosition: {
          x: this.targetX,
          y: this.targetY,
          z: this.targetZ,
        },
      },
    };
  }

  getDescription(): string {
    if (this.targetY === undefined) {
      return `到达位置 (${this.targetX}, ?, ${this.targetZ})`;
    }
    return `到达位置 (${this.targetX}, ${this.targetY}, ${this.targetZ})`;
  }

  toJSON(): any {
    return {
      type: 'location',
      targetX: this.targetX,
      targetY: this.targetY,
      targetZ: this.targetZ,
      radius: this.radius,
    };
  }

  static fromJSON(json: any): LocationTracker {
    return new LocationTracker(json.targetX, json.targetY, json.targetZ, json.radius);
  }
}
