/**
 * AgentLoop - ReAct 核心循环
 *
 * 使用 Function Calling 实现 ReAct 模式
 * 动态状态通过每轮新的 user prompt 注入，历史只保留对话链
 */

import { BaseLoop } from './BaseLoop';
import type { AgentState } from '@/core/agent/types';
import { LLMManager } from '@/llm/LLMManager';
import { ToolRegistry } from '@/core/agent/tool/ToolRegistry';
import { InterruptManager, CancellationError } from '@/core/interrupt';
import { ContextBuilder } from './ContextBuilder';
import { LLMHistoryLogger } from './LLMHistoryLogger';
import { HistoryCompressor } from './HistoryCompressor';
import { SemanticCompressor, type HistoryEntry } from './SemanticCompressor';
import type { ToolCall } from '@/llm/types';

interface HistoryMessage {
  role: 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export class AgentLoop extends BaseLoop<AgentState> {
  private llmManager: LLMManager;
  private toolRegistry: ToolRegistry;
  private interruptManager: InterruptManager;
  private contextBuilder: ContextBuilder;
  private historyLogger: LLMHistoryLogger;
  private historyCompressor: HistoryCompressor;
  private semanticCompressor: SemanticCompressor;
  private loopCount: number = 0;
  private conversationHistory: HistoryMessage[] = [];
  private maxHistoryTurns: number = 10;
  private useSemanticCompression: boolean = true;

  constructor(state: AgentState, llmManager: LLMManager, toolRegistry: ToolRegistry, interruptManager: InterruptManager) {
    super(state, 'AgentLoop');
    this.llmManager = llmManager;
    this.toolRegistry = toolRegistry;
    this.interruptManager = interruptManager;
    this.contextBuilder = new ContextBuilder(state);
    this.historyLogger = new LLMHistoryLogger('data');
    this.historyCompressor = new HistoryCompressor();

    // 创建语义压缩器，使用 LLM 的 simpleChat 方法
    const llmCaller = async (prompt: string, systemPrompt?: string) => {
      return this.llmManager.simpleChat(prompt, systemPrompt);
    };

    // 上下文提供器：获取当前游戏状态
    const contextProvider = () => {
      const gameState = this.state.context.gameState;
      const goalManager = this.state.context.goalManager;
      const currentGoal = goalManager?.getCurrentGoal();

      return {
        goal: currentGoal?.content ?? '无目标',
        plan: currentGoal?.plan ?? '无计划',
        inventory: `物品栏: ${
          gameState.inventory
            ?.slice(0, 5)
            .map((i: any) => `${i.name}x${i.count}`)
            .join(', ') ?? '空'
        }...`,
        position: `(${gameState.blockPosition?.x ?? '?'}, ${gameState.blockPosition?.y ?? '?'}, ${gameState.blockPosition?.z ?? '?'})`,
      };
    };

    this.semanticCompressor = new SemanticCompressor(
      llmCaller,
      {
        compressThreshold: 8, // 8 条消息（4 轮）后触发压缩
        keepRecentTurns: 2, // 保留最近 2 轮（4 条消息）
      },
      contextProvider,
    );

    this.logger.info(`LLM 历史将保存到: ${this.historyLogger.getSessionFile()}`);
    this.logger.info('语义压缩器已启用', { useSemanticCompression: this.useSemanticCompression });
  }

  protected async runLoopIteration(): Promise<void> {
    this.loopCount++;

    const handler = this.interruptManager.detect();
    if (handler) {
      this.logger.info(`检测到中断: ${handler.name}`);
      await this.interruptManager.handleInterrupt(handler);
      return;
    }

    const signal = this.interruptManager.beginScope();
    this.state.context.signal = signal;

    await this.checkGoalAndTaskCompletion();

    let messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [];
    const toolResults: Array<{ toolCallId: string; name: string; success: boolean; result: any }> = [];

    try {
      const context = this.contextBuilder.buildContext();
      const toolSchemas = this.toolRegistry.getAvailableToolSchemas();

      this.logger.info(`🔧 调用 LLM，可用工具: ${toolSchemas.length} 个`);

      messages = this.buildMessages(context.systemPrompt, context.userPrompt);

      const llmResponse = await this.llmManager.callToolWithHistory(messages, toolSchemas, { signal });
      const toolCalls = llmResponse?.tool_calls ?? [];
      const llmContentForAssistant = llmResponse?.content ?? null;

      if (!toolCalls || toolCalls.length === 0) {
        this.logger.warn('⚠️ LLM 没有调用任何工具！');
        await this.historyLogger.logLLMCall(this.loopCount, messages, [], []);
        await this.sleep(500);
        return;
      }

      this.logger.info(`✅ LLM 返回 ${toolCalls.length} 个工具调用`);

      const assistantEntry: HistoryMessage = {
        role: 'assistant',
        content: llmContentForAssistant ?? '[调用工具]',
        tool_calls: toolCalls,
      };
      this.conversationHistory.push(assistantEntry);

      // 同时添加到语义压缩器
      if (this.useSemanticCompression) {
        this.semanticCompressor.addEntry(assistantEntry as HistoryEntry);
      }

      for (const toolCall of toolCalls) {
        signal.throwIfAborted();
        const result = await this.executeToolCallWithResult(toolCall);
        toolResults.push(result);

        // 同时添加到语义压缩器
        if (this.useSemanticCompression && result.result) {
          const toolEntry: HistoryEntry = {
            role: 'tool',
            tool_call_id: result.toolCallId,
            name: result.name,
            content: JSON.stringify(result.result),
          };
          this.semanticCompressor.addEntry(toolEntry);
        }
      }

      await this.historyLogger.logLLMCall(this.loopCount, messages, toolCalls, toolResults);

      this.trimHistory();

      await this.adaptiveSleep();
    } catch (error) {
      if (error instanceof CancellationError) {
        this.logger.info(`迭代被取消: ${error.reason}`);
        return;
      }
      this.logger.error('AgentLoop 迭代异常', undefined, error as Error);
      await this.sleep(2000);
    }
  }

  /**
   * 构建消息列表
   *
   * 两种模式：
   * - 语义压缩模式：[system, user(含历史摘要), 最近1-2轮历史]
   * - 程序压缩模式：[system, user, ...压缩后的对话链]
   */
  private buildMessages(
    systemPrompt: string,
    userPrompt: string,
  ): Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string }> {
    const messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (this.useSemanticCompression) {
      // 语义压缩模式：将历史摘要合并到 user 消息中
      const summary = this.semanticCompressor.getSummary();
      const enhancedUserPrompt = summary ? `${userPrompt}\n\n## 历史行动摘要\n${summary}` : userPrompt;
      messages.push({ role: 'user', content: enhancedUserPrompt });

      // 只添加语义压缩器保留的最近历史
      const retainedHistory = this.semanticCompressor.getRetainedHistory();
      for (const entry of retainedHistory) {
        messages.push({
          role: entry.role,
          content: entry.content,
          tool_calls: entry.tool_calls,
          tool_call_id: entry.tool_call_id,
          name: entry.name,
        });
      }

      this.logger.debug('语义压缩模式', {
        summaryLength: summary.length,
        retainedHistoryCount: retainedHistory.length,
      });
    } else {
      // 程序压缩模式：使用 HistoryCompressor
      messages.push({ role: 'user', content: userPrompt });
      const compressedHistory = this.historyCompressor.compress(this.conversationHistory);
      messages.push(...compressedHistory);
    }

    return messages;
  }

