/**
 * 动作提示词生成器
 *
 * 专门负责生成动作相关的 LLM 提示词
 * 从 ActionExecutor 中分离出提示词生成职责
 */

import { Action } from './Action';
import { ActionId } from './ActionIds';
import { ActionExecutor } from './ActionExecutor';
import { RuntimeContext } from '@/core/context/RuntimeContext';

/**
 * 动作提示词生成器类
 */
export class ActionPromptGenerator {
  constructor(private executor: ActionExecutor) {}

  /**
   * 根据当前上下文过滤应该激活的动作
   */
  private filterActiveActions(actions: Action[], context: RuntimeContext): Action[] {
    return actions.filter(action => {
      // 调用动作的 shouldActivate 方法，默认返回 true
      return action.shouldActivate?.(context) ?? true;
    });
  }

  /**
   * 生成动作列表提示词
   * @param context 运行时上下文，用于判断哪些动作应该激活
   * @param simplifyOthers 是否简化非plan_action的动作显示（只显示名称和描述）
   */
  generatePrompt(context?: RuntimeContext, simplifyOthers: boolean = false): string {
    let actions = this.executor.getRegisteredActions();

    // 如果提供了上下文，则过滤应该激活的动作
    if (context) {
      actions = this.filterActiveActions(actions, context);
    }

    if (actions.length === 0) {
      return '# 可用动作\n\n暂无可用动作';
    }

    const lines: string[] = ['# 可用动作', ''];

    // plan_action放在最前面
    const planAction = actions.find(a => a.id === 'plan_action');
    const otherActions = actions.filter(a => a.id !== 'plan_action');

    if (planAction) {
      lines.push(`## ${planAction.name}`);
      lines.push(planAction.description);
      lines.push('');
      lines.push('```json');
      lines.push(
        JSON.stringify(
          {
            action_type: planAction.id,
            ...planAction.getParamsSchema?.(),
          },
          null,
          2,
        ),
      );
      lines.push('```');
      lines.push('');
    }

    // 其他动作根据simplifyOthers决定显示方式
    for (const action of otherActions) {
      lines.push(`## ${action.name}`);
      lines.push(action.description);
      lines.push('');

      if (!simplifyOthers) {
        // 完整显示参数
        lines.push('```json');
        lines.push(
          JSON.stringify(
            {
              action_type: action.id,
              ...action.getParamsSchema?.(),
            },
            null,
            2,
          ),
        );
        lines.push('```');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * 生成指定动作的提示词
   */
  generateActionPrompt(actionId: ActionId): string {
    const action = this.executor.getAction(actionId);
    if (!action) {
      return `# 动作 ${actionId}\n\n该动作未注册`;
    }

    const lines: string[] = [`# ${action.name}`, action.description, ''];

    lines.push('```json');
    lines.push(
      JSON.stringify(
        {
          action_type: action.id,
          ...action.getParamsSchema?.(),
        },
        null,
        2,
      ),
    );
    lines.push('```');

    return lines.join('\n');
  }

  /**
   * 生成动作分类提示词
   * @param context 运行时上下文，用于判断哪些动作应该激活
   */
  generateCategorizedPrompt(context?: RuntimeContext): string {
    let actions = this.executor.getRegisteredActions();

    // 如果提供了上下文，则过滤应该激活的动作
    if (context) {
      actions = this.filterActiveActions(actions, context);
    }

    if (actions.length === 0) {
      return '# 可用动作\n\n暂无可用动作';
    }

    // 按类别分组动作
    const categories: Record<string, Action[]> = {};
    for (const action of actions) {
      const category = (action as any).category || '其他';
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(action);
    }

    const lines: string[] = ['# 可用动作', ''];

    for (const [category, categoryActions] of Object.entries(categories)) {
      lines.push(`## ${category}`, '');

      for (const action of categoryActions) {
        lines.push(`### ${action.name}`);
        lines.push(action.description);
        lines.push('');
        lines.push('```json');
        lines.push(
          JSON.stringify(
            {
              action_type: action.id,
              ...action.getParamsSchema?.(),
            },
            null,
            2,
          ),
        );
        lines.push('```');
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * 生成简化的动作列表（仅名称和描述，不含参数）
   * 用于规划模式，节省token
   */
  generateSimplifiedActionList(context?: RuntimeContext): string {
    let actions = this.executor.getRegisteredActions();

    // 如果提供了上下文，则过滤应该激活的动作
    if (context) {
      actions = this.filterActiveActions(actions, context);
    }

    // 排除plan_action
    const actionList = actions.filter(a => a.id !== 'plan_action');

    const lines: string[] = [];
    for (const action of actionList) {
      lines.push(`- **${action.name}**: ${action.description}`);
    }

    return lines.join('\n');
  }
}
