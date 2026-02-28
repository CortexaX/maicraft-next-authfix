# 动作系统 (Action System)

> 本文档介绍 Maicraft-Next 的动作系统设计和使用方式

---

## 📐 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    ActionExecutor                           │
│              (动作执行器 - 类型安全的动作调用)                  │
│                                                             │
│  ┌──────────────────────────────────────────────┐          │
│  │    Action Registry (Map<ActionId, Action>)   │          │
│  │  动作注册表 - 支持动态注册                      │          │
│  └──────────────────────────────────────────────┘          │
│                                                             │
│  ┌──────────────────────────────────────────────┐          │
│  │    Interrupt Controller                       │          │
│  │  中断控制 - 支持取消正在执行的动作               │          │
│  └──────────────────────────────────────────────┘          │
│                                                             │
│  ┌──────────────────────────────────────────────┐          │
│  │    Context Provider                           │          │
│  │  为每个动作创建 RuntimeContext                  │          │
│  └──────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
                         │
                         ├────────────────┐
                         ▼                ▼
              ┌────────────────┐  ┌────────────────┐
              │  MoveAction    │  │  MineAction    │
              └────────────────┘  └────────────────┘
                         ...
              15 个核心动作实现
```

---

## 🎯 设计理念

### 1. 去除查询类动作

**Maicraft Python 的问题**：

- 有大量查询类动作（`query_player_status`、`query_inventory`、`query_nearby_entities` 等）
- 需要频繁调用查询动作获取状态
- 占用 LLM 上下文空间
- 增加跨进程通信开销

**Maicraft-Next 的改进**：

- 所有状态通过 `GameState` 实时访问
- 去除 7 个查询类动作
- LLM 可以直接在 prompt 中获取所有状态信息

**对比**：

```typescript
// ❌ Maicraft Python: 需要查询动作
const statusResult = await mcpClient.callTool('query_player_status', {});
const health = statusResult.data.health;
const inventoryResult = await mcpClient.callTool('query_inventory', {});
const items = inventoryResult.data.items;

// ✅ Maicraft-Next: 直接访问
const health = context.gameState.health;
const items = context.gameState.inventory;
```

### 2. 精简动作列表

**Maicraft Python**: 25+ 个动作（含查询类）

**Maicraft-Next**: **17 个核心动作**

| 类别             | 动作                     | 说明                                  |
| ---------------- | ------------------------ | ------------------------------------- |
| **移动和探索**   | `move`                   | 移动到指定坐标                        |
|                  | `find_block`             | 搜索附近方块                          |
| **挖掘**         | `mine_block`             | 挖掘指定类型的方块                    |
|                  | `mine_block_by_position` | 挖掘指定位置的方块                    |
|                  | `mine_in_direction`      | 向指定方向挖掘                        |
| **建造和合成**   | `place_block`            | 放置方块                              |
|                  | `craft`                  | 合成物品                              |
| **智能容器交互** | `interact_chest`         | 智能箱子交互（内部 LLM 决策批量操作） |
|                  | `interact_furnace`       | 智能熔炉交互（内部 LLM 决策批量操作） |
| **传统容器操作** | `use_chest`              | 使用箱子（传统单次操作）              |
|                  | `use_furnace`            | 使用熔炉（传统单次操作）              |
| **生存**         | `eat`                    | 吃食物恢复饥饿度                      |
|                  | `toss_item`              | 丢弃物品                              |
|                  | `kill_mob`               | 击杀生物                              |
| **地标和交流**   | `set_location`           | 设置/更新/删除地标                    |
|                  | `chat`                   | 发送聊天消息                          |
|                  | `swim_to_land`           | 游到陆地（防溺水）                    |

### 3. 类型安全的动作调用

**使用 ActionIds 常量**：

```typescript
// ActionIds.ts
export const ActionIds = {
  MOVE: 'move',
  MINE_BLOCK: 'mine_block',
  CRAFT: 'craft',
  // ... 其他动作
} as const;

export type ActionId = (typeof ActionIds)[keyof typeof ActionIds];
```

**类型安全的调用**：

```typescript
// ✅ 编译时类型检查
await executor.execute(ActionIds.MOVE, { x: 100, y: 64, z: 200 });

