import type { Bot } from 'mineflayer';
import type { AppConfig } from '@/utils/Config';
import type { Logger } from '@/utils/Logger';
import { GlobalLoggerManager } from '@/utils/Logger';
import { getConfigManager } from '@/utils/Config';
import { BlockCache } from '@/core/cache/BlockCache';
import { ContainerCache } from '@/core/cache/ContainerCache';
import { LocationManager } from '@/core/cache/LocationManager';
import { NearbyBlockManager } from '@/core/cache/NearbyBlockManager';
import { GameState } from '@/core/state/GameState';
import { ContextManager } from '@/core/context/ContextManager';
import { ActionExecutor } from '@/core/actions/ActionExecutor';
import { LLMManager } from '@/llm/LLMManager';
import { UsageTracker } from '@/llm/usage/UsageTracker';
import { MaiBotClient } from '@/core/agent/communication/MaiBotClient';
import { MemoryManager } from '@/core/agent/memory/MemoryManager';
import { GoalManager } from '@/core/agent/planning/goal/GoalManager';
import { TrackerFactory } from '@/core/agent/planning/trackers/TrackerFactory';
import { ConfigLoader } from '@/utils/Config';
import { PromptManager } from '@/core/agent/prompt/prompt_manager';
import { createPromptOverrideManager } from '@/core/agent/communication/promptOverrideManager';
import { getDefaultOverrideTemplates } from '@/core/agent/communication/templates/overrideTemplates';
import { PlaceBlockUtils } from '@/utils/PlaceBlockUtils';
import { MovementUtils } from '@/utils/MovementUtils';
import { CraftManager } from '@/core/crafting/CraftManager';
import { Agent } from '@/core/agent/Agent';
import { WebSocketServer } from '@/api/WebSocketServer';
import { InterruptManager } from '@/core/interrupt';
import { EventBus } from '@/core/events/EventBus';
import { MemoryServiceImpl } from '@/core/agent/memory/MemoryServiceImpl';
import { WebSocketAdapter } from '@/core/agent/memory/integrations/WebSocketAdapter';
import { MaiBotAdapter } from '@/core/agent/memory/integrations/MaiBotAdapter';
import {
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
  ChestInteractAction,
  FurnaceInteractAction,
  EatAction,
  TossItemAction,
  KillMobAction,
  SwimToLandAction,
  SetLocationAction,
} from '@/core/actions/implementations';
import { PlanAction } from '@/core/actions/implementations/PlanAction';

