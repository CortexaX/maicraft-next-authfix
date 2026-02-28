import type { InterruptHandler } from '../types';
import type { EntityInfo } from '@/core/state/GameState';
import type { GameState } from '@/core/state/GameState';
import type { ActionExecutor } from '@/core/actions/ActionExecutor';
import type { MemoryManager } from '@/core/agent/memory/MemoryManager';
import { ActionIds } from '@/core/actions/ActionIds';
import { getLogger, type Logger } from '@/utils/Logger';

export interface CombatHandlerConfig {
  threatDistance: number;
  attackCooldown: number;
  maxCombatDuration: number;
  recordThoughts: boolean;
  recordDecisions: boolean;
}

export const DEFAULT_COMBAT_CONFIG: CombatHandlerConfig = {
  threatDistance: 16,
  attackCooldown: 1000,
  maxCombatDuration: 5 * 60 * 1000,
  recordThoughts: true,
  recordDecisions: true,
};

const DEFAULT_HOSTILE_ENTITIES = [
  'zombie',
  'skeleton',
  'creeper',
  'spider',
  'cave_spider',
  'enderman',
  'witch',
  'blaze',
  'ghast',
  'magma_cube',
  'slime',
  'piglin',
  'hoglin',
  'zoglin',
  'drowned',
  'husk',
  'stray',
  'phantom',
  'pillager',
  'vindicator',
  'evoker',
  'vex',
  'ravager',
  'shulker',
];

export class CombatHandler implements InterruptHandler {
  readonly name = 'CombatHandler';
  readonly priority = 100;

  private executor: ActionExecutor;
  private memory: MemoryManager;
  private gameState: GameState;
  private logger: Logger;
  private config: CombatHandlerConfig;

  private hostileEntityNames: string[];

  private lastAttackTime: number = 0;
  private combatStartTime: number = 0;
  private currentEnemy: EntityInfo | null = null;

  constructor(
    executor: ActionExecutor,
    memory: MemoryManager,
    gameState: GameState,
    config: Partial<CombatHandlerConfig> = {},
    hostileEntities: string[] = DEFAULT_HOSTILE_ENTITIES,
  ) {
    this.executor = executor;
    this.memory = memory;
    this.gameState = gameState;
    this.config = { ...DEFAULT_COMBAT_CONFIG, ...config };
    this.hostileEntityNames = hostileEntities;
    this.logger = getLogger('CombatHandler');
  }

  detect(gameState: GameState): boolean {
    const enemy = this.findNearestEnemy(gameState);
    return enemy !== null && (enemy.distance ?? 0) <= this.config.threatDistance;
  }

  async handle(signal: AbortSignal): Promise<void> {
    this.combatStartTime = Date.now();
    this.currentEnemy = null;
    this.lastAttackTime = 0;

    this.logger.info('开始战斗处理');

    if (this.config.recordThoughts) {
      this.memory.recordThought('检测到威胁，进入战斗模式');
    }

    let hasThreat = true;
    let iterationCount = 0;
    const maxIterations = 100;

    while (hasThreat && iterationCount < maxIterations) {
      iterationCount++;

      signal.throwIfAborted();

      if (Date.now() - this.combatStartTime > this.config.maxCombatDuration) {
        this.logger.warn('战斗超时，强制退出');
        if (this.config.recordThoughts) {
          this.memory.recordThought('战斗超时，强制退出');
        }
        break;
      }

      const enemy = this.findNearestEnemy(this.gameState);

      if (!enemy) {
        this.logger.debug('没有发现敌人，战斗结束');
        hasThreat = false;
        break;
      }

      if (!this.currentEnemy || this.currentEnemy.name !== enemy.name) {
        this.currentEnemy = enemy;
        this.logger.info(`锁定目标: ${enemy.name} (距离: ${(enemy.distance ?? 0).toFixed(1)}m, 血量: ${enemy.health ?? '?'})`);
      }

      await this.performAttack(enemy);

      await this.sleep(100);
    }

    if (iterationCount >= maxIterations) {
      this.logger.warn('达到最大迭代次数，强制退出');
    }

    this.logger.info('战斗处理完成');

    if (this.config.recordThoughts) {
      const duration = ((Date.now() - this.combatStartTime) / 1000).toFixed(1);
      this.memory.recordThought(`威胁已消除，退出战斗模式 (持续: ${duration}秒)`);
    }

    this.currentEnemy = null;
  }

