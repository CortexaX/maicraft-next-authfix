/**
 * 通信模块导出
 */

export { MaiBotClient } from './MaiBotClient';
export type { MemoryMessage } from './MaiBotClient';

// 提示词覆盖系统
export { PromptOverrideManager, PromptOverrideTemplates, createPromptOverrideManager, getPromptOverrideManager } from './promptOverrideManager';
export { getDefaultOverrideTemplates, createOverrideTemplates } from './templates/overrideTemplates';
