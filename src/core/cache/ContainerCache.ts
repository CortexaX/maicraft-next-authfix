/**
 * 容器缓存系统
 * 继承 SpatialCache 基类，提供 Minecraft 容器信息的缓存和查询功能
 */

import { Vec3 } from 'vec3';
import { SpatialCache, type SpatialCacheConfig } from './SpatialCache';
import type { ContainerInfo, ContainerType } from './types';
import { distance3D } from '@/utils/spatial';

export class ContainerCache extends SpatialCache<ContainerInfo> {
  private keyGenerator: (x: number, y: number, z: number, type: string) => string;

  constructor(config?: Partial<SpatialCacheConfig>, persistPath?: string) {
    const fullConfig: SpatialCacheConfig = {
      enabled: config?.enabled ?? true,
      autoSaveInterval: config?.autoSaveInterval ?? 10 * 60 * 1000,
      expirationTime: config?.expirationTime ?? 60 * 60 * 1000,
      ...config,
    };

    super('ContainerCache', fullConfig, persistPath || 'data/container_cache.json');
    this.keyGenerator = this.defaultKeyGenerator;
  }

  private defaultKeyGenerator(x: number, y: number, z: number, type: string): string {
    return `${type}:${x},${y},${z}`;
  }

  getContainer(x: number, y: number, z: number, type?: string): ContainerInfo | null {
    if (!this.config.enabled) return null;

    this.stats.totalQueries++;

    if (!type) {
      const possibleTypes: ContainerType[] = ['chest', 'furnace', 'brewing_stand', 'dispenser', 'hopper', 'shulker_box'];
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

    if (this.isExpired(containerInfo)) {
      this.cache.delete(key);
      this.logger.debug(`容器缓存已过期，已移除: ${key}`);
      return null;
    }

    this.stats.totalHits++;
    this.stats.hitRate = this.stats.totalHits / this.stats.totalQueries;

    return containerInfo;
  }

  setContainer(x: number, y: number, z: number, type: string, container: Partial<ContainerInfo>): void {
    if (!this.config.enabled) return;

    const key = this.keyGenerator(x, y, z, type);
    const now = Date.now();

    const containerInfo: ContainerInfo = {
      type: type as ContainerInfo['type'],
      position: new Vec3(x, y, z),
      name: container.name,
      lastAccessed: now,
    };

    this.cache.set(key, containerInfo);
    this.addToChunkIndex(key, x, z);

    this.stats.totalEntries = this.cache.size;
    this.stats.lastUpdate = now;

    this.logger.debug(`容器缓存已更新: ${key} -> ${containerInfo.type}`);
  }

  removeContainer(x: number, y: number, z: number, type: string): boolean {
    const key = this.keyGenerator(x, y, z, type);
    const deleted = this.cache.delete(key);

    this.removeFromChunkIndex(key, x, z);

    if (deleted) {
      this.stats.totalEntries = this.cache.size;
      this.logger.debug(`容器缓存已删除: ${key}`);
    }

    return deleted;
  }

  getContainersInRadius(centerX: number, centerY: number, centerZ: number, radius: number): ContainerInfo[] {
    const containers: ContainerInfo[] = [];

    for (const containerInfo of this.cache.values()) {
      if (this.isExpired(containerInfo)) {
        continue;
      }

      const dist = distance3D(
        { x: containerInfo.position.x, y: containerInfo.position.y, z: containerInfo.position.z },
        { x: centerX, y: centerY, z: centerZ },
      );

      if (dist <= radius) {
        containers.push(containerInfo);
      }
    }

    return containers;
  }

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

  protected override isExpired(containerInfo: ContainerInfo): boolean {
    if (this.config.expirationTime === 0) {
      return false;
    }
    return Date.now() - containerInfo.lastAccessed > this.config.expirationTime;
  }

  protected rebuildChunkIndex(): void {
    this.chunkIndex.clear();

    for (const [key, containerInfo] of this.cache) {
      this.addToChunkIndex(key, containerInfo.position.x, containerInfo.position.z);
    }

    this.logger.debug(`区块索引重建完成: ${this.chunkIndex.size} 个区块`);
  }
}
