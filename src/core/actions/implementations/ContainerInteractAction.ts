/**
 * ContainerInteractAction - 容器交互抽象基类
 *
 * 实现"Action 内部 LLM 调用"模式：
 * - 外层 ReAct 循环决定 WHAT（是否操作容器）
 * - 内层专用 LLM 决定 HOW（具体存取哪些物品）
 */

import { BaseAction } from '@/core/actions/Action';
import { RuntimeContext } from '@/core/context/RuntimeContext';
import { ActionResult, BaseActionParams } from '@/core/actions/types';
import { GoalType } from '@/utils/MovementUtils';
import { Vec3 } from 'vec3';
import { promptManager } from '@/core/agent/prompt/prompt_manager';

/**
 * 容器操作结果
 */
export interface OperationResult {
  success: boolean;
  message: string;
  itemName?: string;
  count?: number;
}

/**
 * 容器状态快照
 */
export interface ContainerSnapshot {
  items: Map<string, number>;
}

/**
 * Diff 摘要
 */
export interface DiffSummary {
  deposited: Array<{ item: string; count: number }>;
  withdrawn: Array<{ item: string; count: number }>;
  errors: string[];
}

/**
 * 容器交互参数
 */
export interface ContainerInteractParams extends BaseActionParams {
  x: number;
  y: number;
  z: number;
  intent?: string;
}

/**
 * 解析后的 LLM 操作
 */
export interface ParsedOperation {
  action_type: string;
  item?: string;
  count?: number;
  slot?: string;
}

/**
 * 容器交互抽象基类
 *
 * 子类需要实现：
 * - getContainerType(): 容器类型标识
 * - getPromptTemplateName(): 用户提示词模板名
 * - getSystemTemplateName(): 系统提示词模板名
 * - getBlockTypes(): 返回容器方块类型 ID 列表
 * - readContainerState(container): 格式化容器内容为字符串
 * - executeOperation(ctx, container, op): 执行单个操作
 */
export abstract class ContainerInteractAction<P extends ContainerInteractParams = ContainerInteractParams> extends BaseAction<P> {
  /**
   * 获取容器类型标识
   */
  abstract getContainerType(): string;

  /**
   * 获取用户提示词模板名
   */
  abstract getPromptTemplateName(): string;

  /**
   * 获取系统提示词模板名
   */
  abstract getSystemTemplateName(): string;

  /**
   * 获取容器方块类型 ID 列表
   */
  abstract getBlockTypes(context: RuntimeContext): number[];

  /**
   * 格式化容器内容为字符串
   */
  abstract readContainerState(container: any): string;

  /**
   * 执行单个操作
   */
  abstract executeOperation(context: RuntimeContext, container: any, operation: ParsedOperation): Promise<OperationResult>;

  /**
   * 获取默认的参数 Schema
   */
  getParamsSchema(): any {
    return {
      type: 'object',
      properties: {
        x: { type: 'number', description: '容器X坐标' },
        y: { type: 'number', description: '容器Y坐标' },
        z: { type: 'number', description: '容器Z坐标' },
        intent: { type: 'string', description: '操作意图描述（如"整理库存"、"取出铁锭"）' },
      },
      required: ['x', 'y', 'z'],
    };
  }

