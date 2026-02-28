# 状态管理 (State Management)

> 本文档介绍 Maicraft-Next 的状态管理系统，包括 GameState 和各种缓存系统

---

## 🎯 核心理念：实时状态，零查询

### Maicraft Python 的问题

```python
# ❌ 需要频繁调用查询动作
status = await mcp_client.call_tool("query_player_status", {})
health = status['data']['health']
food = status['data']['food']

inventory = await mcp_client.call_tool("query_inventory", {})
items = inventory['data']['items']

entities = await mcp_client.call_tool("query_nearby_entities", {})
```

**问题**：

- 每次获取状态都需要跨进程调用
- 占用 LLM 的工具调用额度
- 增加延迟和复杂度

### Maicraft-Next 的改进

```typescript
// ✅ 状态实时访问，零开销
const health = context.gameState.health;
const food = context.gameState.food;
const items = context.gameState.inventory;
const entities = context.gameState.nearbyEntities;
```

**优势**：

- 状态通过 EventManager 事件自动同步
- 任何地方都可以直接访问
- 零轮询开销
- LLM 可以在 prompt 中直接包含所有状态

---

## 📦 核心组件

### 1. GameState - 全局游戏状态

**职责**：实时同步游戏状态，是纯粹的"玩家/环境状态持有者"

> **重要变更 (2026-02)**：GameState 已精简，不再包含缓存代理方法。缓存系统通过 `RuntimeContext` 直接访问。

#### 状态分类

| 类别         | 属性             | 说明                                   |
| ------------ | ---------------- | -------------------------------------- |
| **玩家信息** | `playerName`     | 玩家名称                               |
|              | `gamemode`       | 游戏模式 (survival/creative/adventure) |
| **位置**     | `position`       | 精确坐标 (Vec3)                        |
|              | `blockPosition`  | 方块坐标 (Vec3)                        |
|              | `yaw`, `pitch`   | 视角方向                               |
|              | `onGround`       | 是否在地面                             |
| **生命值**   | `health`         | 当前生命值                             |
|              | `healthMax`      | 最大生命值                             |
|              | `armor`          | 护甲值                                 |
| **饥饿度**   | `food`           | 当前饥饿度                             |
|              | `foodMax`        | 最大饥饿度 (20)                        |
|              | `foodSaturation` | 饱和度                                 |
| **经验**     | `level`          | 等级                                   |
|              | `experience`     | 当前经验值                             |
| **氧气**     | `oxygenLevel`    | 氧气值 (最大 20)                       |
| **物品栏**   | `inventory`      | 物品列表                               |
|              | `equipment`      | 装备 (头盔/胸甲/护腿/鞋子/手持)        |
|              | `heldItem`       | 当前手持物品                           |
| **环境**     | `weather`        | 天气 (clear/rain/thunder)              |
|              | `timeOfDay`      | 游戏时间 (0-24000)                     |
|              | `dimension`      | 维度 (overworld/nether/end)            |
|              | `biome`          | 生物群系                               |
| **周围实体** | `nearbyEntities` | 附近的玩家和生物                       |
| **状态**     | `isSleeping`     | 是否在睡觉                             |

#### 基本使用

```typescript
// 初始化（在 bootstrap 中自动完成）
// GameState.initialize(bot, events) - 通过 EventManager 订阅事件

// 访问状态（通过 RuntimeContext）
const health = context.gameState.health;
const position = context.gameState.position;
const inventory = context.gameState.inventory;

// 获取格式化描述（用于 LLM）
const statusDesc = context.gameState.getStatusDescription();
const inventoryDesc = context.gameState.getInventoryDescription();
```

#### 自动同步机制

GameState 通过 EventManager 订阅事件自动同步，避免双重监听：

```typescript
// 内部实现（用户无需关心）
// 通过 EventManager 订阅，而非直接 bot.on()
events.on('health', () => {
  this.updateHealth(bot);
  this.updateFood(bot);
});

events.on('move', () => {
  this.updatePosition(bot);
});

events.on('experience', () => {
  this.updateExperience(bot);
});

// 周围实体每 1 秒更新一次
setInterval(() => {
  this.updateNearbyEntities(bot);
}, 1000);
```

#### 用于 LLM 的格式化输出

