/**
 * Agent 系统导出
 */

// Core
export { Agent } from './Agent';
export { MemoryManager } from './memory/MemoryManager';
export { AgentLoop } from './loop/AgentLoop';
export { ChatLoop } from './loop/ChatLoop';

// Types
export type { AgentState, AgentStatus, ActionCall, GameContext } from './types';
export type {
  MemoryStore,
  ThoughtEntry,
  ConversationEntry,
  DecisionEntry,
  ExperienceEntry,
  QueryOptions,
  CleanupStrategy,
  MemoryStats,
} from './memory/types';

// Planning - Goal
export type { Goal, GoalStatus, GoalCompletedBy, CreateGoalParams, UpdateGoalParams } from './planning/goal/Goal';
export { GoalManager } from './planning/goal/GoalManager';

// Trackers
export type {
  Tracker,
  TrackerProgress,
  TrackerConfig,
  LocationTrackerConfig,
  EntityTrackerConfig,
  EnvironmentTrackerConfig,
  CraftTrackerConfig,
  CollectionTrackerConfig,
  CompositeTrackerConfig,
  ITrackerFactory,
} from './planning/trackers/types';
export { CollectionTracker } from './planning/trackers/CollectionTracker';
export { LocationTracker } from './planning/trackers/LocationTracker';
export { CraftTracker } from './planning/trackers/CraftTracker';
export { EntityTracker } from './planning/trackers/EntityTracker';
export { EnvironmentTracker } from './planning/trackers/EnvironmentTracker';
export { CompositeTracker } from './planning/trackers/CompositeTracker';
export { TrackerFactory } from './planning/trackers/TrackerFactory';

// Tool Registry
export { ToolRegistry } from './tool/ToolRegistry';
export type { ToolSchema } from './tool/ToolRegistry';
