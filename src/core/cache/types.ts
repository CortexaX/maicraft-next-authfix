/**
 * 缓存系统相关的类型定义
 */

import type { Vec3 } from 'vec3';

/**
 * 方块信息接口
 * 🔧 精简版：只保留查询和寻路必需的信息，减少内存占用
 */
export interface BlockInfo {
  /** 方块名称 */
  name: string;
  /** 方块类型ID */
  type: number;
  /** 方块位置 */
  position: Vec3;
  /** 缓存时间戳 */
  timestamp: number;
  /** 方块元数据 */
  metadata?: number;
  /** 方块硬度 */
  hardness?: number;
  /** 方块亮度 */
  lightLevel?: number;
  /** 是否透明 */
  transparent?: boolean;
  /** 方块状态 */
  state?: Record<string, unknown>;
}

/**
 * 容器类型
 */
export type ContainerType = 'chest' | 'furnace' | 'brewing_stand' | 'dispenser' | 'hopper' | 'shulker_box';

/**
 * 容器信息接口
 * 🔧 精简版：只保留位置和类型信息，不存储物品内容，减少内存占用和查询开销
 */
export interface ContainerInfo {
  /** 容器类型 */
  type: ContainerType;
  /** 容器位置 */
  position: Vec3;
  /** 容器名称 (自定义名称) */
  name?: string;
  /** 最后访问时间 */
  lastAccessed: number;
}

/**
 * 容器物品接口
 */
export interface ContainerItem {
  /** 物品ID */
  itemId: number;
  /** 物品名称 */
  name: string;
  /** 数量 */
  count: number;
  /** 耐久度 */
  durability?: number;
  /** 附魔信息 */
  enchantments?: Array<{
    name: string;
    level: number;
  }>;
  /** 自定义名称 */
  customName?: string;
  /** 物品NBT数据 */
  nbt?: any;
}

/**
 * 缓存配置接口
 */
export interface CacheConfig {
  /** 最大缓存数量 */
  maxEntries: number;
  /** 缓存过期时间 (毫秒) */
  expirationTime: number;
  /** 自动保存间隔 (毫秒) */
  autoSaveInterval: number;
  /** 是否启用缓存 */
  enabled: boolean;
  /** 缓存更新策略 */
  updateStrategy: 'immediate' | 'batch' | 'smart';
  /** 🆕 是否只缓存可见方块（更拟人化，减少内存占用） */
  onlyVisibleBlocks?: boolean;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  /** 缓存条目总数 */
  totalEntries: number;
  /** 过期条目数量 */
  expiredEntries: number;
  /** 最后更新时间 */
  lastUpdate: number;
  /** 缓存命中率 */
  hitRate: number;
  /** 总查询次数 */
  totalQueries: number;
  /** 缓存命中次数 */
  totalHits: number;
}

/**
 * 方块缓存键生成函数类型
 */
export type BlockKeyGenerator = (x: number, y: number, z: number) => string;

/**
 * 容器缓存键生成函数类型
 */
export type ContainerKeyGenerator = (x: number, y: number, z: number, type: string) => string;
