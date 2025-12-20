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

你需要为以下目标制定具体的任务计划：

**当前目标**：
{current_goal}

## 当前状态

**已有任务**：
{task_list}

**库存物品**：
{inventory}

**当前位置**：{position}

**健康状态**：❤️ {health}/20

**规划进度**：第 {planning_round}/{max_rounds} 轮

---

## 你的任务

请分析当前目标，并使用\`plan_action\`动作来创建具体的任务。

**注意**：
1. 如果已有任务列表不为空，请评估现有任务是否足够完成目标
2. 如果现有任务已经足够，可以不创建新任务（或只做微调）
3. 如果需要补充任务，请创建具体、可执行的任务
4. 每个任务应该尽可能简单，理想情况下用一个动作就能完成
5. 务必为任务设置合适的Tracker，以便自动检测完成

**思考步骤**：
1. 分析目标的具体含义和完成条件
2. 评估当前状态（库存、位置、健康）
3. 判断已有任务是否足够
4. 如果需要，创建新的任务并设置Tracker
5. 说明任务的优先级和依赖关系

现在开始你的规划！`,
      ['current_goal', 'task_list', 'inventory', 'position', 'health', 'planning_round', 'max_rounds'],
    ),
  );
}
