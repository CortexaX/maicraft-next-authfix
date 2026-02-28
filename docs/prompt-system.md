# 提示词系统 (Prompt System)

> 本文档介绍 Maicraft-Next 的 Prompt 管理和生成系统

---

## 🎯 设计理念

高质量的 Prompt 是 AI Agent 性能的关键。Maicraft-Next 提供：

- ✅ 模板化的 Prompt 管理
- ✅ 动态上下文注入
- ✅ 模式相关的 Prompt
- ✅ 可重用的 Prompt 组件

---

## 📦 核心组件

### PromptManager

统一管理和生成 Prompt：

```typescript
import { PromptManager } from '@/core/agent/prompt/prompt_manager';

const promptManager = new PromptManager();

// 生成主决策 Prompt
const prompt = promptManager.generateMainThinking(context, {
  goal: '建造房子',
  recentMemories: memories,
  currentTasks: tasks,
});
```

---

## 📋 内置模板

### 1. basic_info - 基本信息

包含游戏状态、物品栏、装备等基础信息。

### 2. main_thinking - 主决策

主决策循环使用的 Prompt 模板。

### 3. chat_response - 聊天回复

处理玩家聊天的 Prompt 模板。

### 4. task_evaluation - 任务评估

评估任务完成度的 Prompt 模板。

### 5. chest_operation - 箱子操作

智能箱子交互使用的 Prompt 模板。

- **用途**：`interact_chest` Action 内部 LLM 调用
- **参数**：`bot_name`, `player_name`, `intent`, `current_goal`, `current_tasks`, `chest_gui`, `inventory_info`
- **返回**：JSON 格式的批量操作序列

### 6. furnace_operation - 熔炉操作

智能熔炉交互使用的 Prompt 模板。

- **用途**：`interact_furnace` Action 内部 LLM 调用
- **参数**：`bot_name`, `player_name`, `intent`, `current_goal`, `current_tasks`, `furnace_gui`, `inventory_info`
- **返回**：JSON 格式的批量操作序列（支持 input/fuel/output 三个槽位）

---

## 💻 基本使用

```typescript
// 生成主决策 Prompt
const thinkingPrompt = promptManager.generateMainThinking(context, {
  goal: state.goal,
  currentMode: state.modeManager.getCurrentMode().name,
  recentThoughts: await state.memory.thought.query({ limit: 5 }),
  recentDecisions: await state.memory.decision.query({ limit: 10 }),
  currentTasks: state.planningManager.getCurrentTasks(),
});

// 生成聊天回复 Prompt
const chatPrompt = promptManager.generateChatResponse(context, {
  username: 'Player1',
  message: '你好',
  conversationHistory: await state.memory.conversation.query({ limit: 10 }),
});
```

---

## 🔧 自定义模板

```typescript
// 定义新模板
export function myCustomTemplate(context: RuntimeContext, options: any): string {
  return `
你是一个 Minecraft AI。

## 当前状态
${context.gameState.getStatusDescription()}

## 特殊指令
${options.specialInstructions}

请决定下一步行动。
  `.trim();
}

// 使用
const prompt = myCustomTemplate(context, {
  specialInstructions: '优先收集钻石',
});
```

---

## 📚 最佳实践

### 1. 包含足够的上下文

```typescript
// ✅ 好：提供丰富的上下文
const prompt = `
当前状态: ${gameState.getStatusDescription()}
物品栏: ${gameState.getInventoryDescription()}
当前目标: ${currentGoal}
最近的思考: ${recentThoughts}
`;
```

### 2. 控制 Prompt 长度

```typescript
// ✅ 限制历史记忆数量
const recentMemories = await memory.thought.query({ limit: 5 });
```

---

## 📚 相关文档

- [LLM 集成](llm-integration.md)
- [代理系统](agent-system.md)

---

_最后更新: 2026-02-28_
