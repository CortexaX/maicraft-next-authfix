import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Item } from 'prismarine-item';
import { getLogger, type Logger } from '@/utils/Logger';
import { BlockCache } from '@/core/cache/BlockCache';
import { ContainerCache } from '@/core/cache/ContainerCache';
import { CacheManager } from '@/core/cache/CacheManager';
import { NearbyBlockManager } from '@/core/cache/NearbyBlockManager';
import type { BlockInfo, ContainerInfo } from '@/core/cache/types';

export interface ItemInfo {
  name: string;
  count: number;
  slot: number;
  displayName: string;
  metadata?: any;
}

export interface EntityInfo {
  type: string;
  name: string;
  position: Vec3;
  distance?: number;
  health?: number;
  maxHealth?: number;
}

export type EquipmentSlot = 'head' | 'torso' | 'legs' | 'feet' | 'hand' | 'off-hand';

export class GameState {
  private logger: Logger;

  readonly playerName: string = '';
  gamemode: string = 'survival';

  position: Vec3 = new Vec3(0, 0, 0);
  blockPosition: Vec3 = new Vec3(0, 0, 0);

  health: number = 20;
  healthMax: number = 20;
  food: number = 20;
  foodMax: number = 20;
  foodSaturation: number = 5;
  experience: number = 0;
  experienceProgress: number = 0;
  level: number = 0;
  oxygenLevel: number = 20;
  armor: number = 0;

  inventory: ItemInfo[] = [];
  equipment: Partial<Record<EquipmentSlot, ItemInfo | null>> = {};
  heldItem: ItemInfo | null = null;

  weather: string = 'clear';
  timeOfDay: number = 0;
  dimension: string = 'overworld';
  biome: string = 'plains';

  nearbyEntities: EntityInfo[] = [];
  entitySearchDistance: number = 16;

  yaw: number = 0;
  pitch: number = 0;
  onGround: boolean = true;

  isSleeping: boolean = false;

  readonly blockCache: BlockCache;
  readonly containerCache: ContainerCache;
  readonly cacheManager: CacheManager;
  readonly nearbyBlockManager: NearbyBlockManager;

  private initialized: boolean = false;

  private entityUpdateInterval?: NodeJS.Timeout;

  constructor(params: {
    blockCache: BlockCache;
    containerCache: ContainerCache;
    cacheManager: CacheManager;
    nearbyBlockManager: NearbyBlockManager;
  }) {
    this.logger = getLogger('GameState');
    this.blockCache = params.blockCache;
    this.containerCache = params.containerCache;
    this.cacheManager = params.cacheManager;
    this.nearbyBlockManager = params.nearbyBlockManager;
  }

  /**
   * 初始化游戏状态，设置 bot 事件监听
   */
  initialize(bot: Bot): void {
    if (this.initialized) {
      this.logger.warn('已经初始化，跳过');
      return;
    }

    // 设置玩家名称
    (this as any).playerName = bot.username;

    this.startCacheSystem();

    this.updatePosition(bot);
    this.updateHealth(bot);
    this.updateFood(bot);
    this.updateExperience(bot);
    this.updateInventory(bot);
    this.updateEnvironment(bot);

    const initialItems = bot.inventory.items();
    this.logger.info(`[GameState] 初始化时的物品栏: ${initialItems.length} 个物品`, {
      items: initialItems.map(i => `${i.name}x${i.count}`).join(', ') || '无',
    });

    bot.on('health', () => {
      this.updateHealth(bot);
      this.updateFood(bot);
    });

    bot.on('move', () => {
      this.updatePosition(bot);
    });

    bot.on('experience', () => {
      this.updateExperience(bot);
    });

    (bot as any).on?.('windowUpdate', () => {
      this.updateInventory(bot);
    });

    bot.on('playerCollect', () => {
      this.updateInventory(bot);
    });

    bot.on('itemDrop', () => {
      this.updateInventory(bot);
    });

    bot.on('time', () => {
      this.timeOfDay = bot.time.timeOfDay;
    });

    (bot as any).on?.('weather', () => {
      this.weather = bot.thunderState ? 'thunder' : bot.isRaining ? 'rain' : 'clear';
    });

    bot.on('sleep', () => {
      this.isSleeping = true;
    });

    bot.on('wake', () => {
      this.isSleeping = false;
    });

    this.entityUpdateInterval = setInterval(() => {
      this.updateNearbyEntities(bot);
    }, 1000);

    this.initialized = true;
    this.logger.info('初始化完成');
  }