// ❌ 编译错误：参数类型不匹配
await executor.execute(ActionIds.MOVE, { x: '100', y: 64, z: 200 });
//                                          ^^^ 类型 'string' 不能赋值给类型 'number'
```

**参数类型映射**：

```typescript
// types.ts
export interface ActionParamsMap {
  [ActionIds.MOVE]: MoveParams;
  [ActionIds.MINE_BLOCK]: MineBlockParams;
  [ActionIds.CRAFT]: CraftParams;
  // ... 其他动作参数
}

// 每个动作的参数类型
export interface MoveParams {
  x: number;
  y: number;
  z: number;
  timeout?: number;
}

export interface MineBlockParams {
  name: string;
  count?: number;
  maxDistance?: number;
}
```

### 4. 统一的执行流程

所有动作都遵循相同的执行流程：

```typescript
async execute(context: RuntimeContext, params: T): Promise<ActionResult>
```

**执行流程**：

1. 参数验证
2. 创建带前缀的 Logger
3. 创建 InterruptSignal（支持中断）
4. 构建 RuntimeContext
5. 执行动作逻辑
6. 记录日志和触发事件
7. 返回 ActionResult

---

## 💻 基本使用

### 1. 创建 ActionExecutor

```typescript
import { createBot } from 'mineflayer';
import { ActionExecutor } from '@/core/actions/ActionExecutor';
import { getLogger } from '@/utils/Logger';

// 创建 bot
const bot = createBot({
  host: 'localhost',
  port: 25565,
  username: 'MyBot',
});

// 创建 executor
const logger = getLogger('ActionExecutor');
const executor = new ActionExecutor(bot, logger);
```

### 2. 注册动作

```typescript
import { MoveAction, MineBlockAction, CraftItemAction } from '@/core/actions/implementations';

// 方式 1: 单个注册
executor.register(new MoveAction());

// 方式 2: 批量注册
executor.registerAll([
  new MoveAction(),
  new MineBlockAction(),
  new CraftItemAction(),
  // ... 其他动作
]);
```

### 3. 执行动作

```typescript
import { ActionIds } from '@/core/actions/ActionIds';

// 移动到坐标
const moveResult = await executor.execute(ActionIds.MOVE, {
  x: 100,
  y: 64,
  z: 200,
});

if (moveResult.success) {
  console.log('移动成功:', moveResult.message);
} else {
  console.log('移动失败:', moveResult.message);
}

// 挖掘方块
const mineResult = await executor.execute(ActionIds.MINE_BLOCK, {
  name: 'iron_ore',
  count: 10,
  maxDistance: 32,
});

// 合成物品
const craftResult = await executor.execute(ActionIds.CRAFT, {
  item: 'wooden_pickaxe',
  count: 1,
});
```

### 4. 中断动作

```typescript
// 在另一个线程或事件处理器中
executor.interruptAll('受到攻击');
// 当前正在执行的动作会收到中断信号并尽快停止
```

---

## 🔧 动作实现详解

### 动作基类

所有动作继承自 `BaseAction`:

```typescript
export abstract class BaseAction<T = any> implements Action<T> {
  abstract readonly id: ActionId;
  abstract readonly name: string;
  abstract readonly description: string;

  abstract execute(context: RuntimeContext, params: T): Promise<ActionResult>;

  // 便捷方法
  protected success(message: string, data?: any): ActionResult {
    return { success: true, message, data };
  }

  protected failure(message: string, error?: Error): ActionResult {
    return { success: false, message, error };
  }
}
```

### 示例：MoveAction

```typescript
import { BaseAction } from '../Action';
import { ActionIds } from '../ActionIds';
import { RuntimeContext } from '@/core/context/RuntimeContext';
import { ActionResult, MoveParams } from '../types';

export class MoveAction extends BaseAction<MoveParams> {
  readonly id = ActionIds.MOVE;
  readonly name = 'MoveAction';
  readonly description = '移动到指定坐标';

