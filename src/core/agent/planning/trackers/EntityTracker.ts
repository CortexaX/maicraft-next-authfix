/**
 * 实体追踪器（状态型Tracker）
 * 检查附近是否有指定类型或数量的实体
 * 用于"找到村民"、"附近有敌对生物"等任务
 */

import type { Tracker, TrackerProgress } from './types';
import type { GameContext } from '@/core/agent/types';

export class EntityTracker implements Tracker {
  readonly type = 'entity';

  constructor(
    private entityType?: string, // 实体类型，如 'villager', 'zombie'
    private entityCategory?: 'hostile' | 'passive' | 'neutral' | 'player', // 实体类别
    private minCount: number = 1, // 最小数量
    private maxCount?: number, // 最大数量（可选）
    private distance: number = 16, // 检测距离
    private mustSee: boolean = false, // 是否必须在视线内
  ) {}

  checkCompletion(context: GameContext): boolean {
    const entities = this.getMatchingEntities(context);

    // 检查最小数量
    if (entities.length < this.minCount) {
      return false;
    }

    // 检查最大数量
    if (this.maxCount !== undefined && entities.length > this.maxCount) {
      return false;
    }

    return true;
  }

  getProgress(context: GameContext): TrackerProgress {
    const entities = this.getMatchingEntities(context);
    const current = entities.length;
    const target = this.maxCount ?? this.minCount;

    let description = '';
    if (this.entityType) {
      description = `发现 ${current}/${target} 个 ${this.entityType}`;
    } else if (this.entityCategory) {
      description = `发现 ${current}/${target} 个${this.entityCategory}实体`;
    } else {
      description = `发现 ${current}/${target} 个实体`;
    }

    return {
      current,
      target,
      percentage: Math.min((current / target) * 100, 100),
      description,
      details: {
        entities: entities.map((e: any) => ({
          type: e.name,
          distance: e.position ? this.calculateDistance(context, e.position) : null,
        })),
      },
    };
  }

  getDescription(): string {
    let desc = '';

    if (this.entityType) {
      desc = `附近有 ${this.minCount}`;
      if (this.maxCount) {
        desc += `-${this.maxCount}`;
      }
      desc += ` 个 ${this.entityType}`;
    } else if (this.entityCategory) {
      desc = `附近有 ${this.minCount}`;
      if (this.maxCount) {
        desc += `-${this.maxCount}`;
      }
      desc += ` 个${this.entityCategory}实体`;
    } else {
      desc = `附近有 ${this.minCount} 个实体`;
    }

    desc += ` (${this.distance}格内`;
    if (this.mustSee) {
      desc += '，可见';
    }
    desc += ')';

    return desc;
  }

  private getMatchingEntities(context: GameContext): any[] {
    const entities = context.gameState.nearbyEntities || [];
    const botPos = context.gameState.blockPosition;

    if (!botPos) return [];

    return entities.filter((entity: any) => {
      // 检查距离
      if (entity.position) {
        const distance = this.calculateDistance(context, entity.position);
        if (distance > this.distance) {
          return false;
        }
      }

      // 检查可见性
      if (this.mustSee && !entity.visible) {
        return false;
      }

      // 检查实体类型
      if (this.entityType && entity.name !== this.entityType) {
        return false;
      }

      // 检查实体类别
      if (this.entityCategory) {
        const category = this.getEntityCategory(entity.name);
        if (category !== this.entityCategory) {
          return false;
        }
      }

      return true;
    });
  }

  private calculateDistance(context: GameContext, entityPos: { x: number; y: number; z: number }): number {
    const botPos = context.gameState.blockPosition;
    if (!botPos) return Infinity;

    return Math.sqrt(Math.pow(botPos.x - entityPos.x, 2) + Math.pow(botPos.y - entityPos.y, 2) + Math.pow(botPos.z - entityPos.z, 2));
  }

  private getEntityCategory(entityType: string): 'hostile' | 'passive' | 'neutral' | 'player' | 'unknown' {
    // 敌对生物
    const hostile = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'blaze', 'ghast', 'slime'];
    // 友好生物
    const passive = ['cow', 'sheep', 'pig', 'chicken', 'villager', 'horse', 'donkey', 'cat', 'wolf'];
    // 中立生物
    const neutral = ['iron_golem', 'zombie_pigman', 'enderman', 'wolf', 'bee'];

    if (entityType === 'player') return 'player';
    if (hostile.includes(entityType)) return 'hostile';
    if (passive.includes(entityType)) return 'passive';
    if (neutral.includes(entityType)) return 'neutral';
    return 'unknown';
  }

  toJSON(): any {
    return {
      type: 'entity',
      entityType: this.entityType,
      entityCategory: this.entityCategory,
      minCount: this.minCount,
      maxCount: this.maxCount,
      distance: this.distance,
      mustSee: this.mustSee,
    };
  }

  static fromJSON(json: any): EntityTracker {
    return new EntityTracker(json.entityType, json.entityCategory, json.minCount || 1, json.maxCount, json.distance || 16, json.mustSee || false);
  }
}