  /**
   * 主执行流程
   */
  protected async doExecute(context: RuntimeContext, params: P): Promise<ActionResult> {
    const { x, y, z, intent } = params;

    if (!context.llmManager) {
      return this.failure('llmManager 未注入，无法执行智能容器操作');
    }

    try {
      // 1. 查找容器方块
      const containerBlock = await this.findContainer(context, x, y, z);
      if (!containerBlock) {
        return this.failure(`在坐标 (${x}, ${y}, ${z}) 未找到${this.getContainerType()}容器`);
      }

      // 2. 移动到容器附近
      const moveResult = await context.movementUtils.moveTo(context.bot, {
        type: 'coordinate',
        x: containerBlock.position.x,
        y: containerBlock.position.y,
        z: containerBlock.position.z,
        distance: 3,
        maxDistance: 32,
        useRelativeCoords: false,
        goalType: GoalType.GoalGetToBlock,
      });

      if (!moveResult.success) {
        return this.failure(`无法移动到${this.getContainerType()}位置: ${moveResult.error}`);
      }

      // 3. 禁用 armorManager 自动装备
      const armorManager = (context.bot as any).armorManager;
      const wasArmorManagerEnabled = armorManager?.enabled ?? false;
      if (armorManager && wasArmorManagerEnabled) {
        context.logger.debug(`[ContainerInteract] 临时禁用 armorManager`);
        armorManager.enabled = false;
      }

      try {
        // 4. 关闭已有窗口
        if (context.bot.currentWindow) {
          context.logger.debug(`检测到已打开的窗口，先关闭: ${context.bot.currentWindow.type}`);
          try {
            context.bot.closeWindow(context.bot.currentWindow);
            await this.waitForWindowClose(context, 2000);
          } catch (e) {
            context.logger.warn(`关闭窗口时出错，继续执行: ${e}`);
          }
          await this.sleep(300);
        }

        // 5. 确保能看见容器
        if (!context.bot.canSeeBlock(containerBlock)) {
          await context.bot.lookAt(containerBlock.position.offset(0.5, 0.5, 0.5));
          await this.sleep(300);
          if (!context.bot.canSeeBlock(containerBlock)) {
            return this.failure(`无法看见${this.getContainerType()}，可能被遮挡`);
          }
        }

        // 6. 重新获取方块对象
        const freshBlock = context.bot.blockAt(containerBlock.position);
        if (!freshBlock) {
          return this.failure(`无法重新获取方块，区块可能未加载`);
        }

        // 7. 打开容器
        const container = await context.bot.openContainer(freshBlock);

        try {
          // 8. 读取容器状态并创建快照
          const containerStateStr = this.readContainerState(container);
          const beforeSnapshot = this.createContainerSnapshot(container);

          // 9. 收集上下文数据
          const inventoryInfo = this.getInventoryInfo(context);
          const currentGoal = this.getCurrentGoal(context);
          const currentTasks = this.getCurrentTasks(context);

          // 10. 生成专用 prompt
          const prompt = this.generatePrompt(context, {
            containerState: containerStateStr,
            inventoryInfo,
            intent: intent || '整理物品',
            currentGoal,
            currentTasks,
          });

          const systemPrompt = this.generateSystemPrompt(context);

          context.logger.info(`[${this.getContainerType()}] 调用内部 LLM 进行决策...`);

          // 11. 内部 LLM 调用
          const llmResponse = await context.llmManager.simpleChat(prompt, systemPrompt);

          context.logger.debug(`[${this.getContainerType()}] LLM 响应: ${llmResponse}`);

          // 12. 解析 JSON 响应
          const operations = this.parseOperations(llmResponse);

          if (operations.length === 0) {
            container.close();
            return this.success(`${this.getContainerType()}操作完成：无需执行任何操作`, {
              containerState: containerStateStr,
            });
          }

          // 13. 顺序执行每个操作
          const results: OperationResult[] = [];
          const diffSummary: DiffSummary = {
            deposited: [],
            withdrawn: [],
            errors: [],
          };

          for (const op of operations) {
            // 检查中断信号
            if (context.signal.aborted) {
              context.logger.warn(`[${this.getContainerType()}] 操作被中断`);
              diffSummary.errors.push('操作被中断');
              break;
            }

            const result = await this.executeOperation(context, container, op);
            results.push(result);

            if (result.success) {
              // 记录到 diff
              if (result.itemName && result.count) {
                if (op.action_type === 'put_items') {
                  const existing = diffSummary.deposited.find(d => d.item === result.itemName);
                  if (existing) {
                    existing.count += result.count;
                  } else {
                    diffSummary.deposited.push({ item: result.itemName!, count: result.count! });
                  }
                } else if (op.action_type === 'take_items') {
                  const existing = diffSummary.withdrawn.find(d => d.item === result.itemName);
                  if (existing) {
                    existing.count += result.count;
                  } else {
                    diffSummary.withdrawn.push({ item: result.itemName!, count: result.count! });
                  }
                }
              }
            } else {
              diffSummary.errors.push(result.message);
            }

            // 操作间隔
            await this.sleep(300);
          }

          // 14. 计算最终 diff 摘要
          const afterSnapshot = this.createContainerSnapshot(container);
          const summaryStr = this.formatDiffSummary(diffSummary);

          // 15. 关闭容器
          container.close();

          // 16. 返回结果
          if (diffSummary.errors.length === 0 || diffSummary.deposited.length > 0 || diffSummary.withdrawn.length > 0) {
            return this.success(`${this.getContainerType()}操作完成: ${summaryStr}`, {
              diff: diffSummary,
              operations: results,
              beforeSnapshot: this.snapshotToObject(beforeSnapshot),
              afterSnapshot: this.snapshotToObject(afterSnapshot),
            });
          } else {
            return this.failure(`${this.getContainerType()}操作失败: ${diffSummary.errors.join('; ')}`);
          }
        } catch (containerError) {
          container.close();
          throw containerError;
        }
      } finally {
        // 恢复 armorManager
        if (armorManager && wasArmorManagerEnabled) {
          context.logger.debug(`[ContainerInteract] 恢复 armorManager`);
          armorManager.enabled = true;
        }
      }
    } catch (error) {
      const err = error as Error;
      context.logger.error(`${this.getContainerType()}交互失败:`, err);
      return this.failure(`${this.getContainerType()}交互失败: ${err.message}`, err);
    }
  }

  /**
   * 查找容器方块
   */
  private async findContainer(context: RuntimeContext, x: number, y: number, z: number): Promise<any> {
    const blockTypes = this.getBlockTypes(context);
    const pos = new Vec3(x, y, z);
    const block = context.bot.blockAt(pos);

    if (!block) {
      return null;
    }

    if (!blockTypes.includes(block.type)) {
      return null;
    }

    return block;
  }

