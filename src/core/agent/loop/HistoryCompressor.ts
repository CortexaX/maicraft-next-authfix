/**
 * HistoryCompressor - 消息历史压缩器
 *
 * 通过程序化方式压缩 LLM 对话历史：
 * 1. 精简 tool 结果内容（只保留关键信息）
 * 2. 合并同一轮的多个 tool 结果为一条消息
 *
 * 目标：减少 token 消耗，同时保留足够的上下文信息
 */

import type { ToolCall } from '@/llm/types';

/**
 * 历史消息格式
 */
export interface CompressedMessage {
  role: 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * 原始历史消息格式
 */
export interface HistoryMessage {
  role: 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * 工具结果数据结构
 */
interface ToolResult {
  success: boolean;
  message?: string;
  data?: Record<string, any>;
  error?: string;
}

export class HistoryCompressor {
  /**
   * 压缩历史消息
   *
   * 策略：
   * 1. 保留 assistant 消息（包含 tool_calls）
   * 2. 将同一轮的多个 tool 结果合并为一条精简消息
   */
  compress(history: HistoryMessage[]): CompressedMessage[] {
    if (history.length === 0) return [];

    const result: CompressedMessage[] = [];

    for (let i = 0; i < history.length; i++) {
      const msg = history[i];

      if (msg.role === 'assistant') {
        // 保留 assistant 消息
        result.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.tool_calls,
        });

        // 收集后续所有连续的 tool 结果
        const toolSummaries: string[] = [];
        const toolCallIds: string[] = [];

        while (i + 1 < history.length && history[i + 1].role === 'tool') {
          const toolMsg = history[++i];
          const summary = this.summarizeToolResult(toolMsg.name || 'unknown', toolMsg.content);
          toolSummaries.push(summary);
          if (toolMsg.tool_call_id) {
            toolCallIds.push(toolMsg.tool_call_id);
          }
        }

        // 合并为一条 tool 消息
        if (toolSummaries.length > 0) {
          result.push({
            role: 'tool',
            tool_call_id: toolCallIds.join(','),
            name: toolSummaries.length > 1 ? 'multi_result' : 'result',
            content: toolSummaries.join('\n'),
          });
        }
      }
    }

    return result;
  }

  /**
   * 摘要单个工具结果
   */
  private summarizeToolResult(toolName: string, content: string): string {
    let result: ToolResult;

    try {
      result = JSON.parse(content);
    } catch {
      // 解析失败，返回截断的原始内容
      return this.formatUnknown(toolName, content);
    }

    const icon = result.success ? '✅' : '❌';
    const brief = this.getBriefSummary(toolName, result);

    return `${icon} ${toolName}: ${brief}`;
  }

  /**
   * 根据工具类型生成简洁摘要
   */
  private getBriefSummary(toolName: string, result: ToolResult): string {
    const data = result.data || {};

    // 失败情况：返回错误信息（截断）
    if (!result.success) {
      const errorMsg = result.error || result.message || '失败';
      return this.truncate(errorMsg, 40);
    }

    // 根据工具类型生成摘要
    switch (toolName) {
      // 移动类
      case 'move':
      case 'move_to_block':
      case 'move_to_entity':
      case 'move_to_location':
        return this.summarizeMove(data);

      // 查找类
      case 'find_block':
        return this.summarizeFindBlock(data);

      // 挖掘类
      case 'mine_by_type':
      case 'mine_at_position':
      case 'mine_in_direction':
        return this.summarizeMine(data);

      // 放置
      case 'place_block':
        return this.summarizePlaceBlock(data);

      // 合成
      case 'craft':
        return this.summarizeCraft(data);

      // 容器操作
      case 'use_chest':
      case 'use_furnace':
      case 'query_container':
      case 'manage_container':
      case 'interact_chest':
      case 'interact_furnace':
        return this.summarizeContainer(data);

      // GUI 触发器
      case 'open_chest_gui':
      case 'open_furnace_gui':
        return '已打开GUI';

      // 生存
      case 'eat':
        return this.summarizeEat(data);
      case 'toss_item':
        return this.summarizeToss(data);
      case 'kill_mob':
        return this.summarizeKillMob(data);
      case 'swim_to_land':
        return this.summarizeSwim(data);

      // 地标和聊天
      case 'set_location':
        return this.summarizeSetLocation(data);
      case 'chat':
        return this.summarizeChat(data);

      // 规划
      case 'plan_action':
        return this.summarizePlan(data);

      default:
        return this.truncate(result.message || '完成', 40);
    }
  }