  async execute(context: RuntimeContext, params: MoveParams): Promise<ActionResult> {
    const { x, y, z, timeout = 60000 } = params;

    try {
      // 1. 验证参数
      if (x === undefined || y === undefined || z === undefined) {
        return this.failure('坐标参数不完整');
      }

      // 2. 记录日志
      const currentPos = context.bot.entity.position;
      context.logger.info(`开始移动: 从 (${currentPos.x}, ${currentPos.y}, ${currentPos.z}) 到 (${x}, ${y}, ${z})`);

      // 3. 执行移动逻辑
      const moveResult = await MovementUtils.moveToCoordinate(
        context.bot,
        Math.floor(x),
        Math.floor(y),
        Math.floor(z),
        1, // 到达距离
        200, // 最大移动距离
        false, // 不使用相对坐标
      );

      // 4. 返回结果
      if (moveResult.success) {
        return this.success(moveResult.message, {
          distance: moveResult.distance,
          position: moveResult.finalPosition,
        });
      } else {
        return this.failure(moveResult.message);
      }
    } catch (error) {
      const err = error as Error;
      context.logger.error('移动过程中发生错误:', err);
      return this.failure(`移动失败: ${err.message}`, err);
    }
  }
}
```

### RuntimeContext

每个动作执行时都会收到一个 `RuntimeContext`：

```typescript
interface RuntimeContext {
  bot: Bot; // Mineflayer bot 实例
  executor: ActionExecutor; // 动作执行器（可用于执行其他动作）
  gameState: GameState; // 游戏状态
  blockCache: BlockCache; // 方块缓存
  containerCache: ContainerCache; // 容器缓存
  locationManager: LocationManager; // 地标管理
  events: EventEmitter; // 事件管理器
  interruptSignal: InterruptSignal; // 中断信号
  logger: Logger; // 带前缀的日志记录器
  config: Config; // 配置对象
  llmManager?: LLMManager; // LLM 管理器（可选，用于 Action 内部 LLM 调用）
}
```

**使用示例**：

```typescript
async execute(context: RuntimeContext, params: MyParams): Promise<ActionResult> {
  // 访问游戏状态
  const health = context.gameState.health;

  // 使用日志（自动带动作名前缀）
  context.logger.info('开始执行');

  // 检查中断信号
  if (context.interruptSignal.isInterrupted()) {
    return this.failure('动作被中断');
  }

  // 访问方块缓存
  const blocks = context.blockCache.findNearby(position, 'iron_ore', 16);

  // 执行其他动作
  await context.executor.execute(ActionIds.CHAT, { message: '完成' });

  return this.success('执行成功');
}
```

---

## 🆚 与 Maicraft Python 的对比

### 动作数量

| Maicraft Python         | Maicraft-Next    | 变化               |
| ----------------------- | ---------------- | ------------------ |
| 25+ 个动作              | 15 个核心动作    | **去除查询类动作** |
| `query_player_status`   | (通过 GameState) | ✂️ 去除            |
| `query_inventory`       | (通过 GameState) | ✂️ 去除            |
| `query_nearby_entities` | (通过 GameState) | ✂️ 去除            |
| `query_nearby_blocks`   | (通过 GameState) | ✂️ 去除            |
| `query_game_state`      | (通过 GameState) | ✂️ 去除            |
| `break_block`           | `mine_block`     | ✅ 保留（重命名）  |
| `move`                  | `move`           | ✅ 保留            |
| `craft`                 | `craft`          | ✅ 保留            |
| ...                     | ...              | ...                |

### 调用方式

**Maicraft Python (MCP)**：

```python
# 通过 MCP 工具调用
result = await mcp_client.call_tool("move", {
    "x": 100,
    "y": 64,
    "z": 200
})
```

**Maicraft-Next (TypeScript)**：

```typescript
// 类型安全的直接调用
const result = await executor.execute(ActionIds.MOVE, {
  x: 100,
  y: 64,
  z: 200,
});
```

### 状态访问

**Maicraft Python**：

```python
# ❌ 需要查询
status = await mcp_client.call_tool("query_player_status", {})
health = status['data']['health']
inventory = await mcp_client.call_tool("query_inventory", {})
```

**Maicraft-Next**：

```typescript
// ✅ 直接访问
const health = context.gameState.health;
const inventory = context.gameState.inventory;
```

---

## 📚 所有动作详细说明

### 移动和探索

#### `move` - 移动到坐标

```typescript
await executor.execute(ActionIds.MOVE, {
  x: 100,
  y: 64,
  z: 200,
  timeout: 60000, // 可选
});
```

#### `find_block` - 搜索方块

```typescript
await executor.execute(ActionIds.FIND_BLOCK, {
  block: 'iron_ore',
  radius: 32,
  count: 5, // 找到 5 个就停止
});
```

### 挖掘

#### `mine_block` - 挖掘方块

```typescript
await executor.execute(ActionIds.MINE_BLOCK, {
  name: 'iron_ore',
  count: 10,
  maxDistance: 32,
});
```

#### `mine_block_by_position` - 按坐标挖掘

```typescript
await executor.execute(ActionIds.MINE_BLOCK_BY_POSITION, {
  x: 100,
  y: 64,
  z: 200,
});
```

#### `mine_in_direction` - 按方向挖掘

```typescript
import { Direction } from '@/core/actions/ActionIds';

