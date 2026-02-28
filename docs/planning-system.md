# 规划系统 (Goal Planning System)

> 本文档介绍 Maicraft-Next 的简化目标规划系统

---

## 🎯 设计理念

### 架构演进

**之前 (Goal → Task 双层)**：

```
Goal → Task 1..N → Tracker
     ↓
   TaskManager
```

**问题**：

- 双层管理复杂度高
- Task 需要结构化定义
- LLM 受限于 Task 结构

**现在 (Goal 单层)**：

```
Goal + plan 文本 → Tracker
     ↓
  GoalManager
```

**优势**：

- 简化为单层管理
- plan 用自然语言描述，LLM 完全自主
- 减少代码复杂度，提高灵活性

### 与 Maicraft Python 对比

| 方面           | Maicraft Python | Maicraft-Next         |
| -------------- | --------------- | --------------------- |
| **结构**       | 扁平 todo_list  | Goal 单层 + plan 文本 |
| **灵活性**     | 固定列表        | 自然语言描述          |
| **自动检测**   | 无              | Tracker 自动完成      |
| **LLM 自主性** | 低              | 完全自主              |

---

## 📐 系统架构

```
GoalManager (目标管理器)
├── Goal 1 (目标)
│   ├── id: "collect_wood"
│   ├── content: "收集基础资源"
│   ├── plan?: "1. 寻找树木 2. 收集20个橡木 3. 制作工作台"
│   ├── tracker?: CollectionTracker
│   ├── status: "active" | "completed" | "abandoned"
│   └── priority: 1-5
├── Goal 2
│   └── ...
├── TrackerFactory (追踪器工厂)
└── AutoCheckLoop (自动完成检测)
```

---

## 💾 数据结构

### Goal 接口

```typescript
interface Goal {
  id: string; // 语义化ID，如 "collect_wood"
  content: string; // 目标描述
  plan?: string; // 执行计划（自然语言）
  tracker?: Tracker; // 可选的自动检测器
  status: GoalStatus; // 'active' | 'completed' | 'abandoned' | 'failed'
  priority: number; // 1-5，默认3
  createdAt: number; // 创建时间戳
  completedAt?: number; // 完成时间戳
  completedBy?: 'tracker' | 'llm'; // 完成方式
  metadata: Record<string, any>; // 元数据
}
```

### plan 字段

`plan` 是新增的关键字段，用自然语言描述执行步骤：

```
1. 寻找附近的树木
2. 收集20个橡木原木
3. 制作工作台
4. 如果天黑就先躲避
```

**特点**：

- 纯文本，无结构化要求
- LLM 完全自主规划
- 可随时更新调整

---

## 🔧 LLM 操作：plan_action

LLM 通过 `plan_action` 工具管理目标：

### 操作类型

| operation     | 说明     | 必需参数     |
| ------------- | -------- | ------------ |
| `add`         | 添加目标 | `content`    |
| `edit`        | 编辑目标 | `id`         |
| `remove`      | 删除目标 | `id`         |
| `complete`    | 完成目标 | `id`         |
| `update_plan` | 更新计划 | `id`, `plan` |

### 示例调用

#### 添加目标

```json
{
  "operation": "add",
  "id": "collect_resources",
  "content": "收集基础资源",
  "plan": "1. 寻找附近的树木 2. 收集20个橡木原木 3. 制作工作台",
  "priority": 5
}
```

#### 添加带 Tracker 的目标

```json
{
  "operation": "add",
  "content": "收集20个橡木原木",
  "tracker": {
    "type": "collection",
    "itemName": "oak_log",
    "targetCount": 20
  }
}
```

#### 更新计划

```json
{
  "operation": "update_plan",
  "id": "collect_resources",
  "plan": "1. 先去坐标(100,64,200)附近 2. 收集橡木原木 3. 如果天黑就先找地方躲避"
}
```

#### 完成目标

```json
{
  "operation": "complete",
  "id": "collect_resources"
}
```

