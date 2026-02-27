# 容器操作事件循环阻塞问题修复

## 更新日志

- **2025-11-22 22:50** - 新增熔炉和合成超时问题修复
- **2025-11-22 22:38** - 初始版本：GUI 模式（箱子/熔炉）超时问题修复

---

# GUI 模式事件循环阻塞问题修复

## 问题描述

在 Agent 主循环中调用箱子/熔炉 GUI 模式时，`bot.openContainer()` 总是超时，无法触发 `windowOpen` 事件。但在 test-bot 单独测试环境中，相同的代码却能正常工作。

**错误现象**：

```
[QueryContainer] ⏰ 自定义超时（5秒），windowOpen监听器=2 个
容器查询失败: 自定义超时：5秒内未收到 windowOpen 事件
```

## 根本原因

### TypeScript 版本与原 Python 版本的架构差异

#### 原 Python 版本（maicraft）

```python
# 主循环
while not complete_goal:
    await next_thinking()  # 一次完整的决策+执行

# 执行动作时
elif action_type == "use_chest":
    await mode_manager.set_mode("chest_gui")
    gui = ChestSimGui(position, llm_client)
    result = await gui.chest_gui()  # ← 阻塞等待完成
    await mode_manager.set_mode("main_mode")
    return result  # 返回主循环
```

**特点**：箱子操作**阻塞等待**完成后才返回主循环，事件循环干净。

#### TypeScript 版本（修复前）

```typescript
// 主循环每次迭代
async runLoopIteration() {
    await checkAndGeneratePlan();      // 生成目标/计划（LLM调用）
    await executeCurrentMode();         // 执行当前模式
    // 方块扫描定时器持续运行
}

// MainMode 检测到 GUI 动作
if (isGUIAction(actionName)) {
    await handleGUIAction(actionName, action);
    break;  // ← 立即返回主循环！
}

// 主循环下一次迭代
await checkAndGeneratePlan();  // ← 开始生成目标（LLM调用）
await executeCurrentMode();    // ← 这时才执行箱子模式
```

**问题**：

1. GUI 模式切换后**立即返回主循环**
2. 主循环继续执行其他任务（目标生成、方块扫描）
3. 这些任务占用事件循环，导致 `bot.openContainer()` 的 `windowOpen` 事件被阻塞
4. 5 秒后触发自定义超时

## 解决方案

### 三个关键修复

#### 1. 在 MainMode 中直接执行并等待 GUI 模式完成（最关键）

**文件**：`src/core/agent/mode/modes/MainMode.ts`

```typescript
private async handleGUIAction(actionName: string, actionJson: any): Promise<string | null> {
    // ... 切换到 GUI 模式 ...
    await this.state.modeManager.setMode(targetMode, `LLM决策使用${actionName}`);

    // 🔧 关键修复：立即执行 GUI 模式，并等待完成
    const guiMode = this.state.modeManager.getAllModes().find(mode => mode.type === targetMode);
    if (guiMode) {
        await guiMode.execute();  // ← 阻塞等待
    }

    // GUI 操作完成后，切换回主模式
    await this.state.modeManager.setMode(ModeManager.MODE_TYPES.MAIN, 'GUI操作完成');

    return targetMode;
}
```

**效果**：主循环在 GUI 模式执行期间被阻塞，不会继续调度其他任务。

#### 2. 暂停方块扫描

**文件**：`src/core/cache/CacheManager.ts`

```typescript
export class CacheManager {
  private isPaused: boolean = false;

  pauseScanning(): void {
    this.isPaused = true;
  }

  resumeScanning(): void {
    this.isPaused = false;
  }

  private async onChunkLoad(chunkCorner: Vec3): Promise<void> {
    if (!this.blockCache || this.isPaused) return; // 检查暂停标志
    // ...
  }

  private async scanNearbyBlocks(): Promise<void> {
    if (!this.blockCache || !this.bot.entity || this.isScanning || this.isPaused) {
      return;
    }
    // ...
  }
}
```

**在 MainMode 中调用**：

```typescript
// GUI 模式执行前
const cacheManager = (this.state.context.gameState as any).cacheManager;
if (cacheManager) {
  cacheManager.pauseScanning();
}

// GUI 模式执行后
if (cacheManager) {
  cacheManager.resumeScanning();
}
```

**效果**：避免区块加载事件触发扫描，减少事件循环占用。

#### 3. 延迟目标生成

**文件**：`src/core/agent/Agent.ts`

```typescript
private async generateNewGoalAfterCompletion(completedGoal: Goal): Promise<void> {
    // 检查中断标志
    if (this.state.interrupt.isInterrupted()) {
        const reason = this.state.interrupt.getReason();
        this.logger.info(`⏸️ 检测到中断标志（${reason}），延迟生成新目标`);

        // 等待中断解除后再生成
        setTimeout(() => {
            if (!this.state.interrupt.isInterrupted()) {
                this.generateNewGoalAfterCompletion(completedGoal);
            }
        }, 2000);

        return;
    }

    // ... 正常生成目标 ...
}
```

