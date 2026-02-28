# 记忆系统 (Memory System)

> 本文档介绍 Maicraft-Next 的记忆系统设计和使用方式

---

## 🎯 设计理念

### Maicraft Python 的局限

```python
# ❌ 简单的 thinking_log
thinking_log = []
thinking_log.append({
    "timestamp": time.time(),
    "content": "我需要收集木头"
})
```

**问题**：

- 只有一种记忆类型
- 无法区分不同类型的信息
- 查询不方便
- 无持久化机制

### Maicraft-Next 的改进

```typescript
// ✅ 四种专门记忆类型
await memory.recordThought('我需要先收集 10 个木头');
await memory.recordConversation('Player123', '帮我建造一个房子');
await memory.recordDecision('move', { x: 100 }, 'success');
await memory.recordExperience('在夜晚挖矿很危险', '挖矿');

const recentDecisions = await memory.decision.getRecent(10);
const summary = memory.buildContextSummary({ includeDecisions: 5 });

// ✅ 自动持久化
await memory.saveAll();
```

---

## 🏗️ 架构

### 组件结构

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent                                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   MemoryService                          ││
│  │  (门面层 - 统一访问入口)                                 ││
│  └─────────────────────────────────────────────────────────┘│
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                 MemoryManager                            ││
│  │  (存储层 - 负责持久化)                                   ││
│  │  - ThoughtMemory                                         ││
│  │  - ConversationMemory                                    ││
│  │  - DecisionMemory                                        ││
│  │  - ExperienceMemory                                       ││
│  └─────────────────────────────────────────────────────────┘│
│                            │                                 │
│                            ▼ (发布事件)                      │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    EventBus                               ││
│  │  (事件总线 - 解耦外部集成)                                ││
│  └─────────────────────────────────────────────────────────┘│
│              │                       │                      │
│              ▼                       ▼                      │
│  ┌──────────────────┐    ┌──────────────────┐               │
│  │ WebSocketAdapter │    │  MaiBotAdapter  │               │
│  │ (推送记忆到WS)   │    │ (发送到MaiBot)   │               │
│  └──────────────────┘    └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### 核心原则

1. **单一职责**: MemoryManager 只负责存储，MemoryService 负责统一访问
2. **事件驱动**: 外部集成通过事件订阅解耦
3. **依赖注入**: 所有依赖通过构造函数注入，便于测试

---

## 📦 四种记忆类型

### 1. ThoughtMemory - 思维记忆

**用途**：记录 AI 的内部思考过程

```typescript
// 通过 MemoryService 记录
memoryService.recordThought('我需要先收集 10 个木头，然后制作工作台', {
  goal: 'build_house',
});
```

**适用场景**：

- 规划和推理过程
- 问题分析
- 策略思考

### 2. ConversationMemory - 对话记忆

**用途**：记录与玩家的聊天互动

```typescript
memoryService.recordConversation('Player123', '帮我建造一个房子', {
  location: homePosition,
});
```

**适用场景**：

- 玩家指令
- 聊天对话
- 社交互动

### 3. DecisionMemory - 决策记忆

**用途**：记录行动决策及其结果

```typescript
memoryService.recordDecision('挖掘铁矿', { action: 'mine_block', params: { name: 'iron_ore', count: 10 } }, 'success', '需要铁矿来制作工具');
```

**适用场景**：

- 动作执行记录
- 决策依据
- 结果评估

### 4. ExperienceMemory - 经验记忆

**用途**：记录学习到的经验教训

```typescript
memoryService.recordExperience('在夜晚挖矿很危险，容易遭遇怪物攻击', 'Y=12 层挖矿时被僵尸攻击', 0.8);
```

**适用场景**：

- 成功经验
- 失败教训
- 技巧总结

---

## 💻 基本使用

### 通过 AgentState 访问

```typescript
// Agent 内部通过 state.memory 访问
this.state.memory.recordThought('我需要找到铁矿');
this.state.memory.recordConversation('Player1', '你好');
```

### 记录记忆

```typescript
// 记录思维
memoryService.recordThought('我需要找到铁矿', {
  currentTask: 'gather_materials',
});

// 记录对话
memoryService.recordConversation('Player1', '你好');

// 记录决策
memoryService.recordDecision('移动到位置', { actionType: 'move', params: { x: 100, y: 64, z: 200 } }, 'success');

// 记录经验
memoryService.recordExperience('对付僵尸时保持距离很重要', 'combat', 0.7);
```

### 查询记忆

```typescript
// 查询最近的思维
const recentThoughts = memoryService.thought.getRecent(10);

// 查询最近的对话
const conversations = memoryService.conversation.getRecent(20);

// 查询最近的决策
const decisions = memoryService.decision.getRecent(15);

// 查询最近的经验
const experiences = memoryService.experience.getRecent(5);
```

