# Composition Root 模式 - 服务组装指南

## 概述

本项目使用 **Composition Root** 模式进行依赖管理，这是一种简洁、类型安全的依赖注入方式。相比传统的 DI 容器，它具有：

- **零运行时开销**：静态 import，无动态解析
- **完整类型安全**：编译时检查所有依赖
- **显式依赖图**：依赖关系一目了然
- **易于调试**：直接跳转到定义，无反射魔法

## 核心架构

### AppServices 接口

所有服务的类型定义：

```typescript
export interface AppServices {
  blockCache: BlockCache;
  containerCache: ContainerCache;
  locationManager: LocationManager;
  cacheManager: CacheManager;
  nearbyBlockManager: NearbyBlockManager;
  gameState: GameState;
  goalManager: GoalManager;
  movementUtils: MovementUtils;
  placeBlockUtils: PlaceBlockUtils;
  craftManager: CraftManager;
  contextManager: ContextManager;
  actionExecutor: ActionExecutor;
  usageTracker: UsageTracker;
  llmManager: LLMManager;
  maiBotClient?: MaiBotClient;
  memoryManager: MemoryManager;
  memoryService: MemoryServiceImpl;
  interruptManager: InterruptManager;
  trackerFactory: TrackerFactory;
  configLoader: ConfigLoader;
  promptManager: PromptManager;
  promptOverrideManager: ReturnType<typeof createPromptOverrideManager>;
  agent: Agent;
  wsServer: WebSocketServer;
}
```

### 三个核心函数

```typescript
export function createServices(bot: Bot, config: AppConfig, logger: Logger): AppServices;

export async function initializeServices(services: AppServices, bot: Bot, logger: Logger): Promise<void>;

export async function disposeServices(services: AppServices): Promise<void>;
```

## 使用方式

### 基本使用

```typescript
import { createServices, initializeServices, disposeServices, type AppServices } from '@/core/di';

class MaicraftNext {
  private services?: AppServices;

  async initialize(): Promise<void> {
    this.services = createServices(bot, config, logger);
    await initializeServices(this.services, bot, logger);
    await this.services.agent.start();
  }

  async shutdown(): Promise<void> {
    if (this.services) {
      await disposeServices(this.services);
    }
  }
}
```

### createServices 详解

创建所有服务实例，依赖通过变量声明顺序保证：

```typescript
export function createServices(bot: Bot, config: AppConfig, logger: Logger): AppServices {
  const blockCache = new BlockCache({ ... });
  const containerCache = new ContainerCache({ ... });
  const locationManager = new LocationManager();
  const cacheManager = new CacheManager(bot, blockCache, containerCache, { ... });
  const nearbyBlockManager = new NearbyBlockManager(blockCache, bot);

  // GameState 不再需要缓存参数，它是纯粹的状态持有者
  const gameState = new GameState();

  // ContextManager 现在需要 cacheManager 和 nearbyBlockManager
  const contextManager = new ContextManager({
    bot,
    config,
    logger,
    gameState,
    blockCache,
    containerCache,
    locationManager,
    cacheManager,
    nearbyBlockManager,
    signal: new AbortController().signal,
    placeBlockUtils,
    movementUtils,
    craftManager,
    goalManager,
  });

  return { blockCache, containerCache, locationManager, cacheManager, ... };
}
```

### initializeServices 详解

异步初始化需要启动的服务：

```typescript
export async function initializeServices(services: AppServices, bot: Bot, logger: Logger): Promise<void> {
  // 获取 EventManager（通过 ActionExecutor）
  const events = services.actionExecutor.getEventManager();

  // GameState 通过 EventManager 订阅事件，避免双重监听
  services.gameState.initialize(bot, events);

  // 启动缓存系统
  await startCacheSystem(services, logger);

  if (services.maiBotClient) {
    await services.maiBotClient.start();
  }

  await services.memoryManager.initialize();
  await services.agent.initialize();
  await services.wsServer.start();
}

async function startCacheSystem(services: AppServices, logger: Logger): Promise<void> {
  await services.blockCache.load();
  await services.containerCache.load();
  services.cacheManager.start();
  await services.cacheManager.triggerBlockScan();
}
```

### disposeServices 详解

按正确顺序销毁所有服务：

