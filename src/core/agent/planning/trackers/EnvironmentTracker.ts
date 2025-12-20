/**
 * 环境追踪器（状态型Tracker）
 * 检查游戏环境状态（时间、天气、生物群系、维度、光照）
 * 用于"等待白天"、"到达下界"、"在沙漠中"等任务
 */

import type { Tracker, TrackerProgress } from './types';
import type { GameContext } from '@/core/agent/types';

export class EnvironmentTracker implements Tracker {
  readonly type = 'environment';

  constructor(
    private timeOfDay?: { min?: number; max?: number }, // 时间范围 0-24000
    private weather?: 'clear' | 'rain' | 'thunder', // 天气
    private biome?: string, // 生物群系
    private dimension?: 'overworld' | 'nether' | 'end', // 维度
    private lightLevel?: { min?: number; max?: number }, // 光照等级 0-15
  ) {}

  checkCompletion(context: GameContext): boolean {
    // 检查时间
    if (this.timeOfDay) {
      const time = context.gameState.time?.timeOfDay ?? 0;
      if (this.timeOfDay.min !== undefined && time < this.timeOfDay.min) {
        return false;
      }
      if (this.timeOfDay.max !== undefined && time > this.timeOfDay.max) {
        return false;
      }
    }

    // 检查天气
    if (this.weather) {
      const currentWeather = this.getWeatherFromContext(context);
      if (currentWeather !== this.weather) {
        return false;
      }
    }

    // 检查生物群系
    if (this.biome) {
      const currentBiome = context.gameState.biome;
      if (currentBiome !== this.biome) {
        return false;
      }
    }

    // 检查维度
    if (this.dimension) {
      const currentDimension = this.getDimensionFromContext(context);
      if (currentDimension !== this.dimension) {
        return false;
      }
    }

    // 检查光照等级
    if (this.lightLevel) {
      const light = context.gameState.lightLevel ?? 15;
      if (this.lightLevel.min !== undefined && light < this.lightLevel.min) {
        return false;
      }
      if (this.lightLevel.max !== undefined && light > this.lightLevel.max) {
        return false;
      }
    }

    return true;
  }

  getProgress(context: GameContext): TrackerProgress {
    let current = 0;
    let target = 0;
    let descriptions: string[] = [];

    // 时间进度
    if (this.timeOfDay) {
      target++;
      const time = context.gameState.time?.timeOfDay ?? 0;
      const minTime = this.timeOfDay.min ?? 0;
      const maxTime = this.timeOfDay.max ?? 24000;

      if (time >= minTime && time <= maxTime) {
        current++;
        descriptions.push(`✓ 时间: ${this.formatTime(time)}`);
      } else {
        descriptions.push(`✗ 时间: ${this.formatTime(time)} (需要 ${this.formatTime(minTime)}-${this.formatTime(maxTime)})`);
      }
    }

    // 天气进度
    if (this.weather) {
      target++;
      const currentWeather = this.getWeatherFromContext(context);
      if (currentWeather === this.weather) {
        current++;
        descriptions.push(`✓ 天气: ${this.formatWeather(this.weather)}`);
      } else {
        descriptions.push(`✗ 天气: ${this.formatWeather(currentWeather)} (需要 ${this.formatWeather(this.weather)})`);
      }
    }

    // 生物群系进度
    if (this.biome) {
      target++;
      const currentBiome = context.gameState.biome;
      if (currentBiome === this.biome) {
        current++;
        descriptions.push(`✓ 生物群系: ${currentBiome}`);
      } else {
        descriptions.push(`✗ 生物群系: ${currentBiome || '未知'} (需要 ${this.biome})`);
      }
    }

    // 维度进度
    if (this.dimension) {
      target++;
      const currentDimension = this.getDimensionFromContext(context);
      if (currentDimension === this.dimension) {
        current++;
        descriptions.push(`✓ 维度: ${this.formatDimension(this.dimension)}`);
      } else {
        descriptions.push(`✗ 维度: ${this.formatDimension(currentDimension)} (需要 ${this.formatDimension(this.dimension)})`);
      }
    }

    // 光照进度
    if (this.lightLevel) {
      target++;
      const light = context.gameState.lightLevel ?? 15;
      const minLight = this.lightLevel.min ?? 0;
      const maxLight = this.lightLevel.max ?? 15;

      if (light >= minLight && light <= maxLight) {
        current++;
        descriptions.push(`✓ 光照: ${light}`);
      } else {
        descriptions.push(`✗ 光照: ${light} (需要 ${minLight}-${maxLight})`);
      }
    }

    return {
      current,
      target,
      percentage: target > 0 ? (current / target) * 100 : 100,
      description: descriptions.join(', '),
    };
  }

  getDescription(): string {
    const conditions: string[] = [];

    if (this.timeOfDay) {
      const minTime = this.timeOfDay.min ?? 0;
      const maxTime = this.timeOfDay.max ?? 24000;
      conditions.push(`时间 ${this.formatTime(minTime)}-${this.formatTime(maxTime)}`);
    }

    if (this.weather) {
      conditions.push(`天气为${this.formatWeather(this.weather)}`);
    }

    if (this.biome) {
      conditions.push(`在${this.biome}生物群系`);
    }

    if (this.dimension) {
      conditions.push(`在${this.formatDimension(this.dimension)}`);
    }

    if (this.lightLevel) {
      const minLight = this.lightLevel.min ?? 0;
      const maxLight = this.lightLevel.max ?? 15;
      conditions.push(`光照 ${minLight}-${maxLight}`);
    }

    return conditions.length > 0 ? `环境条件: ${conditions.join(', ')}` : '环境条件';
  }

  private getWeatherFromContext(context: GameContext): 'clear' | 'rain' | 'thunder' {
    const isRaining = context.gameState.isRaining || false;
    const isThundering = context.gameState.isThundering || false;

    if (isThundering) return 'thunder';
    if (isRaining) return 'rain';
    return 'clear';
  }

  private getDimensionFromContext(context: GameContext): 'overworld' | 'nether' | 'end' {
    const dimension = context.gameState.dimension;

    if (dimension?.includes('nether')) return 'nether';
    if (dimension?.includes('end')) return 'end';
    return 'overworld';
  }

  private formatTime(time: number): string {
    // Minecraft时间：0-24000，对应0:00-24:00
    const hours = Math.floor((time / 1000 + 6) % 24);
    const minutes = Math.floor(((time % 1000) / 1000) * 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  private formatWeather(weather: string): string {
    const weatherMap: Record<string, string> = {
      clear: '晴天',
      rain: '雨天',
      thunder: '雷暴',
    };
    return weatherMap[weather] || weather;
  }

  private formatDimension(dimension: string): string {
    const dimensionMap: Record<string, string> = {
      overworld: '主世界',
      nether: '下界',
      end: '末地',
    };
    return dimensionMap[dimension] || dimension;
  }

  toJSON(): any {
    return {
      type: 'environment',
      timeOfDay: this.timeOfDay,
      weather: this.weather,
      biome: this.biome,
      dimension: this.dimension,
      lightLevel: this.lightLevel,
    };
  }

  static fromJSON(json: any): EnvironmentTracker {
    return new EnvironmentTracker(json.timeOfDay, json.weather, json.biome, json.dimension, json.lightLevel);
  }
}
