/**
 * 规划管理动作
 * 统一管理目标和任务的增删改查
 */

import { BaseAction } from '../Action';
import { ActionIds } from '../ActionIds';
import type { ActionResult, BaseActionParams } from '../types';
import type { RuntimeContext } from '@/core/context/RuntimeContext';
import type { TrackerConfig } from '@/core/agent/planning/trackers/types';
import { TrackerFactory } from '@/core/agent/planning/trackers/TrackerFactory';
import { logger } from '@/utils/Logger';

/**
 * PlanAction 参数接口
 */
export interface PlanActionParams extends BaseActionParams {
  /** 类型：目标或任务 */
  type: 'goal' | 'task';

  /** 操作：添加、编辑、删除、完成 */
  operation: 'add' | 'edit' | 'remove' | 'complete';

  /** ID（语义化，add时可选） */
  id?: string;

  /** 内容描述 */
  content?: string;

  /** 所属目标ID（仅task的add操作需要） */
  goalId?: string;

  /** Tracker配置（可选） */
  tracker?: TrackerConfig;

  /** 优先级 1-5，默认3 */
  priority?: number;

  /** 元数据 */
  metadata?: Record<string, any>;
}

export class PlanAction extends BaseAction<PlanActionParams> {
  readonly id = ActionIds.PLAN_ACTION;
  readonly name = '规划管理';
  readonly description = '管理目标和任务的规划。可以添加、编辑、删除、完成目标或任务。';

  private trackerFactory: TrackerFactory;

  constructor() {
    super();
    this.trackerFactory = new TrackerFactory();
  }

  async execute(context: RuntimeContext, params: PlanActionParams): Promise<ActionResult> {
    try {
      // 根据 type 分发到不同的处理方法
      if (params.type === 'goal') {
        return await this.handleGoal(context, params);
      } else if (params.type === 'task') {
        return await this.handleTask(context, params);
      } else {
        return this.failure(`未知的类型: ${params.type}`);
      }
    } catch (error) {
      logger.error('[PlanAction] 执行出错:', error);
      return this.failure(`规划管理失败: ${error instanceof Error ? error.message : String(error)}`, error as Error);
    }
  }

  /**
   * 处理目标操作
   */
  private async handleGoal(context: RuntimeContext, params: PlanActionParams): Promise<ActionResult> {
    const goalManager = context.goalManager;

    switch (params.operation) {
      case 'add': {
        if (!params.content) {
          return this.failure('添加目标需要提供 content 参数');
        }

        // 创建Tracker（如果提供）
        const tracker = params.tracker ? this.trackerFactory.createTracker(params.tracker) : undefined;

        const goal = goalManager.addGoal({
          id: params.id,
          content: params.content,
          tracker,
          priority: params.priority,
          metadata: params.metadata,
        });

        return this.success(`✅ 成功添加目标: [${goal.id}] ${goal.content}`, goal);
      }

      case 'edit': {
        if (!params.id) {
          return this.failure('编辑目标需要提供 id 参数');
        }

        const updates: any = {};
        if (params.content !== undefined) updates.content = params.content;
        if (params.priority !== undefined) updates.priority = params.priority;
        if (params.tracker !== undefined) {
          updates.tracker = this.trackerFactory.createTracker(params.tracker);
        }
        if (params.metadata !== undefined) updates.metadata = params.metadata;

        goalManager.updateGoal(params.id, updates);

        return this.success(`✅ 成功更新目标: [${params.id}]`);
      }

      case 'remove': {
        if (!params.id) {
          return this.failure('删除目标需要提供 id 参数');
        }

        goalManager.removeGoal(params.id);

        return this.success(`✅ 成功删除目标: [${params.id}]`);
      }

      case 'complete': {
        if (!params.id) {
          return this.failure('完成目标需要提供 id 参数');
        }

        goalManager.completeGoal(params.id, 'llm');

        return this.success(`🎯 成功完成目标: [${params.id}]`);
      }

      default:
        return this.failure(`未知的操作: ${params.operation}`);
    }
  }

