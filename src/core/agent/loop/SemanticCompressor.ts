/**
 * SemanticCompressor - 语义化历史压缩器
 *
 * 异步调用 LLM 将多轮对话历史压缩为语义摘要，
 * 合并到 user 消息中，大幅减少 token 消耗。
 *
 * 架构：
 * - 主循环继续运行，不阻塞
 * - 后台异步压缩
 * - 压缩完成后更新摘要，清空历史
 */

import type { ToolCall } from '@/llm/types';
import { Logger, getLogger } from '@/utils/Logger';

/**
 * 历史消息格式
 */
export interface HistoryEntry {
  role: 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * 压缩结果
 */
export interface CompressionResult {
  summary: string;
  compressedCount: number;
  timestamp: Date;
}

/**
 * 压缩器配置
 */
export interface SemanticCompressorConfig {
  /** 触发压缩的历史条数阈值 */
  compressThreshold: number;
  /** 压缩后保留的最近轮数 */
  keepRecentTurns: number;
  /** 压缩提示词 */
  compressionPrompt: string;
  /** 是否启用压缩 */
  enabled: boolean;
}

/**
 * 上下文提供器 - 提供当前游戏状态
 */
export type ContextProvider = () => {
  goal?: string;
  plan?: string;
  inventory?: string;
  position?: string;
};

const DEFAULT_CONFIG: SemanticCompressorConfig = {
  compressThreshold: 6, // 6 条消息（3 轮）后触发压缩
  keepRecentTurns: 1, // 保留最近 1 轮（2 条消息）
  enabled: true,
  compressionPrompt: `你是一个 Minecraft Bot 的行为总结助手。

## 任务
将 Bot 的行动历史总结为**一段自然语言描述**，而非行动列表。

## 上下文
当前目标：{goal}
当前计划：{plan}
物品栏状态：{inventory}
当前位置：{position}

## 行动历史
{history}

## 总结要求
1. **识别行动模式**：如"寻找→移动→挖掘"表示正在收集资源
2. **合并重复行动**：多次相同操作只提一次，说明总次数
3. **关注进度**：如"已收集 23/64 个橡木"
4. **关注问题**：如"多次挖掘失败，可能需要换位置"
5. **自然语言**：写成一段话，不是列表
6. **简洁**：控制在 2-3 句话

## 示例输出
正在收集橡木原木，已获得 23 个（目标 64 个）。尝试挖掘时多次遇到"目标不可见"问题，已调整位置继续。最近成功挖掘了 2 个方块。`,
};

export type LLMCaller = (prompt: string, systemPrompt?: string) => Promise<string>;

export class SemanticCompressor {
  private logger: Logger;
  private config: SemanticCompressorConfig;
  private llmCaller: LLMCaller;
  private contextProvider?: ContextProvider;

  private currentSummary: string = '';

  private pendingHistory: HistoryEntry[] = [];

  private isCompressing: boolean = false;

  private stats = {
    totalCompressions: 0,
    totalMessagesCompressed: 0,
    lastCompressionTime: null as Date | null,
  };

  constructor(llmCaller: LLMCaller, config?: Partial<SemanticCompressorConfig>, contextProvider?: ContextProvider) {
    this.logger = getLogger('SemanticCompressor');
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llmCaller = llmCaller;
    this.contextProvider = contextProvider;

    this.logger.info('语义压缩器初始化', {
      threshold: this.config.compressThreshold,
      keepRecent: this.config.keepRecentTurns,
      enabled: this.config.enabled,
    });
  }

  setContextProvider(provider: ContextProvider): void {
    this.contextProvider = provider;
  }

  /**
   * 添加历史条目
   * 如果达到阈值，触发异步压缩
   */
  addEntry(entry: HistoryEntry): void {
    if (!this.config.enabled) return;

    this.pendingHistory.push(entry);

    // 检查是否需要压缩
    if (this.pendingHistory.length >= this.config.compressThreshold && !this.isCompressing) {
      this.triggerCompression();
    }
  }

  /**
   * 批量添加历史条目
   */
  addEntries(entries: HistoryEntry[]): void {
    if (!this.config.enabled) return;

    this.pendingHistory.push(...entries);

    if (this.pendingHistory.length >= this.config.compressThreshold && !this.isCompressing) {
      this.triggerCompression();
    }
  }

  /**
   * 获取当前摘要（用于构建 user prompt）
   */
  getSummary(): string {
    return this.currentSummary;
  }

  /**
   * 获取压缩后应保留的历史条目
   * （最近的几轮，避免压缩过程中的上下文丢失）
   */
  getRetainedHistory(): HistoryEntry[] {
    const keepCount = this.config.keepRecentTurns * 2;
    if (this.pendingHistory.length <= keepCount) {
      return [...this.pendingHistory];
    }
    return this.pendingHistory.slice(-keepCount);
  }

