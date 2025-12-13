/**
 * Prompt Manager - 智能提示词模板管理器
 *
 * 完全照搬原版 maicraft 的实现，提供模板注册、参数格式化和提示词生成功能
 */

import { getLogger, type Logger } from '@/utils/Logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 提示词模板类
 *
 * 对应 maicraft 的 PromptTemplate
 */
export class PromptTemplate {
  name: string;
  template: string;
  description: string;
  parameters: string[];

  constructor(name: string, template: string, description: string = '', parameters: string[] = []) {
    this.name = name;
    this.template = template;
    this.description = description;
    this.parameters = parameters.length > 0 ? parameters : this.extractParameters();
  }

  /**
   * 从模板中提取参数名
   *
   * 对应 Python 的 _extract_parameters()
   */
  private extractParameters(): string[] {
    // 匹配 {param} 或 {param:format} 格式
    const paramPattern = /\{([^}:]+)(?::[^}]+)?\}/g;
    const params = new Set<string>();
    let match;

    while ((match = paramPattern.exec(this.template)) !== null) {
      params.add(match[1]);
    }

    return Array.from(params);
  }

  /**
   * 验证提供的参数是否完整
   *
   * 对应 Python 的 validate_parameters()
   */
  validateParameters(params: Record<string, any>): string[] {
    const missingParams: string[] = [];

    for (const param of this.parameters) {
      if (!(param in params)) {
        missingParams.push(param);
      }
    }

    return missingParams;
  }

  /**
   * 格式化模板
   *
   * 对应 Python 的 format(**kwargs)
   */
  format(params: Record<string, any>): string {
    try {
      let result = this.template;

      // 替换所有 {param} 格式的占位符
      for (const [key, value] of Object.entries(params)) {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        result = result.replace(regex, String(value ?? ''));
      }

      return result;
    } catch (error) {
      throw new Error(`模板格式化失败: ${error}`);
    }
  }
}

/**
 * 提示词管理器
 *
 * 对应 maicraft 的 PromptManager
 */
export class PromptManager {
  private templates: Map<string, PromptTemplate> = new Map();
  private logger: Logger;
  private enablePromptOutput: boolean = true;

  constructor(logger?: Logger, enablePromptOutput: boolean = true) {
    this.logger = logger || getLogger('PromptManager');
    this.enablePromptOutput = enablePromptOutput;
  }

  /**
   * 注册新模板
   *
   * 对应 Python 的 register_template()
   */
  registerTemplate(template: PromptTemplate): boolean {
    try {
      if (this.templates.has(template.name)) {
        this.logger.warn(`模板 '${template.name}' 已存在，将被覆盖`);
      }

      this.templates.set(template.name, template);
      this.logger.info(`成功注册模板: ${template.name}`);
      return true;
    } catch (error) {
      this.logger.error(`注册模板失败`, undefined, error as Error);
      return false;
    }
  }

  /**
   * 从字符串注册模板
   *
   * 对应 Python 的 register_template_from_string()
   */
  registerTemplateFromString(name: string, templateStr: string, description: string = ''): boolean {
    try {
      const template = new PromptTemplate(name, templateStr, description);
      return this.registerTemplate(template);
    } catch (error) {
      this.logger.error(`从字符串注册模板失败`, undefined, error as Error);
      return false;
    }
  }

  /**
   * 获取指定名称的模板
   *
   * 对应 Python 的 get_template()
   */
  getTemplate(name: string): PromptTemplate | undefined {
    return this.templates.get(name);
  }

  /**
   * 根据模板名称和参数生成提示词（支持1-2层嵌套模板引用）
   *
   * 简化版本：
   * - 只支持1-2层嵌套，符合实际使用需求
   * - 简化的循环引用检测
   * - 减少不必要的日志和验证
   */
  generatePrompt(templateName: string, params: Record<string, any>, visitedTemplates: Set<string> = new Set()): string {
    const template = this.getTemplate(templateName);

    if (!template) {
      throw new Error(`模板 '${templateName}' 不存在`);
    }

    // 简化的循环引用检测（最多10层）
    if (visitedTemplates.size > 10) {
      const path = Array.from(visitedTemplates).join(' -> ');
      throw new Error(`嵌套层次过深，可能存在循环引用: ${path} -> ${templateName}`);
    }

    // 标记当前模板为已访问
    const newVisited = new Set(visitedTemplates);
    newVisited.add(templateName);

    try {
      const result = this.formatTemplate(template, params, newVisited);
      this.logger.debug(`成功生成提示词，模板: ${templateName}`);

      // 将提示词输出到文件
      if (this.enablePromptOutput) {
        this.savePromptToFile(templateName, result);
      }

      return result;
    } catch (error) {
      this.logger.error(`生成提示词失败`, undefined, error as Error);
      throw error;
    }
  }

