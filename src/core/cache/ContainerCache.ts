/**
 * 容器缓存系统
 * 提供 Minecraft 容器信息的缓存、查询和持久化功能
 */

import { promises as fs } from 'fs';
import { Vec3 } from 'vec3';
import { getLogger } from '@/utils/Logger';
import type { Logger } from '@/utils/Logger';
import type { ContainerInfo, CacheConfig, CacheStats, ContainerKeyGenerator } from './types';

export class ContainerCache {
  private cache: Map<string, ContainerInfo> = new Map();
  private chunkIndex: Map<string, Set<string>> = new Map(); // 🔧 区块索引：chunkKey -> Set<containerKey>
  private logger: Logger;
  private persistPath: string;
  private config: CacheConfig;
  private stats: CacheStats;
  private keyGenerator: ContainerKeyGenerator;
  private autoSaveTimer?: NodeJS.Timeout;

  constructor(config?: Partial<CacheConfig>, persistPath?: string) {
    this.logger = getLogger('ContainerCache');
    this.persistPath = persistPath || 'data/container_cache.json';
    this.keyGenerator = this.defaultKeyGenerator;

    // 默认配置
    this.config = {
      maxEntries: 0, // 🔧 设为0表示无限制，完全依赖区块卸载事件清理
      expirationTime: 60 * 60 * 1000, // 1小时
      autoSaveInterval: 10 * 60 * 1000, // 10分钟
      enabled: true,
      updateStrategy: 'smart',
      ...config,
    };

    // 初始化统计信息
    this.stats = {
      totalEntries: 0,
      expiredEntries: 0,
      lastUpdate: Date.now(),
      hitRate: 0,
      totalQueries: 0,
      totalHits: 0,
    };

    this.logger.info('ContainerCache 初始化完成', {
      config: this.config,
      persistPath: this.persistPath,
    });

    // 启动自动保存
    this.startAutoSave();
  }

  /**
   * 默认的缓存键生成器
   */
  private defaultKeyGenerator(x: number, y: number, z: number, type: string): string {
    return `${type}:${x},${y},${z}`;
  }

  /**
   * 生成区块键
   */
  private getChunkKey(x: number, z: number): string {
    const chunkX = x >> 4; // 除以16
    const chunkZ = z >> 4;
    return `${chunkX},${chunkZ}`;
  }

  /**
   * 获取容器信息
   */
  getContainer(x: number, y: number, z: number, type?: string): ContainerInfo | null {
    if (!this.config.enabled) return null;

    this.stats.totalQueries++;

    // 如果没有指定类型，尝试所有可能的类型
    if (!type) {
      const possibleTypes = ['chest', 'furnace', 'brewing_stand', 'dispenser', 'hopper', 'shulker_box'];
      for (const containerType of possibleTypes) {
        const key = this.keyGenerator(x, y, z, containerType);
        const containerInfo = this.cache.get(key);
        if (containerInfo && !this.isExpired(containerInfo)) {
          this.stats.totalHits++;
          this.stats.hitRate = this.stats.totalHits / this.stats.totalQueries;
          return containerInfo;
        }
      }
      return null;
    }

    const key = this.keyGenerator(x, y, z, type);
    const containerInfo = this.cache.get(key);

    if (!containerInfo) {
      return null;
    }

    // 检查是否过期
    if (this.isExpired(containerInfo)) {
      this.cache.delete(key);
      this.logger.debug(`容器缓存已过期，已移除: ${key}`);
      return null;
    }

    this.stats.totalHits++;
    this.stats.hitRate = this.stats.totalHits / this.stats.totalQueries;

    return containerInfo;
  }

  /**
   * 设置容器信息
   * 🔧 精简版：只存储位置和类型，不存储物品内容，减少内存占用
   */
  setContainer(x: number, y: number, z: number, type: string, container: Partial<ContainerInfo>): void {
    if (!this.config.enabled) return;

    const key = this.keyGenerator(x, y, z, type);
    const now = Date.now();

    // 检查缓存大小限制（0表示无限制）
    if (this.config.maxEntries > 0 && this.cache.size >= this.config.maxEntries) {
      this.evictOldestEntries();
    }

    // 🔧 只存储必要字段：type, position, name, lastAccessed
    const containerInfo: ContainerInfo = {
      type: type as ContainerInfo['type'],
      position: new Vec3(x, y, z),
      name: container.name,
      lastAccessed: now,
    };

    this.cache.set(key, containerInfo);

    // 🔧 更新区块索引
    const chunkKey = this.getChunkKey(x, z);
    if (!this.chunkIndex.has(chunkKey)) {
      this.chunkIndex.set(chunkKey, new Set());
    }
    this.chunkIndex.get(chunkKey)!.add(key);

    this.stats.totalEntries = this.cache.size;
    this.stats.lastUpdate = now;

    this.logger.debug(`容器缓存已更新: ${key} -> ${containerInfo.type}`);
  }

  /**
   * 删除容器缓存
   */
  removeContainer(x: number, y: number, z: number, type: string): boolean {
    const key = this.keyGenerator(x, y, z, type);
    const deleted = this.cache.delete(key);

    // 🔧 从区块索引中移除
    const chunkKey = this.getChunkKey(x, z);
    const keysInChunk = this.chunkIndex.get(chunkKey);
    if (keysInChunk) {
      keysInChunk.delete(key);
      if (keysInChunk.size === 0) {
        this.chunkIndex.delete(chunkKey);
      }
    }

    if (deleted) {
      this.stats.totalEntries = this.cache.size;
      this.logger.debug(`容器缓存已删除: ${key}`);
    }

    return deleted;
  }

