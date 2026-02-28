# 中断系统 (Interrupt System)

> 本文档介绍 Maicraft-Next 的中断系统，取代了原来的模式状态机架构

---

## 📋 概述

中断系统是一种轻量级的被动响应机制，取代了原来复杂的模式状态机设计。

**核心思想**：检测到特定条件 → 暂停 LLM 决策 → 程序化处理 → 恢复 LLM 决策

## 🎯 设计原则

### 1. 轻量级检测

- `detect()` 方法必须轻量，每轮循环调用
- 只检查最必要的条件，避免复杂计算

### 2. 阻塞式处理

- `handle()` 方法是阻塞的，异步等待完成
- 处理期间 AgentLoop 暂停 LLM 调用
- 处理完成后自动恢复 LLM 决策

### 3. 按优先级排序

- 多个中断处理器按优先级排序
- 高优先级中断可以打断低优先级

## 🏗️ 核心组件

### InterruptSystem

```typescript
export class InterruptSystem {
  private handlers: InterruptHandler[] = [];
  private activeHandler: InterruptHandler | null = null;
  private status: InterruptStatus = 'idle';

  // 注册中断处理器（按优先级排序）
  register(handler: InterruptHandler): void;

  // 注销中断处理器
  unregister(name: string): boolean;

  // 检查是否有中断触发
  check(): InterruptHandler | null;

  // 处理中断（阻塞执行）
  async handleInterrupt(handler: InterruptHandler): Promise<void>;

  // 获取状态
  getStatus(): InterruptStatus;
  isHandling(): boolean;
  isEnabled(): boolean;
}
```

### InterruptHandler 接口

```typescript
export interface InterruptHandler {
  // 处理器名称
  name: string;

  // 优先级（数值越大优先级越高）
  priority: number;

  // 轻量级检测，每轮循环调用
  detect(gameState: GameState): boolean;

  // 程序化处理，阻塞直到完成
  handle(): Promise<void>;
}
```

## 🔧 内置中断处理器

### CombatHandler

战斗中断处理器，检测并消灭敌对生物：

```typescript
export class CombatHandler implements InterruptHandler {
  readonly name = 'CombatHandler';
  readonly priority = 100;

  // 检测近距离敌对实体
  detect(gameState: GameState): boolean {
    const enemy = this.findNearestEnemy(gameState);
    return enemy !== null && enemy.distance <= this.config.threatDistance;
  }

  // 持续攻击直到威胁消除
  async handle(): Promise<void> {
    while (hasThreat) {
      const enemy = this.findNearestEnemy();
      await this.performAttack(enemy);
    }
  }
}
```

**配置选项**：

```typescript
interface CombatHandlerConfig {
  threatDistance: number; // 威胁检测距离（默认16方块）
  attackCooldown: number; // 攻击冷却（默认1000ms）
  maxCombatDuration: number; // 最大战斗时间（默认5分钟）
  recordThoughts: boolean; // 是否记录思考
  recordDecisions: boolean; // 是否记录决策
}
```

## 💻 使用示例

### 注册中断处理器

```typescript
// 在 Agent 初始化时
const interruptSystem = new InterruptSystem(gameState);

// 注册战斗处理器
const combatHandler = new CombatHandler(executor, memory, gameState, { threatDistance: 16 });
interruptSystem.register(combatHandler);
```

### 在 AgentLoop 中使用

```typescript
class AgentLoop extends BaseLoop<AgentState> {
  protected async runLoopIteration(): Promise<void> {
    // 1. 检查中断
    const handler = this.interruptSystem.check();
    if (handler) {
      await this.interruptSystem.handleInterrupt(handler);
      return; // 跳过本轮 LLM
    }

    // 2. 正常 LLM 决策
    // ...
  }
}
```

## ⚡ 对比：中断系统 vs 模式系统

| 特性       | 模式系统 (旧)                | 中断系统 (新)       |
| ---------- | ---------------------------- | ------------------- |
| 架构复杂度 | 高（多层模式切换）           | 低（简单检测-处理） |
| LLM 决策   | 被模式分割                   | 统一的 ReAct 循环   |
| 战斗响应   | 切换到 CombatMode            | 中断处理            |
| GUI 操作   | 切换到 ChestMode/FurnaceMode | 直接调用 Action     |
| 代码量     | ~1000 行                     | ~300 行             |

## 📚 相关文档

- [决策循环](decision-loop.md)
- [Agent 系统](agent-system.md)
- [ReAct 规划系统](./refactor/react-planning-system.md)

---

_最后更新: 2026-02-28_
