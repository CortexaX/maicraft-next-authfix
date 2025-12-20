/**
 * 模板统一导出和初始化
 */

// 导出所有模板初始化函数
export { initBasicInfoTemplate } from './basic_info';
export { initMainThinkingTemplate } from './main_thinking';
export { initChatResponseTemplate } from './chat_response';
export { initChatInitiateTemplate } from './chat_initiate';
export { initTaskEvaluationTemplate } from './task_evaluation';
export { initSystemPromptTemplates } from './system_prompts';
export { initFurnaceOperationTemplate } from './furnace_operation';
export { initChestOperationTemplate } from './chest_operation';
export { initExperienceSummaryTemplate } from './experience_summary';
export { initPlanGenerationTemplate } from './plan_generation';
export { initGoalGenerationTemplate } from './goal_generation';
export { initPlanningSystemTemplate } from './planning_system';
export { initPlanningThinkingTemplate } from './planning_thinking';

// 导入所有模板初始化函数（一次性）
import {
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
  initPlanningSystemTemplate,
  initPlanningThinkingTemplate,
} from './template_initializers';

/**
 * 初始化所有核心模板
 *
 * 对应 maicraft 的 template.py 中的 init_templates()
 */
export function initAllCoreTemplates(): void {
  // 按类别分组初始化，提高可维护性
  try {
    // 基础模板
    initBasicInfoTemplate();
    initMainThinkingTemplate();
    initSystemPromptTemplates();

    // 功能模板
    initTaskEvaluationTemplate();
    initPlanGenerationTemplate();
    initGoalGenerationTemplate();
    initExperienceSummaryTemplate();

    // 规划模板
    initPlanningSystemTemplate();
    initPlanningThinkingTemplate();

    // 交互模板
    initChatResponseTemplate();
    initChatInitiateTemplate();

    // 操作模板
    initFurnaceOperationTemplate();
    initChestOperationTemplate();
  } catch (error) {
    console.error('模板初始化失败:', error);
    throw error;
  }
}
