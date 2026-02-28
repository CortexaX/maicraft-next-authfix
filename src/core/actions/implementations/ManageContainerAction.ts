/**
 * ManageContainerAction - 管理容器内容
 *
 * 执行单个物品的存取操作，支持箱子和熔炉
 */

import { BaseAction } from '@/core/actions/Action';
import { RuntimeContext } from '@/core/context/RuntimeContext';
import { ActionResult, ManageContainerParams } from '@/core/actions/types';
import { ActionIds } from '@/core/actions/ActionIds';
import { MovementUtils, GoalType } from '@/utils/MovementUtils';
import { Vec3 } from 'vec3';

export class ManageContainerAction extends BaseAction<any> {
  readonly id = ActionIds.MANAGE_CONTAINER;
  readonly name = 'ManageContainerAction';
  readonly description = '管理容器内容，执行单个物品的存取操作';

  shouldActivate(context: RuntimeContext): boolean {
    return false;
  }

  protected async doExecute(context: RuntimeContext, params: ManageContainerParams): Promise<ActionResult> {
    try {
      const { position, action, item, count, slot } = params;

      // 验证参数
      if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
        return this.failure('请提供有效的容器位置坐标');
      }

      if (!action || !['take_items', 'put_items'].includes(action)) {
        return this.failure('操作类型必须是 take_items 或 put_items');
      }

      if (!item || typeof item !== 'string') {
        return this.failure('请指定有效的物品名称');
      }

      if (typeof count !== 'number' || count <= 0) {
        return this.failure('数量必须是正数');
      }

      // 验证物品是否存在
      const mcData = context.bot.registry;
      const itemMeta = mcData.itemsByName[item];
      if (!itemMeta) {
        return this.failure(`未知物品: ${item}`);
      }

      // 查找容器
      const containerBlock = await this.findContainer(context, position.x, position.y, position.z);
      if (!containerBlock) {
        return this.failure('未找到容器');
      }

      // 移动到容器附近（确保能看见容器）
      const moveResult = await context.movementUtils.moveTo(context.bot, {
        type: 'coordinate',
        x: containerBlock.position.x,
        y: containerBlock.position.y,
        z: containerBlock.position.z,
        distance: 5, // 5格以内，确保能看见和操作容器
        maxDistance: 32,
        useRelativeCoords: false,
        goalType: GoalType.GoalGetToBlock,
      });

      if (!moveResult.success) {
        return this.failure(`无法移动到容器位置: ${moveResult.error}`);
      }

      // 🔒 暂时禁用 armorManager 自动装备，防止干扰窗口操作
      const armorManager = (context.bot as any).armorManager;
      const wasArmorManagerEnabled = armorManager?.enabled ?? false;
      if (armorManager && wasArmorManagerEnabled) {
        context.logger.debug('[ManageContainer] 临时禁用 armorManager 自动装备');
        armorManager.enabled = false;
      }

      try {
        // 检查是否已经有打开的窗口，如果有则先关闭
        if (context.bot.currentWindow) {
          context.logger.warn(`检测到已打开的窗口，先关闭: ${context.bot.currentWindow.type}`);
          try {
            context.bot.closeWindow(context.bot.currentWindow);
            // 等待窗口关闭事件，最多等待2秒
            await Promise.race([
              new Promise(resolve => {
                const onWindowClose = () => {
                  context.bot.removeListener('windowClose', onWindowClose);
                  resolve(true);
                };
                context.bot.once('windowClose', onWindowClose);
              }),
              new Promise(resolve => setTimeout(() => resolve(false), 2000)),
            ]);
            context.logger.info(`窗口已关闭`);
          } catch (error) {
            context.logger.warn(`关闭窗口时出错，继续执行: ${error}`);
          }
          // 额外等待，确保服务器端状态同步
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // 确保能看见容器
        if (!context.bot.canSeeBlock(containerBlock)) {
          context.logger.warn(`无法看见容器，尝试调整视角`);
          await context.bot.lookAt(containerBlock.position.offset(0.5, 0.5, 0.5));
          await new Promise(resolve => setTimeout(resolve, 300));

          if (!context.bot.canSeeBlock(containerBlock)) {
            return this.failure(`无法看见容器，可能被遮挡`);
          }
        }

        // 🔧 重新获取方块对象，确保它是最新的（避免区块卸载/重载导致的失效）
        const pos = containerBlock.position;
        const freshBlock = context.bot.blockAt(pos);

        if (!freshBlock) {
          return this.failure(`无法重新获取方块 (${pos.x}, ${pos.y}, ${pos.z})，区块可能未加载`);
        }

        context.logger.info(`[ManageContainer] 方块信息: 名称=${freshBlock.name}, 类型=${freshBlock.type}`);

        // 打开容器
        const container = await context.bot.openContainer(freshBlock);

        try {
          let result: { success: boolean; message: string };

          if (action === 'put_items') {
            result = await this.performPutOperation(container, item, itemMeta, count, context);
          } else {
            // take_items
            result = await this.performTakeOperation(container, item, itemMeta, count, slot);
          }

          return result.success ? this.success(result.message) : this.failure(result.message);
        } finally {
          container.close();
        }
      } finally {
        // 🔓 恢复 armorManager 自动装备
        if (armorManager && wasArmorManagerEnabled) {
          context.logger.debug('[ManageContainer] 恢复 armorManager 自动装备');
          armorManager.enabled = true;
        }
      }
    } catch (error) {
      const err = error as Error;
      context.logger.error('容器管理失败:', err);
      return this.failure(`容器管理失败: ${err.message}`, err);
    }
  }

