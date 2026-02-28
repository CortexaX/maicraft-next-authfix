# 代理系统 (Agent System)

> 本文档介绍 Maicraft-Next 的 Agent 架构和工作原理

---

## 🎯 Agent 的职责

Agent 是整个系统的**主协调器**，负责：

1. **初始化和管理**所有子系统（记忆、规划、工具等）
2. **协调**决策循环（AgentLoop、ChatLoop）的运行
3. **管理**Agent 的生命周期（启动、停止）
4. **提供**统一的状态访问接口

---

## 📐 系统架构

```
Agent (主协调器)
  ├── AgentState (共享状态)
  │   ├── RuntimeContext (运行时上下文)
  │   ├── MemoryManager (记忆管理)
  │   ├── GoalPlanningManager (规划管理)
  │   ├── InterruptSystem (中断系统)
  │   └── ToolRegistry (工具注册表)
  │
  ├── AgentLoop (ReAct 主决策循环)
  ├── ChatLoop (聊天循环)
  └── EventListeners (事件监听器)
```

**新架构特点**：

- 使用 **AgentLoop** 取代 MainDecisionLoop，直接使用 LLM function-calling
- 使用 **InterruptSystem** 取代 ModeManager，按优先级处理中断
- 使用 **ToolRegistry** 将 Action 转换为 function-calling schema

---

## 💻 基本使用

### 创建 Agent

```typescript
import { createBot } from 'mineflayer';
import { Agent } from '@/core/agent/Agent';
import { ActionExecutor } from '@/core/actions/ActionExecutor';
import { LLMManager } from '@/llm/LLMManager';

// 1. 创建 bot
const bot = createBot({
  /* ... */
});

// 2. 创建 ActionExecutor
const executor = new ActionExecutor(bot, logger, config);

// 3. 创建 LLMManager
const llmManager = LLMManagerFactory.create(config.llm, logger);

// 4. 创建 Agent
const agent = new Agent(bot, executor, llmManager, config);

// 5. 初始化
await agent.initialize();

// 6. 启动 Agent
await agent.start();
```

### Agent 生命周期

```typescript
// 初始化
await agent.initialize();

// 启动
await agent.start();

// 停止
await agent.stop();

// 获取状态
const status = agent.getStatus();
console.log(status.isRunning);
```

---

## 🔧 子系统详解

### 1. AgentState - 共享状态

所有子系统共享的状态对象：

```typescript
interface AgentState {
  goal: string; // 当前总目标
  isRunning: boolean; // 运行状态
  context: RuntimeContext; // 运行时上下文
  memory: MemoryManager; // 记忆管理器
  llmManager: LLMManager; // LLM 管理器
  interrupt: InterruptController; // 中断控制器
  interruptSystem: InterruptSystem; // 中断系统
  toolRegistry: ToolRegistry; // 工具注册表
  config: Config; // 配置对象
}
```

### 2. AgentLoop - ReAct 主决策循环

负责 Agent 的主要决策逻辑，采用 ReAct 模式：

```typescript
class AgentLoop {
  protected async runLoopIteration(): Promise<void> {
    // 1. 检查中断
    const handler = this.interruptSystem.check();
    if (handler) {
      await this.interruptSystem.handleInterrupt(handler);
      return;
    }

    // 2. 构建上下文
    const context = this.contextBuilder.buildContext();

    // 3. 获取工具 schema
    const toolSchemas = this.toolRegistry.getAvailableToolSchemas();

    // 4. LLM function-calling
    const toolCalls = await this.llmManager.callTool(context.userPrompt, toolSchemas, context.systemPrompt);

    // 5. 执行工具
    for (const toolCall of toolCalls) {
      await this.executeToolCall(toolCall);
    }
  }
}
```

### 3. ChatLoop - 聊天循环

处理玩家聊天互动：

```typescript
class ChatLoop {
  async handleMessage(username: string, message: string): Promise<void> {
    // 1. 记录对话
    await this.state.memory.conversation.record({
      /* ... */
    });

    // 2. 生成回复
    const response = await this.llmManager.chat(/* ... */);

    // 3. 发送回复
    await this.state.context.executor.execute(ActionIds.CHAT, {
      message: response.content,
    });
  }
}
```

### 4. InterruptSystem - 中断系统

处理战斗等紧急情况：

```typescript
class InterruptSystem {
  register(handler: InterruptHandler): void;
  check(): InterruptHandler | null;
  async handleInterrupt(handler: InterruptHandler): Promise<void>;
}
```

### 5. ToolRegistry - 工具注册表

将 Action 转换为 LLM function-calling 格式：

```typescript
class ToolRegistry {
  getToolSchemas(): ToolSchema[];
  getAvailableToolSchemas(): ToolSchema[];
  async executeTool(name: string, args: Record<string, any>): Promise<any>;
}
```

---

## 🔄 架构演进

### 旧架构 (模式系统)

```
Agent
  └── MainDecisionLoop
        └── ModeManager
              ├── MainMode
              ├── CombatMode
              ├── ChestMode
              └── FurnaceMode
```

**问题**：调用链过长（6层），LLM 决策被模式分割

### 新架构 (ReAct + 中断)

```
Agent
  └── AgentLoop
        ├── InterruptSystem (战斗等)
        ├── ToolRegistry (工具)
        └── LLMManager.callTool() (直接 function-calling)
```

**优势**：

- LLM 是中央决策者
- 调用链简化（3层）
- 统一的工具调用机制

---

## 📚 相关文档

- [架构概览](architecture-overview.md)
- [记忆系统](memory-system.md)
- [规划系统](planning-system.md)
- [中断系统](interrupt-system.md)
- [决策循环](decision-loop.md)

---

_最后更新: 2026-02-28_