  // ============ 各工具类型的摘要方法 ============

  private summarizeMove(data: any): string {
    if (data.position) {
      const pos = data.position;
      return `到达(${pos.x?.toFixed?.(0) ?? pos.x},${pos.y?.toFixed?.(0) ?? pos.y},${pos.z?.toFixed?.(0) ?? pos.z})`;
    }
    if (data.targetPosition) {
      const pos = data.targetPosition;
      return `移动到(${pos.x?.toFixed?.(0) ?? pos.x},${pos.y?.toFixed?.(0) ?? pos.y},${pos.z?.toFixed?.(0) ?? pos.z})`;
    }
    return '移动完成';
  }

  private summarizeFindBlock(data: any): string {
    if (data.blocks && data.blocks.length > 0) {
      const count = data.blocks.length;
      const blockType = data.blockType || '方块';
      const nearest = data.blocks[0];
      const dist = nearest.distance?.toFixed?.(1) ?? '?';
      return `找到${count}个${blockType},最近${dist}格`;
    }
    return '未找到方块';
  }

  private summarizeMine(data: any): string {
    if (data.minedCount !== undefined) {
      const blockType = data.blockType || '方块';
      return `挖掘${data.minedCount}/${data.totalCount || 1}个${blockType}`;
    }
    if (data.blockType) {
      return `挖掘${data.blockType}完成`;
    }
    return '挖掘完成';
  }

  private summarizePlaceBlock(data: any): string {
    if (data.position) {
      const pos = data.position;
      return `放置在(${pos.x},${pos.y},${pos.z})`;
    }
    return '放置完成';
  }

  private summarizeCraft(data: any): string {
    if (data.item && data.count) {
      return `合成${data.count}个${data.item}`;
    }
    return '合成完成';
  }

  private summarizeContainer(data: any): string {
    if (data.operation) {
      return `${data.operation}${data.item ? data.item : ''}`;
    }
    return '容器操作完成';
  }

  private summarizeEat(data: any): string {
    if (data.food) {
      return `吃${data.food}`;
    }
    return '进食完成';
  }

  private summarizeToss(data: any): string {
    if (data.item && data.count) {
      return `丢弃${data.count}个${data.item}`;
    }
    return '丢弃完成';
  }

  private summarizeKillMob(data: any): string {
    if (data.mobType) {
      return `击杀${data.mobType}`;
    }
    return '击杀完成';
  }

  private summarizeSwim(data: any): string {
    if (data.landedPosition) {
      const pos = data.landedPosition;
      return `上岸(${pos.x?.toFixed?.(0) ?? pos.x},${pos.y?.toFixed?.(0) ?? pos.y},${pos.z?.toFixed?.(0) ?? pos.z})`;
    }
    return '已上岸';
  }

  private summarizeSetLocation(data: any): string {
    if (data.name) {
      return `设置地标"${data.name}"`;
    }
    return '地标设置完成';
  }

  private summarizeChat(data: any): string {
    if (data.message) {
      return this.truncate(`说:${data.message}`, 30);
    }
    return '发送消息';
  }

  private summarizePlan(data: any): string {
    if (data.operation) {
      return `规划:${data.operation}`;
    }
    return '更新计划';
  }

  // ============ 辅助方法 ============

  private formatUnknown(toolName: string, content: string): string {
    return `❓ ${toolName}: ${this.truncate(content, 30)}`;
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
}
