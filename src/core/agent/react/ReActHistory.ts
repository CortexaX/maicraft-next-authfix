// src/core/agent/react/ReActHistory.ts

import type { StructuredAction } from '@/core/agent/structured/ActionSchema';
import type { ReActEntry } from './types';

/**
 * ReAct 历史记录
 * 短期工作记忆，存储最近的 Thought-Action-Observation 三元组
 */
export class ReActHistory {
  private entries: ReActEntry[] = [];
  private maxEntries: number = 10;

  /**
   * 添加一条历史记录
   */
  add(entry: ReActEntry): void {
    this.entries.push({
      ...entry,
      timestamp: Date.now(),
    });

    // 保持历史在限制内
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /**
   * 获取格式化的历史记录（用于提示词）
   */
  getFormattedHistory(): string {
    if (this.entries.length === 0) {
      return '暂无历史记录';
    }

    return this.entries.map((entry, i) => {
      const lines = [
        `### 步骤 ${i + 1}`,
        `**思考**: ${entry.thought}`,
        `**动作**: ${entry.action.action_type}`,
        `**观察**: ${entry.observation}`,
      ];
      return lines.join('\n');
    }).join('\n\n');
  }

  /**
   * 获取最近的 N 条记录
   */
  getRecent(n: number): ReActEntry[] {
    return this.entries.slice(-n);
  }

  /**
   * 清空历史
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * 获取历史条目数量
   */
  get length(): number {
    return this.entries.length;
  }
}
