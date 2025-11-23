/**
 * MaiBot 提示词覆盖模板
 *
 * 定义 maicraft-next 发送给 MaiBot 的覆盖提示词模板
 * 每个提示词模板单独定义在对应的文件中
 */

import type { PromptOverrideTemplates } from '../promptOverrideManager';

// 导入所有提示词模板
import { chatTargetGroup1 } from './chatTargetGroup1';
import { chatTargetGroup2 } from './chatTargetGroup2';
import { chatTargetPrivate1 } from './chatTargetPrivate1';
import { chatTargetPrivate2 } from './chatTargetPrivate2';
import { replyerPrompt } from './replyerPrompt';
import { privateReplyerPrompt } from './privateReplyerPrompt';
import { identity } from './identity';
import { getMoodPrompt } from './getMoodPrompt';

/**
 * 默认的 MaiBot 覆盖提示词模板配置
 */
export const defaultOverrideTemplates: PromptOverrideTemplates = {
  groupName: 'maicraft_override',
  templates: {
    [chatTargetGroup1.name]: chatTargetGroup1.content,
    [chatTargetGroup2.name]: chatTargetGroup2.content,
    [chatTargetPrivate1.name]: chatTargetPrivate1.content,
    [chatTargetPrivate2.name]: chatTargetPrivate2.content,
    [replyerPrompt.name]: replyerPrompt.content,
    [privateReplyerPrompt.name]: privateReplyerPrompt.content,
    [identity.name]: identity.content,
    [getMoodPrompt.name]: getMoodPrompt.content,
  },
  descriptions: {
    [chatTargetGroup1.name]: chatTargetGroup1.description,
    [chatTargetGroup2.name]: chatTargetGroup2.description,
    [chatTargetPrivate1.name]: chatTargetPrivate1.description,
    [chatTargetPrivate2.name]: chatTargetPrivate2.description,
    [replyerPrompt.name]: replyerPrompt.description,
    [privateReplyerPrompt.name]: privateReplyerPrompt.description,
    [identity.name]: identity.description,
    [getMoodPrompt.name]: getMoodPrompt.description,
  },
};

/**
 * 获取默认的覆盖模板配置
 */
export function getDefaultOverrideTemplates(): PromptOverrideTemplates {
  return { ...defaultOverrideTemplates };
}

/**
 * 创建自定义的覆盖模板配置
 */
export function createOverrideTemplates(customTemplates: Partial<PromptOverrideTemplates>): PromptOverrideTemplates {
  return {
    groupName: customTemplates.groupName || defaultOverrideTemplates.groupName,
    templates: { ...defaultOverrideTemplates.templates, ...customTemplates.templates },
    descriptions: { ...defaultOverrideTemplates.descriptions, ...customTemplates.descriptions },
  };
}

/**
 * 导出所有单个模板，方便直接使用
 */
export { chatTargetGroup1, chatTargetGroup2, chatTargetPrivate1, chatTargetPrivate2, replyerPrompt, privateReplyerPrompt, identity, getMoodPrompt };
