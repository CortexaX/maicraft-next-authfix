# 决策循环 (Decision Loop)

> 本文档介绍 Maicraft-Next 的决策循环机制

---

## 🎯 两种决策循环

### AgentLoop - ReAct 主决策循环

负责 Agent 的主要自主决策和行动，采用 ReAct (Reasoning + Acting) 模式。

**核心特性**：

- **Function Calling**：直接使用 LLM 的 function calling 能力调用工具
- **InterruptSystem**：集成中断系统处理战斗等被动响应
- **ContextBuilder**：动态构建每轮 LLM 调用的上下文

**工作流程**：

```
1. interruptSystem.check()     → 检查是否有中断需要处理
2. PromptDataCollector.collect() → 收集环境观察
3. ContextBuilder.buildPrompt() → 构建 system/user prompt
4. LLMManager.callTool()       → LLM function-calling 调用
5. ToolRegistry.executeTool()  → 执行工具调用
6. Memory.recordDecision()     → 记录决策到记忆
7. adaptiveSleep()             → 自适应延迟
```

### ChatLoop - 聊天循环

处理与玩家的聊天互动。

**触发方式**：

- 玩家发送聊天消息
- 消息包含特定前缀（如 `@bot`）

---

## 💻 基本流程

### AgentLoop

```typescript
export class AgentLoop extends BaseLoop<AgentState> {
  protected async runLoopIteration(): Promise<void> {
    // 1. 检查中断（战斗等）
    const handler = this.interruptSystem.check();
    if (handler this.interruptSystem) {
      await.handleInterrupt(handler);
      return; // 中断处理后跳过本轮 LLM
    }

    // 2. 构建上下文
    const context = this.contextBuilder.buildContext();

    // 3. 获取可用工具 schema
    const toolSchemas = this.toolRegistry.getAvailableToolSchemas();

    // 4. LLM function-calling 调用
    const toolCalls = await this.llmManager.callTool(
      context.userPrompt,
      toolSchemas,
      context.systemPrompt
    );

    // 5. 执行所有工具调用
    for (const toolCall of toolCalls) {
      await this.executeToolCall(toolCall);
    }

    // 6. 记录记忆
    // 7. 自适应延迟
  }
}
```

### InterruptSystem

中断系统取代了原来的被动模式切换，直接处理战斗等紧急情况：

```typescript
export class InterruptSystem {
  // 注册中断处理器
  register(handler: InterruptHandler): void;

  // 检查是否有中断触发
  check(): InterruptHandler | null;

  // 处理中断（阻塞执行）
  async handleInterrupt(handler: InterruptHandler): Promise<void>;
}

export interface InterruptHandler {
  name: string;
  priority: number;
  detect(gameState: GameState): boolean; // 轻量级检测
  handle(): Promise<void>; // 程序化处理
}
```

### ChatLoop

```typescript
export class ChatLoop {
  async handleMessage(username: string, message: string): Promise<void> {
    // 1. 记录对话
    await this.state.memory.conversation.record({
      speaker: username,
      message,
    });

    // 2. 生成回复 Prompt
    const prompt = this.promptManager.generateChatResponse(this.state.context, {
      username,
      message,
      conversationHistory: await this.state.memory.conversation.query({ limit: 10 }),
    });

    // 3. 调用 LLM
    const response = await this.llmManager.chat(prompt);

    // 4. 发送回复
    await this.state.context.executor.execute(ActionIds.CHAT, {
      message: response.content,
    });

    // 5. 记录回复
    await this.state.memory.conversation.record({
      speaker: this.state.context.bot.username,
      message: response.content,
      response_to: username,
    });
  }
}
```

---

## 🔧 组件说明

### ToolRegistry

将 Action 系统转换为 LLM function-calling 格式：

```typescript
export class ToolRegistry {
  // 获取所有工具的 function-calling schema
  getToolSchemas(): ToolSchema[];

  // 根据上下文过滤可用工具
  getAvailableToolSchemas(): ToolSchema[];

  // 执行工具调用
  executeTool(name: string, args: Record<string, any>): Promise<any>;
}
```

### ContextBuilder

动态构建每轮 LLM 调用的上下文：

```typescript
export class ContextBuilder {
  buildContext(): BuiltContext;

  // 动态 system prompt
  buildSystemPrompt(): string;

  // user prompt (环境观察)
  buildUserPrompt(): string;
}
```

### CombatHandler

战斗中断处理器：

```typescript
export class CombatHandler implements InterruptHandler {
  readonly name = 'CombatHandler';
  readonly priority = 100;

  detect(gameState: GameState): boolean;
  handle(): Promise<void>;
}
```

---

## 📚 相关文档

- [代理系统](agent-system.md)
- [LLM 集成](llm-integration.md)
- [提示词系统](prompt-system.md)
- [ReAct 规划系统](./refactor/react-planning-system.md)

---

_最后更新: 2026-02-28_
