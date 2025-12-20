/**
 * 应用程序启动配置
 * 在这里注册所有服务
 */

import { Container } from './Container';
import { ServiceKeys } from './ServiceKeys';
import { Lifetime } from './Container';

// 导入类型
import type { Bot } from 'mineflayer';
import type { AppConfig } from '@/utils/Config';
import type { Logger } from '@/utils/Logger';
import type { GameState } from '@/core/state/GameState';
import type { BlockCache } from '@/core/cache/BlockCache';
import type { ContainerCache } from '@/core/cache/ContainerCache';
import type { LocationManager } from '@/core/cache/LocationManager';
import type { PlaceBlockUtils } from '@/utils/PlaceBlockUtils';
import type { MovementUtils } from '@/utils/MovementUtils';

/**
 * 配置容器，注册所有服务
 */
export function configureServices(container: Container): void {
  // ==================== 1. 配置和日志 ====================
  // 注意：Config 和 Logger 需要在外部初始化后注册为实例
  // container.registerInstance(ServiceKeys.Config, config);
  // container.registerInstance(ServiceKeys.Logger, logger);

  // ==================== 2. Minecraft Bot ====================
  // Bot 需要根据配置创建，也需要外部初始化
  // container.registerInstance(ServiceKeys.Bot, bot);

  // ==================== 3. 核心状态系统 ====================

  // BlockCache (单例)
  container.registerSingleton(ServiceKeys.BlockCache, c => {
    const { BlockCache } = require('@/core/cache/BlockCache');
    return new BlockCache({
      maxEntries: 0, // 🔧 设为0表示无限制，完全依赖区块卸载事件清理
      expirationTime: 0, // 🔧 设为0表示永不过期，完全依赖区块卸载清理
      autoSaveInterval: 0, // 🔧 设为0禁用自动保存
      enabled: true, // ⚠️ 必须为true，否则整个缓存都不工作
      updateStrategy: 'smart' as const,
      onlyVisibleBlocks: true, // 🆕 只缓存可见方块，更拟人化且优化性能
    });
  });

  // ContainerCache (单例)
  container.registerSingleton(ServiceKeys.ContainerCache, c => {
    const { ContainerCache } = require('@/core/cache/ContainerCache');
    return new ContainerCache({
      maxEntries: 0, // 🔧 设为0表示无限制，完全依赖区块卸载事件清理
      expirationTime: 0, // 🔧 设为0表示永不过期，完全依赖区块卸载清理
      autoSaveInterval: 0, // 🔧 设为0禁用自动保存
      enabled: true, // ⚠️ 必须为true，否则整个缓存都不工作
      updateStrategy: 'smart' as const,
    });
  });

  // LocationManager (单例)
  container.registerSingleton(ServiceKeys.LocationManager, c => {
    const { LocationManager } = require('@/core/cache/LocationManager');
    return new LocationManager();
  });

  // CacheManager (单例)
  container.registerSingleton(ServiceKeys.CacheManager, c => {
    const { CacheManager } = require('@/core/cache/CacheManager');
    const bot = c.resolve<Bot>(ServiceKeys.Bot);
    const blockCache = c.resolve(ServiceKeys.BlockCache);
    const containerCache = c.resolve(ServiceKeys.ContainerCache);

    const managerConfig = {
      blockScanInterval: 5 * 1000, // 5秒（仅在启用定期扫描时使用）
      blockScanRadius: 50,
      containerUpdateInterval: 10 * 1000, // 10秒
      autoSaveInterval: 60 * 1000, // 1分钟
      enablePeriodicScan: false, // 🔧 关闭定期扫描，完全使用区块事件
      enableAutoSave: false, // 🔧 禁用自动保存，缓存已禁用持久化
      performanceMode: 'balanced' as const,
    };

    return new CacheManager(bot, blockCache, containerCache, managerConfig);
  });

  // NearbyBlockManager (单例)
  container.registerSingleton(ServiceKeys.NearbyBlockManager, c => {
    const { NearbyBlockManager } = require('@/core/cache/NearbyBlockManager');
    const blockCache = c.resolve(ServiceKeys.BlockCache);
    const bot = c.resolve<Bot>(ServiceKeys.Bot);

    return new NearbyBlockManager(blockCache, bot);
  });

  // GameState (单例，注入缓存和缓存管理器)
  container.registerSingleton(ServiceKeys.GameState, c => {
    const { GameState } = require('@/core/state/GameState');
    const blockCache = c.resolve(ServiceKeys.BlockCache);
    const containerCache = c.resolve(ServiceKeys.ContainerCache);
    const cacheManager = c.resolve(ServiceKeys.CacheManager);
    const nearbyBlockManager = c.resolve(ServiceKeys.NearbyBlockManager);

    const gameState = new GameState();
    // 注入缓存实例
    (gameState as any).blockCache = blockCache;
    (gameState as any).containerCache = containerCache;
    (gameState as any).cacheManager = cacheManager;
    (gameState as any).nearbyBlockManager = nearbyBlockManager;

    return gameState;
  });

  // GoalManager (单例) - 必须在ContextManager之前注册
  container.registerSingleton(ServiceKeys.GoalManager, c => {
    const { GoalManager } = require('@/core/agent/planning/goal/GoalManager');
    return new GoalManager();
  });

  // TaskManager (单例) - 必须在ContextManager之前注册
  container.registerSingleton(ServiceKeys.TaskManager, c => {
    const { TaskManager } = require('@/core/agent/planning/task/TaskManager');
    return new TaskManager();
  });

  // ContextManager (单例)
  container.registerSingleton(ServiceKeys.ContextManager, c => {
    const { ContextManager } = require('@/core/context/ContextManager');
    const contextManager = new ContextManager() as import('@/core/context/ContextManager').ContextManager;

    // 创建上下文（需要 bot, config, logger）
    const bot = c.resolve<Bot>(ServiceKeys.Bot);
    const config = c.resolve<AppConfig>(ServiceKeys.Config);
    const logger = c.resolve<Logger>(ServiceKeys.Logger);
    const gameState = c.resolve(ServiceKeys.GameState) as GameState;
    const blockCache = c.resolve(ServiceKeys.BlockCache) as BlockCache;
    const containerCache = c.resolve(ServiceKeys.ContainerCache) as ContainerCache;
    const locationManager = c.resolve(ServiceKeys.LocationManager) as LocationManager;
    const placeBlockUtils = c.resolve(ServiceKeys.PlaceBlockUtils) as PlaceBlockUtils;
    const movementUtils = c.resolve(ServiceKeys.MovementUtils) as MovementUtils;
    const craftManager = c.resolve(ServiceKeys.CraftManager) as import('@/core/crafting/CraftManager').CraftManager;
    const interruptSignal = c.resolve(ServiceKeys.InterruptSignal);
    const goalManager = c.resolve(ServiceKeys.GoalManager);
    const taskManager = c.resolve(ServiceKeys.TaskManager);

    contextManager.createContextWithDI({
      bot,
      executor: null as any, // 稍后通过 updateExecutor 注入
      config,
      logger,
      gameState,
      blockCache,
      containerCache,
      locationManager,
      interruptSignal,
      placeBlockUtils,
      movementUtils,
      craftManager,
      goalManager,
      taskManager,
    });

    return contextManager;
  });

  // ==================== 4. 动作系统 ====================

  // ActionExecutor (单例)
  container
    .registerSingleton(ServiceKeys.ActionExecutor, c => {
      const { ActionExecutor } = require('@/core/actions/ActionExecutor');
      const contextManager = c.resolve(ServiceKeys.ContextManager) as any;
      const logger = c.resolve<Logger>(ServiceKeys.Logger);
      const executor = new ActionExecutor(contextManager, logger);

      // 更新 ContextManager 中的 executor 引用
      contextManager.updateExecutor(executor);

      // 注册所有动作
      registerActions(executor, logger);

      return executor;
    })
    .withInitializer(ServiceKeys.ActionExecutor, (executor: any) => {
      // 设置事件监听
      const events = executor.getEventManager();

      events.on('actionComplete', (data: any) => {
        console.debug(`动作完成: ${data.actionName}`, {
          duration: data.duration,
          result: data.result.message,
        });
      });

      events.on('actionError', (data: any) => {
        console.error(`动作错误: ${data.actionName}`, data.error);
      });
    });

  // ==================== 5. LLM 系统 ====================

  // LLMManager (单例)
  container
    .registerSingleton(ServiceKeys.LLMManager, c => {
      const { LLMManager } = require('@/llm/LLMManager');
      const config = c.resolve<AppConfig>(ServiceKeys.Config);
      const usageTracker = c.resolve(ServiceKeys.UsageTracker);
      const logger = c.resolve(ServiceKeys.Logger);
      return new LLMManager(config.llm, usageTracker, logger);
    })
    .withInitializer(ServiceKeys.LLMManager, async (llmManager: any) => {
      const logger = llmManager.logger;
      logger.info('✅ LLM管理器初始化完成', {
        provider: llmManager.getActiveProvider(),
      });

      // 执行健康检查
      const health = await llmManager.healthCheck();
      logger.info('LLM提供商健康检查', { health });
    })
    .withDisposer(ServiceKeys.LLMManager, (llmManager: any) => {
      llmManager.close();
    });

  // ==================== 6. AI 代理系统 ====================

  // MaiBotClient (单例)
  // 注意：MaiBotClient 会在后台异步连接，不会阻塞应用启动
  container
    .registerSingleton(ServiceKeys.MaiBotClient, c => {
      const { MaiBotClient } = require('@/core/agent/communication/MaiBotClient');
      const config = c.resolve<AppConfig>(ServiceKeys.Config);
      return new MaiBotClient(config.maibot);
    })
    .withInitializer(ServiceKeys.MaiBotClient, async (client: any) => {
      // start() 方法已经是非阻塞的，会在后台连接
      // 即使连接失败也不会抛出异常，而是自动重试
      await client.start();
    })
    .withDisposer(ServiceKeys.MaiBotClient, async (client: any) => {
      try {
        await client.stop();
      } catch (error) {
        // 忽略停止时的错误
      }
    });

  // MemoryManager (单例)
  container
    .registerSingleton(ServiceKeys.MemoryManager, async c => {
      const { MemoryManager } = require('@/core/agent/memory/MemoryManager');
      const config = c.resolve<AppConfig>(ServiceKeys.Config);
      const logger = c.resolve<Logger>(ServiceKeys.Logger);
      const memory = new MemoryManager();
      memory.setBotConfig(config);

      // 设置 MaiBot 客户端（如果启用）
      if (config.maibot.enabled) {
        try {
          const maibotClient = await c.resolveAsync(ServiceKeys.MaiBotClient);
          memory.setMaiBotClient(maibotClient);
        } catch (error) {
          // MaiBot 客户端初始化失败，但不影响 MemoryManager 的正常工作
          logger.warn('⚠️ MaiBot 客户端初始化失败，记忆管理器将在无 MaiBot 模式下运行', { error: (error as Error).message });
        }
      }

      return memory;
    })
    .withInitializer(ServiceKeys.MemoryManager, async (memory: any) => {
      await memory.initialize();
    })
    .withDisposer(ServiceKeys.MemoryManager, async (memory: any) => {
      await memory.saveAll();
    });

  // ModeManager (单例)
  container.registerSingleton(ServiceKeys.ModeManager, c => {
    const { ModeManager } = require('@/core/agent/mode/ModeManager');
    const executor = c.resolve(ServiceKeys.ActionExecutor) as any;
    const context = executor.getContextManager().getContext();
    return new ModeManager(context);
  });

  // InterruptController (单例)
  container.registerSingleton(ServiceKeys.InterruptController, c => {
    const { InterruptController } = require('@/core/agent/InterruptController');
    return new InterruptController();
  });

  // InterruptSignal (单例 - 系统级中断信号)
  container.registerSingleton(ServiceKeys.InterruptSignal, c => {
    const { InterruptSignal } = require('@/core/interrupt/InterruptSignal');
    return new InterruptSignal();
  });

  // StructuredOutputManager (瞬态 - 每次创建新实例)
  container.registerTransient(ServiceKeys.StructuredOutputManager, c => {
    const { StructuredOutputManager } = require('@/core/agent/structured/StructuredOutputManager');
    const llmManager = c.resolve(ServiceKeys.LLMManager);
    return new StructuredOutputManager(llmManager, {
      useStructuredOutput: true,
    });
  });

  // TrackerFactory (单例)
  container.registerSingleton(ServiceKeys.TrackerFactory, c => {
    const { TrackerFactory } = require('@/core/agent/planning/trackers/TrackerFactory');
    return new TrackerFactory();
  });

  // LoggerFactory (单例)
  container.registerSingleton(ServiceKeys.LoggerFactory, c => {
    const { LoggerFactory } = require('@/utils/Logger');
    return new LoggerFactory();
  });

  // ConfigLoader (单例)
  container.registerSingleton(ServiceKeys.ConfigLoader, c => {
    const { ConfigLoader } = require('@/utils/Config');
    return new ConfigLoader();
  });

  // PromptManager (单例)
  container.registerSingleton(ServiceKeys.PromptManager, c => {
    const { PromptManager } = require('@/core/agent/prompt/prompt_manager');
    return new PromptManager();
  });

  // PromptOverrideManager (单例)
  container.registerSingleton(ServiceKeys.PromptOverrideManager, c => {
    const { createPromptOverrideManager } = require('@/core/agent/communication/promptOverrideManager');
    const { getDefaultOverrideTemplates } = require('@/core/agent/communication/templates/overrideTemplates');

    // 使用默认的覆盖模板配置
    const overrideTemplates = getDefaultOverrideTemplates();

    return createPromptOverrideManager(overrideTemplates);
  });

  // PlaceBlockUtils (单例)
  container.registerSingleton(ServiceKeys.PlaceBlockUtils, c => {
    const { PlaceBlockUtils } = require('@/utils/PlaceBlockUtils');
    const logger = c.resolve(ServiceKeys.Logger);
    const movementUtils = c.resolve(ServiceKeys.MovementUtils);
    return new PlaceBlockUtils(logger, movementUtils);
  });

  // MovementUtils (单例)
  container.registerSingleton(ServiceKeys.MovementUtils, c => {
    const { MovementUtils } = require('@/utils/MovementUtils');
    const logger = c.resolve(ServiceKeys.Logger);
    return new MovementUtils(logger);
  });

  // CraftManager (单例)
  container.registerSingleton(ServiceKeys.CraftManager, c => {
    const { CraftManager } = require('@/core/crafting/CraftManager');
    const bot = c.resolve(ServiceKeys.Bot);
    return new CraftManager(bot);
  });

  // UsageTracker (单例)
  container.registerSingleton(ServiceKeys.UsageTracker, c => {
    const { UsageTracker } = require('@/llm/usage/UsageTracker');
    const config = c.resolve(ServiceKeys.Config) as AppConfig;
    const logger = c.resolve(ServiceKeys.Logger);
    return new UsageTracker(config.llm, logger);
  });

  // Agent (单例)
  container
    .registerSingleton(ServiceKeys.Agent, async c => {
      const { Agent } = require('@/core/agent/Agent');
      const bot = c.resolve<Bot>(ServiceKeys.Bot);
      const executor = c.resolve(ServiceKeys.ActionExecutor);
      const llmManager = await c.resolveAsync(ServiceKeys.LLMManager);
      const config = c.resolve<AppConfig>(ServiceKeys.Config);
      const logger = c.resolve<Logger>(ServiceKeys.Logger);
      const memory = await c.resolveAsync(ServiceKeys.MemoryManager);
      const modeManager = c.resolve(ServiceKeys.ModeManager);
      const interrupt = c.resolve(ServiceKeys.InterruptController);

      return new Agent(bot, executor, llmManager, config, memory, modeManager, interrupt, logger);
    })
    .withInitializer(ServiceKeys.Agent, async (agent: any) => {
      await agent.initialize();
    })
    .withDisposer(ServiceKeys.Agent, async (agent: any) => {
      await agent.stop();
    });

  // ==================== 7. API 服务 ====================

  // WebSocketServer (单例)
  container
    .registerSingleton(ServiceKeys.WebSocketServer, c => {
      const { WebSocketServer } = require('@/api/WebSocketServer');
      return new WebSocketServer();
    })
    .withInitializer(ServiceKeys.WebSocketServer, async (wsServer: any) => {
      await wsServer.start();
    })
    .withDisposer(ServiceKeys.WebSocketServer, async (wsServer: any) => {
      await wsServer.stop();
    });
}

