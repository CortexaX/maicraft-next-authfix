# CollectionTracker 使用指南

## 概述

CollectionTracker 是基于 PlayerCollect 事件的物品收集追踪器，用于追踪新获取的物品数量，而不是背包中已有的物品数量。

## 核心特性

| 特性     | 说明                               |
| -------- | ---------------------------------- |
| 追踪内容 | 新获取的物品数量                   |
| 驱动方式 | 事件驱动 (基于 playerCollect 事件) |
| 重置能力 | 支持重置计数                       |
| 适用场景 | 收集任务、资源采集追踪             |

## 使用示例

### 创建 CollectionTracker

```typescript
// 创建一个追踪收集64个原木的追踪器
const collectionTracker = trackerFactory.createCollectionTracker('oak_log', 64);

// 或者使用 JSON 配置创建
const trackerConfig = {
  type: 'collection',
  itemName: 'oak_log',
  targetCount: 64,
};
const collectionTracker = trackerFactory.fromJSON(trackerConfig);
```

### 检查进度

```typescript
// 检查是否完成
const isCompleted = collectionTracker.checkCompletion(context);

// 获取进度信息
const progress = collectionTracker.getProgress(context);
console.log(`进度: ${progress.description} (${progress.percentage.toFixed(2)}%)`);
```

### 重置追踪器

```typescript
// 重置收集计数（用于开始新的收集任务）
collectionTracker.reset();
```

### 销毁追踪器

```typescript
// 当不再需要时，销毁追踪器以释放资源
collectionTracker.destroy();
```

## 典型使用场景

### 1. 收集任务

当机器人需要收集特定数量的物品时，使用 CollectionTracker 可以避免"背包中已有物品"的干扰：

```typescript
// 即使背包中已经有64个原木，这个任务也会追踪新收集的64个原木
const collectLogsGoal = new Goal('收集64个原木', new Task('收集原木', trackerFactory.createCollectionTracker('oak_log', 64)));
```

### 2. 资源收集追踪

在大型项目中，可以追踪多种资源的收集进度：

```typescript
const resourceTrackers = {
  oakLogs: trackerFactory.createCollectionTracker('oak_log', 128),
  cobblestone: trackerFactory.createCollectionTracker('cobblestone', 256),
  ironOre: trackerFactory.createCollectionTracker('iron_ore', 32),
};

// 获取所有资源的收集进度
const allProgress = Object.entries(resourceTrackers).map(([name, tracker]) => {
  const progress = tracker.getProgress(context);
  return { resource: name, ...progress };
});
```

## 注意事项

1. **事件依赖**：CollectionTracker 依赖 playerCollect 事件，确保 EventManager 已正确初始化。
2. **资源清理**：当不再需要 CollectionTracker 时，请调用 destroy() 方法以避免内存泄漏。
3. **重置时机**：在开始新的收集任务前，记得调用 reset() 方法重置计数。
4. **物品名称**：确保使用正确的物品名称，参考 Minecraft 物品 ID 规范。

## 性能考虑

CollectionTracker 使用事件驱动机制，性能开销极小：

- 只有在物品被收集时才会更新计数
- 不需要遍历背包，避免了 O(n) 的查询复杂度
- 内存占用仅为几字节，用于存储计数

## 扩展功能

CollectionTracker 还支持以下高级功能：

1. **范围追踪**：设置最小和最大收集数量
2. **多物品追踪**：通过 getAllCollectedItems() 获取所有物品的收集情况
3. **事件过滤**：只追踪机器人自己收集的物品，忽略其他玩家的收集行为

这些功能使 CollectionTracker 成为解决收集任务追踪问题的理想选择。
