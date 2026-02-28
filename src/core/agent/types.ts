/**
 * Agent 相关的类型定义
 */

import type { RuntimeContext } from '@/core/context/RuntimeContext';
import type { MemoryManager } from './memory/MemoryManager';
import type { LLMManager } from '@/llm/LLMManager';
import type { AppConfig as Config } from '@/utils/Config';
import type { ToolRegistry } from './tool/ToolRegistry';
import type { InterruptManager } from '@/core/interrupt';
import type { GameState } from '@/core/state/GameState';
import type { BlockCache } from '@/core/cache/BlockCache';
import type { ContainerCache } from '@/core/cache/ContainerCache';
import type { LocationManager } from '@/core/cache/LocationManager';
import type { Logger } from '@/utils/Logger';

/**
 * Agent 共享状态
 * 所有子系统都可以访问，但不能直接修改 Agent 内部实现
 */
export interface AgentState {
  readonly goal: string;
  isRunning: boolean;

  readonly context: RuntimeContext;

  readonly memory: MemoryManager;
  readonly llmManager: LLMManager;

  readonly interruptManager: InterruptManager;
  readonly toolRegistry?: ToolRegistry;

  readonly config: Config;
}

/**
 * Agent 状态摘要
 */
export interface AgentStatus {
  isRunning: boolean;
  currentMode: string;
  goal: string;
  currentTask: unknown;
  interrupted: boolean;
  interruptReason: string;
}

/**
 * 动作调用
 */
export interface ActionCall {
  actionType: string;
  params: Record<string, unknown>;
}

/**
 * 游戏上下文（用于追踪器和任务系统）
 */
export interface GameContext {
  gameState: GameState;
  blockCache: BlockCache;
  containerCache: ContainerCache;
  locationManager: LocationManager;
  logger: Logger;
}
