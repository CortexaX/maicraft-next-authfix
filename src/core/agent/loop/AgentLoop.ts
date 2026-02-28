/**
 * AgentLoop - ReAct 核心循环
 *
 * 取代 MainDecisionLoop，直接使用 LLM function-calling
 * 实现 ReAct 模式：观察 → 思考 → 工具调用 → 观察结果
 */

import { BaseLoop } from './BaseLoop';
import type { AgentState } from '@/core/agent/types';
import { LLMManager } from '@/llm/LLMManager';
import { ToolRegistry } from '@/core/agent/tool/ToolRegistry';
import { InterruptManager, CancellationError } from '@/core/interrupt';
import { ContextBuilder } from './ContextBuilder';
import type { ToolCall } from '@/llm/types';

/**
 * AgentLoop - ReAct 核心循环
 * 取代 MainDecisionLoop，直接使用 LLM function-calling
 */
export class AgentLoop extends BaseLoop<AgentState> {
  private llmManager: LLMManager;
  private toolRegistry: ToolRegistry;
  private interruptManager: InterruptManager;
  private contextBuilder: ContextBuilder;
  private loopCount: number = 0;

  constructor(state: AgentState, llmManager: LLMManager, toolRegistry: ToolRegistry, interruptManager: InterruptManager) {
    super(state, 'AgentLoop');
    this.llmManager = llmManager;
    this.toolRegistry = toolRegistry;
    this.interruptManager = interruptManager;
    this.contextBuilder = new ContextBuilder(state);
  }

  /**
   * 执行一次循环迭代
   * ReAct 模式：检查中断 → 收集观察 → 构建 prompt → LLM 调用 → 执行工具 → 记录记忆
   */
  protected async runLoopIteration(): Promise<void> {
    this.loopCount++;

    // 1. 检测自动中断（战斗等）
    const handler = this.interruptManager.detect();
    if (handler) {
      this.logger.info(`检测到中断: ${handler.name}`);
      await this.interruptManager.handleInterrupt(handler);
      return;
    }

    // 2. 创建本次迭代的取消信号
    const signal = this.interruptManager.beginScope();

    // 3. 更新 RuntimeContext 中的 signal（让后续动作能感知）
    this.state.context.signal = signal;

    // 4. 自动检测目标和任务完成
    await this.checkGoalAndTaskCompletion();

    try {
      // 5. 构建 prompt
      const context = this.contextBuilder.buildContext();

      // 6. 获取可用工具 schema
      const toolSchemas = this.toolRegistry.getAvailableToolSchemas();

      this.logger.debug(`调用 LLM，可用工具: ${toolSchemas.length} 个`);

      // 7. LLM function-calling 调用（传入 signal，可被取消）
      const toolCalls = await this.llmManager.callTool(context.userPrompt, toolSchemas, context.systemPrompt, { signal });

      if (!toolCalls || toolCalls.length === 0) {
        // LLM 没有调用工具，可能是思考或结束
        this.logger.debug('LLM 没有调用工具');
        await this.sleep(500);
        return;
      }

      // 8. 执行所有工具调用
      for (const toolCall of toolCalls) {
        signal.throwIfAborted();
        await this.executeToolCall(toolCall);
      }

      // 9. 自适应延迟
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
   * 执行单个工具调用
   */
  private async executeToolCall(toolCall: ToolCall): Promise<void> {
    const toolName = toolCall.function.name;
    let args: Record<string, any> = {};

    try {
      // 解析参数
      args = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      this.logger.error(`❌ 解析工具参数失败: ${toolName}`, undefined, e as Error);
      this.state.memory.recordDecision(`调用工具 ${toolName}`, { toolName, rawArgs: toolCall.function.arguments }, 'failed', '参数解析失败');
      return;
    }

    this.logger.info(`🔧 执行工具: ${toolName}`, args);

    try {
      // 执行工具
      const result = await this.toolRegistry.executeTool(toolName, args);

      // 记录决策
      this.state.memory.recordDecision(`执行 ${toolName}`, { toolName, args }, result.success ? 'success' : 'failed', result.message);

      this.logger.info(`${result.success ? '✅' : '❌'} 工具执行${result.success ? '成功' : '失败'}: ${result.message}`);
    } catch (error) {
      this.logger.error(`❌ 工具执行异常: ${toolName}`, undefined, error as Error);
      this.state.memory.recordDecision(`执行 ${toolName}`, { toolName, args }, 'failed', `执行异常: ${(error as Error).message}`);
    }
  }

  /**
   * 检查目标完成
   */
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

  /**
   * 自适应延迟
   */
  private async adaptiveSleep(): Promise<void> {
    // 基础延迟
    let delay = 500;

    // 如果生命值低，更快响应
    if (this.state.context.gameState.health < 10) {
      delay = 200;
    }

    await this.sleep(delay);
  }

  /**
   * 获取循环计数
   */
  getLoopCount(): number {
    return this.loopCount;
  }
}