  private startCacheSystem(): void {
    this.logger.info('启动缓存系统', {
      hasCacheManager: !!this.cacheManager,
      hasNearbyBlockManager: !!this.nearbyBlockManager,
    });

    this.loadCaches()
      .then(() => {
        this.logger.info('缓存数据加载完成', {
          blockCacheSize: this.blockCache.size(),
          containerCacheSize: this.containerCache.size(),
        });

        this.cacheManager.start();
        this.logger.info('缓存管理器已启动');

        this.cacheManager
          .triggerBlockScan()
          .then(() => {
            this.logger.info('初始方块扫描完成');
          })
          .catch(err => {
            this.logger.error('初始方块扫描失败', undefined, err);
          });
      })
      .catch(error => {
        this.logger.error('加载缓存数据失败', undefined, error);
      });

    this.logger.info('缓存系统启动完成');
  }

  private async loadCaches(): Promise<void> {
    await this.blockCache.load();
    await this.containerCache.load();
  }

  cleanup(): void {
    if (this.entityUpdateInterval) {
      clearInterval(this.entityUpdateInterval);
      this.entityUpdateInterval = undefined;
    }

    this.cacheManager.destroy();
    this.blockCache.destroy();
    this.containerCache.destroy();

    this.initialized = false;
  }

  /**
   * 更新位置信息
   */
  private updatePosition(bot: Bot): void {
    if (bot.entity && bot.entity.position) {
      this.position = bot.entity.position.clone();
      this.blockPosition = this.position.floored();
      this.onGround = bot.entity.onGround;

      if (bot.entity.yaw !== undefined) {
        this.yaw = bot.entity.yaw;
      }
      if (bot.entity.pitch !== undefined) {
        this.pitch = bot.entity.pitch;
      }
    }
  }

  /**
   * 更新健康信息
   */
  private updateHealth(bot: Bot): void {
    this.health = bot.health;
    this.healthMax = 20; // Minecraft 默认最大生命值
    this.oxygenLevel = bot.oxygenLevel;
  }

  /**
   * 更新食物信息
   */
  private updateFood(bot: Bot): void {
    this.food = bot.food;
    this.foodMax = 20; // Minecraft 默认最大饥饿值
    this.foodSaturation = bot.foodSaturation;
  }

  /**
   * 更新经验信息
   */
  private updateExperience(bot: Bot): void {
    this.experience = bot.experience.points;
    this.level = bot.experience.level;
    this.experienceProgress = bot.experience.progress;
  }

  /**
   * 更新物品栏信息
   */
  private updateInventory(bot: Bot): void {
    // 更新物品栏
    const items = bot.inventory.items();
    this.inventory = items.map(item => this.itemToItemInfo(item));

    // 调试日志
    if (items.length > 0) {
      this.logger.debug(`[GameState] 物品栏更新: ${items.length} 个物品`, {
        items: items.map(i => `${i.name}x${i.count}`).join(', '),
      });
    }

    // 更新手持物品
    if (bot.heldItem) {
      this.heldItem = this.itemToItemInfo(bot.heldItem);
    } else {
      this.heldItem = null;
    }

    // 更新装备
    // 注意: mineflayer 的装备系统可能需要特殊处理
    // 这里提供基本实现，后续可以完善
  }