```typescript
// 状态描述
const statusDesc = context.gameState.getStatusDescription();
// 输出:
// 当前状态:
//   生命值: 20/20
//   饥饿值: 18/20
//   等级: 5 (经验: 150)
//
// 位置: (100, 64, 200)
// 维度: overworld
// ...

// 物品栏描述
const inventoryDesc = context.gameState.getInventoryDescription();
// 输出:
// 物品栏 (15/36):
//   iron_ore x10
//   coal x32
//   wooden_pickaxe x1
// ...

// 周围实体描述
const entitiesDesc = context.gameState.getNearbyEntitiesDescription();
// 输出:
// 周边16格内实体 (3):
//   1. zombie (距离: 8.5格)
//   2. cow (距离: 12.3格)
//   3. skeleton (距离: 15.0格)
```

### 2. 缓存系统（通过 RuntimeContext 访问）

> **重要**：缓存系统不再通过 GameState 访问，而是直接通过 `RuntimeContext` 访问。

#### BlockCache - 方块缓存

```typescript
// 获取方块
const block = context.blockCache.getBlock(100, 64, 200);

// 设置方块
context.blockCache.setBlock(100, 64, 200, {
  name: 'oak_log',
  type: 17,
  hardness: 2,
});

// 获取附近方块
const nearbyBlocks = context.blockCache.getBlocksInRadius(x, y, z, 16);

// 按名称查找方块
const diamonds = context.blockCache.findBlocksByName('diamond_ore');
```

#### ContainerCache - 容器缓存

```typescript
// 获取容器
const container = context.containerCache.getContainer(100, 64, 200, 'chest');

// 设置容器
context.containerCache.setContainer(100, 64, 200, 'chest', {
  type: 'chest',
  items: [...],
  size: 27
});

// 获取附近容器
const nearbyContainers = context.containerCache.getContainersInRadius(x, y, z, 32);

// 按物品查找容器
const chestsWithDiamond = context.containerCache.findContainersWithItem(264, 1);
```

#### CacheManager - 缓存管理器

```typescript
// 触发方块扫描
await context.cacheManager.triggerBlockScan(16);

// 触发容器更新
await context.cacheManager.triggerContainerUpdate();

// 获取统计信息
const stats = context.cacheManager.getStats();
```

#### NearbyBlockManager - 周边方块管理器

```typescript
// 获取可见方块信息（用于 LLM 提示词）
const blockInfo = context.nearbyBlockManager.getVisibleBlocksInfo({ x: 100, y: 64, z: 200 }, 50);
```

### 3. LocationManager - 地标管理

**职责**：管理玩家设置的地标（如家、矿洞入口等）

#### 基本使用

```typescript
// 设置地标
context.locationManager.setLocation('home', position, '我的家');
context.locationManager.setLocation('mine_entrance', position, '矿洞入口');

// 获取地标
const home = context.locationManager.getLocation('home');

// 删除地标
context.locationManager.deleteLocation('home');

// 查找附近地标
const nearby = context.locationManager.findNearby(position, 100);

// 获取所有地标描述（用于 LLM）
const locationsDesc = context.locationManager.getAllLocationsString();
// 输出:
// 已保存的地标 (共 2 个):
//   - home: (100, 64, 200) - 我的家
//   - mine_entrance: (150, 60, 250) - 矿洞入口

// 持久化
await context.locationManager.save();
await context.locationManager.load();
```

---

## 🔄 架构设计

### 职责分离

```
┌─────────────────────────────────────────────────────────────┐
│                     RuntimeContext                           │
├─────────────────────────────────────────────────────────────┤
│  gameState      │  blockCache  │  containerCache            │
│  (纯状态)        │  (方块缓存)   │  (容器缓存)                 │
│                 │              │                             │
│  locationManager│  cacheManager│  nearbyBlockManager        │
│  (地标管理)      │  (缓存管理)   │  (周边方块)                 │
└─────────────────────────────────────────────────────────────┘
```

**设计原则**：

- **GameState**：纯粹的玩家/环境状态持有者，不包含业务逻辑
- **缓存系统**：通过 RuntimeContext 统一访问，生命周期由 bootstrap 管理
- **单一职责**：每个组件只负责一个明确的功能

### 与 Maicraft Python 的对比

