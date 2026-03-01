import { Bot } from 'mineflayer';
import { RuntimeContext, Logger, Config, createPrefixedLogger } from './RuntimeContext';
import type { ActionExecutor } from '@/core/actions/ActionExecutor';
import { BlockCache } from '@/core/cache/BlockCache';
import { ContainerCache } from '@/core/cache/ContainerCache';
import { LocationManager } from '@/core/cache/LocationManager';
import { NearbyBlockManager } from '@/core/cache/NearbyBlockManager';
import { EventBus } from '@/core/events/EventBus';
import { GameState } from '@/core/state/GameState';
import type { PlaceBlockUtils } from '@/utils/PlaceBlockUtils';
import type { MovementUtils } from '@/utils/MovementUtils';
import type { CraftManager } from '@/core/crafting/CraftManager';
import type { LLMManager } from '@/llm/LLMManager';

export interface ContextManagerParams {
  bot: Bot;
  config: Config;
  logger: Logger;
  gameState: GameState;
  blockCache: BlockCache;
  containerCache: ContainerCache;
  locationManager: LocationManager;
  nearbyBlockManager: NearbyBlockManager;
  signal: AbortSignal;
  placeBlockUtils: PlaceBlockUtils;
  movementUtils: MovementUtils;
  craftManager: CraftManager;
  goalManager?: any;
  llmManager?: LLMManager;
}

export class ContextManager {
  private context: RuntimeContext;

  constructor(params: ContextManagerParams) {
    const events = EventBus.getInstance();
    events.attachBot(params.bot);

    this.context = {
      bot: params.bot,
      executor: null,
      gameState: params.gameState,
      blockCache: params.blockCache,
      containerCache: params.containerCache,
      locationManager: params.locationManager,
      nearbyBlockManager: params.nearbyBlockManager,
      events,
      signal: params.signal,
      logger: params.logger,
      config: params.config,
      placeBlockUtils: params.placeBlockUtils,
      movementUtils: params.movementUtils,
      craftManager: params.craftManager,
      goalManager: params.goalManager,
      llmManager: params.llmManager,
    };
  }

  getContext(): RuntimeContext {
    return this.context;
  }

  createActionContext(actionName: string): RuntimeContext {
    return {
      ...this.context,
      logger: createPrefixedLogger(this.context.logger, actionName),
    };
  }

  updateExecutor(executor: ActionExecutor): void {
    this.context.executor = executor;
  }

  cleanup(): void {
    this.context.gameState.cleanup();
  }

  hasContext(): boolean {
    return true;
  }
}
