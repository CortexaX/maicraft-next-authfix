/**
 * 空间缓存基类
 * 提供 BlockCache 和 ContainerCache 的共享逻辑
 */

import { promises as fs } from 'fs';
import { getLogger } from '@/utils/Logger';
import type { Logger } from '@/utils/Logger';
import type { CacheStats } from './types';

/**
 * 空间缓存配置接口（精简版）
 */
export interface SpatialCacheConfig {
  /** 是否启用缓存 */
  enabled: boolean;
  /** 自动保存间隔（毫秒），0 表示禁用持久化 */
  autoSaveInterval: number;
  /** 缓存过期时间（毫秒），0 表示永不过期 */
  expirationTime: number;
}

/**
 * 缓存项基础接口
 */
export interface CacheEntry {
  /** 缓存时间戳 */
  timestamp: number;
}

/**
 * 空间缓存抽象基类
 * @template T 缓存项类型
 */
export abstract class SpatialCache<T extends CacheEntry> {
  protected cache: Map<string, T> = new Map();
  protected chunkIndex: Map<string, Set<string>> = new Map();
  protected logger: Logger;
  protected persistPath: string;
  protected config: SpatialCacheConfig;
  protected stats: CacheStats;
  protected autoSaveTimer?: NodeJS.Timeout;

  constructor(name: string, config: SpatialCacheConfig, persistPath?: string) {
    this.logger = getLogger(name);
    this.persistPath = persistPath || '';
    this.config = config;

    this.stats = {
      totalEntries: 0,
      expiredEntries: 0,
      lastUpdate: Date.now(),
      hitRate: 0,
      totalQueries: 0,
      totalHits: 0,
    };

    this.logger.info(`${name} 初始化完成`, {
      config: this.config,
      persistPath: this.persistPath || '(无持久化)',
    });

    this.startAutoSave();
  }

  /**
   * 生成区块键
   */
  protected getChunkKey(x: number, z: number): string {
    const chunkX = x >> 4;
    const chunkZ = z >> 4;
    return `${chunkX},${chunkZ}`;
  }

  /**
   * 添加到区块索引
   */
  protected addToChunkIndex(key: string, x: number, z: number): void {
    const chunkKey = this.getChunkKey(x, z);
    if (!this.chunkIndex.has(chunkKey)) {
      this.chunkIndex.set(chunkKey, new Set());
    }
    this.chunkIndex.get(chunkKey)!.add(key);
  }

  /**
   * 从区块索引移除
   */
  protected removeFromChunkIndex(key: string, x: number, z: number): void {
    const chunkKey = this.getChunkKey(x, z);
    const chunkSet = this.chunkIndex.get(chunkKey);
    if (chunkSet) {
      chunkSet.delete(key);
      if (chunkSet.size === 0) {
        this.chunkIndex.delete(chunkKey);
      }
    }
  }

  /**
   * 检查缓存项是否过期
   */
  protected isExpired(entry: T): boolean {
    if (this.config.expirationTime === 0) {
      return false;
    }
    return Date.now() - entry.timestamp > this.config.expirationTime;
  }

  /**
   * 清理过期的缓存条目
   */
  cleanupExpiredEntries(): number {
    let cleanedCount = 0;

    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    this.stats.totalEntries = this.cache.size;
    this.stats.expiredEntries = cleanedCount;

    if (cleanedCount > 0) {
      this.logger.info(`已清理 ${cleanedCount} 个过期的缓存`);
    }

    return cleanedCount;
  }

  /**
   * 启动自动保存
   */
  protected startAutoSave(): void {
    if (this.config.autoSaveInterval > 0) {
      this.autoSaveTimer = setInterval(() => {
        this.save().catch(error => {
          this.logger.error('自动保存失败', undefined, error as Error);
        });
      }, this.config.autoSaveInterval);
    }
  }

  /**
   * 停止自动保存
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
  }

  /**
   * 保存缓存到文件
   * 子类可 override 禁用持久化
   */
  async save(): Promise<void> {
    if (this.config.autoSaveInterval === 0 || !this.persistPath) {
      this.logger.debug('持久化已禁用，跳过保存');
      return;
    }

    try {
      this.cleanupExpiredEntries();

      const data = Array.from(this.cache.entries());
      const saveData = {
        version: '1.0',
        timestamp: Date.now(),
        stats: this.stats,
        entries: data,
      };

      await fs.writeFile(this.persistPath, JSON.stringify(saveData, null, 2), 'utf-8');
      this.logger.info(`缓存保存完成，已保存 ${data.length} 个条目`);
    } catch (error) {
      this.logger.error('保存缓存失败', undefined, error as Error);
      throw error;
    }
  }

  /**
   * 从文件加载缓存
   * 子类可 override 禁用持久化
   */
  async load(): Promise<void> {
    if (this.config.autoSaveInterval === 0 || !this.persistPath) {
      this.logger.info('持久化已禁用，跳过加载，使用空缓存');
      return;
    }

    try {
      const content = await fs.readFile(this.persistPath, 'utf-8');
      const saveData = JSON.parse(content);

      if (saveData.version && saveData.entries) {
        this.cache = new Map(saveData.entries);
        if (saveData.stats) {
          this.stats = { ...this.stats, ...saveData.stats };
        }
      } else {
        this.cache = new Map(saveData);
      }

      this.stats.totalEntries = this.cache.size;
      this.rebuildChunkIndex();

      this.logger.info(`缓存加载完成，已加载 ${this.cache.size} 个条目，区块索引 ${this.chunkIndex.size} 个区块`);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.info('缓存文件不存在，跳过加载');
      } else {
        this.logger.error('加载缓存失败', undefined, error as Error);
        throw error;
      }
    }
  }

  /**
   * 重建区块索引
   * 子类需要实现获取坐标的方法
   */
  protected abstract rebuildChunkIndex(): void;

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    this.chunkIndex.clear();
    this.stats.totalEntries = 0;
    this.stats.lastUpdate = Date.now();
    this.logger.info('缓存已清空');
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 启用/禁用缓存
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.logger.info(`缓存 ${enabled ? '已启用' : '已禁用'}`);
  }

  /**
   * 销毁缓存实例
   */
  destroy(): void {
    this.stopAutoSave();
    this.clear();
    this.logger.info('缓存已销毁');
  }
}
