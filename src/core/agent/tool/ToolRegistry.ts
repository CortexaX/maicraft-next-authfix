/**
 * ToolRegistry - Action 到 function-calling 的桥梁
 *
 * 将 Action 系统转换为 LLM function-calling 格式
 * 包装 ActionExecutor（不替代），负责 schema 转换和工具调用执行
 */

import { ActionExecutor } from '@/core/actions/ActionExecutor';
import type { Action } from '@/core/actions/Action';
import { RuntimeContext } from '@/core/context/RuntimeContext';
import { getLogger, Logger } from '@/utils/Logger';

/**
 * OpenAI function-calling tool schema 格式
 */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

/**
 * 标准化的 JSON Schema 格式
 */
interface StandardJsonSchema {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
}

/**
 * Action 原始 Schema 可能的格式
 */
type ActionSchema = StandardJsonSchema | Record<string, any>;

/**
 * Tool Registry 类
 *
 * 负责将 Action 转换为 OpenAI function-calling 格式
 */
export class ToolRegistry {
  private logger: Logger;
  private executor: ActionExecutor;
  private context: RuntimeContext;

  constructor(executor: ActionExecutor, context: RuntimeContext) {
    this.executor = executor;
    this.context = context;
    this.logger = getLogger('ToolRegistry');
    this.logger.info('ToolRegistry 初始化');
  }

  /**
   * 获取所有工具的 function-calling schema
   */
  getToolSchemas(): ToolSchema[] {
    const actions = this.executor.getRegisteredActions();
    const schemas: ToolSchema[] = [];

    for (const action of actions) {
      try {
        const schema = this.actionToToolSchema(action);
        schemas.push(schema);
      } catch (error) {
        this.logger.warn(`转换 Action schema 失败: ${action.name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.debug(`生成 ${schemas.length} 个工具 schemas`);
    return schemas;
  }

  /**
   * 根据上下文过滤可用工具
   * 使用 Action.shouldActivate(context) 过滤
   */
  getAvailableToolSchemas(): ToolSchema[] {
    const actions = this.executor.getRegisteredActions();
    const schemas: ToolSchema[] = [];

    for (const action of actions) {
      try {
        // 检查 action 是否应该激活
        if (action.shouldActivate && !action.shouldActivate(this.context)) {
          continue;
        }

        const schema = this.actionToToolSchema(action);
        schemas.push(schema);
      } catch (error) {
        this.logger.warn(`过滤 Action schema 失败: ${action.name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.debug(`生成 ${schemas.length} 个可用工具 schemas（已过滤）`);
    return schemas;
  }

  /**
   * 执行工具调用
   * @param name 工具名称（Action ID）
   * @param args 参数对象（JSON 解析后的）
   */
  async executeTool(name: string, args: Record<string, any>): Promise<any> {
    this.logger.info(`执行工具: ${name}`, { args });

    try {
      // 委托给 ActionExecutor.execute()
      const result = await this.executor.execute(name as any, args);

      // 返回执行结果
      return {
        success: result.success,
        message: result.message,
        data: result.data,
        error: result.error?.message || null,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`工具执行失败: ${name}`, { error: err.message });

      return {
        success: false,
        message: `工具执行失败: ${err.message}`,
        error: err.message,
      };
    }
  }

  /**
   * 将 Action 转换为 Tool Schema
   */
  private actionToToolSchema(action: Action): ToolSchema {
    // 获取参数 schema
    const paramsSchema = action.getParamsSchema ? action.getParamsSchema() : {};

    // 标准化为 OpenAI 格式
    const normalizedParams = this.normalizeSchema(paramsSchema);

    return {
      type: 'function',
      function: {
        name: action.id,
        description: action.description || action.name,
        parameters: normalizedParams,
      },
    };
  }

  /**
   * 将 Action 的 schema 转换为标准 OpenAI 格式
   *
   * 处理两种格式：
   * 1. 标准格式：{ type: "object", properties: {...}, required: [...] }
   * 2. 扁平格式：{ param1: {...}, param2: {...} }
   */
  private normalizeSchema(actionSchema: ActionSchema): StandardJsonSchema {
    // 检查是否已经是标准格式
    if (this.isStandardSchema(actionSchema)) {
      return actionSchema as StandardJsonSchema;
    }

    // 扁平格式：包装为标准格式
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(actionSchema)) {
      // 确保每个属性有 type 字段
      if (typeof value === 'object' && value !== null) {
        properties[key] = {
          type: value.type || 'string',
          ...value,
        };

        // 检查是否为必需参数
        if (value.required === true || (value.optional !== true && value.default === undefined)) {
          required.push(key);
        }
      } else {
        // 简单值，默认为 string
        properties[key] = {
          type: 'string',
          description: String(value),
        };
      }
    }

    const result: StandardJsonSchema = {
      type: 'object',
      properties,
    };

    if (required.length > 0) {
      result.required = required;
    }

    return result;
  }

  /**
   * 检查 schema 是否为标准 JSON Schema 格式
   */
  private isStandardSchema(schema: ActionSchema): boolean {
    return (
      typeof schema === 'object' &&
      schema !== null &&
      'type' in schema &&
      schema.type === 'object' &&
      'properties' in schema &&
      typeof schema.properties === 'object'
    );
  }

  /**
   * 获取工具列表（用于调试）
   */
  getToolList(): string[] {
    const actions = this.executor.getRegisteredActions();
    return actions.map(a => `${a.id} (${a.name})`);
  }
}