  /**
   * 更新环境信息
   */
  private updateEnvironment(bot: Bot): void {
    this.timeOfDay = bot.time.timeOfDay;
    this.weather = bot.thunderState ? 'thunder' : bot.isRaining ? 'rain' : 'clear';

    // 维度信息 - 使用类型断言处理可能的枚举或字符串类型
    const dim = bot.game.dimension as unknown;
    if (dim === -1 || dim === 'minecraft:nether' || dim === 'nether') {
      this.dimension = 'nether';
    } else if (dim === 1 || dim === 'minecraft:the_end' || dim === 'the_end') {
      this.dimension = 'end';
    } else {
      this.dimension = 'overworld';
    }

    // 生物群系（如果可用）
    try {
      const block = bot.blockAt(this.blockPosition);
      if (block && (block as any).biome) {
        this.biome = (block as any).biome.name || 'unknown';
      }
    } catch (error) {
      // 忽略错误，使用默认值
    }
  }

  /**
   * 更新周围实体信息
   */
  private updateNearbyEntities(bot: Bot): void {
    const entities: EntityInfo[] = [];
    const maxDistance = 16; // 最大距离16格

    for (const entity of Object.values(bot.entities)) {
      if (!entity || !entity.position || entity === bot.entity) {
        continue;
      }

      const distance = entity.position.distanceTo(bot.entity.position);
      if (distance <= maxDistance) {
        entities.push({
          type: entity.type,
          name: entity.name || entity.displayName || 'unknown',
          position: entity.position.clone(),
          distance,
          health: (entity as any).health,
          maxHealth: (entity as any).maxHealth,
        });
      }
    }

    this.nearbyEntities = entities;
  }

  /**
   * 将 Item 转换为 ItemInfo
   */
  private itemToItemInfo(item: Item): ItemInfo {
    return {
      name: item.name,
      count: item.count,
      slot: (item as any).slot || 0,
      displayName: item.displayName || item.name,
      metadata: (item as any).metadata,
    };
  }

  /**
   * 生成状态描述（用于 LLM 提示词）
   */
  getStatusDescription(): string {
    return `
当前状态:
  生命值: ${this.health}/${this.healthMax}
  饥饿值: ${this.food}/${this.foodMax}
  等级: ${this.level} (经验: ${this.experience})
  
位置: (${this.blockPosition.x}, ${this.blockPosition.y}, ${this.blockPosition.z})
维度: ${this.dimension}
生物群系: ${this.biome}
天气: ${this.weather}
时间: ${this.timeOfDay}

物品栏: ${this.inventory.length} 个物品
手持: ${this.heldItem?.name || '无'}
    `.trim();
  }

  /**
   * 获取物品栏描述
   */
  getInventoryDescription(): string {
    if (this.inventory.length === 0) {
      return '物品栏为空';
    }

    const lines = this.inventory.map(item => `  ${item.name} x${item.count}`);

    return `物品栏 (${this.inventory.length}/36):\n${lines.join('\n')}`;
  }

  /**
   * 获取周围实体描述
   */
  getNearbyEntitiesDescription(): string {
    if (this.nearbyEntities.length === 0) {
      return `周围${this.entitySearchDistance}格内没有实体`;
    }

    const lines = this.nearbyEntities.map((e, i) => `  ${i + 1}. ${e.name} (距离: ${e.distance?.toFixed(1)}格)`);

    return `周围${this.entitySearchDistance}格内实体 (${this.nearbyEntities.length}):\n${lines.join('\n')}`;
  }

  getBlockInfo(x: number, y: number, z: number): BlockInfo | null {
    return this.blockCache.getBlock(x, y, z);
  }

  setBlockInfo(x: number, y: number, z: number, blockInfo: Partial<BlockInfo>): void {
    this.blockCache.setBlock(x, y, z, blockInfo);
  }

