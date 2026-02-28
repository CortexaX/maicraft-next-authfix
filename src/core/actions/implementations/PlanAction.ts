/**
 * 规划管理动作
 * 统一管理目标的增删改查和计划更新
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
  /** 操作：添加、编辑、删除、完成、更新计划 */
  operation: 'add' | 'edit' | 'remove' | 'complete' | 'update_plan';

  /** ID（语义化，add时可选） */
  id?: string;

  /** 目标内容描述 */
  content?: string;

  /** 执行计划（自然语言描述） */
  plan?: string;

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
  readonly description = '管理目标的规划。可以添加、编辑、删除、完成目标，或更新目标的执行计划。';

  private getTrackerFactory(context: RuntimeContext): TrackerFactory {
    return new TrackerFactory(context.events);
  }

  async execute(context: RuntimeContext, params: PlanActionParams): Promise<ActionResult> {
    try {
      return await this.handleGoal(context, params);
    } catch (error) {
      logger.error('[PlanAction] 执行出错:', { error });
      return this.failure(`规划管理失败: ${error instanceof Error ? error.message : String(error)}`, error as Error);
    }
  }

  private async handleGoal(context: RuntimeContext, params: PlanActionParams): Promise<ActionResult> {
    const goalManager = context.goalManager;

    switch (params.operation) {
      case 'add': {
        if (!params.content) {
          return this.failure('添加目标需要提供 content 参数');
        }

        const tracker = params.tracker ? this.getTrackerFactory(context).createTracker(params.tracker) : undefined;

        const goal = goalManager.addGoal({
          id: params.id,
          content: params.content,
          plan: params.plan,
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

        const updates: Record<string, unknown> = {};
        if (params.content !== undefined) updates.content = params.content;
        if (params.plan !== undefined) updates.plan = params.plan;
        if (params.priority !== undefined) updates.priority = params.priority;
        if (params.tracker !== undefined) {
          updates.tracker = this.getTrackerFactory(context).createTracker(params.tracker);
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

      case 'update_plan': {
        if (!params.id) {
          return this.failure('更新计划需要提供 id 参数');
        }
        if (!params.plan) {
          return this.failure('更新计划需要提供 plan 参数');
        }

        goalManager.updatePlan(params.id, params.plan);

        return this.success(`📋 成功更新目标计划: [${params.id}]`);
      }

      default:
        return this.failure(`未知的操作: ${params.operation}`);
    }
  }

  getParamsSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['add', 'edit', 'remove', 'complete', 'update_plan'],
          description: '操作：add=添加目标, edit=编辑目标, remove=删除目标, complete=完成目标, update_plan=更新计划',
        },
        id: {
          type: 'string',
          pattern: '^[a-z][a-z0-9_]*$',
          description:
            '语义化ID（如 "find_village", "collect_wood"）。add操作时可选（LLM可传入，否则自动生成），其他操作必需。如果重复会自动添加序号',
        },
        content: {
          type: 'string',
          description: '目标内容描述（add和edit操作需要）',
        },
        plan: {
          type: 'string',
          description: '执行计划，用自然语言描述的执行步骤（add、edit、update_plan操作可用）',
        },
        tracker: {
          type: 'object',
          description: '可选的自动检测Tracker配置',
          properties: {
            type: {
              type: 'string',
              enum: ['collection', 'location', 'entity', 'environment', 'craft', 'composite'],
              description: 'Tracker类型：collection=收集物品, location=位置, entity=实体, environment=环境, craft=制作, composite=组合',
            },
            itemName: {
              type: 'string',
              description: '物品名称（collection/craft需要）',
            },
            targetCount: {
              type: 'number',
              description: '目标数量（collection/craft需要）',
            },
            x: { type: 'number', description: 'X坐标（location需要）' },
            y: { type: 'number', description: 'Y坐标（location可选）' },
            z: { type: 'number', description: 'Z坐标（location需要）' },
            radius: {
              type: 'number',
              description: '到达半径（location，默认3）',
            },
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
      required: ['operation'],
    };
  }

  validateParams(params: PlanActionParams): boolean {
    if (!params.operation) {
      return false;
    }

    if (params.operation === 'add') {
      if (!params.content) return false;
    }

    if (['edit', 'remove', 'complete', 'update_plan'].includes(params.operation)) {
      if (!params.id) return false;
    }

    if (params.operation === 'update_plan') {
      if (!params.plan) return false;
    }

    return true;
  }
}
