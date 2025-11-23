/**
 * 提示词覆盖管理器
 *
 * 管理 maicraft-next 发送给 MaiBot 的提示词覆盖功能
 * 类似于 MaiBot 中的覆盖机制，但方向相反：我们主动覆盖 MaiBot 的提示词
 */

import { getLogger, type Logger } from '@/utils/Logger';
import { PromptTemplate } from '@/core/agent/prompt/prompt_manager';

/**
 * 覆盖提示词模板配置
 */
export interface PromptOverrideTemplates {
  /** 要覆盖的提示词模板映射 */
  templates: Record<string, string>;
  /** 覆盖模板的描述信息 */
  descriptions?: Record<string, string>;
  /** 模板组名称 */
  groupName?: string;
}

/**
 * 提示词覆盖管理器
 */
export class PromptOverrideManager {
  private logger: Logger;
  private templates: Map<string, PromptTemplate> = new Map();
  private groupName: string;
  private enabled: boolean = true;

  constructor(templates?: PromptOverrideTemplates, logger?: Logger) {
    this.logger = logger || getLogger('PromptOverrideManager');
    this.groupName = templates?.groupName || 'maicraft_override';

    if (templates) {
      this.initializeTemplates(templates);
    }
  }

  /**
   * 初始化覆盖模板
   */
  private initializeTemplates(templates: PromptOverrideTemplates): void {
    this.logger.info('初始化提示词覆盖模板', {
      groupName: this.groupName,
      templateCount: Object.keys(templates.templates).length,
    });

    // 注册覆盖的模板
    for (const [templateName, templateContent] of Object.entries(templates.templates)) {
      const description = templates.descriptions?.[templateName] || `覆盖模板: ${templateName}`;
      const template = new PromptTemplate(templateName, templateContent, description);
      this.templates.set(templateName, template);
      this.logger.debug(`注册覆盖模板: ${templateName}`);
    }
  }

  /**
   * 获取覆盖模板
   */
  getTemplate(name: string): PromptTemplate | undefined {
    return this.templates.get(name);
  }

  /**
   * 获取所有覆盖模板
   */
  getAllTemplates(): Array<{ name: string; description: string }> {
    return Array.from(this.templates.values()).map(t => ({
      name: t.name,
      description: t.description,
    }));
  }

  /**
   * 生成用于发送给 MaiBot 的 TemplateInfo
   * 符合 MaiBot 期望的消息格式
   */
  generateTemplateInfo(): any {
    if (!this.enabled || this.templates.size === 0) {
      return undefined;
    }

    // 构建 template_items，包含所有覆盖的模板内容
    const templateItems: Record<string, string> = {};
    const templateName: Record<string, string> = {};

    for (const [name, template] of this.templates) {
      templateItems[name] = template.template;
      templateName[name] = template.description;
    }

    // 构建 TemplateInfo 对象
    // 注意：这里返回的是符合 MaiBot 期望的格式，不是我们的 TemplateInfo 类
    return {
      template_items: templateItems,
      template_name: templateName,
      template_default: false, // 标记为非默认模板，启用覆盖机制
    };
  }

  /**
   * 检查是否有可用的覆盖模板
   */
  hasTemplates(): boolean {
    return this.enabled && this.templates.size > 0;
  }

  /**
   * 注册新的覆盖模板
   */
  registerTemplate(name: string, template: string, description?: string): boolean {
    if (!this.enabled) {
      this.logger.warn('提示词覆盖功能未启用，无法注册模板');
      return false;
    }

    try {
      const promptTemplate = new PromptTemplate(name, template, description || `覆盖模板: ${name}`);
      this.templates.set(name, promptTemplate);

      this.logger.info(`成功注册覆盖模板: ${name}`);
      return true;
    } catch (error) {
      this.logger.error(`注册覆盖模板失败: ${name}`, undefined, error as Error);
      return false;
    }
  }

  /**
   * 移除覆盖模板
   */
  removeTemplate(name: string): boolean {
    if (!this.templates.has(name)) {
      return false;
    }

    this.templates.delete(name);
    this.logger.info(`移除覆盖模板: ${name}`);
    return true;
  }

  /**
   * 设置启用状态
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.logger.info(`提示词覆盖功能已${enabled ? '启用' : '禁用'}`);
  }

  /**
   * 获取启用状态
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * 全局提示词覆盖管理器实例
 */
let globalPromptOverrideManager: PromptOverrideManager | null = null;

/**
 * 创建或获取全局提示词覆盖管理器
 */
export function createPromptOverrideManager(templates?: PromptOverrideTemplates, logger?: Logger): PromptOverrideManager {
  if (globalPromptOverrideManager) {
    // 如果已存在，可以选择更新或返回现有实例
    return globalPromptOverrideManager;
  }

  globalPromptOverrideManager = new PromptOverrideManager(templates, logger);
  return globalPromptOverrideManager;
}

/**
 * 获取全局提示词覆盖管理器
 */
export function getPromptOverrideManager(): PromptOverrideManager | null {
  return globalPromptOverrideManager;
}