export interface AppServices {
  blockCache: BlockCache;
  containerCache: ContainerCache;
  locationManager: LocationManager;
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

export function createServices(bot: Bot, config: AppConfig, logger: Logger): AppServices {
  const blockCache = new BlockCache({
    expirationTime: 0,
    autoSaveInterval: 0,
    enabled: true,
    onlyVisibleBlocks: config.cache.only_visible_blocks,
  });

  const containerCache = new ContainerCache({
    expirationTime: config.cache.container_expiration_time,
    autoSaveInterval: config.cache.enable_auto_save ? 60000 : 0,
    enabled: true,
  });

  const locationManager = new LocationManager();

  blockCache.attachBot(bot);

  const nearbyBlockManager = new NearbyBlockManager(blockCache, bot);

  const gameState = new GameState();

  const goalManager = new GoalManager();

  const movementUtils = new MovementUtils(logger);
  const placeBlockUtils = new PlaceBlockUtils(logger, movementUtils);
  const craftManager = new CraftManager(bot);

  const contextManager = new ContextManager({
    bot,
    config,
    logger,
    gameState,
    blockCache,
    containerCache,
    locationManager,
    nearbyBlockManager,
    signal: new AbortController().signal,
    placeBlockUtils,
    movementUtils,
    craftManager,
    goalManager,
  });

  const actionExecutor = new ActionExecutor(contextManager, logger);
  contextManager.updateExecutor(actionExecutor);
  registerActions(actionExecutor, logger);

  const usageTracker = new UsageTracker(config.llm, logger);
  const llmManager = new LLMManager(config.llm, usageTracker, logger);

  let maiBotClient: MaiBotClient | undefined;
  if (config.maibot.enabled) {
    maiBotClient = new MaiBotClient(config.maibot);
  }

  const eventBus = EventBus.getInstance();
  const memoryManager = new MemoryManager(config, logger, eventBus);
  const memoryService = new MemoryServiceImpl(memoryManager, eventBus);

  const interruptManager = new InterruptManager(gameState, actionExecutor.getEventBus());
  const trackerFactory = new TrackerFactory(actionExecutor.getEventBus());
  const configLoader = new ConfigLoader();
  const promptManager = new PromptManager();
  const promptOverrideManager = createPromptOverrideManager(getDefaultOverrideTemplates());

  const agent = new Agent(bot, actionExecutor, llmManager, config, memoryService, memoryManager, interruptManager, logger);

  const wsServer = new WebSocketServer();

  return {
    blockCache,
    containerCache,
    locationManager,
    nearbyBlockManager,
    gameState,
    goalManager,
    movementUtils,
    placeBlockUtils,
    craftManager,
    contextManager,
    actionExecutor,
    usageTracker,
    llmManager,
    maiBotClient,
    memoryManager,
    memoryService,
    interruptManager,
    trackerFactory,
    configLoader,
    promptManager,
    promptOverrideManager,
    agent,
    wsServer,
  };
}

export async function initializeServices(services: AppServices, bot: Bot, logger: Logger): Promise<void> {
  const events = services.actionExecutor.getEventBus();

  services.gameState.initialize(bot, events);

  events.on('action:complete', data => {
    logger.debug(`动作完成: ${data.actionName}`, {
      duration: data.duration,
      result: data.result.message,
    });
  });

  events.on('action:error', data => {
    logger.error(`动作错误: ${data.actionName}`, { actionId: data.actionId }, data.error);
  });

  const configManager = getConfigManager();
  configManager.on('configChanged', () => {
    GlobalLoggerManager.getInstance().updateAllConfigs();
    logger.info('配置已更新，日志级别已同步');
  });

  logger.info('✅ LLM管理器初始化完成', {
    provider: services.llmManager.getActiveProvider(),
  });

  const health = await services.llmManager.healthCheck();
  logger.info('LLM提供商健康检查', { health });

  if (services.maiBotClient) {
    await services.maiBotClient.start();
  }

  await services.memoryManager.initialize();

  const eventBus = EventBus.getInstance();

  const wsAdapter = new WebSocketAdapter(eventBus, services.wsServer);
  wsAdapter.initialize();

  if (services.maiBotClient) {
    const maiBotAdapter = new MaiBotAdapter(eventBus, services.maiBotClient, services.memoryService);
    maiBotAdapter.initialize();
  }

  await services.agent.initialize();

  await services.wsServer.start();

  await startCacheSystem(services, logger);
}

async function startCacheSystem(services: AppServices, logger: Logger): Promise<void> {
  logger.info('启动缓存系统', {
    hasNearbyBlockManager: !!services.nearbyBlockManager,
  });

  try {
    await services.blockCache.load();
    await services.containerCache.load();

    logger.info('缓存数据加载完成', {
      blockCacheSize: services.blockCache.size(),
      containerCacheSize: services.containerCache.size(),
    });

    await services.blockCache.performInitialScan(services.contextManager.getContext().bot);
    logger.info('初始方块扫描完成');
  } catch (error) {
    logger.error('启动缓存系统失败', undefined, error as Error);
  }
}

export async function disposeServices(services: AppServices): Promise<void> {
  await services.wsServer.stop();

  await services.agent.stop();

  await services.memoryManager.saveAll();

  if (services.maiBotClient) {
    try {
      await services.maiBotClient.stop();
    } catch {
      // ignore
    }
  }

  services.llmManager.close();

  services.contextManager.cleanup();

  services.blockCache.destroy();
  services.containerCache.destroy();
}

function registerActions(executor: ActionExecutor, logger: Logger): void {
  const actions = [
    new PlanAction(),
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
    new UseChestAction(),
    new UseFurnaceAction(),
    new OpenChestGUIAction(),
    new OpenFurnaceGUIAction(),
    new QueryContainerAction(),
    new ManageContainerAction(),
    new ChestInteractAction(),
    new FurnaceInteractAction(),
    new EatAction(),
    new TossItemAction(),
    new KillMobAction(),
    new SwimToLandAction(),
    new SetLocationAction(),
  ];

  executor.registerAll(actions);
  logger.info(`✅ 已注册 ${actions.length} 个动作`);
}
