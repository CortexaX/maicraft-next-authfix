import * as fs from 'fs/promises';
import * as path from 'path';
import { getLogger, type Logger } from '@/utils/Logger';

export interface LLMHistoryEntry {
  timestamp: string;
  loopCount: number;
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
  }>;
  toolCalls?: any[];
  toolResults?: Array<{
    toolCallId: string;
    name: string;
    success: boolean;
    result: any;
  }>;
}

export class LLMHistoryLogger {
  private logger: Logger;
  private historyDir: string;
  private sessionFile: string;
  private isEnabled: boolean = true;

  constructor(dataDir: string = 'data') {
    this.logger = getLogger('LLMHistoryLogger');
    this.historyDir = path.join(dataDir, 'llm_history');
    this.sessionFile = path.join(this.historyDir, 'latest.json');
    this.ensureDirectory();
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.historyDir, { recursive: true });
    } catch (error) {
      this.logger.error('创建历史目录失败', undefined, error as Error);
    }
  }

  async logLLMCall(
    loopCount: number,
    messages: Array<{
      role: string;
      content: string;
      tool_calls?: any[];
      tool_call_id?: string;
      name?: string;
    }>,
    toolCalls?: any[],
    toolResults?: Array<{ toolCallId: string; name: string; success: boolean; result: any }>,
  ): Promise<void> {
    if (!this.isEnabled) return;

    const entry: LLMHistoryEntry = {
      timestamp: new Date().toISOString(),
      loopCount,
      messages: this.sanitizeMessages(messages),
      toolCalls,
      toolResults,
    };

    try {
      await fs.writeFile(this.sessionFile, JSON.stringify(entry, null, 2), 'utf-8');
    } catch (error) {
      this.logger.error('保存 LLM 历史失败', undefined, error as Error);
    }
  }

  private sanitizeMessages(
    messages: Array<{
      role: string;
      content: string;
      tool_calls?: any[];
      tool_call_id?: string;
      name?: string;
    }>,
  ): Array<{
    role: string;
    content: string;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
  }> {
    return messages.map(msg => ({
      ...msg,
      content: msg.content.length > 2000 ? msg.content.substring(0, 2000) + '...[截断]' : msg.content,
    }));
  }

  getSessionFile(): string {
    return this.sessionFile;
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }
}