  /**
   * 格式化模板，支持嵌套模板自动替换（简化版）
   */
  private formatTemplate(template: PromptTemplate, params: Record<string, any>, visitedTemplates: Set<string>): string {
    let result = template.template;

    // 提取所有 {param} 占位符
    const paramPattern = /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)(?::[^}]+)?\}(?!\})/g;
    const placeholders = new Set<string>();
    let match;

    while ((match = paramPattern.exec(template.template)) !== null) {
      placeholders.add(match[1]);
    }

    // 处理每个占位符
    for (const placeholder of placeholders) {
      let value: string;

      // 检查参数是否存在且有值（空字符串也算有值）
      const paramValue = params[placeholder];
      const paramExists = placeholder in params;
      const hasNonEmptyValue = paramValue !== undefined && paramValue !== null && paramValue !== '';
      const hasTemplate = this.templates.has(placeholder);

      if (hasTemplate) {
        // 优先使用同名模板
        if (hasNonEmptyValue) {
          // 存在同名模板但用户也提供了非空值，这是冲突
          this.logger.warn(`参数 '${placeholder}' 的值被忽略，因为存在同名模板，建议从参数中移除该字段`);
        }
        try {
          value = this.generatePrompt(placeholder, params, visitedTemplates);
        } catch (error) {
          throw new Error(`无法生成嵌套模板 '${placeholder}': ${error instanceof Error ? error.message : error}`);
        }
      } else if (paramExists) {
        // 没有同名模板，使用参数值
        value = String(paramValue ?? '');
      } else {
        // 既没有同名模板，也没有提供参数
        throw new Error(`缺少必需参数: ${placeholder}`);
      }

      // 替换所有该占位符（避免替换 {{ 和 }} 包围的内容）
      const regex = new RegExp(`(?<!\\{)\\{${placeholder}\\}(?!\\})`, 'g');
      result = result.replace(regex, value);
    }

    return result;
  }

  /**
   * 将提示词保存到文件
   * @param templateName 模板名称
   * @param promptContent 提示词内容
   */
  private savePromptToFile(templateName: string, promptContent: string): void {
    try {
      // 创建data/prompts目录（如果不存在）
      const promptsDir = path.join(process.cwd(), 'data', 'prompts');
      if (!fs.existsSync(promptsDir)) {
        fs.mkdirSync(promptsDir, { recursive: true });
      }

      // 生成文件名，将_替换为-以提高可读性
      const fileName = `${templateName.replace(/_/g, '-')}.txt`;
      const filePath = path.join(promptsDir, fileName);

      // 覆盖写入文件（每次都是覆盖而不是追加）
      fs.writeFileSync(filePath, promptContent, 'utf8');

      this.logger.debug(`💾 提示词已保存到文件: ${filePath}`);
    } catch (error) {
      this.logger.error(`❌ 保存提示词文件失败: ${templateName}`, undefined, error as Error);
    }
  }

  /**
   * 列出所有模板
   */
  listTemplates(): Array<{ name: string; description: string }> {
    return Array.from(this.templates.values()).map(t => ({
      name: t.name,
      description: t.description,
    }));
  }
}

/**
 * 全局单例 prompt_manager
 * 对应 Python 的 prompt_manager = PromptManager()
 */
export const promptManager = new PromptManager(undefined, true);

/**
 * 创建提示词管理器的便捷函数
 * 对应 Python 的 create_prompt_manager()
 */
export function createPromptManager(logger?: Logger): PromptManager {
  return new PromptManager(logger);
}

/**
 * 快速生成提示词（无需注册模板）
 * 对应 Python 的 quick_generate()
 */
export function quickGenerate(templateStr: string, params: Record<string, any>): string {
  const template = new PromptTemplate('quick', templateStr);
  return template.format(params);
}
