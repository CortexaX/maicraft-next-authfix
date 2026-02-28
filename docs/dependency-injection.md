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
  interruptSignal: InterruptSignal;
  movementUtils: MovementUtils;
  placeBlockUtils: PlaceBlockUtils;
  craftManager: CraftManager;
  contextManager: ContextManager;
  actionExecutor: ActionExecutor;
  usageTracker: UsageTracker;
  llmManager: LLMManager;
  maiBotClient?: MaiBotClient;
  memoryManager: MemoryManager;
  interruptController: InterruptController;
  trackerFactory: TrackerFactory;
  loggerFactory: LoggerFactory;
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

  const gameState = new GameState({
    blockCache,
    containerCache,
    cacheManager,
    nearbyBlockManager,
  });

  return { blockCache, containerCache, locationManager, cacheManager, ... };
}
```

### initializeServices 详解

异步初始化需要启动的服务：

```typescript
export async function initializeServices(services: AppServices, bot: Bot, logger: Logger): Promise<void> {
  services.gameState.initialize(bot);

  if (services.maiBotClient) {
    await services.maiBotClient.start();
  }

  await services.memoryManager.initialize();
  await services.agent.initialize();
  await services.wsServer.start();
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
  services.contextManager.cleanup();
}
```

## 依赖注入模式

### 构造函数注入（推荐）

所有依赖通过构造函数传入：

```typescript
class GameState {
  readonly blockCache: BlockCache;
  readonly containerCache: ContainerCache;

  constructor(params: {
    blockCache: BlockCache;
    containerCache: ContainerCache;
    cacheManager: CacheManager;
    nearbyBlockManager: NearbyBlockManager;
  }) {
    this.blockCache = params.blockCache;
    this.containerCache = params.containerCache;
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

_这个文档展示了 Composition Root 模式的完整架构和使用方式。_