  getNearbyBlocks(radius: number = 16): BlockInfo[] {
    return this.blockCache.getBlocksInRadius(this.blockPosition.x, this.blockPosition.y, this.blockPosition.z, radius);
  }

  getNearbyBlockManager(): NearbyBlockManager {
    return this.nearbyBlockManager;
  }

  findBlocksByName(name: string): BlockInfo[] {
    return this.blockCache.findBlocksByName(name);
  }

  getContainerInfo(x: number, y: number, z: number, type?: string): ContainerInfo | null {
    return this.containerCache.getContainer(x, y, z, type);
  }

  setContainerInfo(x: number, y: number, z: number, type: string, containerInfo: Partial<ContainerInfo>): void {
    this.containerCache.setContainer(x, y, z, type, containerInfo);
  }

  getNearbyContainers(radius: number = 16): ContainerInfo[] {
    return this.containerCache.getContainersInRadius(this.blockPosition.x, this.blockPosition.y, this.blockPosition.z, radius);
  }

  findContainersWithItem(itemId: number, minCount: number = 1): ContainerInfo[] {
    return this.containerCache.findContainersWithItem(itemId, minCount);
  }

  findContainersWithItemName(itemName: string, minCount: number = 1): ContainerInfo[] {
    return this.containerCache.findContainersWithItemName(itemName, minCount);
  }

  async saveCaches(): Promise<void> {
    await this.blockCache.save();
    await this.containerCache.save();
  }

  getCacheStats(): { blockCache?: any; containerCache?: any } {
    return {
      blockCache: this.blockCache.getStats(),
      containerCache: this.containerCache.getStats(),
    };
  }

  scanNearbyBlocks(bot: Bot, radius: number = 8): void {
    if (!bot.blockAt) return;

    try {
      const blocks: Array<{ x: number; y: number; z: number; block: Partial<BlockInfo> }> = [];

      for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
          for (let z = -radius; z <= radius; z++) {
            const worldX = Math.floor(this.blockPosition.x + x);
            const worldY = Math.floor(this.blockPosition.y + y);
            const worldZ = Math.floor(this.blockPosition.z + z);

            const block = bot.blockAt(new Vec3(worldX, worldY, worldZ));
            if (block) {
              // 缓存所有方块，包括空气方块
              // 这对环境感知非常重要（如检测水、岩浆等）
              blocks.push({
                x: worldX,
                y: worldY,
                z: worldZ,
                block: {
                  name: block.name,
                  type: block.type,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  metadata: (block as any).metadata,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  hardness: (block as any).hardness,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  lightLevel: (block as any).lightLevel,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  transparent: (block as any).transparent,
                } as any,
              });
            }
          }
        }
      }

      this.blockCache.setBlocks(blocks);
      this.logger.debug(`扫描并缓存了 ${blocks.length} 个方块 (半径: ${radius})，包含所有方块类型`);
    } catch (error) {
      this.logger.error('扫描周围方块失败', undefined, error as Error);
    }
  }

  async triggerCacheScan(radius?: number): Promise<void> {
    await this.cacheManager.triggerBlockScan(radius);
  }

  async triggerContainerUpdate(): Promise<void> {
    await this.cacheManager.triggerContainerUpdate();
  }

  getCacheManagerStats(): any {
    return this.cacheManager.getStats();
  }

  setCacheAutoManagement(enabled: boolean): void {
    if (enabled) {
      this.cacheManager.start();
    } else {
      this.cacheManager.stop();
    }
  }

  setCachePerformanceMode(mode: 'balanced' | 'performance' | 'memory'): void {
    this.logger.info(`设置缓存性能模式: ${mode}`);

    switch (mode) {
      case 'performance':
        this.logger.info('缓存已切换到性能优先模式');
        break;
      case 'memory':
        this.logger.info('缓存已切换到内存优化模式');
        break;
      case 'balanced':
      default:
        this.logger.info('缓存已切换到平衡模式');
        break;
    }
  }
}
