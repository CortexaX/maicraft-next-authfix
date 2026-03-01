/**
 * 方块缓存系统
 * 继承 SpatialCache 基类，提供 Minecraft 方块信息的缓存和查询功能
 */

import { Vec3 } from 'vec3';
import { Bot } from 'mineflayer';
import { Block } from 'prismarine-block';
import { SpatialCache, type SpatialCacheConfig } from './SpatialCache';
import type { BlockInfo } from './types';
import { distance3D } from '@/utils/spatial';

export interface BlockCacheConfig extends SpatialCacheConfig {
  onlyVisibleBlocks: boolean;
}

export class BlockCache extends SpatialCache<BlockInfo> {
  private onlyVisibleBlocks: boolean;
  private bot: Bot | null = null;

  constructor(config?: Partial<BlockCacheConfig>, persistPath?: string) {
    const fullConfig: SpatialCacheConfig = {
      enabled: config?.enabled ?? true,
      autoSaveInterval: 0,
      expirationTime: 0,
      ...config,
    };

    super('BlockCache', fullConfig, persistPath || 'data/block_cache.json');
    this.onlyVisibleBlocks = config?.onlyVisibleBlocks ?? true;
  }

  private defaultKeyGenerator(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  attachBot(bot: Bot): void {
    this.bot = bot;
    this.setupChunkListeners(bot);
    this.logger.info('BlockCache 已关联 Bot 并设置区块监听');
  }

  private setupChunkListeners(bot: Bot): void {
    bot.on('chunkColumnLoad', (point: Vec3) => {
      this.onChunkLoad(bot, point);
    });

    bot.on('chunkColumnUnload', (point: Vec3) => {
      this.onChunkUnload(point);
    });
  }

  private async onChunkLoad(bot: Bot, chunkCorner: Vec3): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const chunkX = chunkCorner.x >> 4;
      const chunkZ = chunkCorner.z >> 4;

      const blocks: Array<{ x: number; y: number; z: number; block: Partial<BlockInfo> & { canSee?: boolean } }> = [];

      const startX = chunkX * 16;
      const startZ = chunkZ * 16;

      const botY = bot.entity?.position?.y || 64;
      const minY = Math.max(-64, Math.floor(botY) - 16);
      const maxY = Math.min(320, Math.floor(botY) + 16);

      for (let x = startX; x < startX + 16; x++) {
        for (let z = startZ; z < startZ + 16; z++) {
          for (let y = minY; y <= maxY; y++) {
            try {
              const block = bot.blockAt(new Vec3(x, y, z));

              if (block) {
                let canSee: boolean | undefined = undefined;
                canSee = bot.canSeeBlock(block);

                blocks.push({
                  x,
                  y,
                  z,
                  block: {
                    name: block.name || 'unknown',
                    type: block.type,
                    metadata: block.metadata,
                    hardness: block.hardness,
                    lightLevel: block.lightLevel,
                    transparent: block.transparent,
                    state: this.getBlockState(block),
                    canSee,
                  },
                });
              }
            } catch {
              // Empty
            }
          }
        }
      }

      if (blocks.length > 0) {
        this.setBlocks(blocks);
        this.logger.debug(`区块加载: chunk(${chunkX},${chunkZ}) 缓存${blocks.length}个方块`);
      }
    } catch (error) {
      this.logger.error('区块扫描失败', undefined, error as Error);
    }
  }

  private onChunkUnload(chunkCorner: Vec3): void {
    const chunkX = chunkCorner.x >> 4;
    const chunkZ = chunkCorner.z >> 4;
    const chunkKey = `${chunkX},${chunkZ}`;

    const blockKeysInChunk = this.chunkIndex.get(chunkKey);
    if (blockKeysInChunk) {
      for (const blockKey of blockKeysInChunk) {
        this.cache.delete(blockKey);
      }
      this.chunkIndex.delete(chunkKey);
    }

    this.stats.totalEntries = this.cache.size;
    this.logger.debug(`区块卸载: chunk(${chunkX},${chunkZ}) 清理完成`);
  }

  async performInitialScan(bot: Bot): Promise<void> {
    if (!bot.entity) return;

    const botPos = bot.entity.position.floored();
    const chunkRadiusX = 3;
    const chunkRadiusZ = 3;
    const centerChunkX = botPos.x >> 4;
    const centerChunkZ = botPos.z >> 4;

    this.logger.info(`开始初始扫描: bot位置(${botPos.x},${botPos.y},${botPos.z})`);

    let scannedChunks = 0;

    for (let chunkX = centerChunkX - chunkRadiusX; chunkX <= centerChunkX + chunkRadiusX; chunkX++) {
      for (let chunkZ = centerChunkZ - chunkRadiusZ; chunkZ <= centerChunkZ + chunkRadiusZ; chunkZ++) {
        const testX = chunkX * 16;
        const testZ = chunkZ * 16;
        const testBlock = bot.blockAt(new Vec3(testX, botPos.y, testZ));

        if (testBlock) {
          const chunkCorner = new Vec3(chunkX * 16, 0, chunkZ * 16);
          await this.onChunkLoad(bot, chunkCorner);
          scannedChunks++;
        }
      }
    }

    this.logger.info(`初始扫描完成: 扫描${scannedChunks}个区块`);
  }

  private getBlockState(block: Block): Record<string, unknown> {
    const state: Record<string, unknown> = {};

    try {
      if (block.metadata !== undefined) {
        state.metadata = block.metadata;
      }

      if (block.name.includes('door') || block.name.includes('chest') || block.name.includes('furnace')) {
        state.facing = this.getBlockFacing(block);
      }

      if (block.name.includes('door') || block.name.includes('gate') || block.name.includes('lever')) {
        state.open = this.isBlockOpen(block);
      }
    } catch {
      // Empty
    }

    return state;
  }

  private getBlockFacing(block: Block): string {
    const metadata = block.metadata || 0;
    const directions = ['north', 'east', 'south', 'west'];
    return directions[metadata % 4] || 'north';
  }

  private isBlockOpen(block: Block): boolean {
    const metadata = block.metadata || 0;
    return (metadata & 0x4) !== 0;
  }

  getBlock(x: number, y: number, z: number): BlockInfo | null {
    if (!this.config.enabled) return null;

    const key = this.defaultKeyGenerator(x, y, z);
    this.stats.totalQueries++;

    const blockInfo = this.cache.get(key);
    if (!blockInfo) {
      return null;
    }

    this.stats.totalHits++;
    this.stats.hitRate = this.stats.totalHits / this.stats.totalQueries;

    return blockInfo;
  }

  setBlock(x: number, y: number, z: number, block: Partial<BlockInfo> & { canSee?: boolean }): void {
    if (!this.config.enabled) return;

    if (this.onlyVisibleBlocks && block.canSee === false) {
      return;
    }

    const key = this.defaultKeyGenerator(x, y, z);
    const now = Date.now();

    const blockInfo: BlockInfo = {
      name: block.name || 'unknown',
      type: block.type || 0,
      position: new Vec3(x, y, z),
      timestamp: now,
    };

    this.cache.set(key, blockInfo);
    this.addToChunkIndex(key, x, z);

    this.stats.totalEntries = this.cache.size;
    this.stats.lastUpdate = now;
  }

  setBlocks(blocks: Array<{ x: number; y: number; z: number; block: Partial<BlockInfo> & { canSee?: boolean } }>): void {
    if (!this.config.enabled) return;

    const now = Date.now();

    for (const { x, y, z, block } of blocks) {
      if (this.onlyVisibleBlocks && block.canSee === false) {
        continue;
      }

      const key = this.defaultKeyGenerator(x, y, z);
      const blockInfo: BlockInfo = {
        name: block.name || 'unknown',
        type: block.type || 0,
        position: new Vec3(x, y, z),
        timestamp: now,
      };
      this.cache.set(key, blockInfo);
      this.addToChunkIndex(key, x, z);
    }

    this.stats.totalEntries = this.cache.size;
    this.stats.lastUpdate = now;
  }

  removeBlock(x: number, y: number, z: number): boolean {
    const key = this.defaultKeyGenerator(x, y, z);
    const deleted = this.cache.delete(key);

    if (deleted) {
      this.removeFromChunkIndex(key, x, z);
      this.stats.totalEntries = this.cache.size;
    }

    return deleted;
  }

  getBlocksInRadius(centerX: number, centerY: number, centerZ: number, radius: number): BlockInfo[] {
    const blocks: BlockInfo[] = [];
    let checkedBlocks = 0;

    const centerChunkX = Math.floor(centerX / 16);
    const centerChunkZ = Math.floor(centerZ / 16);
    const chunkRadius = Math.ceil(radius / 16) + 1;

    for (let chunkX = centerChunkX - chunkRadius; chunkX <= centerChunkX + chunkRadius; chunkX++) {
      for (let chunkZ = centerChunkZ - chunkRadius; chunkZ <= centerChunkZ + chunkRadius; chunkZ++) {
        const chunkKey = `${chunkX},${chunkZ}`;
        const chunkBlockKeys = this.chunkIndex.get(chunkKey);

        if (!chunkBlockKeys) continue;

        for (const blockKey of chunkBlockKeys) {
          const blockInfo = this.cache.get(blockKey);
          if (!blockInfo) continue;

          checkedBlocks++;

          const dist = distance3D(
            { x: blockInfo.position.x, y: blockInfo.position.y, z: blockInfo.position.z },
            { x: centerX, y: centerY, z: centerZ },
          );

          if (dist <= radius) {
            blocks.push(blockInfo);
          }
        }
      }
    }

    if (blocks.length < 100 && checkedBlocks > 0) {
      this.logger.warn(`getBlocksInRadius结果少: 中心(${centerX},${centerY},${centerZ}) 半径:${radius} 找到:${blocks.length} 检查:${checkedBlocks}`);
    }

    return blocks;
  }

  findBlocksByName(name: string): BlockInfo[] {
    const blocks: BlockInfo[] = [];

    for (const blockInfo of this.cache.values()) {
      if (blockInfo.name === name) {
        blocks.push(blockInfo);
      }
    }

    return blocks;
  }

  findBlocksByPattern(pattern: string): BlockInfo[] {
    const regex = new RegExp(pattern, 'i');
    const blocks: BlockInfo[] = [];

    for (const blockInfo of this.cache.values()) {
      if (regex.test(blockInfo.name)) {
        blocks.push(blockInfo);
      }
    }

    return blocks;
  }

  clearOutOfRange(centerX: number, centerY: number, centerZ: number, maxDistance: number): number {
    if (!this.config.enabled) return 0;

    let removedCount = 0;
    const keysToRemove: string[] = [];

    for (const [key, blockInfo] of this.cache) {
      const dist = distance3D({ x: blockInfo.position.x, y: blockInfo.position.y, z: blockInfo.position.z }, { x: centerX, y: centerY, z: centerZ });

      if (dist > maxDistance) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      this.cache.delete(key);
      removedCount++;
    }

    this.stats.totalEntries = this.cache.size;

    if (removedCount > 0) {
      this.logger.info(`清除了 ${removedCount} 个超出范围(${maxDistance}格)的方块缓存`);
    }

    return removedCount;
  }

  protected rebuildChunkIndex(): void {
    this.chunkIndex.clear();

    for (const [key, blockInfo] of this.cache) {
      this.addToChunkIndex(key, blockInfo.position.x, blockInfo.position.z);
    }

    this.logger.debug(`区块索引重建完成: ${this.chunkIndex.size} 个区块`);
  }

  override async save(): Promise<void> {
    this.logger.debug('BlockCache 持久化已禁用，跳过保存');
  }

  override async load(): Promise<void> {
    this.logger.info('BlockCache 持久化已禁用，跳过加载，使用空缓存');
  }
}
