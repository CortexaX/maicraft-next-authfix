/**
 * 规划模式思考提示词
 */

import { PromptTemplate, promptManager } from '../prompt_manager';

/**
 * 注册规划模式思考提示词模板
 */
export function initPlanningThinkingTemplate(): void {
  promptManager.registerTemplate(
    new PromptTemplate(
      'planning_thinking',
      `# 当前规划任务

你需要为以下目标制定执行计划：

## 目标状态

**当前活动目标**：
{current_goal}

**目标历史**（最近的目标和完成情况）：
{goal_history}

## 当前状态

**当前计划**：
{current_plan}

**库存物品**：
{inventory}

**当前位置**：{position}

**健康状态**：❤️ {health}/20

**规划进度**：第 {planning_round}/{max_rounds} 轮

---

## 你的任务

请分析当前目标和历史情况，并使用\`plan_action\`动作来制定合适的计划。

**重要提醒**：
- 查看目标历史，了解最近完成的目标和新创建的目标
- 如果当前目标是刚创建的，使用 \`operation="update_plan"\` 为其添加执行计划
- 专注于为当前活动目标制定清晰的执行步骤

**计划设计建议**：
1. 分析目标的具体含义和完成条件
2. 评估当前状态（库存、位置、健康）
3. 用自然语言描述执行步骤，例如：
   - "1. 寻找附近的树木 2. 收集20个橡木原木 3. 制作工作台"
4. 如果目标有Tracker，确保计划能触发Tracker检测
5. 计划应该简洁明了，每个步骤都可用现有动作完成

**注意**：
- 如果已有执行计划且仍然有效，可以不更新
- 如果需要调整计划，使用 \`operation="update_plan"\` 更新
- 每个步骤应该简单明确，避免过于复杂的描述

现在开始你的规划！`,
      '',
      ['current_goal', 'goal_history', 'current_plan', 'inventory', 'position', 'health', 'planning_round', 'max_rounds'],
    ),
  );
}