  /**
   * 触发异步压缩
   */
  private triggerCompression(): void {
    if (this.isCompressing) return;

    // 保留最近的条目不压缩
    const keepCount = this.config.keepRecentTurns * 2;
    if (this.pendingHistory.length <= keepCount) return;

    const toCompress = this.pendingHistory.slice(0, -keepCount);
    if (toCompress.length === 0) return;

    this.isCompressing = true;

    // 异步执行压缩
    this.compressAsync(toCompress)
      .then(result => {
        if (result) {
          // 更新摘要
          if (this.currentSummary) {
            this.currentSummary = this.currentSummary + '\n' + result.summary;
          } else {
            this.currentSummary = result.summary;
          }

          // 清理已压缩的历史
          this.pendingHistory = this.pendingHistory.slice(-keepCount);

          // 更新统计
          this.stats.totalCompressions++;
          this.stats.totalMessagesCompressed += result.compressedCount;
          this.stats.lastCompressionTime = new Date();

          this.logger.info('✅ 历史压缩完成', {
            compressedCount: result.compressedCount,
            summaryLength: result.summary.length,
            remainingHistory: this.pendingHistory.length,
          });
        }
      })
      .catch((error: unknown) => {
        this.logger.error('历史压缩失败', undefined, error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        this.isCompressing = false;
      });
  }

  /**
   * 异步压缩历史
   */
  private async compressAsync(history: HistoryEntry[]): Promise<CompressionResult | null> {
    try {
      const historyText = this.formatHistoryForLLM(history);

      // 获取上下文信息
      const ctx = this.contextProvider?.() ?? {};
      const goal = ctx.goal ?? '无';
      const plan = ctx.plan ?? '无';
      const inventory = ctx.inventory ?? '未知';
      const position = ctx.position ?? '未知';

      // 填充模板
      const prompt = this.config.compressionPrompt
        .replace('{goal}', goal)
        .replace('{plan}', plan)
        .replace('{inventory}', inventory)
        .replace('{position}', position)
        .replace('{history}', historyText);

      this.logger.debug('开始 LLM 语义压缩', {
        historyCount: history.length,
        historyLength: historyText.length,
        hasContext: !!this.contextProvider,
      });

      const summary = await this.llmCaller(prompt, '你是一个游戏行为分析助手，擅长识别行动模式并给出简洁的总结。');

      return {
        summary: summary.trim(),
        compressedCount: history.length,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error('LLM 压缩调用失败', undefined, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * 格式化历史为 LLM 可读的文本
   */
  private formatHistoryForLLM(history: HistoryEntry[]): string {
    const lines: string[] = [];

    for (const entry of history) {
      if (entry.role === 'assistant') {
        if (entry.tool_calls && entry.tool_calls.length > 0) {
          for (const tc of entry.tool_calls) {
            const args = this.formatArgs(tc.function.arguments);
            lines.push(`[调用] ${tc.function.name}(${args})`);
          }
        }
      } else if (entry.role === 'tool') {
        lines.push(`[结果] ${entry.name}: ${this.formatToolResult(entry.content)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 格式化工具参数
   */
  private formatArgs(argsStr: string): string {
    try {
      const args = JSON.parse(argsStr);
      const parts: string[] = [];
      for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string') {
          parts.push(`${key}="${value}"`);
        } else {
          parts.push(`${key}=${value}`);
        }
      }
      return parts.join(', ');
    } catch {
      return argsStr.slice(0, 50);
    }
  }

  /**
   * 格式化工具结果
   */
  private formatToolResult(content: string): string {
    try {
      const result = JSON.parse(content);
      if (result.success) {
        return result.message || '成功';
      } else {
        return result.error || result.message || '失败';
      }
    } catch {
      return content.slice(0, 100);
    }
  }

  /**
   * 强制立即压缩（用于关键时刻，如任务完成）
   */
  async forceCompress(): Promise<void> {
    if (this.pendingHistory.length === 0) return;

    const toCompress = [...this.pendingHistory];
    this.pendingHistory = [];

    const result = await this.compressAsync(toCompress);
    if (result) {
      if (this.currentSummary) {
        this.currentSummary = this.currentSummary + '\n' + result.summary;
      } else {
        this.currentSummary = result.summary;
      }

      this.stats.totalCompressions++;
      this.stats.totalMessagesCompressed += result.compressedCount;
      this.stats.lastCompressionTime = new Date();
    }
  }

  /**
   * 清空所有历史和摘要
   */
  reset(): void {
    this.currentSummary = '';
    this.pendingHistory = [];
    this.isCompressing = false;
    this.logger.info('历史压缩器已重置');
  }

  /**
   * 获取压缩统计
   */
  getStats() {
    return {
      ...this.stats,
      currentSummaryLength: this.currentSummary.length,
      pendingHistoryCount: this.pendingHistory.length,
      isCompressing: this.isCompressing,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SemanticCompressorConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('压缩器配置已更新', config);
  }
}