**效果**：避免目标完成回调在 GUI 模式期间触发耗时的 LLM 调用。

### 设置中断标志

**文件**：`src/core/agent/mode/modes/MainMode.ts`

```typescript
// GUI 模式执行前
if (this.state.interrupt) {
  this.state.interrupt.trigger(`GUI模式执行中: ${targetMode}`);
}

// GUI 模式执行后
if (this.state.interrupt) {
  this.state.interrupt.clear();
}
```

**效果**：通知其他系统当前处于 GUI 模式，需要暂停某些操作。

## 修复效果

### 修复前

```
[2025-11-22 22:10:38] 🎯 LLM生成新目标...         ← 在箱子模式期间
[2025-11-22 22:10:38] 📋 正在为新目标生成计划...    ← 占用事件循环
[2025-11-22 22:10:41] 📦 方块扫描同步...           ← 占用事件循环
[2025-11-22 22:10:42] ⏰ 自定义超时（5秒）         ← windowOpen 被阻塞
```

### 修复后

```
[2025-11-22 22:38:46] [INFO] 🔄 开始执行 chest_gui 模式...
[2025-11-22 22:38:46] [INFO] ⏸️ 已暂停方块扫描
[2025-11-22 22:38:46] [INFO] 🔄 调用 bot.openContainer()...
[2025-11-22 22:38:47] [INFO] ✅ windowOpen 事件已触发      ← 成功！
[2025-11-22 22:38:47] [INFO] 容器已打开，类型: chest，耗时: 365ms
[2025-11-22 22:38:49] [INFO] ✅ chest_gui 模式执行完成
[2025-11-22 22:38:49] [INFO] ▶️ 已恢复方块扫描
```

## 总结

**核心思想**：让 GUI 模式的执行行为与原 Python 版本一致，即**阻塞主循环，等待 GUI 操作完成后再返回**。

这个修复不仅解决了箱子模式的问题，也适用于所有需要独占事件循环的操作场景。

## 扩展问题修复

### 问题3：熔炉查询失败

**错误**：

```
[ERROR] [QueryContainerAction] 查询容器内容失败: containerToOpen is neither a block nor an entity
```

**原因**：QueryContainerAction 对所有容器统一使用 `bot.openContainer()`，但**熔炉必须用 `bot.openFurnace()`**。

**修复**：

```typescript
// 在 QueryContainerAction.ts 的 queryContainerContents 方法中
const isFurnace = freshBlock.name === 'furnace' || freshBlock.name === 'blast_furnace' || freshBlock.name === 'smoker';
const openPromise = isFurnace ? context.bot.openFurnace(freshBlock) : context.bot.openContainer(freshBlock);
```

### 问题4：合成偶发超时

**错误**：

```
[ERROR] [CraftItemAction] 合成执行失败:
[WARN] [CraftItemAction] 合成失败: Error: Event windowOpen did not fire within timeout of 20000ms
```

**原因**：

- `bot.craft()` 内部会打开工作台窗口
- 合成是在主模式中直接执行的，不是 GUI 模式
- 如果恰好有方块扫描或其他任务在运行，就会超时
- **偶发性**：取决于扫描时机

**修复**：

```typescript
// 在 CraftManager.ts 的 performCrafting 方法中
// 从 gameState 获取 cacheManager
let cacheManager: any = null;
if ((this.bot as any).cacheManager) {
  cacheManager = (this.bot as any).cacheManager;
} else if ((this.bot as any).gameState?.cacheManager) {
  cacheManager = (this.bot as any).gameState.cacheManager;
}

// 暂停扫描
if (cacheManager && typeof cacheManager.pauseScanning === 'function') {
  cacheManager.pauseScanning();
}

try {
  await this.bot.craft(recipe, count, craftingTable);
} finally {
  // 恢复扫描
  if (cacheManager && typeof cacheManager.resumeScanning === 'function') {
    cacheManager.resumeScanning();
  }
}
```

## 相关文件

- `src/core/agent/mode/modes/MainMode.ts` - 主模式，处理 GUI 动作切换
- `src/core/agent/mode/modes/ChestMode.ts` - 箱子模式
- `src/core/agent/Agent.ts` - Agent 主类，目标生成
- `src/core/cache/CacheManager.ts` - 缓存管理器，方块扫描
- `src/core/actions/implementations/QueryContainerAction.ts` - 查询容器动作（熔炉修复）
- `src/core/actions/implementations/ManageContainerAction.ts` - 管理容器动作
- `src/core/crafting/CraftManager.ts` - 合成管理器（合成超时修复）

## 通用解决方案

**核心原则**：所有需要打开容器窗口的操作，在执行期间都应该：

1. 暂停方块扫描
2. 检查并设置中断标志（如果适用）
3. 使用正确的打开方法（`openContainer` vs `openFurnace`）
4. 操作完成后恢复扫描
