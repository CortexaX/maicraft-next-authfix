/**
 * FurnaceInteractAction - 智能熔炉交互
 *
 * 与熔炉交互，通过内部 LLM 决策并批量执行存取操作
 */

import { RuntimeContext } from '@/core/context/RuntimeContext';
import { ActionResult } from '@/core/actions/types';
import { ContainerInteractAction, ContainerInteractParams, ParsedOperation, OperationResult } from './ContainerInteractAction';

export interface FurnaceInteractParams extends ContainerInteractParams {}

export class FurnaceInteractAction extends ContainerInteractAction<FurnaceInteractParams> {
  readonly id = 'interact_furnace';
  readonly name = 'FurnaceInteractAction';
  readonly description = '与熔炉交互：打开熔炉，AI 自主决策并批量执行存取操作（输入/燃料/输出）';

  shouldActivate(_context: RuntimeContext): boolean {
    return true;
  }

  getContainerType(): string {
    return 'furnace';
  }

  getPromptTemplateName(): string {
    return 'furnace_operation';
  }

  getSystemTemplateName(): string {
    return 'furnace_operation_system';
  }

  getBlockTypes(context: RuntimeContext): number[] {
    const mcData = context.bot.registry;
    const furnaceId = mcData.blocksByName.furnace?.id;
    const blastFurnaceId = mcData.blocksByName.blast_furnace?.id;
    const smokerId = mcData.blocksByName.smoker?.id;

    const types: number[] = [];
    if (furnaceId !== undefined) types.push(furnaceId);
    if (blastFurnaceId !== undefined) types.push(blastFurnaceId);
    if (smokerId !== undefined) types.push(smokerId);
    return types;
  }

  readContainerState(container: any): string {
    const lines: string[] = ['熔炉状态:'];

    const inputItem = container.inputItem?.();
    if (inputItem) {
      lines.push(`  输入槽: ${inputItem.name || `unknown_${inputItem.type}`} x${inputItem.count}`);
    } else {
      lines.push('  输入槽: 空');
    }

    const fuelItem = container.fuelItem?.();
    if (fuelItem) {
      lines.push(`  燃料槽: ${fuelItem.name || `unknown_${fuelItem.type}`} x${fuelItem.count}`);
    } else {
      lines.push('  燃料槽: 空');
    }

    const outputItem = container.outputItem?.();
    if (outputItem) {
      lines.push(`  输出槽: ${outputItem.name || `unknown_${outputItem.type}`} x${outputItem.count}`);
    } else {
      lines.push('  输出槽: 空');
    }

    const progress = container.progress?.();
    if (progress !== undefined && progress > 0) {
      lines.push(`  熔炼进度: ${progress}%`);
    }

    return lines.join('\n');
  }

  async executeOperation(context: RuntimeContext, container: any, operation: ParsedOperation): Promise<OperationResult> {
    const { action_type, item, count = 1, slot } = operation;

    if (!item) {
      return { success: false, message: '未指定物品名称' };
    }

    const mcData = context.bot.registry;
    const itemMeta = mcData.itemsByName[item];

    if (!itemMeta) {
      return { success: false, message: `未知物品: ${item}` };
    }

    try {
      if (action_type === 'put_items') {
        return await this.performPut(context, container, item, itemMeta.id, count, slot);
      } else if (action_type === 'take_items') {
        return await this.performTake(container, item, itemMeta.id, count, slot);
      } else {
        return { success: false, message: `未知操作类型: ${action_type}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: `${action_type} ${item} 失败: ${errorMessage}` };
    }
  }

  private async performPut(
    context: RuntimeContext,
    container: any,
    itemName: string,
    itemId: number,
    count: number,
    slot?: string,
  ): Promise<OperationResult> {
    const invItem = context.bot.inventory.findInventoryItem(itemId, null, false);

    if (!invItem) {
      return { success: false, message: `背包中没有 ${itemName}` };
    }

    const putCount = Math.min(count, invItem.count);

    if (slot === 'input') {
      if (typeof container.putInput !== 'function') {
        await container.deposit(itemId, null, putCount);
      } else {
        await container.putInput(itemId, null, putCount);
      }
      return { success: true, message: `已放入输入槽 ${itemName} ${putCount} 个`, itemName, count: putCount };
    } else if (slot === 'fuel') {
      if (typeof container.putFuel !== 'function') {
        await container.deposit(itemId, null, putCount);
      } else {
        await container.putFuel(itemId, null, putCount);
      }
      return { success: true, message: `已放入燃料槽 ${itemName} ${putCount} 个`, itemName, count: putCount };
    } else {
      return { success: false, message: `熔炉不支持放入到 ${slot} 槽位` };
    }
  }

  private async performTake(container: any, itemName: string, itemId: number, count: number, slot?: string): Promise<OperationResult> {
    if (slot === 'output') {
      const outputItem = container.outputItem?.();
      if (!outputItem || outputItem.type !== itemId) {
        return { success: false, message: `输出槽没有 ${itemName}` };
      }
      const takeCount = Math.min(count, outputItem.count);

      if (typeof container.takeOutput !== 'function') {
        await container.withdraw(itemId, null, takeCount);
      } else {
        await container.takeOutput(itemId, null, takeCount);
      }
      return { success: true, message: `已从输出槽取出 ${itemName} ${takeCount} 个`, itemName, count: takeCount };
    } else if (slot === 'input') {
      const inputItem = container.inputItem?.();
      if (!inputItem || inputItem.type !== itemId) {
        return { success: false, message: `输入槽没有 ${itemName}` };
      }
      const takeCount = Math.min(count, inputItem.count);

      if (typeof container.takeInput !== 'function') {
        await container.withdraw(itemId, null, takeCount);
      } else {
        await container.takeInput(itemId, null, takeCount);
      }
      return { success: true, message: `已从输入槽取出 ${itemName} ${takeCount} 个`, itemName, count: takeCount };
    } else if (slot === 'fuel') {
      const fuelItem = container.fuelItem?.();
      if (!fuelItem || fuelItem.type !== itemId) {
        return { success: false, message: `燃料槽没有 ${itemName}` };
      }
      const takeCount = Math.min(count, fuelItem.count);

      if (typeof container.takeFuel !== 'function') {
        await container.withdraw(itemId, null, takeCount);
      } else {
        await container.takeFuel(itemId, null, takeCount);
      }
      return { success: true, message: `已从燃料槽取出 ${itemName} ${takeCount} 个`, itemName, count: takeCount };
    } else {
      return { success: false, message: `未指定有效槽位` };
    }
  }

  getParamsSchema(): any {
    return {
      type: 'object',
      properties: {
        x: { type: 'number', description: '熔炉X坐标' },
        y: { type: 'number', description: '熔炉Y坐标' },
        z: { type: 'number', description: '熔炉Z坐标' },
        intent: { type: 'string', description: '操作意图描述（如"熔炼铁矿"、"取出铁锭"）' },
      },
      required: ['x', 'y', 'z'],
    };
  }
}
