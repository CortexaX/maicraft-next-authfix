import type { GameState } from '@/core/state/GameState';

export interface InterruptHandler {
  readonly name: string;
  readonly priority: number;
  detect(gameState: GameState): boolean;
  handle(signal: AbortSignal): Promise<void>;
}

export interface InterruptConfig {
  enabled: boolean;
  maxHandlingTime: number;
}