  /**
   * 查找容器
   */
  private async findContainer(context: RuntimeContext, x: number, y: number, z: number): Promise<any> {
    const mcData = context.bot.registry;
    const chestId = mcData.blocksByName.chest?.id;
    const furnaceId = mcData.blocksByName.furnace?.id;

    if (!chestId && !furnaceId) {
      throw new Error('无法找到容器方块类型');
    }

    // 查找指定坐标的容器
    const pos = new Vec3(x, y, z);
    const block = context.bot.blockAt(pos);

    if (!block) {
      throw new Error(`指定坐标 (${x}, ${y}, ${z}) 处没有方块`);
    }

    const isChest = chestId && block.type === chestId;
    const isFurnace = furnaceId && block.type === furnaceId;

    if (!isChest && !isFurnace) {
      const blockName = mcData.blocks[block.type]?.name || `未知方块(${block.type})`;
      throw new Error(`指定坐标 (${x}, ${y}, ${z}) 处是 ${blockName}，不是容器`);
    }

    return block;
  }

  /**
   * 执行放入操作
   */
  private async performPutOperation(
    container: any,
    itemName: string,
    itemMeta: any,
    count: number,
    context: RuntimeContext,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // 检查背包是否有该物品
      const invItem = context.bot.inventory.findInventoryItem(itemMeta.id, null, false);
      if (!invItem) {
        return { success: false, message: `背包中没有 ${itemName}` };
      }

      const depositCount = Math.min(count, invItem.count);
      await container.deposit(itemMeta.id, null, depositCount);

      return { success: true, message: `已放入 ${itemName} ${depositCount} 个` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: `放入 ${itemName} 失败: ${errorMessage}` };
    }
  }

  /**
   * 执行取出操作
   */
  private async performTakeOperation(
    container: any,
    itemName: string,
    itemMeta: any,
    count: number,
    slot?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      let containerItem;

      if (slot) {
        // 如果指定了槽位（用于熔炉），从指定槽位取出
        // 注意：这里需要根据实际的熔炉API调整
        containerItem = container.containerItems().find((item: any) => {
          // 根据槽位信息查找物品，这里需要具体实现
          return item.type === itemMeta.id;
        });
      } else {
        // 从容器中查找物品
        containerItem = container.containerItems().find((item: any) => item.type === itemMeta.id);
      }

      if (!containerItem) {
        return { success: false, message: `容器中没有 ${itemName}` };
      }

      const withdrawCount = Math.min(count, containerItem.count);
      await container.withdraw(itemMeta.id, null, withdrawCount);

      return { success: true, message: `已取出 ${itemName} ${withdrawCount} 个` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: `取出 ${itemName} 失败: ${errorMessage}` };
    }
  }
}
