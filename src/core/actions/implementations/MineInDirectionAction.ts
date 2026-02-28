/**
 * MineInDirectionAction - 沿方向连续挖掘
 *
 * 专门用于创建隧道、矿井等线性挖掘任务
 */

import { BaseAction } from '@/core/actions/Action';
import { RuntimeContext } from '@/core/context/RuntimeContext';
import { ActionResult } from '@/core/actions/types';
import { ActionIds } from '@/core/actions/ActionIds';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder-mai';

// 定义本地参数类型以避免循环依赖
interface MineInDirectionNewParams {
  direction: string;
  count?: number;
  force?: boolean;
  collect?: boolean;
}

export class MineInDirectionAction extends BaseAction<MineInDirectionNewParams> {
  readonly id = ActionIds.MINE_IN_DIRECTION;
  readonly name = 'MineInDirectionAction';
  readonly description = '沿指定方向连续挖掘，创建隧道或矿井';

  protected async doExecute(context: RuntimeContext, params: MineInDirectionNewParams): Promise<ActionResult> {
    const { direction, count = 10, force = false, collect = true } = params;

    try {
      // 1. 参数验证
      if (!direction || typeof direction !== 'string') {
        return this.failure('方向参数不能为空');
      }

      // 强制模式警告
      if (force) {
        context.logger.warn('⚠️  使用强制挖掘模式，已绕过安全检查');
      }

      // 2. 获取方向向量
      const directionVector = this.getDirectionVector(direction);
      if (!directionVector) {
        return this.failure(`无效的方向: ${direction}，支持的方向：+x, -x, +y, -y, +z, -z`);
      }

      context.logger.info(`开始沿 ${direction} 方向挖掘 ${count} 个方块`);

      // 3. 执行方向挖掘
      const results = [];
      const startPos = context.bot.entity.position;
      let consecutiveFailures = 0;
      const maxFailures = 3;

      for (let i = 0; i < count; i++) {
        // 检查中断
        context.signal.throwIfAborted();

        // 计算当前目标位置
        const targetPos = startPos.plus(directionVector.scaled(i + 1));

        const result = await this.digAtPosition(context, targetPos, force, collect, i + 1, count);
        results.push(result);

        if (!result.success) {
          consecutiveFailures++;
          context.logger.warn(`第 ${i + 1} 个方块挖掘失败: ${result.message}`);

          // 如果连续失败多次，停止挖掘
          if (consecutiveFailures >= maxFailures) {
            context.logger.warn(`连续失败 ${maxFailures} 次，停止挖掘`);
            break;
          }

          // 如果遇到不可破坏的方块（如基岩），也停止
          if (result.message?.includes('无法破坏的方块')) {
            context.logger.warn('遇到不可破坏的方块，停止挖掘');
            break;
          }
        } else {
          consecutiveFailures = 0;
          context.logger.debug(`成功挖掘第 ${i + 1} 个方块`);
        }

        // 短暂延迟
        if (i < count - 1) {
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }

      // 4. 统计结果
      const successCount = results.filter(r => r.success).length;
      const message = `方向挖掘完成：成功 ${successCount}/${count} 个方块`;

      if (successCount > 0) {
        context.logger.info(`挖掘成功: ${message}`);
        return this.success(message, {
          successCount,
          totalCount: count,
          direction,
          startPos: { x: startPos.x, y: startPos.y, z: startPos.z },
          results: results.map(r => ({ success: r.success, message: r.message })),
        });
      } else {
        context.logger.warn(`挖掘失败: ${results[0]?.message || '无法挖掘任何方块'}`);
        return this.failure(results[0]?.message || '无法挖掘任何方块');
      }
    } catch (error) {
      const err = error as Error;
      context.logger.error('方向挖掘过程中发生错误:', err);
      return this.failure(`方向挖掘失败: ${err.message}`, err);
    }
  }

  /**
   * 在指定位置挖掘方块
   */
  private async digAtPosition(
    context: RuntimeContext,
    position: Vec3,
    force: boolean,
    collect: boolean,
    currentIndex: number,
    totalCount: number,
  ): Promise<ActionResult> {
    try {
      // 1. 获取目标方块
      const block = context.bot.blockAt(position);
      if (!block || block.name === 'air') {
        return {
          success: false,
          message: `第 ${currentIndex} 个位置没有方块（空气）`,
        };
      }

      context.logger.debug(
        `第 ${currentIndex}/${totalCount} 个目标: ${block.name} at (${block.position.x}, ${block.position.y}, ${block.position.z})`,
      );

      // 2. 安全检查
      if (!force) {
        const safetyCheck = await this.performSafetyCheck(context, block, position);
        if (!safetyCheck.safe) {
          const message = `第 ${currentIndex} 个方块安全检查失败: ${safetyCheck.reason}`;
          return {
            success: false,
            message,
            error: new Error(safetyCheck.reason),
          };
        }
      }

      // 3. 移动到合适位置
      if (context.bot.entity.position.distanceTo(position) > 4) {
        try {
          await context.bot.pathfinder.goto(new goals.GoalBlock(position.x, position.y, position.z));
        } catch (error) {
          const err = error as Error;
          context.logger.warn(`无法移动到挖掘位置: ${err.message}`);
          // 继续尝试挖掘，可能已经有视野范围
        }
      }

      // 4. 移动后重新获取方块状态
      const freshBlock = context.bot.blockAt(position);
      if (!freshBlock || freshBlock.name === 'air') {
        return {
          success: false,
          message: `第 ${currentIndex} 个位置到达后方块已不存在`,
        };
      }

      // 5. 安全检查（在移动后进行）
      if (!force) {
        const safetyCheck = await this.performSafetyCheck(context, freshBlock, position);
        if (!safetyCheck.safe) {
          const message = `第 ${currentIndex} 个方块安全检查失败: ${safetyCheck.reason}`;
          return {
            success: false,
            message,
            error: new Error(safetyCheck.reason),
          };
        }
      }

      // 6. 工具检查和装备（在移动和安全检查后）
      if (!force) {
        const tool = context.bot.pathfinder.bestHarvestTool(freshBlock);
        if (tool) {
          await context.bot.equip(tool, 'hand');
        } else if (freshBlock.hardness > 0) {
          const message = `第 ${currentIndex} 个方块需要合适工具: ${freshBlock.name}`;
          return {
            success: false,
            message,
            error: new Error('缺少合适工具'),
          };
        }
      }

      // 7. 执行挖掘
      await context.bot.dig(freshBlock);

      // 8. 收集掉落物（可选）
      if (collect) {
        await this.collectDrops(context);
      }

      return {
        success: true,
        message: `第 ${currentIndex} 个方块挖掘成功: ${block.name}`,
        data: {
          blockType: block.name,
          position: { x: block.position.x, y: block.position.y, z: block.position.z },
        },
      };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        message: `第 ${currentIndex} 个方块挖掘失败: ${err.message}`,
        error: err,
      };
    }
  }

