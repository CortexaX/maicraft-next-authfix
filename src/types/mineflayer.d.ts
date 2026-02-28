/**
 * mineflayer 类型扩展
 * 为 mineflayer 及相关库添加缺失的类型定义
 */

import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import type { Entity } from 'prismarine-entity';
import type { Item } from 'prismarine-item';

// ==================== Block 扩展 ====================

declare module 'prismarine-block' {
  interface Block {
    /** 方块硬度 */
    hardness?: number;
    /** 方块亮度 */
    lightLevel?: number;
    /** 是否透明 */
    transparent?: boolean;
    /** 生物群系 */
    biome?: {
      id: number;
      name: string;
    };
    /** 方块状态 */
    states?: Record<string, unknown>;
    /** 方块面向 */
    face?: number;
  }
}

// ==================== Entity 扩展 ====================

declare module 'prismarine-entity' {
  interface Entity {
    /** 生命值 */
    health?: number;
    /** 最大生命值 */
    maxHealth?: number;
    /** 物品栏 */
    inventory?: Item[];
    /** 装备 */
    equipment?: Record<string, Item | null>;
  }
}

// ==================== Item 扩展 ====================

declare module 'prismarine-item' {
  interface Item {
    /** 物品槽位 */
    slot?: number;
    /** 物品元数据 */
    metadata?: number;
  }
}

// ==================== Bot 扩展 ====================

declare module 'mineflayer' {
  interface Bot {
    /** 收集方块插件 */
    collectBlock?: {
      collect(targets: Entity | Block, options?: { timeout?: number }): Promise<void>;
      movements?: unknown;
    };
    /** PvP 插件 */
    pvp?: {
      attack(target: Entity): Promise<void>;
    };
    /** 装备管理器插件 */
    armorManager?: {
      equipAll(): Promise<void>;
    };
    /** 路径查找器 */
    pathfinder?: {
      movements?: unknown;
    };
    /** 工具插件 */
    tool?: {
      equipBetterTool(block: Block): Promise<void>;
      canHarvest(block: Block): boolean;
    };
    /** 缓存管理器 (自定义) */
    cacheManager?: unknown;
    /** 游戏状态 (自定义) */
    gameState?: unknown;
  }
}

// ==================== 常用类型导出 ====================

/** mineflayer Bot 类型 */
export type Bot = Bot;

/** mineflayer Block 类型 */
export type Block = Block;

/** mineflayer Entity 类型 */
export type Entity = Entity;

/** mineflayer Item 类型 */
export type Item = Item;

/** 容器接口 */
export interface Container {
  type(): string;
  containerItems(): Item[];
  close(): Promise<void>;
}

/** 窗口接口 */
export interface Window extends Container {
  /** 窗口 ID */
  id: number;
  /** 窗口标题 */
  title: string;
  /** 物品槽位数 */
  slotCount: number;
}
