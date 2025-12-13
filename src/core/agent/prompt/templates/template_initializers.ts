/**
 * 模板初始化函数集中管理
 *
 * 将所有模板初始化函数集中在一个文件中，便于维护
 */

import { initBasicInfoTemplate } from './basic_info';
import { initMainThinkingTemplate } from './main_thinking';
import { initChatResponseTemplate } from './chat_response';
import { initChatInitiateTemplate } from './chat_initiate';
import { initTaskEvaluationTemplate } from './task_evaluation';
import { initSystemPromptTemplates } from './system_prompts';
import { initFurnaceOperationTemplate } from './furnace_operation';
import { initChestOperationTemplate } from './chest_operation';
import { initExperienceSummaryTemplate } from './experience_summary';
import { initPlanGenerationTemplate } from './plan_generation';
import { initGoalGenerationTemplate } from './goal_generation';

// 导出所有初始化函数
export {
  initBasicInfoTemplate,
  initMainThinkingTemplate,
  initChatResponseTemplate,
  initChatInitiateTemplate,
  initTaskEvaluationTemplate,
  initSystemPromptTemplates,
  initFurnaceOperationTemplate,
  initChestOperationTemplate,
  initExperienceSummaryTemplate,
  initPlanGenerationTemplate,
  initGoalGenerationTemplate,
};