  /**
   * 执行安全检查
   */
  private async performSafetyCheck(
    context: RuntimeContext,
    block: any,
    position: Vec3,
  ): Promise<{ safe: boolean; reason?: string; suggestion?: string }> {
    // 流体检查
    if (this.isFluidBlock(block)) {
      return {
        safe: false,
        reason: `无法挖掘流体方块: ${block.name}`,
        suggestion: '请先处理流体，或使用force参数强制挖掘',
      };
    }

    // 不可破坏方块检查
    if (this.isUnbreakableBlock(block)) {
      return {
        safe: false,
        reason: `无法破坏的方块: ${block.name}`,
        suggestion: '此方块无法被破坏，挖掘将停止',
      };
    }

    // 掉落物检查
    const aboveBlock = context.bot.blockAt(position.offset(0, 1, 0));
    if (aboveBlock && this.isFallingBlock(aboveBlock)) {
      return {
        safe: false,
        reason: `上方有掉落方块: ${aboveBlock.name}`,
        suggestion: '请先清理上方掉落物，或使用force参数强制挖掘',
      };
    }

    // 工具检查
    const tool = context.bot.pathfinder.bestHarvestTool(block);
    if (!tool && block.hardness > 0) {
      return {
        safe: false,
        reason: `需要合适工具挖掘: ${block.name}`,
        suggestion: '请装备合适的工具，或使用force参数强制挖掘',
      };
    }

    // 可见性检查
    if (!context.bot.canSeeBlock(block)) {
      return {
        safe: false,
        reason: '目标方块不可见',
        suggestion: '请移动到可见位置，或使用force参数强制挖掘',
      };
    }

    // 特殊情况：位置是否在基岩层或虚空附近
    if (position.y <= 0) {
      return {
        safe: false,
        reason: `目标位置过低 (${position.y})，可能接近基岩层或虚空`,
        suggestion: '请选择更安全的位置挖掘，或使用force参数强制挖掘',
      };
    }

    return { safe: true };
  }