### 构建上下文摘要

```typescript
// 构建完整的上下文摘要（用于 LLM）
const summary = memoryService.buildContextSummary({
  includeThoughts: 5,
  includeConversations: 3,
  includeDecisions: 10,
  includeExperiences: 3,
});
```

### 持久化

```typescript
// 保存所有记忆
await memoryService.saveAll();

// 加载所有记忆
await memoryService.loadAll();
```

---

## 🔌 事件系统

### 事件类型

记忆系统通过 EventBus 发布以下事件：

| 事件名                         | 说明     | Payload                        |
| ------------------------------ | -------- | ------------------------------ |
| `memory:thought:recorded`      | 思维记录 | `{ entry: ThoughtEntry }`      |
| `memory:conversation:recorded` | 对话记录 | `{ entry: ConversationEntry }` |
| `memory:decision:recorded`     | 决策记录 | `{ entry: DecisionEntry }`     |
| `memory:experience:recorded`   | 经验记录 | `{ entry: ExperienceEntry }`   |

### 订阅事件

```typescript
import { EventBus } from '@/core/events/EventBus';
import { MemoryEventTypes } from '@/core/events/types';

const eventBus = EventBus.getInstance();

eventBus.onMemory(MemoryEventTypes.THOUGHT_RECORDED, data => {
  console.log('新思维:', data.entry.content);
});
```

---

## 🔄 与 Maicraft Python 的对比

| 方面         | Maicraft Python     | Maicraft-Next    |
| ------------ | ------------------- | ---------------- |
| **记忆类型** | 单一的 thinking_log | 4 种专门记忆类型 |
| **结构化**   | 简单的列表          | 类型化的记录结构 |
| **查询**     | 遍历列表            | 支持过滤和限制   |
| **持久化**   | 需手动实现          | 自动持久化机制   |
| **容量管理** | 无                  | 自动清理机制     |

---

## 📚 在 Agent 中使用记忆

### 在决策循环中

```typescript
// MainDecisionLoop.ts
async think(): Promise<void> {
  // 1. 获取相关记忆
  const recentDecisions = this.state.memory.decision.getRecent(10);
  const recentThoughts = this.state.memory.thought.getRecent(5);

  // 2. 构建上下文摘要
  const contextSummary = this.state.memory.buildContextSummary({
    includeThoughts: 5,
    includeDecisions: 10,
  });

  // 3. 包含在 Prompt 中
  const prompt = this.generatePrompt({
    contextSummary,
    decisions: recentDecisions,
  });

  // 4. 调用 LLM
  const response = await this.llmManager.chat(prompt);

  // 5. 记录新的思维
  this.state.memory.recordThought(response.thinking);

  // 6. 记录决策
  this.state.memory.recordDecision(
    response.intention,
    response.action,
    response.result
  );
}
```

### 在事件处理中

```typescript
// 监听死亡事件，记录经验
bot.on('death', () => {
  this.state.memory.recordExperience('需要更加小心，避免死亡', `在 ${gameState.position} 死亡`, 0.9);
});
```

---

## 🚀 最佳实践

### 1. 合理使用记忆类型

```typescript
// ✅ 正确：思维记忆用于内部推理
this.state.memory.recordThought('我需要先做一个工作台');

// ✅ 正确：对话记忆用于聊天记录
this.state.memory.recordConversation(username, message);

// ✅ 正确：决策记忆用于记录动作决策
this.state.memory.recordDecision(intention, action, result);

// ✅ 正确：经验记忆用于记录教训
this.state.memory.recordExperience(lesson, context, confidence);
```

### 2. 记录足够的上下文

```typescript
// ✅ 提供丰富的上下文
this.state.memory.recordDecision(
  '制作木镐',
  { actionType: 'craft', params: { item: 'wooden_pickaxe', count: 1 } },
  'success',
  '需要挖掘石头来制作更好的工具',
);
```

### 3. 定期持久化

记忆系统会在 Agent 生命周期内自动持久化，无需手动调用。

### 4. 使用上下文摘要

```typescript
// 构建摘要用于 LLM 上下文
const summary = this.state.memory.buildContextSummary({
  includeThoughts: 3,
  includeDecisions: 5,
  includeConversations: 2,
  includeExperiences: 2,
});
```

---

## 📚 相关文档

- [代理系统](agent-system.md) - 了解记忆系统在 Agent 中的使用
- [规划系统](planning-system.md) - 了解记忆如何配合任务规划
- [事件系统](event-system.md) - 了解 EventBus 事件机制

---

_最后更新: 2026-02-28_