| 方面         | Maicraft Python              | Maicraft-Next              |
| ------------ | ---------------------------- | -------------------------- |
| **玩家状态** | `query_player_status` 工具   | `gameState.health` 等属性  |
| **物品栏**   | `query_inventory` 工具       | `gameState.inventory`      |
| **周围实体** | `query_nearby_entities` 工具 | `gameState.nearbyEntities` |
| **方块缓存** | 通过工具查询                 | `context.blockCache`       |
| **容器缓存** | 通过工具查询                 | `context.containerCache`   |
| **事件监听** | 多处重复监听                 | EventManager 统一分发      |
| **同步方式** | 需要主动查询                 | 事件驱动自动同步           |
| **性能开销** | 跨进程调用                   | 零开销内存访问             |

---

## 💻 在动作中使用状态

### 示例：在动作执行中访问状态

```typescript
export class MyAction extends BaseAction {
  async execute(context: RuntimeContext, params: any): Promise<ActionResult> {
    // 1. 检查生命值（通过 gameState）
    if (context.gameState.health < 10) {
      return this.failure('生命值过低，拒绝执行');
    }

    // 2. 检查物品栏
    const hasPickaxe = context.gameState.inventory.some(item => item.name.includes('pickaxe'));
    if (!hasPickaxe) {
      return this.failure('没有镐子');
    }

    // 3. 检查位置
    const pos = context.gameState.position;
    context.logger.info(`当前位置: ${pos.x}, ${pos.y}, ${pos.z}`);

    // 4. 使用方块缓存
    const nearbyBlocks = context.blockCache.getBlocksInRadius(pos.x, pos.y, pos.z, 16);

    // 5. 检查环境
    if (context.gameState.weather === 'thunder') {
      context.logger.warn('当前正在打雷，注意安全');
    }

    // 6. 执行动作逻辑
    // ...

    return this.success('执行成功');
  }
}
```

---

## 📚 在 LLM Prompt 中使用状态

### 示例：PromptDataCollector 收集数据

```typescript
// 在 PromptDataCollector 中
collectBasicInfo(): BaseInfoData {
  const { gameState, blockCache, containerCache, nearbyBlockManager } = this.state.context;

  return {
    // 玩家状态
    self_status_info: this.formatStatusInfo(gameState),
    inventory_info: gameState.getInventoryDescription(),
    position: this.formatPosition(gameState.blockPosition),

    // 环境信息
    nearby_block_info: this.getNearbyBlocksInfo(),  // 使用 nearbyBlockManager
    container_cache_info: this.getContainerCacheInfo(), // 使用 containerCache
    nearby_entities_info: gameState.getNearbyEntitiesDescription(),

    // ...
  };
}

private getNearbyBlocksInfo(): string {
  const { nearbyBlockManager, blockCache, bot, gameState } = this.state.context;

  // 优先使用 NearbyBlockManager
  if (nearbyBlockManager) {
    return nearbyBlockManager.getVisibleBlocksInfo(position, 50);
  }

  // 降级到 BlockCache
  const blocks = blockCache.getBlocksInRadius(x, y, z, 16);
  // ... 格式化输出
}
```

---

## 🚀 最佳实践

### 1. 通过 RuntimeContext 访问所有状态和缓存

```typescript
// ✅ 推荐：通过 context 访问
const health = context.gameState.health;
const blocks = context.blockCache.getBlocksInRadius(x, y, z, 16);
const containers = context.containerCache.getContainersInRadius(x, y, z, 32);

// ❌ 不推荐：尝试从其他途径访问
// 缓存系统不再挂载在 GameState 上
```

### 2. 在动作中检查关键状态

```typescript
// ✅ 在动作开始前检查状态
if (context.gameState.health < 5) {
  return this.failure('生命值过低');
}

// ✅ 在长时间执行中定期检查
for (let i = 0; i < 100; i++) {
  if (context.gameState.health < 5) {
    return this.failure('生命值过低，中止执行');
  }
  await doSomething();
}
```

### 3. 利用缓存系统提高效率

```typescript
// ✅ 记录发现的资源
context.blockCache.setBlock(x, y, z, blockData);

// ✅ 记录容器位置
context.containerCache.setContainer(x, y, z, 'chest', containerData);

// ✅ 设置重要地标
context.locationManager.setLocation('home', position, '我的家');
```

---

## 📚 相关文档

- [架构概览](architecture-overview.md) - 了解状态管理在整体架构中的位置
- [动作系统](action-system.md) - 了解如何在动作中使用状态
- [事件系统](event-system.md) - 了解 EventManager 如何分发事件
- [缓存优化说明](cache-optimization.md) - 方块缓存系统优化详解

---

_最后更新: 2026-02-28_
