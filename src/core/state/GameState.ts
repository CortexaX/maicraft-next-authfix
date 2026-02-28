import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Item } from 'prismarine-item';
import { getLogger, type Logger } from '@/utils/Logger';
import { EventBus, type ListenerHandle } from '@/core/events/EventBus';

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

  playerName: string = '';
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
  time: number = 0;
  dimension: string = 'overworld';
  biome: string = 'plains';
  lightLevel: number = 0;
  isRaining: boolean = false;
  isThundering: boolean = false;

  nearbyEntities: EntityInfo[] = [];
  entitySearchDistance: number = 16;

  yaw: number = 0;
  pitch: number = 0;
  onGround: boolean = true;

  isSleeping: boolean = false;

  private initialized: boolean = false;
  private bot: Bot | null = null;
  private eventHandles: ListenerHandle[] = [];
  private entityUpdateInterval?: NodeJS.Timeout;

  constructor() {
    this.logger = getLogger('GameState');
  }

  /**
   * 初始化游戏状态，设置事件监听（通过 EventManager）
   */
  initialize(bot: Bot, events: EventBus): void {
    if (this.initialized) {
      this.logger.warn('已经初始化，跳过');
      return;
    }

    this.bot = bot;
    this.playerName = bot.username;

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

    this.eventHandles.push(
      events.on('game:health', () => {
        this.updateHealth(bot);
        this.updateFood(bot);
      }),
    );

    this.eventHandles.push(
      events.on('game:move', () => {
        this.updatePosition(bot);
      }),
    );

    this.eventHandles.push(
      events.on('game:experience', () => {
        this.updateExperience(bot);
      }),
    );

    this.eventHandles.push(
      events.on('game:windowUpdate', () => {
        this.updateInventory(bot);
      }),
    );

    this.eventHandles.push(
      events.on('game:playerCollect', () => {
        this.updateInventory(bot);
      }),
    );

    this.eventHandles.push(
      events.on('game:time', data => {
        this.timeOfDay = data.timeOfDay;
      }),
    );

    this.eventHandles.push(
      events.on('game:weather', () => {
        this.weather = bot.thunderState ? 'thunder' : bot.isRaining ? 'rain' : 'clear';
      }),
    );

    this.eventHandles.push(
      events.on('game:sleep', () => {
        this.isSleeping = true;
      }),
    );

    this.eventHandles.push(
      events.on('game:wake', () => {
        this.isSleeping = false;
      }),
    );

    // 定时更新周围实体（仍需直接访问 bot）
    this.entityUpdateInterval = setInterval(() => {
      this.updateNearbyEntities(bot);
    }, 1000);

    this.initialized = true;
    this.logger.info('初始化完成');
  }

  cleanup(): void {
    for (const handle of this.eventHandles) {
      handle.remove();
    }
    this.eventHandles = [];

    if (this.entityUpdateInterval) {
      clearInterval(this.entityUpdateInterval);
      this.entityUpdateInterval = undefined;
    }

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
      if (block && block.biome) {
        this.biome = block.biome.name || 'unknown';
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
          health: entity.health,
          maxHealth: entity.maxHealth,
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
      slot: item.slot || 0,
      displayName: item.displayName || item.name,
      metadata: item.metadata,
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
}
