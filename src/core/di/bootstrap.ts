import type { Bot } from 'mineflayer';
import type { AppConfig } from '@/utils/Config';
import type { Logger } from '@/utils/Logger';
import { GlobalLoggerManager } from '@/utils/Logger';
import { getConfigManager } from '@/utils/Config';
import { BlockCache } from '@/core/cache/BlockCache';
import { ContainerCache } from '@/core/cache/ContainerCache';
import { LocationManager } from '@/core/cache/LocationManager';
import { CacheManager } from '@/core/cache/CacheManager';
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

export function createServices(bot: Bot, config: AppConfig, logger: Logger): AppServices {
  const blockCache = new BlockCache({
    maxEntries: config.cache.max_block_entries,
    expirationTime: config.cache.block_expiration_time,
    autoSaveInterval: config.cache.enable_auto_save ? 60000 : 0,
    enabled: true,
    updateStrategy: 'smart' as const,
    onlyVisibleBlocks: config.cache.only_visible_blocks,
  });

  const containerCache = new ContainerCache({
    maxEntries: config.cache.max_container_entries,
    expirationTime: config.cache.container_expiration_time,
    autoSaveInterval: config.cache.enable_auto_save ? 60000 : 0,
    enabled: true,
    updateStrategy: 'smart' as const,
  });

  const locationManager = new LocationManager();

  const cacheManager = new CacheManager(bot, blockCache, containerCache, {
    blockScanInterval: 5000,
    blockScanRadius: 50,
    containerUpdateInterval: 10000,
    autoSaveInterval: 60000,
    enablePeriodicScan: config.cache.enable_periodic_scan,
    enableAutoSave: config.cache.enable_auto_save,
    performanceMode: 'balanced' as const,
  });

  const nearbyBlockManager = new NearbyBlockManager(blockCache, bot);

  const gameState = new GameState({
    blockCache,
    containerCache,
    cacheManager,
    nearbyBlockManager,
  });

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

  const interruptManager = new InterruptManager(gameState, actionExecutor.getEventManager());
  const trackerFactory = new TrackerFactory(actionExecutor.getEventManager());
  const configLoader = new ConfigLoader();
  const promptManager = new PromptManager();
  const promptOverrideManager = createPromptOverrideManager(getDefaultOverrideTemplates());

  const agent = new Agent(bot, actionExecutor, llmManager, config, memoryService, memoryManager, interruptManager, logger);

  const wsServer = new WebSocketServer();

  return {
    blockCache,
    containerCache,
    locationManager,
    cacheManager,
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
  services.gameState.initialize(bot);

  const events = services.actionExecutor.getEventManager();
  events.on('actionComplete', (data: any) => {
    logger.debug(`动作完成: ${data.actionName}`, {
      duration: data.duration,
      result: data.result.message,
    });
  });

  events.on('actionError', (data: any) => {
    logger.error(`动作错误: ${data.actionName}`, data.error);
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