```typescript
export async function disposeServices(services: AppServices): Promise<void> {
  await services.wsServer.stop();
  await services.agent.stop();
  await services.memoryManager.saveAll();

  if (services.maiBotClient) {
    await services.maiBotClient.stop();
  }

  services.llmManager.close();

  // 清理 ContextManager（包括 GameState 的事件监听）
  services.contextManager.cleanup();

  // 销毁缓存系统
  services.cacheManager.destroy();
  services.blockCache.destroy();
  services.containerCache.destroy();
}
```

## 依赖注入模式

### 构造函数注入（推荐）

所有依赖通过构造函数传入：

```typescript
// GameState 不再需要缓存参数，它是纯粹的状态持有者
class GameState {
  private logger: Logger;

  playerName: string = '';
  health: number = 20;
  // ... 其他状态属性

  constructor() {
    this.logger = getLogger('GameState');
  }

  initialize(bot: Bot, events: EventManager): void {
    // 通过 EventManager 订阅事件，避免双重监听
  }
}

// ContextManager 现在需要 cacheManager 和 nearbyBlockManager
class ContextManager {
  private context: RuntimeContext;

  constructor(params: {
    bot: Bot;
    gameState: GameState;
    blockCache: BlockCache;
    containerCache: ContainerCache;
    locationManager: LocationManager;
    cacheManager: CacheManager; // 新增
    nearbyBlockManager: NearbyBlockManager; // 新增
    // ...
  }) {
    this.context = {
      bot: params.bot,
      gameState: params.gameState,
      blockCache: params.blockCache,
      containerCache: params.containerCache,
      locationManager: params.locationManager,
      cacheManager: params.cacheManager,
      nearbyBlockManager: params.nearbyBlockManager,
      // ...
    };
  }
}
```

### 循环依赖处理

使用两阶段初始化解决循环依赖：

```typescript
class ContextManager {
  private context: RuntimeContext;

  constructor(params: ContextManagerParams) {
    this.context = {
      executor: null,
    };
  }

  updateExecutor(executor: ActionExecutor): void {
    this.context.executor = executor;
  }
}

const contextManager = new ContextManager({ ... });
const actionExecutor = new ActionExecutor(contextManager, logger);
contextManager.updateExecutor(actionExecutor);
```

## 配置集成

缓存配置从 `AppConfig.cache` 读取：

```typescript
const blockCache = new BlockCache({
  maxEntries: config.cache.max_block_entries,
  expirationTime: config.cache.block_expiration_time,
  onlyVisibleBlocks: config.cache.only_visible_blocks,
});
```

## RuntimeContext 结构

RuntimeContext 是所有 Action 的上下文，包含所有必要的服务：

```typescript
export interface RuntimeContext {
  bot: Bot;
  executor: ActionExecutor | null;
  gameState: GameState; // 玩家/环境状态
  blockCache: BlockCache; // 方块缓存
  containerCache: ContainerCache; // 容器缓存
  locationManager: LocationManager; // 地标管理
  cacheManager: CacheManager; // 缓存管理器
  nearbyBlockManager: NearbyBlockManager; // 周边方块管理
  events: EventManager; // 事件系统
  signal: AbortSignal;
  logger: Logger;
  config: Config;
  placeBlockUtils: PlaceBlockUtils;
  movementUtils: MovementUtils;
  craftManager: CraftManager;
  goalManager: GoalManager;
  llmManager?: LLMManager;
}
```

## 与 DI 容器的对比

| 特性       | DI 容器        | Composition Root |
| ---------- | -------------- | ---------------- |
| 运行时开销 | 有             | 无               |
| 类型安全   | 部分运行时检查 | 完整编译时检查   |
| 调试体验   | 跳转困难       | 直接跳转定义     |
| 代码量     | 较多           | 较少             |
| 依赖可见性 | 分散在各处     | 集中在一个文件   |

## 测试支持

```typescript
const mockBot = createMockBot();
const mockConfig = createTestConfig();
const mockLogger = createTestLogger();

const services = createServices(mockBot, mockConfig, mockLogger);
await initializeServices(services, mockBot, mockLogger);

expect(services.gameState).toBeDefined();
```

## 文件结构

```
src/core/di/
├── bootstrap.ts    # Composition Root
└── index.ts        # 导出公共 API
```

---

_最后更新: 2026-02-28_