---

## 🔄 工作流程

### ReAct 循环中的规划

```
┌─────────────────────────────────────────────────────────┐
│                    AgentLoop                             │
├─────────────────────────────────────────────────────────┤
│  1. 检查中断（战斗等）                                    │
│  2. 检查目标完成（tracker 自动检测）                       │
│  3. 构建上下文（包含当前目标 + plan）                      │
│  4. LLM 决策                                             │
│     - 无目标 → plan_action 创建目标                       │
│     - 有目标无计划 → plan_action.update_plan              │
│     - 有计划 → 执行动作（mine, move, craft 等）            │
│  5. 执行工具，记录到 DecisionMemory                       │
└─────────────────────────────────────────────────────────┘
```

### 无目标时的提示

系统会自动提示 LLM 创建目标：

```
⚠️ 当前没有活动目标！

💡 你需要立即使用 plan_action 动作来创建目标：
1. 使用 operation="add" 添加一个目标
2. 创建目标后，可以使用 operation="update_plan" 来制定执行计划
```

---

## 📊 GoalManager API

### 基本操作

```typescript
const goalManager = context.goalManager;

// 添加目标
const goal = goalManager.addGoal({
  id: 'collect_wood',
  content: '收集基础资源',
  plan: '1. 寻找树木 2. 收集橡木',
  priority: 5,
});

// 获取当前目标
const currentGoal = goalManager.getCurrentGoal();

// 获取所有活动目标
const activeGoals = goalManager.getActiveGoals();

// 更新目标
goalManager.updateGoal('collect_wood', {
  content: '收集更多橡木',
  priority: 4,
});

// 更新计划
goalManager.updatePlan('collect_wood', '1. 向北走 2. 寻找森林 3. 砍树');

// 完成目标
goalManager.completeGoal('collect_wood', 'llm');

// 删除目标
goalManager.removeGoal('collect_wood');
```

### 格式化输出

```typescript
// 格式化目标列表（用于 Prompt）
const formatted = goalManager.formatGoals(context);
// 输出：
// 🎯 [collect_wood] 收集基础资源 [优先级: 5]
//   📋 计划: 1. 寻找树木 2. 收集橡木
// 🎯 [find_iron] 寻找铁矿
```

### 自动完成检测

```typescript
// 手动触发检测
goalManager.checkCompletion(gameContext);

// 检测逻辑：
// 1. 遍历所有 active 状态的目标
// 2. 如果目标有 tracker，调用 tracker.checkCompletion()
// 3. 如果检测通过，自动标记为 completed
```

---

## 🔧 任务追踪器 (Trackers)

Tracker 挂载在 Goal 上，用于自动检测目标完成。

### 内置追踪器类型

#### 1. CollectionTracker - 物品收集

```json
{
  "type": "collection",
  "itemName": "oak_log",
  "targetCount": 20
}
```

检测背包中是否有足够的指定物品。

#### 2. LocationTracker - 位置到达

```json
{
  "type": "location",
  "targetX": 100,
  "targetY": 64,
  "targetZ": 200,
  "radius": 3
}
```

检测是否到达指定坐标附近。

#### 3. CraftTracker - 物品合成

```json
{
  "type": "craft",
  "itemName": "wooden_pickaxe",
  "targetCount": 1
}
```

检测是否完成了指定物品的合成。

#### 4. EntityTracker - 实体检测

```json
{
  "type": "entity",
  "entityType": "villager",
  "distance": 16
}
```

检测附近是否有指定类型的实体。

#### 5. EnvironmentTracker - 环境检测

```json
{
  "type": "environment",
  "dimension": "nether"
}
```

检测是否处于指定环境（维度、生物群系、天气等）。

#### 6. CompositeTracker - 组合追踪

```json
{
  "type": "composite",
  "logic": "and",
  "trackers": [
    { "type": "collection", "itemName": "oak_log", "targetCount": 10 },
    { "type": "collection", "itemName": "stone", "targetCount": 20 }
  ]
}
```

