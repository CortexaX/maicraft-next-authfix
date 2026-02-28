/**
 * 追踪器工厂
 * 用于创建和反序列化追踪器
 *
 * 支持的Tracker类型：
 * - 状态型：location, entity, environment
 * - 事件型：collection, craft
 * - 组合型：composite
 */

import type { Tracker, TrackerConfig, ITrackerFactory } from './types';
import type { EventBus } from '@/core/events/EventBus';
import { CollectionTracker } from './CollectionTracker';
import { LocationTracker } from './LocationTracker';
import { CraftTracker } from './CraftTracker';
import { EntityTracker } from './EntityTracker';
import { EnvironmentTracker } from './EnvironmentTracker';
import { CompositeTracker } from './CompositeTracker';

export class TrackerFactory implements ITrackerFactory {
  private trackers: Map<string, any>;

  constructor(private eventBus: EventBus) {
    this.trackers = new Map<string, any>([
      ['collection', CollectionTracker],
      ['location', LocationTracker],
      ['craft', CraftTracker],
      ['entity', EntityTracker],
      ['environment', EnvironmentTracker],
      ['composite', CompositeTracker],
    ]);
  }

  /**
   * 注册自定义追踪器
   */
  register(type: string, trackerClass: any): void {
    this.trackers.set(type, trackerClass);
  }

  /**
   * 从配置创建追踪器
   */
  createTracker(config: TrackerConfig): Tracker {
    return this.fromJSON(config);
  }

  /**
   * 从 JSON 创建追踪器
   */
  fromJSON(json: any): Tracker {
    const TrackerClass = this.trackers.get(json.type);

    if (!TrackerClass) {
      throw new Error(`未知的追踪器类型: ${json.type}`);
    }

    // CompositeTracker 需要特殊处理（需要递归创建子Tracker）
    if (json.type === 'composite') {
      return CompositeTracker.fromJSON(json, this);
    }

    // CollectionTracker 需要注入 eventManager
    if (json.type === 'collection') {
      return CollectionTracker.fromJSON(json, this.eventBus);
    }

    return TrackerClass.fromJSON(json);
  }

  /**
   * 获取所有注册的追踪器类型
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.trackers.keys());
  }

  /**
   * 兼容旧代码的静态方法
   * @deprecated 使用DI容器：container.resolve(ServiceKeys.TrackerFactory).fromJSON(json)
   * 注意：静态方法无法获取 eventManager，CollectionTracker 无法使用
   */
  static fromJSON(_json: unknown): Tracker {
    throw new Error('TrackerFactory.fromJSON 已废弃，请使用 DI 容器获取 TrackerFactory 实例');
  }

  static register(_type: string, _trackerClass: unknown): void {
    throw new Error('TrackerFactory.register 已废弃，请使用 DI 容器获取 TrackerFactory 实例');
  }

  /**
   * 兼容旧代码的静态方法
   * @deprecated 使用DI容器
   */
  static getRegisteredTypes(): string[] {
    throw new Error('TrackerFactory.getRegisteredTypes 已废弃，请使用 DI 容器获取 TrackerFactory 实例');
  }
}