  /**
   * 处理任务操作
   */
  private async handleTask(context: RuntimeContext, params: PlanActionParams): Promise<ActionResult> {
    const taskManager = context.taskManager;

    switch (params.operation) {
      case 'add': {
        if (!params.content) {
          return this.failure('添加任务需要提供 content 参数');
        }
        if (!params.goalId) {
          return this.failure('添加任务需要提供 goalId 参数');
        }

        // 创建Tracker（如果提供）
        const tracker = params.tracker ? this.trackerFactory.createTracker(params.tracker) : undefined;

        const task = taskManager.addTask({
          id: params.id,
          content: params.content,
          goalId: params.goalId,
          tracker,
          priority: params.priority,
          metadata: params.metadata,
        });

        return this.success(`✅ 成功添加任务: [${task.id}] ${task.content}`, task);
      }

      case 'edit': {
        if (!params.id) {
          return this.failure('编辑任务需要提供 id 参数');
        }

        const updates: any = {};
        if (params.content !== undefined) updates.content = params.content;
        if (params.priority !== undefined) updates.priority = params.priority;
        if (params.tracker !== undefined) {
          updates.tracker = this.trackerFactory.createTracker(params.tracker);
        }
        if (params.metadata !== undefined) updates.metadata = params.metadata;

        taskManager.updateTask(params.id, updates);

        return this.success(`✅ 成功更新任务: [${params.id}]`);
      }

      case 'remove': {
        if (!params.id) {
          return this.failure('删除任务需要提供 id 参数');
        }

        taskManager.removeTask(params.id);

        return this.success(`✅ 成功删除任务: [${params.id}]`);
      }

      case 'complete': {
        if (!params.id) {
          return this.failure('完成任务需要提供 id 参数');
        }

        taskManager.completeTask(params.id, 'llm');

        return this.success(`✅ 成功完成任务: [${params.id}]`);
      }

      default:
        return this.failure(`未知的操作: ${params.operation}`);
    }
  }

  /**
   * 获取参数Schema（用于LLM工具调用）
   */
  getParamsSchema(): any {
    return {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['goal', 'task'],
          description: '类型：goal=目标（抽象的、多步骤）, task=任务（具体的、单步骤）',
        },
        operation: {
          type: 'string',
          enum: ['add', 'edit', 'remove', 'complete'],
          description: '操作：add=添加, edit=编辑, remove=删除, complete=完成',
        },
        id: {
          type: 'string',
          pattern: '^[a-z][a-z0-9_]*$',
          description: '语义化ID（如 "find_village", "collect_wood"）。add操作时可选（LLM可传入，否则自动生成），其他操作必需。如果重复会自动添加序号',
        },
        content: {
          type: 'string',
          description: '内容描述（add和edit操作需要）',
        },
        goalId: {
          type: 'string',
          description: '所属目标ID（仅task的add操作需要）',
        },
        tracker: {
          type: 'object',
          description: '可选的自动检测Tracker配置',
          properties: {
            type: {
              type: 'string',
              enum: ['inventory', 'location', 'entity', 'environment', 'craft', 'composite'],
              description: 'Tracker类型：inventory=背包物品, location=位置, entity=实体, environment=环境, craft=制作, composite=组合',
            },
            // inventory
            itemName: {
              type: 'string',
              description: '物品名称（inventory/craft需要）',
            },
            targetCount: {
              type: 'number',
              description: '目标数量（inventory/craft需要）',
            },
            // location
            x: { type: 'number', description: 'X坐标（location需要）' },
            y: { type: 'number', description: 'Y坐标（location可选）' },
            z: { type: 'number', description: 'Z坐标（location需要）' },
            radius: {
              type: 'number',
              description: '到达半径（location，默认3）',
            },
            // entity
            entityType: {
              type: 'string',
              description: '实体类型（entity，如 "villager"）',
            },
            entityCategory: {
              type: 'string',
              enum: ['hostile', 'passive', 'neutral', 'player'],
              description: '实体类别（entity）',
            },
            minCount: { type: 'number', description: '最小数量（entity）' },
            distance: {
              type: 'number',
              description: '检测距离（entity，默认16）',
            },
            // environment
            timeOfDay: {
              type: 'object',
              description: '时间范围（environment，如 {min: 0, max: 12000}）',
            },
            weather: {
              type: 'string',
              enum: ['clear', 'rain', 'thunder'],
              description: '天气（environment）',
            },
            biome: { type: 'string', description: '生物群系（environment）' },
            dimension: {
              type: 'string',
              enum: ['overworld', 'nether', 'end'],
              description: '维度（environment）',
            },
            // composite
            logic: {
              type: 'string',
              enum: ['and', 'or', 'sequence'],
              description: '组合逻辑（composite）：and=所有条件, or=任意条件, sequence=顺序完成',
            },
            trackers: {
              type: 'array',
              description: '子Tracker列表（composite）',
            },
          },
        },
        priority: {
          type: 'number',
          minimum: 1,
          maximum: 5,
          description: '优先级（1-5，默认3）',
        },
      },
      required: ['type', 'operation'],
    };
  }

  /**
   * 验证参数
   */
  validateParams(params: PlanActionParams): boolean {
    // 基本验证
    if (!params.type || !params.operation) {
      return false;
    }

    // 根据操作验证特定参数
    if (params.operation === 'add') {
      if (!params.content) return false;
      if (params.type === 'task' && !params.goalId) return false;
    }

    if (['edit', 'remove', 'complete'].includes(params.operation)) {
      if (!params.id) return false;
    }

    return true;
  }
}