  /**
   * 收集附近的掉落物
   */
  private async collectDrops(context: RuntimeContext): Promise<void> {
    try {
      // 检查是否有 collectBlock 插件
      if (!(context.bot as any).collectBlock) {
        context.logger.debug('collectBlock 插件未加载，使用手动收集模式');
        await this.collectDropsManually(context);
        return;
      }

      // 使用 collectBlock 插件自动收集掉落物
      const droppedItems = Object.values(context.bot.entities).filter(
        entity => entity.name === 'item' && entity.position.distanceTo(context.bot.entity.position) <= 16,
      );

      if (droppedItems.length > 0) {
        context.logger.debug(`发现 ${droppedItems.length} 个掉落物，使用 collectBlock 插件收集`);

        // 使用 collectBlock 插件收集所有掉落物，过滤 "Collect finish!" 消息
        await this.collectBlockSilently(context, droppedItems);

        context.logger.debug(`使用 collectBlock 插件收集完成`);
      }
    } catch (error) {
      context.logger.debug('使用 collectBlock 插件收集时出错，回退到手动模式:', error);
      // 如果插件收集失败，回退到手动收集
      await this.collectDropsManually(context);
    }
  }

  /**
   * 无消息收集方块 - 阻止 collectBlock 插件发送完成消息
   * 参考 maicraft-mcp-server 项目的实现
   */
  private async collectBlockSilently(context: RuntimeContext, targets: any[]): Promise<void> {
    const originalChat = context.bot.chat?.bind(context.bot);
    const originalWhisper = context.bot.whisper?.bind(context.bot);
    const filteredMessages = ['Collect finish!'];

    // 临时禁用聊天消息输出
    const tempChat = (message: string) => {
      if (!filteredMessages.some(filtered => message.includes(filtered))) {
        originalChat?.(message);
      }
    };

    const tempWhisper = (username: string, message: string) => {
      if (!filteredMessages.some(filtered => message.includes(filtered))) {
        originalWhisper?.(username, message);
      }
    };

    // 临时替换方法
    if (context.bot.chat) context.bot.chat = tempChat;
    if (context.bot.whisper) context.bot.whisper = tempWhisper;

    try {
      // 执行收集操作
      await (context.bot as any).collectBlock.collect(targets);
    } finally {
      // 恢复原始方法
      if (context.bot.chat) context.bot.chat = originalChat;
      if (context.bot.whisper) context.bot.whisper = originalWhisper;
    }
  }

  /**
   * 手动收集掉落物（备用方法）
   */
  private async collectDropsManually(context: RuntimeContext): Promise<void> {
    try {
      const droppedItems = Object.values(context.bot.entities).filter(
        entity => entity.name === 'item' && entity.position.distanceTo(context.bot.entity.position) <= 6,
      );

      if (droppedItems.length > 0) {
        for (const item of droppedItems) {
          try {
            const pos = item.position;
            await context.bot.pathfinder.goto(new goals.GoalBlock(pos.x, pos.y, pos.z));
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            // 忽略收集失败
            continue;
          }
        }
      }
    } catch (error) {
      context.logger.debug('手动收集掉落物时出错:', error);
    }
  }

  /**
   * 获取方向向量
   */
  private getDirectionVector(direction: string): Vec3 | null {
    const vectors: Record<string, Vec3> = {
      '+x': new Vec3(1, 0, 0),
      '-x': new Vec3(-1, 0, 0),
      '+y': new Vec3(0, 1, 0),
      '-y': new Vec3(0, -1, 0),
      '+z': new Vec3(0, 0, 1),
      '-z': new Vec3(0, 0, -1),
    };
    return vectors[direction] || null;
  }

  /**
   * 检查是否为流体方块
   */
  private isFluidBlock(block: any): boolean {
    const fluidTypes = ['water', 'lava', 'flowing_water', 'flowing_lava'];
    return fluidTypes.includes(block.name);
  }

  /**
   * 检查是否为不可破坏方块
   */
  private isUnbreakableBlock(block: any): boolean {
    const unbreakableTypes = ['bedrock', 'end_portal', 'end_portal_frame', 'command_block', 'barrier'];
    return unbreakableTypes.includes(block.name);
  }

  /**
   * 检查是否为掉落方块
   */
  private isFallingBlock(block: any): boolean {
    const fallingTypes = ['sand', 'gravel', 'anvil', 'white_concrete_powder'];
    return fallingTypes.some(type => block.name.includes(type));
  }

  /**
   * 获取参数 Schema
   */
  getParamsSchema(): any {
    return {
      direction: {
        type: 'string',
        description: '挖掘方向（必需，支持：+x, -x, +y, -y, +z, -z）',
        required: true,
        enum: ['+x', '-x', '+y', '-y', '+z', '-z'],
      },
      count: {
        type: 'number',
        description: '挖掘数量，默认为10',
        optional: true,
        minimum: 1,
        maximum: 128,
        default: 10,
      },
      force: {
        type: 'boolean',
        description: '强制挖掘，绕过安全检查（默认false）',
        optional: true,
        default: false,
      },
      collect: {
        type: 'boolean',
        description: '是否收集掉落物（默认true）',
        optional: true,
        default: true,
      },
    };
  }
}
