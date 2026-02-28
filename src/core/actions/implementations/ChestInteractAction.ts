/**
 * ChestInteractAction - 智能箱子交互
 *
 * 与箱子交互，通过内部 LLM 决策并批量执行存取操作
 */

import { RuntimeContext } from '@/core/context/RuntimeContext';
import { ActionResult } from '@/core/actions/types';
import { ContainerInteractAction, ContainerInteractParams, ParsedOperation, OperationResult } from './ContainerInteractAction';

/**
 * 箱子交互参数
 */
export interface ChestInteractParams extends ContainerInteractParams {}

export class ChestInteractAction extends ContainerInteractAction<ChestInteractParams> {
  readonly id = 'interact_chest';
  readonly name = 'ChestInteractAction';
  readonly description = '与箱子交互：打开箱子，AI 自主决策并批量执行存取操作';

  shouldActivate(_context: RuntimeContext): boolean {
    return true;
  }

  getContainerType(): string {
    return 'chest';
  }

  getPromptTemplateName(): string {
    return 'chest_operation';
  }

  getSystemTemplateName(): string {
    return 'chest_operation_system';
  }

  getBlockTypes(context: RuntimeContext): number[] {
    const mcData = context.bot.registry;
    const chestId = mcData.blocksByName.chest?.id;
    const trappedChestId = mcData.blocksByName.trapped_chest?.id;

    const types: number[] = [];
    if (chestId !== undefined) types.push(chestId);
    if (trappedChestId !== undefined) types.push(trappedChestId);
    return types;
  }

  readContainerState(container: any): string {
    const items = container.containerItems?.() || [];
    if (items.length === 0) {
      return '箱子为空';
    }

    const itemMap = new Map<string, { count: number; slots: number[] }>();

    items.forEach((item: any, index: number) => {
      const name = item.name || `unknown_${item.type}`;
      const existing = itemMap.get(name);
      if (existing) {
        existing.count += item.count;
        existing.slots.push(index);
      } else {
        itemMap.set(name, { count: item.count, slots: [index] });
      }
    });

    const lines: string[] = ['箱子内容:'];
    itemMap.forEach((data, name) => {
      lines.push(`  - ${name}: ${data.count}个 (槽位: ${data.slots.join(', ')})`);
    });

    return lines.join('\n');
  }

  async executeOperation(context: RuntimeContext, container: any, operation: ParsedOperation): Promise<OperationResult> {
    const { action_type, item, count = 1 } = operation;

    if (!item) {
      return { success: false, message: '未指定物品名称' };
    }

    const mcData = context.bot.registry;
    const itemMeta = mcData.itemsByName[item];

    if (!itemMeta) {
      return { success: false, message: `未知物品: ${item}` };
    }

    try {
      if (action_type === 'take_items') {
        return await this.performWithdraw(container, item, itemMeta.id, count);
      } else if (action_type === 'put_items') {
        return await this.performDeposit(context, container, item, itemMeta.id, count);
      } else {
        return { success: false, message: `未知操作类型: ${action_type}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: `${action_type} ${item} 失败: ${errorMessage}` };
    }
  }

  private async performWithdraw(container: any, itemName: string, itemId: number, count: number): Promise<OperationResult> {
    const chestItem = container.containerItems?.().find((it: any) => it.type === itemId);

    if (!chestItem) {
      return { success: false, message: `箱子中没有 ${itemName}` };
    }

    const withdrawCount = Math.min(count, chestItem.count);
    await container.withdraw(itemId, null, withdrawCount);

    return {
      success: true,
      message: `已取出 ${itemName} ${withdrawCount} 个`,
      itemName,
      count: withdrawCount,
    };
  }

  private async performDeposit(context: RuntimeContext, container: any, itemName: string, itemId: number, count: number): Promise<OperationResult> {
    const invItem = context.bot.inventory.findInventoryItem(itemId, null, false);

    if (!invItem) {
      return { success: false, message: `背包中没有 ${itemName}` };
    }

    const depositCount = Math.min(count, invItem.count);
    await container.deposit(itemId, null, depositCount);

    return {
      success: true,
      message: `已存入 ${itemName} ${depositCount} 个`,
      itemName,
      count: depositCount,
    };
  }

  getParamsSchema(): any {
    return {
      type: 'object',
      properties: {
        x: { type: 'number', description: '箱子X坐标' },
        y: { type: 'number', description: '箱子Y坐标' },
        z: { type: 'number', description: '箱子Z坐标' },
        intent: { type: 'string', description: '操作意图描述（如"整理库存"、"取出铁锭"）' },
      },
      required: ['x', 'y', 'z'],
    };
  }
}