组合多个追踪器，支持 `and`、`or`、`sequence` 逻辑。

---

## 📚 典型使用场景

### 场景：建造房子

```json
// 第一步：创建目标
{
  "operation": "add",
  "id": "build_house",
  "content": "建造一个木质房子",
  "plan": "1. 收集64个橡木原木 2. 制作木板和工作台 3. 找平坦地方 4. 建造5x5木屋",
  "priority": 5
}

// LLM 自主执行计划中的步骤...
// 使用 mine_block, craft, place_block 等动作...

// 中途发现需要调整计划
{
  "operation": "update_plan",
  "id": "build_house",
  "plan": "1. 先收集32个橡木（够用就行）2. 在当前位置建造 3. 建一个3x3的小木屋"
}

// 目标完成（LLM判断或tracker检测）
{
  "operation": "complete",
  "id": "build_house"
}
```

### 场景：收集资源（带自动检测）

```json
// 创建带 tracker 的目标
{
  "operation": "add",
  "content": "收集20个橡木原木",
  "tracker": {
    "type": "collection",
    "itemName": "oak_log",
    "targetCount": 20
  }
}

// LLM 执行收集动作...
// 系统自动检测：当背包中 oak_log >= 20 时，目标自动完成
```

---

## 💾 持久化

### 自动保存

- 目标数据自动保存到 `data/goals.json`
- 每次 Goal 状态变化时触发保存

### 数据恢复

```typescript
// Agent 初始化时加载
await goalManager.load('./data', trackerFactory);
```

### 存储格式

```json
{
  "goals": [
    {
      "id": "collect_wood",
      "content": "收集基础资源",
      "plan": "1. 寻找树木 2. 收集橡木",
      "status": "active",
      "priority": 5,
      "createdAt": 1709000000000,
      "tracker": {
        "type": "collection",
        "itemName": "oak_log",
        "targetCount": 20
      }
    }
  ]
}
```

---

## 🔄 与旧架构对比

| 方面           | 旧架构 (Goal-Task)             | 新架构 (Goal + plan) |
| -------------- | ------------------------------ | -------------------- |
| **结构**       | Goal → Task 双层               | Goal 单层            |
| **计划**       | Task 对象数组                  | plan 文本字段        |
| **操作**       | `type: "goal"`, `type: "task"` | 只有 goal 操作       |
| **灵活性**     | 受 Task 结构限制               | plan 可自由描述      |
| **复杂度**     | 高（两层管理）                 | 低（单层管理）       |
| **LLM 自主性** | 受限                           | 完全自主             |
| **代码量**     | ~800 行                        | ~350 行              |

---

## 🚀 最佳实践

### 1. 合理使用 plan 字段

```json
// ✅ 好：清晰的执行步骤
{
  "plan": "1. 向北探索寻找村庄 2. 与村民交易获取绿宝石 3. 返回基地"
}

// ❌ 差：过于模糊
{
  "plan": "去交易"
}
```

### 2. 为可自动检测的目标设置 tracker

```json
// ✅ 可自动完成
{
  "content": "收集20个橡木",
  "tracker": { "type": "collection", "itemName": "oak_log", "targetCount": 20 }
}

// ✅ 需要手动判断完成
{
  "content": "探索世界",
  "tracker": null
}
```

### 3. 设置合理的优先级

```json
// 紧急目标
{ "priority": 5 }

// 重要目标
{ "priority": 4 }

// 普通目标
{ "priority": 3 }
```

### 4. 及时更新计划

```json
// 当情况变化时，更新计划
{
  "operation": "update_plan",
  "id": "explore",
  "plan": "发现前方有岩浆湖，改为向东探索"
}
```

---

## 📚 相关文档

- [代理系统](agent-system.md) - 了解规划系统在 Agent 中的使用
- [决策循环](decision-loop.md) - 了解 ReAct 决策循环

---

_最后更新: 2026-02-28_
