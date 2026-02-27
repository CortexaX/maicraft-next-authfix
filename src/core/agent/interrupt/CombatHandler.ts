/**
 * 战斗中断处理器
 *
 * 从 CombatMode 迁移而来，作为中断处理器使用
 * 检测到敌对生物时触发，持续战斗直到威胁消除
 */

import type { InterruptHandler } from './types';
import type { EntityInfo } from '@/core/state/GameState';
import type { GameState } from '@/core/state/GameState';
import type { ActionExecutor } from '@/core/actions/ActionExecutor';
import type { MemoryManager } from '@/core/agent/memory/MemoryManager';
import { ActionIds } from '@/core/actions/ActionIds';
import { getLogger, type Logger } from '@/utils/Logger';

/**
 * 战斗中断处理器配置
 */
export interface CombatHandlerConfig {
  /**
   * 威胁检测距离（方块）
   */
  threatDistance: number;

  /**
   * 攻击冷却时间（毫秒）
   */
  attackCooldown: number;

  /**
   * 最大战斗时间（毫秒）
   * 超时后强制退出
   */
  maxCombatDuration: number;

  /**
   * 是否在攻击前记录思考
   */
  recordThoughts: boolean;

  /**
   * 是否记录决策
   */
  recordDecisions: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_COMBAT_CONFIG: CombatHandlerConfig = {
  threatDistance: 16,
  attackCooldown: 1000,
  maxCombatDuration: 5 * 60 * 1000, // 5分钟
  recordThoughts: true,
  recordDecisions: true,
};

/**
 * 敌对生物列表
 */
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
  readonly priority = 100; // 高优先级

  private executor: ActionExecutor;
  private memory: MemoryManager;
  private gameState: GameState;
  private logger: Logger;
  private config: CombatHandlerConfig;

  // 敌对生物列表
  private hostileEntityNames: string[];

  // 战斗状态
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

  /**
   * 检测是否有近距离威胁
   */
  detect(gameState: GameState): boolean {
    const enemy = this.findNearestEnemy(gameState);
    return enemy !== null && (enemy.distance ?? 0) <= this.config.threatDistance;
  }

  /**
   * 处理战斗 - 持续攻击直到威胁消除
   */
  async handle(): Promise<void> {
    this.combatStartTime = Date.now();
    this.currentEnemy = null;
    this.lastAttackTime = 0;

    this.logger.info('⚔️ 开始战斗处理');

    if (this.config.recordThoughts) {
      this.memory.recordThought('⚔️ 检测到威胁，进入战斗模式');
    }

    let hasThreat = true;
    let iterationCount = 0;
    const maxIterations = 100; // 防止无限循环

    while (hasThreat && iterationCount < maxIterations) {
      iterationCount++;

      // 检查是否超时
      if (Date.now() - this.combatStartTime > this.config.maxCombatDuration) {
        this.logger.warn('⏱️ 战斗超时，强制退出');
        if (this.config.recordThoughts) {
          this.memory.recordThought('⏱️ 战斗超时，强制退出');
        }
        break;
      }

      // 获取当前威胁
      const enemy = this.findNearestEnemy(this.gameState);

      if (!enemy) {
        this.logger.debug('🔍 没有发现敌人，战斗结束');
        hasThreat = false;
        break;
      }

      // 检查是否是新的敌人
      if (!this.currentEnemy || this.currentEnemy.name !== enemy.name) {
        this.currentEnemy = enemy;
        this.logger.info(`🎯 锁定目标: ${enemy.name} (距离: ${(enemy.distance ?? 0).toFixed(1)}m, 血量: ${enemy.health ?? '?'})`);
      }

      // 执行攻击
      await this.performAttack(enemy);

      // 短暂等待，让游戏状态更新
      await this.sleep(100);
    }

    if (iterationCount >= maxIterations) {
      this.logger.warn('⚠️ 达到最大迭代次数，强制退出');
    }

    this.logger.info('✅ 战斗处理完成');

    if (this.config.recordThoughts) {
      const duration = ((Date.now() - this.combatStartTime) / 1000).toFixed(1);
      this.memory.recordThought(`✅ 威胁已消除，退出战斗模式 (持续: ${duration}秒)`);
    }

    // 清理状态
    this.currentEnemy = null;
  }

  /**
   * 查找最近的敌人
   */
  private findNearestEnemy(gameState: GameState): EntityInfo | null {
    const entities = gameState.nearbyEntities;

    if (!entities || entities.length === 0) {
      return null;
    }

    const enemies = entities.filter((e: EntityInfo) => this.hostileEntityNames.includes(e.name?.toLowerCase()));

    if (enemies.length === 0) {
      return null;
    }

    // 返回最近的敌人
    return enemies.reduce((nearest: EntityInfo, current: EntityInfo) =>
      (current.distance ?? Infinity) < (nearest.distance ?? Infinity) ? current : nearest,
    );
  }

  /**
   * 执行攻击
   */
  private async performAttack(enemy: EntityInfo): Promise<void> {
    const now = Date.now();

    // 检查攻击冷却
    if (now - this.lastAttackTime < this.config.attackCooldown) {
      return;
    }

    this.lastAttackTime = now;
    this.logger.info(`⚔️ 攻击目标: ${enemy.name} (距离: ${(enemy.distance ?? 0).toFixed(1)}m)`);

    try {
      // 执行攻击动作
      const result = await this.executor.execute(ActionIds.KILL_MOB, {
        entity: enemy.name,
        timeout: 30,
      });

      // 记录决策
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

        // 记录战斗结果到思考日志
        if (this.config.recordThoughts) {
          if (result.success) {
            this.memory.recordThought(`⚔️ 成功击杀 ${enemy.name}`);
          } else {
            this.memory.recordThought(`⚠️ 战斗失败: ${result.message}`);
          }
        }
      }

      if (result.success) {
        this.logger.info(`✅ 成功击杀: ${enemy.name}`);
        // 清理当前敌人，下次循环会寻找新目标
        this.currentEnemy = null;
      } else {
        this.logger.warn(`⚠️ 攻击失败: ${result.message}`);
      }
    } catch (error) {
      this.logger.error(`❌ 攻击执行异常: ${error}`, undefined, error as Error);

      if (this.config.recordThoughts) {
        this.memory.recordThought(`❌ 攻击异常: ${error}`);
      }
    }
  }

  /**
   * 获取战斗统计信息
   */
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

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CombatHandlerConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('战斗处理器配置已更新', { config: this.config });
  }

  /**
   * 获取配置
   */
  getConfig(): CombatHandlerConfig {
    return { ...this.config };
  }

  /**
   * 更新敌对生物列表
   */
  updateHostileEntities(entities: string[]): void {
    this.hostileEntityNames = entities;
    this.logger.info('敌对生物列表已更新', { count: entities.length });
  }

  /**
   * 添加敌对生物
   */
  addHostileEntity(entity: string): void {
    if (!this.hostileEntityNames.includes(entity)) {
      this.hostileEntityNames.push(entity);
      this.logger.debug(`添加敌对生物: ${entity}`);
    }
  }

  /**
   * 移除敌对生物
   */
  removeHostileEntity(entity: string): void {
    const index = this.hostileEntityNames.indexOf(entity);
    if (index !== -1) {
      this.hostileEntityNames.splice(index, 1);
      this.logger.debug(`移除敌对生物: ${entity}`);
    }
  }

  /**
   * 睡眠工具
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
