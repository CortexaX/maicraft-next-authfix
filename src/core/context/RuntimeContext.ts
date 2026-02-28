import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { GameState } from '@/core/state/GameState';
import { EventManager } from '@/core/events/EventManager';
import type { ActionExecutor } from '@/core/actions/ActionExecutor';
import type { Location } from '@/core/cache/LocationManager';
import { PlaceBlockUtils } from '@/utils/PlaceBlockUtils';
import { MovementUtils } from '@/utils/MovementUtils';
import { CraftManager } from '@/core/crafting/CraftManager';
import { BlockCache } from '@/core/cache/BlockCache';
import { ContainerCache } from '@/core/cache/ContainerCache';
import type { LLMManager } from '@/llm/LLMManager';
import type { GoalManager } from '@/core/agent/planning/goal/GoalManager';

export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

export interface Config {
  [key: string]: any;
}

export interface LocationManager {
  setLocation(name: string, position: Vec3, info: string, metadata?: any): Location;
  getLocation(name: string): Location | undefined;
  deleteLocation(name: string): boolean;
  updateLocation(name: string, info: string): boolean;
  getAllLocations(): Location[];
  findNearby(center: Vec3, radius?: number): Location[];
  search(query: string): Location[];
  getNearest(center: Vec3): Location | undefined;
  getAllLocationsString(): string;
  getNearbyLocationsString(center: Vec3, radius?: number): string;
  hasLocation(name: string): boolean;
  clear(): void;
  size(): number;
  export(): any[];
  import(data: any[]): void;
  save(): Promise<void>;
}

export interface RuntimeContext {
  bot: Bot;
  executor: ActionExecutor | null;

  gameState: GameState;

  blockCache: BlockCache;
  containerCache: ContainerCache;
  locationManager: LocationManager;

  events: EventManager;

  signal: AbortSignal;

  logger: Logger;

  config: Config;

  placeBlockUtils: PlaceBlockUtils;
  movementUtils: MovementUtils;
  craftManager: CraftManager;

  goalManager: GoalManager;

  llmManager?: LLMManager;
}

export function createPrefixedLogger(baseLogger: Logger, prefix: string): Logger {
  return {
    debug: (message: string, ...args: any[]) => baseLogger.debug(`[${prefix}] ${message}`, ...args),
    info: (message: string, ...args: any[]) => baseLogger.info(`[${prefix}] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => baseLogger.warn(`[${prefix}] ${message}`, ...args),
    error: (message: string, ...args: any[]) => baseLogger.error(`[${prefix}] ${message}`, ...args),
  };
}