/**
 * 注册所有动作
 */
function registerActions(executor: any, logger: Logger): void {
  const {
    ChatAction,
    MoveAction,
    MoveToLocationAction,
    MoveToEntityAction,
    MoveToBlockAction,
    FindBlockAction,
    MineAtPositionAction,
    MineByTypeAction,
    PlaceBlockAction,
    CraftItemAction,
    MineInDirectionAction,
    UseChestAction,
    UseFurnaceAction,
    OpenChestGUIAction,
    OpenFurnaceGUIAction,
    QueryContainerAction,
    ManageContainerAction,
    EatAction,
    TossItemAction,
    KillMobAction,
    SwimToLandAction,
    SetLocationAction,
  } = require('@/core/actions/implementations');

  const { PlanAction } = require('@/core/actions/implementations/PlanAction');

  const actions = [
    // 规划管理
    new PlanAction(),

    // P0 核心动作
    new ChatAction(),
    new MoveAction(),
    new MoveToLocationAction(),
    new MoveToEntityAction(),
    new MoveToBlockAction(),
    new FindBlockAction(),
    new MineAtPositionAction(),
    new MineByTypeAction(),
    new PlaceBlockAction(),
    new CraftItemAction(),
    new MineInDirectionAction(),

    // 容器操作
    new UseChestAction(),
    new UseFurnaceAction(),
    new OpenChestGUIAction(),
    new OpenFurnaceGUIAction(),
    new QueryContainerAction(),
    new ManageContainerAction(),

    // 生存相关
    new EatAction(),
    new TossItemAction(),
    new KillMobAction(),

    // 移动和探索
    new SwimToLandAction(),

    // 地标管理
    new SetLocationAction(),
  ];

  executor.registerAll(actions);
  logger.info(`✅ 已注册 ${actions.length} 个动作`);
}
