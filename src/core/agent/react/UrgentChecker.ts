// src/core/agent/react/UrgentChecker.ts

import type { AgentState } from '@/core/agent/types';
import type { StructuredAction } from '@/core/agent/structured/ActionSchema';
import { getLogger } from '@/utils/Logger';

/**
 * 紧急情况检查器
 *
 * 设计决策：采用混合策略
 * - 轮询检查：用于低血量、溺水等状态检测
 * - 事件驱动：用于敌对生物检测（保留原 CombatMode 的事件能力）
 */
export class UrgentChecker {
  private state: AgentState;
  private logger = getLogger('UrgentChecker');

  // 敌对生物列表
  private readonly hostileMobs = [
    'zombie', 'skeleton', 'creeper', 'spider',
    'cave_spider', 'enderman', 'witch', 'blaze',
    'ghast', 'magma_cube', 'slime', 'piglin',
    'hoglin', 'zoglin', 'drowned', 'husk',
    'stray', 'phantom', 'pillager', 'vindicator',
    'evoker', 'vex', 'ravager', 'shulker',
  ];

  // 事件驱动状态
  private pendingUrgentAction: StructuredAction | null = null;
  private threatCount: number = 0;

  constructor(state: AgentState) {
    this.state = state;
    this.registerEventListeners();
  }

  /**
   * 注册事件监听器
   *
   * 注意：敌对生物检测完全依赖 check() 方法中的轮询机制
   * 不使用事件驱动，因为：
   * 1. mineflayer 没有原生的 entityUpdated 事件
   * 2. entityHurt 事件数据与 nearbyEntities 无直接关联
   * 3. 轮询机制已经足够处理敌对生物检测
   */
  private registerEventListeners(): void {
    // 敌对生物检测依赖 check() 方法中的轮询机制
    // 不使用事件驱动
  }

  /**
   * 检查敌对生物
   */
  private checkForHostileEntities(entities: any[]): void {
    this.handleEntitiesUpdate(entities);
  }

  /**
   * 处理实体更新（事件驱动）
   */
  private handleEntitiesUpdate(entities: any[]): void {
    if (!entities) return;

    const hostileEntities = entities.filter(e =>
      this.hostileMobs.includes(e.name?.toLowerCase())
    );

    const previousThreatCount = this.threatCount;
    this.threatCount = hostileEntities.length;

    // 威胁出现时，设置紧急动作
    if (previousThreatCount === 0 && this.threatCount > 0) {
      const nearestEnemy = hostileEntities.reduce((nearest, curr) =>
        (curr.distance ?? 999) < (nearest.distance ?? 999) ? curr : nearest
      );

      this.pendingUrgentAction = {
        action_type: 'kill_mob',
        entity: nearestEnemy.name,
        timeout: 30,
        intention: '紧急：自动反击敌对生物',
      } as StructuredAction;

      this.state.memory?.recordThought(
        `⚠️ 检测到威胁: ${nearestEnemy.name} (距离: ${(nearestEnemy.distance ?? 0).toFixed(1)}m)`,
        { source: 'urgent_checker' }
      );

      this.logger.info(`⚠️ 检测到威胁: ${nearestEnemy.name}`);
    }
  }

  /**
   * 检查紧急情况（轮询 + 事件混合）
   */
  async check(): Promise<StructuredAction | null> {
    const gameState = this.state.context.gameState;

    // 1. 优先处理事件驱动的紧急动作
    if (this.pendingUrgentAction) {
      const action = this.pendingUrgentAction;
      this.pendingUrgentAction = null;
      return action;
    }

    // 2. 检查低血量（轮询）
    if (gameState.health < 6) {
      const food = this.findBestFood(gameState);
      if (food) {
        return {
          action_type: 'eat',
          item: food,
          intention: '紧急：血量过低，需要进食',
        } as StructuredAction;
      }
    }

    // 3. 检查溺水（轮询）
    if (this.isUnderwater(gameState) && (gameState.oxygenLevel ?? 20) < 5) {
      return {
        action_type: 'swim_to_land',
        intention: '紧急：溺水危险',
      } as StructuredAction;
    }

    return null;
  }

  /**
   * 获取当前威胁数量
   */
  getThreatCount(): number {
    return this.threatCount;
  }

  /**
   * 查找最佳食物
   */
  private findBestFood(gameState: any): string | null {
    const inventory = gameState.inventory;
    if (!inventory) return null;

    // 食物优先级
    const foodPriority = [
      'golden_apple', 'enchanted_golden_apple',
      'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
      'bread', 'apple', 'cooked_chicken',
    ];

    for (const food of foodPriority) {
      if (inventory.some?.((item: any) => item.name === food)) {
        return food;
      }
    }

    // 任意食物
    const anyFood = inventory.find?.((item: any) =>
      item.name.includes('cooked') || item.name.includes('bread') || item.name.includes('apple')
    );
    return anyFood?.name || null;
  }

  /**
   * 检查是否在水下
   */
  private isUnderwater(gameState: any): boolean {
    return (gameState.oxygenLevel ?? 20) < 20;
  }
}
