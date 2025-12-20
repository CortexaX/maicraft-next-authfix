/**
 * 组合追踪器（组合型Tracker）
 * 支持 AND/OR/SEQUENCE 逻辑组合多个追踪器
 *
 * - and: 所有条件都必须满足
 * - or: 任意条件满足即可
 * - sequence: 必须按顺序依次完成
 */

import type { Tracker, TrackerProgress } from './types';
import type { GameContext } from '@/core/agent/types';

export class CompositeTracker implements Tracker {
  readonly type = 'composite';

  constructor(
    private trackers: Tracker[],
    private logic: 'and' | 'or' | 'sequence' = 'and',
    private weights?: number[], // 各子Tracker的权重（用于进度计算）
  ) {
    // 如果没有提供权重，使用均等权重
    if (!this.weights) {
      this.weights = new Array(trackers.length).fill(1);
    }
  }

  checkCompletion(context: GameContext): boolean {
    if (this.logic === 'and') {
      // AND: 所有条件都必须满足
      return this.trackers.every(tracker => tracker.checkCompletion(context));
    } else if (this.logic === 'or') {
      // OR: 任意条件满足即可
      return this.trackers.some(tracker => tracker.checkCompletion(context));
    } else {
      // SEQUENCE: 必须按顺序完成
      // 只有当前一个完成后，才检查下一个
      for (let i = 0; i < this.trackers.length; i++) {
        if (!this.trackers[i].checkCompletion(context)) {
          // 如果当前步骤未完成，返回false
          return false;
        }
      }
      // 所有步骤都完成
      return true;
    }
  }

  getProgress(context: GameContext): TrackerProgress {
    if (this.logic === 'sequence') {
      // SEQUENCE模式：找到第一个未完成的步骤
      let completedSteps = 0;
      let currentStepProgress = 0;

      for (let i = 0; i < this.trackers.length; i++) {
        if (this.trackers[i].checkCompletion(context)) {
          completedSteps++;
        } else {
          // 当前步骤未完成，获取其进度
          const stepProgress = this.trackers[i].getProgress(context);
          currentStepProgress = stepProgress.percentage / 100;
          break;
        }
      }

      const totalProgress = completedSteps + currentStepProgress;
      const percentage = (totalProgress / this.trackers.length) * 100;

      return {
        current: Math.floor(totalProgress * 100),
        target: this.trackers.length * 100,
        percentage,
        description: `完成 ${completedSteps}/${this.trackers.length} 个步骤`,
      };
    } else {
      // AND/OR模式：计算加权平均进度
      let totalWeight = 0;
      let weightedProgress = 0;

      for (let i = 0; i < this.trackers.length; i++) {
        const weight = this.weights?.[i] ?? 1;
        const progress = this.trackers[i].getProgress(context);

        totalWeight += weight;
        weightedProgress += progress.percentage * weight;
      }

      const percentage = totalWeight > 0 ? weightedProgress / totalWeight : 0;
      const completedCount = this.trackers.filter(t => t.checkCompletion(context)).length;

      return {
        current: completedCount,
        target: this.trackers.length,
        percentage,
        description: `完成 ${completedCount}/${this.trackers.length} 个条件 (${percentage.toFixed(0)}%)`,
      };
    }
  }

  getDescription(): string {
    const descriptions = this.trackers.map(t => t.getDescription());

    if (this.logic === 'and') {
      return descriptions.join(' 并且 ');
    } else if (this.logic === 'or') {
      return descriptions.join(' 或者 ');
    } else {
      // sequence
      return descriptions.map((d, i) => `${i + 1}. ${d}`).join('; ');
    }
  }

  toJSON(): any {
    return {
      type: 'composite',
      logic: this.logic,
      trackers: this.trackers.map(t => t.toJSON()),
      weights: this.weights,
    };
  }

  static fromJSON(json: any, trackerFactory: any): CompositeTracker {
    const trackers = json.trackers.map((t: any) => trackerFactory.fromJSON(t));
    return new CompositeTracker(trackers, json.logic, json.weights);
  }
}