  private async executeToolCall(toolCall: ToolCall): Promise<void> {
    const result = await this.executeToolCallWithResult(toolCall);
    this.logger.info(
      `${result.success ? '✅' : '❌'} 工具执行${result.success ? '成功' : '失败'}: ${result.result?.message || result.result?.error || ''}`,
    );
  }

  private async executeToolCallWithResult(toolCall: ToolCall): Promise<{ toolCallId: string; name: string; success: boolean; result: any }> {
    const toolName = toolCall.function.name;
    let args: Record<string, any> = {};

    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      this.logger.error(`❌ 解析工具参数失败: ${toolName}`, undefined, e as Error);
      this.state.memory.recordDecision(`调用工具 ${toolName}`, { toolName, rawArgs: toolCall.function.arguments }, 'failed', '参数解析失败');

      const errorResult = { success: false, error: '参数解析失败' };
      this.conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: JSON.stringify(errorResult),
      });

      return { toolCallId: toolCall.id, name: toolName, success: false, result: errorResult };
    }

    this.logger.info(`🔧 执行工具: ${toolName}`, args);

    try {
      const result = await this.toolRegistry.executeTool(toolName, args);

      this.state.memory.recordDecision(`执行 ${toolName}`, { toolName, args }, result.success ? 'success' : 'failed', result.message);

      const toolResult = {
        success: result.success,
        message: result.message,
        data: result.data,
      };

      this.conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: JSON.stringify(toolResult),
      });

      return { toolCallId: toolCall.id, name: toolName, success: result.success, result: toolResult };
    } catch (error) {
      this.logger.error(`❌ 工具执行异常: ${toolName}`, undefined, error as Error);
      this.state.memory.recordDecision(`执行 ${toolName}`, { toolName, args }, 'failed', `执行异常: ${(error as Error).message}`);

      const errorResult = { success: false, error: (error as Error).message };
      this.conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: JSON.stringify(errorResult),
      });

      return { toolCallId: toolCall.id, name: toolName, success: false, result: errorResult };
    }
  }

  private trimHistory(): void {
    const maxMessages = this.maxHistoryTurns * 2;
    if (this.conversationHistory.length > maxMessages) {
      this.conversationHistory = this.conversationHistory.slice(-maxMessages);
    }
  }

  resetHistory(): void {
    this.conversationHistory = [];
    this.semanticCompressor.reset();
  }

  private async checkGoalAndTaskCompletion(): Promise<void> {
    try {
      const goalManager = this.state.context.goalManager;
      const gameContext = {
        gameState: this.state.context.gameState,
      } as any;

      if (goalManager) {
        goalManager.checkCompletion(gameContext);
      }
    } catch (error) {
      this.logger.error('❌ 目标检测失败', undefined, error as Error);
    }
  }

  private async adaptiveSleep(): Promise<void> {
    let delay = 500;

    if (this.state.context.gameState.health < 10) {
      delay = 200;
    }

    await this.sleep(delay);
  }

  getLoopCount(): number {
    return this.loopCount;
  }
}