  /**
   * 等待窗口关闭
   */
  private async waitForWindowClose(context: RuntimeContext, timeout: number): Promise<boolean> {
    return Promise.race([
      new Promise<boolean>(resolve => {
        const onClose = () => {
          context.bot.removeListener('windowClose', onClose);
          resolve(true);
        };
        context.bot.once('windowClose', onClose);
      }),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeout)),
    ]);
  }

  /**
   * 创建容器快照
   */
  protected createContainerSnapshot(container: any): ContainerSnapshot {
    const items = new Map<string, number>();
    const containerItems = container.containerItems?.() || [];

    for (const item of containerItems) {
      const name = item.name || `unknown_${item.type}`;
      const existing = items.get(name) || 0;
      items.set(name, existing + item.count);
    }

    return { items };
  }

  /**
   * 快照转对象
   */
  protected snapshotToObject(snapshot: ContainerSnapshot): Record<string, number> {
    const obj: Record<string, number> = {};
    snapshot.items.forEach((count, name) => {
      obj[name] = count;
    });
    return obj;
  }

  /**
   * 获取背包信息
   */
  protected getInventoryInfo(context: RuntimeContext): string {
    const items = context.bot.inventory.items();
    const itemMap = new Map<string, number>();

    for (const item of items) {
      const name = item.name || `unknown_${item.type}`;
      const existing = itemMap.get(name) || 0;
      itemMap.set(name, existing + item.count);
    }

    const parts: string[] = [];
    itemMap.forEach((count, name) => {
      parts.push(`${name}: ${count}`);
    });

    return parts.length > 0 ? parts.join(', ') : '背包为空';
  }

  /**
   * 获取当前目标
   */
  protected getCurrentGoal(context: RuntimeContext): string {
    if (context.goalManager) {
      const goals = context.goalManager.getActiveGoals() || [];
      if (goals.length > 0) {
        return `当前目标: ${goals[0].content || '未知目标'}`;
      }
    }
    return '当前无特定目标';
  }

  /**
   * 获取当前任务
   */
  protected getCurrentTasks(_context: RuntimeContext): string {
    return '当前无特定任务';
  }

  /**
   * 生成用户提示词
   */
  protected generatePrompt(
    context: RuntimeContext,
    data: {
      containerState: string;
      inventoryInfo: string;
      intent: string;
      currentGoal: string;
      currentTasks: string;
    },
  ): string {
    const templateName = this.getPromptTemplateName();
    const template = promptManager.getTemplate(templateName);

    if (!template) {
      throw new Error(`模板 ${templateName} 未注册`);
    }

    const params: Record<string, string> = {
      bot_name: context.bot.username || 'Bot',
      player_name: context.bot.username || 'Bot',
      intent: `操作意图: ${data.intent}`,
      current_goal: data.currentGoal,
      current_tasks: data.currentTasks,
      inventory_info: data.inventoryInfo,
    };

    // 根据容器类型设置对应的 GUI 信息
    if (this.getContainerType() === 'chest') {
      params.chest_gui = data.containerState;
    } else if (this.getContainerType() === 'furnace') {
      params.furnace_gui = data.containerState;
    }

    // 添加 inventory_info
    params.inventory_info = data.inventoryInfo;

    return template.format(params);
  }

  /**
   * 生成系统提示词
   */
  protected generateSystemPrompt(context: RuntimeContext): string {
    const templateName = this.getSystemTemplateName();
    const template = promptManager.getTemplate(templateName);

    if (!template) {
      return `你是 ${context.bot.username}，一个专业的 Minecraft 容器管理助手。`;
    }

    return template.format({
      bot_name: context.bot.username || 'Bot',
      player_name: context.bot.username || 'Bot',
    });
  }

  /**
   * 解析 LLM 响应为操作序列
   */
  protected parseOperations(response: string): ParsedOperation[] {
    const operations: ParsedOperation[] = [];

    try {
      // 尝试提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // 处理两种格式：单个操作或批量操作
      if (parsed.action) {
        // 带思考的格式
        const action = parsed.action;
        if (action.sequence && Array.isArray(action.sequence)) {
          operations.push(...action.sequence);
        } else if (action.action_type) {
          operations.push(action);
        }
      } else if (parsed.sequence && Array.isArray(parsed.sequence)) {
        // 直接批量操作格式
        operations.push(...parsed.sequence);
      } else if (parsed.action_type) {
        // 单个操作格式
        operations.push(parsed);
      }
    } catch (e) {
      return [];
    }

    return operations;
  }

  /**
   * 格式化 diff 摘要
   */
  protected formatDiffSummary(diff: DiffSummary): string {
    const parts: string[] = [];

    if (diff.deposited.length > 0) {
      const depositStr = diff.deposited.map(d => `${d.item} x${d.count}`).join(', ');
      parts.push(`存入: ${depositStr}`);
    }

    if (diff.withdrawn.length > 0) {
      const withdrawStr = diff.withdrawn.map(w => `${w.item} x${w.count}`).join(', ');
      parts.push(`取出: ${withdrawStr}`);
    }

    if (diff.errors.length > 0) {
      parts.push(`失败: ${diff.errors.join('; ')}`);
    }

    return parts.length > 0 ? parts.join('; ') : '无变化';
  }

  /**
   * 辅助方法：睡眠
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