  private findNearestEnemy(gameState: GameState): EntityInfo | null {
    const entities = gameState.nearbyEntities;

    if (!entities || entities.length === 0) {
      return null;
    }

    const enemies = entities.filter((e: EntityInfo) => this.hostileEntityNames.includes(e.name?.toLowerCase()));

    if (enemies.length === 0) {
      return null;
    }

    return enemies.reduce((nearest: EntityInfo, current: EntityInfo) =>
      (current.distance ?? Infinity) < (nearest.distance ?? Infinity) ? current : nearest,
    );
  }

  private async performAttack(enemy: EntityInfo): Promise<void> {
    const now = Date.now();

    if (now - this.lastAttackTime < this.config.attackCooldown) {
      return;
    }

    this.lastAttackTime = now;
    this.logger.info(`攻击目标: ${enemy.name} (距离: ${(enemy.distance ?? 0).toFixed(1)}m)`);

    try {
      const result = await this.executor.execute(ActionIds.KILL_MOB, {
        entity: enemy.name,
        timeout: 30,
      });

      if (this.config.recordDecisions) {
        const decisionResult = result.success ? 'success' : 'failed';
        const duration = ((Date.now() - this.combatStartTime) / 1000).toFixed(1);

        this.memory.recordDecision(
          `战斗行动: 攻击 ${enemy.name}`,
          {
            actionType: 'kill_mob',
            params: {
              entity: enemy.name,
              timeout: 30,
            },
          },
          decisionResult,
          `战斗持续${duration}秒，敌人血量${enemy.health ?? '?'}, 距离${(enemy.distance ?? 0).toFixed(1)} - ${result.message}`,
        );

        if (this.config.recordThoughts) {
          if (result.success) {
            this.memory.recordThought(`成功击杀 ${enemy.name}`);
          } else {
            this.memory.recordThought(`战斗失败: ${result.message}`);
          }
        }
      }

      if (result.success) {
        this.logger.info(`成功击杀: ${enemy.name}`);
        this.currentEnemy = null;
      } else {
        this.logger.warn(`攻击失败: ${result.message}`);
      }
    } catch (error) {
      this.logger.error(`攻击执行异常: ${error}`, undefined, error as Error);

      if (this.config.recordThoughts) {
        this.memory.recordThought(`攻击异常: ${error}`);
      }
    }
  }

  getCombatStats(): {
    duration: number;
    currentEnemy: string | null;
    isFighting: boolean;
  } {
    return {
      duration: this.combatStartTime > 0 ? Date.now() - this.combatStartTime : 0,
      currentEnemy: this.currentEnemy?.name ?? null,
      isFighting: this.currentEnemy !== null,
    };
  }

  updateConfig(config: Partial<CombatHandlerConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('战斗处理器配置已更新', { config: this.config });
  }

  getConfig(): CombatHandlerConfig {
    return { ...this.config };
  }

  updateHostileEntities(entities: string[]): void {
    this.hostileEntityNames = entities;
    this.logger.info('敌对生物列表已更新', { count: entities.length });
  }

  addHostileEntity(entity: string): void {
    if (!this.hostileEntityNames.includes(entity)) {
      this.hostileEntityNames.push(entity);
      this.logger.debug(`添加敌对生物: ${entity}`);
    }
  }

  removeHostileEntity(entity: string): void {
    const index = this.hostileEntityNames.indexOf(entity);
    if (index !== -1) {
      this.hostileEntityNames.splice(index, 1);
      this.logger.debug(`移除敌对生物: ${entity}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