await executor.execute(ActionIds.MINE_IN_DIRECTION, {
  direction: Direction.PLUS_X,
  distance: 5,
});
```

### 建造和合成

#### `place_block` - 放置方块

```typescript
await executor.execute(ActionIds.PLACE_BLOCK, {
  name: 'cobblestone',
  x: 100,
  y: 64,
  z: 200,
});
```

#### `craft` - 合成物品

```typescript
await executor.execute(ActionIds.CRAFT, {
  item: 'wooden_pickaxe',
  count: 1,
});
```

### 容器操作

#### `use_chest` - 使用箱子（传统）

```typescript
await executor.execute(ActionIds.USE_CHEST, {
  x: 100,
  y: 64,
  z: 200,
  operation: 'deposit', // 'deposit' 或 'withdraw'
  items: [{ name: 'iron_ingot', count: 10 }],
});
```

#### `use_furnace` - 使用熔炉（传统）

```typescript
await executor.execute(ActionIds.USE_FURNACE, {
  x: 100,
  y: 64,
  z: 200,
  input: { name: 'iron_ore', count: 10 },
  fuel: { name: 'coal', count: 5 },
});
```

### 智能容器交互（推荐）

#### `interact_chest` - 智能箱子交互

使用内部 LLM 进行批量存取操作，一次性完成多个物品的整理。

```typescript
await executor.execute(ActionIds.INTERACT_CHEST, {
  x: 100,
  y: 64,
  z: 200,
  intent: '整理库存，取出铁锭用于制作工具', // 可选，描述操作意图
});
```

**特点**：

- **内部 LLM 决策**：外层 ReAct 循环决定"做什么"，内层 LLM 决定"怎么做"
- **批量操作**：一次调用可执行多个存取操作
- **智能整理**：LLM 根据容器内容和背包情况自动决定最优操作
- **Diff 摘要**：返回操作前后的变化摘要

**性能对比**：
| 方式 | 5 个操作耗时 |
| --- | --- |
| 传统方式（5 次 ReAct） | 15-25 秒 |
| 智能交互（1 次 ReAct + 内部 LLM） | 5-7 秒 |

#### `interact_furnace` - 智能熔炉交互

使用内部 LLM 进行批量冶炼操作。

```typescript
await executor.execute(ActionIds.INTERACT_FURNACE, {
  x: 100,
  y: 64,
  z: 200,
  intent: '熔炼铁矿石，补充燃料并取出产物', // 可选
});
```

**支持的操作**：

- `put_items` + `slot: input` - 放入输入槽
- `put_items` + `slot: fuel` - 放入燃料槽
- `take_items` + `slot: output` - 取出输出槽
- `take_items` + `slot: input` - 取出输入槽
- `take_items` + `slot: fuel` - 取出燃料槽

**支持的熔炉类型**：

- 普通熔炉 (furnace)
- 高炉 (blast_furnace)
- 烟熏炉 (smoker)

### 生存

#### `eat` - 吃食物

```typescript
await executor.execute(ActionIds.EAT, {
  food: 'cooked_beef', // 可选，不指定则自动选择
});
```

#### `toss_item` - 丢弃物品

```typescript
await executor.execute(ActionIds.TOSS_ITEM, {
  name: 'dirt',
  count: 64,
});
```

#### `kill_mob` - 击杀生物

```typescript
await executor.execute(ActionIds.KILL_MOB, {
  mobType: 'zombie',
  maxDistance: 16,
});
```

### 地标和交流

#### `set_location` - 设置地标

```typescript
import { LocationActionType } from '@/core/actions/ActionIds';

// 设置新地标
await executor.execute(ActionIds.SET_LOCATION, {
  name: 'home',
  action: LocationActionType.SET,
  x: 100,
  y: 64,
  z: 200,
  description: '我的家',
});

