import { Bot } from 'mineflayer';
import { RuntimeContext, Logger, Config, createPrefixedLogger } from './RuntimeContext';
import type { ActionExecutor } from '@/core/actions/ActionExecutor';
import { BlockCache } from '@/core/cache/BlockCache';
import { ContainerCache } from '@/core/cache/ContainerCache';
import { LocationManager } from '@/core/cache/LocationManager';
import { InterruptSignal } from '@/core/interrupt/InterruptSignal';
import { EventManager } from '@/core/events/EventManager';
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
  interruptSignal: InterruptSignal;
  placeBlockUtils: PlaceBlockUtils;
  movementUtils: MovementUtils;
  craftManager: CraftManager;
  goalManager?: any;
  llmManager?: LLMManager;
}

export class ContextManager {
  private context: RuntimeContext;

  constructor(params: ContextManagerParams) {
    const events = new EventManager(params.bot);

    this.context = {
      bot: params.bot,
      executor: null,
      gameState: params.gameState,
      blockCache: params.blockCache,
      containerCache: params.containerCache,
      locationManager: params.locationManager,
      events,
      interruptSignal: params.interruptSignal,
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
      interruptSignal: new InterruptSignal(),
    };
  }

  updateExecutor(executor: ActionExecutor): void {
    this.context.executor = executor;
    this.context.events = executor.getEventManager();
  }

  cleanup(): void {
    this.context.gameState.cleanup();
  }

  hasContext(): boolean {
    return true;
  }
}