  /**
   * 获取指定范围内的容器
   */
  getContainersInRadius(centerX: number, centerY: number, centerZ: number, radius: number): ContainerInfo[] {
    const containers: ContainerInfo[] = [];

    for (const containerInfo of this.cache.values()) {
      if (this.isExpired(containerInfo)) {
        continue;
      }

      const distance = Math.sqrt(
        Math.pow(containerInfo.position.x - centerX, 2) +
          Math.pow(containerInfo.position.y - centerY, 2) +
          Math.pow(containerInfo.position.z - centerZ, 2),
      );

      if (distance <= radius) {
        containers.push(containerInfo);
      }
    }

    return containers;
  }

  /**
   * 🔧 移除指定区块内的所有容器
   */
  removeContainersInChunk(chunkX: number, chunkZ: number): number {
    const chunkKey = `${chunkX},${chunkZ}`;
    const containerKeysInChunk = this.chunkIndex.get(chunkKey);
    let removedCount = 0;

    if (containerKeysInChunk) {
      for (const containerKey of containerKeysInChunk) {
        if (this.cache.delete(containerKey)) {
          removedCount++;
        }
      }
      this.chunkIndex.delete(chunkKey);
    }

    this.stats.totalEntries = this.cache.size;
    return removedCount;
  }

  /**
   * 按类型查找容器
   */
  findContainersByType(type: string): ContainerInfo[] {
    const containers: ContainerInfo[] = [];

    for (const containerInfo of this.cache.values()) {
      if (this.isExpired(containerInfo)) {
        continue;
      }

      if (containerInfo.type === type) {
        containers.push(containerInfo);
      }
    }

    return containers;
  }

  /**
   * 检查容器信息是否过期
   */
  private isExpired(containerInfo: ContainerInfo): boolean {
    // 🔧 如果 expirationTime 为 0，表示永不过期，完全依赖区块卸载清理
    if (this.config.expirationTime === 0) {
      return false;
    }
    return Date.now() - containerInfo.lastAccessed > this.config.expirationTime;
  }

  /**
   * 清理过期的缓存条目
   */
  cleanupExpiredEntries(): number {
    let cleanedCount = 0;

    for (const [key, containerInfo] of this.cache) {
      if (this.isExpired(containerInfo)) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    this.stats.totalEntries = this.cache.size;
    this.stats.expiredEntries = cleanedCount;

    if (cleanedCount > 0) {
      this.logger.info(`已清理 ${cleanedCount} 个过期的容器缓存`);
    }

    return cleanedCount;
  }

  /**
   * 驱逐最旧的缓存条目
   */
  private evictOldestEntries(): void {
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    const evictCount = Math.floor(this.config.maxEntries * 0.1); // 驱逐10%的旧条目
    for (let i = 0; i < evictCount && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
    }

    this.stats.totalEntries = this.cache.size;
    this.logger.info(`已驱逐 ${evictCount} 个最旧的容器缓存`);
  }

  /**
   * 启动自动保存
   */
  private startAutoSave(): void {
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
   */
  async save(): Promise<void> {
    // 🔧 如果 autoSaveInterval 为 0，则跳过保存（禁用持久化）
    if (this.config.autoSaveInterval === 0) {
      this.logger.debug('持久化已禁用，跳过保存');
      return;
    }

    try {
      // 清理过期条目
      this.cleanupExpiredEntries();

      const data = Array.from(this.cache.entries());
      const saveData = {
        version: '1.0',
        timestamp: Date.now(),
        stats: this.stats,
        entries: data,
      };

      await fs.writeFile(this.persistPath, JSON.stringify(saveData, null, 2), 'utf-8');
      this.logger.info(`ContainerCache 保存完成，已保存 ${data.length} 个容器缓存`);
    } catch (error) {
      this.logger.error('保存 ContainerCache 失败', undefined, error as Error);
      throw error;
    }
  }

  /**
   * 从文件加载缓存
   */
  async load(): Promise<void> {
    // 🔧 如果 autoSaveInterval 为 0，则跳过加载（禁用持久化）
    if (this.config.autoSaveInterval === 0) {
      this.logger.info('持久化已禁用，跳过加载，使用空缓存');
      return;
    }

    try {
      const content = await fs.readFile(this.persistPath, 'utf-8');
      const saveData = JSON.parse(content);

      if (saveData.version && saveData.entries) {
        // 新版本格式
        this.cache = new Map(saveData.entries);
        if (saveData.stats) {
          this.stats = { ...this.stats, ...saveData.stats };
        }
      } else {
        // 旧版本兼容
        this.cache = new Map(saveData);
      }

      this.stats.totalEntries = this.cache.size;

      // 🔧 重建区块索引
      this.chunkIndex.clear();
      for (const [_key, containerInfo] of this.cache) {
        const chunkKey = this.getChunkKey(containerInfo.position.x, containerInfo.position.z);
        if (!this.chunkIndex.has(chunkKey)) {
          this.chunkIndex.set(chunkKey, new Set());
        }
        this.chunkIndex.get(chunkKey)!.add(_key);
      }

      this.logger.info(`ContainerCache 加载完成，已加载 ${this.cache.size} 个容器缓存，区块索引 ${this.chunkIndex.size} 个区块`);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.info('ContainerCache 文件不存在，跳过加载');
      } else {
        this.logger.error('加载 ContainerCache 失败', undefined, error as Error);
        throw error;
      }
    }
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    this.stats.totalEntries = 0;
    this.stats.lastUpdate = Date.now();
    this.logger.info('ContainerCache 已清空');
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
    this.logger.info(`ContainerCache ${enabled ? '已启用' : '已禁用'}`);
  }

  /**
   * 销毁缓存实例
   */
  destroy(): void {
    this.stopAutoSave();
    this.clear();
    this.logger.info('ContainerCache 已销毁');
  }
}