// 删除地标
await executor.execute(ActionIds.SET_LOCATION, {
  name: 'home',
  action: LocationActionType.DELETE,
});
```

#### `chat` - 发送聊天

```typescript
await executor.execute(ActionIds.CHAT, {
  message: '你好！',
});
```

#### `swim_to_land` - 游到陆地

```typescript
await executor.execute(ActionIds.SWIM_TO_LAND, {
  maxDistance: 50,
});
```

---

## 🔧 高级特性

### 1. 动态注册动作

支持在运行时注册新动作：

```typescript
// 自定义动作
class MyCustomAction extends BaseAction<{ param: string }> {
  readonly id = 'my_custom_action';
  readonly name = 'MyCustomAction';
  readonly description = '自定义动作';

  async execute(context: RuntimeContext, params: { param: string }): Promise<ActionResult> {
    // 实现逻辑
    return this.success('执行成功');
  }
}

// 注册
executor.register(new MyCustomAction());

// 使用
await executor.execute('my_custom_action' as ActionId, { param: 'value' });
```

### 2. 中断机制

动作可以被中断：

```typescript
// 在动作执行中检查中断
async execute(context: RuntimeContext, params: T): Promise<ActionResult> {
  for (let i = 0; i < 100; i++) {
    // 检查中断信号
    if (context.interruptSignal.isInterrupted()) {
      return this.failure(`动作被中断: ${context.interruptSignal.reason}`);
    }

    // 执行步骤
    await doSomething();
  }

  return this.success('完成');
}
```

### 3. 事件监听

可以监听动作执行事件：

```typescript
// 监听动作完成
executor.getEventEmitter().on('actionComplete', data => {
  console.log(`动作 ${data.actionName} 完成，耗时 ${data.duration}ms`);
});

// 监听动作错误
executor.getEventEmitter().on('actionError', data => {
  console.error(`动作 ${data.actionName} 出错:`, data.error);
});
```

### 4. 智能容器交互架构

#### Action 内部 LLM 调用模式

智能容器交互动作（`interact_chest`、`interact_furnace`）采用"Action 内部 LLM 调用"模式：

```
外层 ReAct 循环 (主 LLM)     内层专用 LLM
        │                           │
        │  决定 "做什么"              │  决定 "怎么做"
        │  (是否操作容器)            │  (具体存取哪些物品)
        │                           │
        └─────────→ Action ──────────┘
                    │
                    ├── 构建专用 prompt (容器状态 + 背包 + 意图)
                    │
                    ├── context.llmManager.simpleChat(prompt)
                    │
                    ├── 解析 JSON 响应
                    │
                    └── 批量执行操作
```

**架构优势**：

- 不破坏 ReAct 原则：外层决定"做什么"，内层决定"怎么做"
- 无需改动 AgentLoop、ToolRegistry、InterruptSystem
- 对外层来说，Interact Action 只是一个"执行时间较长的工具"

**性能对比**：

| 方式                              | 5 个操作耗时 |
| --------------------------------- | ------------ |
| 传统方式（5 次 ReAct 循环）       | 15-25 秒     |
| 智能交互（1 次 ReAct + 内部 LLM） | 5-7 秒       |

**实现要点**：

```typescript
abstract class ContainerInteractAction extends BaseAction {
  abstract getContainerType(): string; // "chest" | "furnace"
  abstract getPromptTemplateName(): string; // "chest_operation"
  abstract readContainerState(container): string;
  abstract executeOperation(ctx, container, op): Promise<OpResult>;

  async execute(context, params) {
    // 1. 移动到容器 + 打开容器
    // 2. 读取容器状态
    const containerState = this.readContainerState(container);

    // 3. 生成专用 prompt
    const prompt = this.generatePrompt(context, {
      containerState,
      inventoryInfo: this.getInventoryInfo(context),
      intent: params.intent,
    });

    // 4. 内部 LLM 调用
    const llmResponse = await context.llmManager.simpleChat(prompt, systemPrompt);

    // 5. 解析 JSON 并批量执行
    const operations = this.parseOperations(llmResponse);
    for (const op of operations) {
      // 检查中断信号
      if (context.interruptSignal?.isInterrupted?.()) break;

      await this.executeOperation(context, container, op);
      await sleep(300); // 操作间隔
    }

    // 6. 计算 diff 摘要并返回
    return this.success(this.formatDiffSummary(diff));
  }
}
```

---

## 📚 相关文档

- [架构概览](architecture-overview.md) - 了解动作系统在整体架构中的位置
- [状态管理](state-management.md) - 了解 GameState 和缓存系统
- [事件系统](event-system.md) - 了解事件管理机制

---

_最后更新: 2026-02-28_
