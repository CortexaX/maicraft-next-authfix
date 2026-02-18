// src/core/agent/react/ObservationCollector.ts

import type { AgentState } from '@/core/agent/types';
import type { Observation } from './types';
import { ActionPromptGenerator } from '@/core/actions/ActionPromptGenerator';
import { PromptDataCollector } from '@/core/agent/prompt/PromptDataCollector';
import { getLogger } from '@/utils/Logger';

/**
 * 观察收集器
 * 收集当前游戏状态，生成结构化观察
 */
export class ObservationCollector {
  private state: AgentState;
  private promptDataCollector: PromptDataCollector;
  private logger = getLogger('ObservationCollector');

  constructor(state: AgentState) {
    this.state = state;
    this.promptDataCollector = new PromptDataCollector(
      state,
      new ActionPromptGenerator(state.context.executor!)
    );
  }

  /**
   * 收集观察
   */
  async collect(): Promise<Observation> {
    const gameState = this.state.context.gameState;

    // 收集基础信息
    let promptData: any = {};
    try {
      promptData = await this.promptDataCollector.collectAllData();
    } catch (error) {
      this.logger.warn('收集提示词数据失败，使用默认值');
    }

    // 构建观察
    return {
      // 位置信息
      position: {
        x: gameState.position?.x ?? 0,
        y: gameState.position?.y ?? 0,
        z: gameState.position?.z ?? 0,
      },

      // 健康状态
      health: gameState.health ?? 20,
      food: gameState.food ?? 20,
      saturation: 20, // GameState doesn't track saturation separately

      // 附近实体
      nearbyEntities: gameState.nearbyEntities || [],

      // 附近方块（简化版）
      nearbyBlocks: this.summarizeNearbyBlocks(gameState),

      // 物品栏摘要
      inventory: this.summarizeInventory(gameState),

      // 时间
      timeOfDay: gameState.timeOfDay ?? 0,

      // 当前目标
      currentGoal: this.state.context.goalManager?.getCurrentGoal(),

      // 完整的提示词数据
      promptData: promptData,
    };
  }

  /**
   * 汇总附近方块
   */
  private summarizeNearbyBlocks(gameState: any): string {
    if (typeof gameState.getNearbyBlocksDescription === 'function') {
      return gameState.getNearbyBlocksDescription();
    }

    // 简化实现
    const nearbyBlocks = gameState.nearbyBlocks;
    if (!nearbyBlocks || nearbyBlocks.length === 0) {
      return '附近无特殊方块';
    }

    // 统计方块数量
    const counts: Record<string, number> = {};
    for (const block of nearbyBlocks) {
      const name = block.name || 'unknown';
      counts[name] = (counts[name] || 0) + 1;
    }

    const parts = Object.entries(counts)
      .slice(0, 10)
      .map(([name, count]) => `${name}(${count})`);

    return `附近有: ${parts.join(', ')}`;
  }

  /**
   * 汇总物品栏
   */
  private summarizeInventory(gameState: any): string {
    if (typeof gameState.getInventoryDescription === 'function') {
      return gameState.getInventoryDescription();
    }

    const inventory = gameState.inventory;
    if (!inventory || inventory.length === 0) {
      return '物品栏为空';
    }

    // 统计物品
    const counts: Record<string, number> = {};
    for (const item of inventory) {
      if (item && item.name) {
        counts[item.name] = (counts[item.name] || 0) + (item.count || 1);
      }
    }

    const parts = Object.entries(counts)
      .slice(0, 15)
      .map(([name, count]) => `${name}(${count})`);

    return parts.join(', ');
  }
}
