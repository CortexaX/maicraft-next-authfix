/**
 * 地标管理器
 */

import { Vec3 } from 'vec3';
import { promises as fs } from 'fs';
import { getLogger } from '@/utils/Logger';
import type { Logger } from '@/utils/Logger';

export interface Location {
  name: string;
  position: Vec3;
  info: string;
  createdAt: number;
  updatedAt: number;
}

export class LocationManager {
  private locations: Map<string, Location> = new Map();
  private logger: Logger;
  private persistPath: string;
  private saveTimer?: NodeJS.Timeout;
  private readonly SAVE_INTERVAL = 30000;

  constructor(persistPath?: string) {
    this.logger = getLogger('LocationManager');
    this.persistPath = persistPath || 'data/locations.json';
    this.load();
  }

  setLocation(name: string, position: Vec3 | { x: number; y: number; z: number }, info: string): Location {
    const existing = this.locations.get(name);
    const now = Date.now();

    const pos = position instanceof Vec3 ? position.clone() : new Vec3(position.x, position.y, position.z);

    const location: Location = {
      name,
      position: pos,
      info,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.locations.set(name, location);
    this.scheduleSave();
    this.logger.debug(`设置地标: ${name} (${position.x}, ${position.y}, ${position.z})`);
    return location;
  }

  getLocation(name: string): Location | undefined {
    return this.locations.get(name);
  }

  deleteLocation(name: string): boolean {
    const deleted = this.locations.delete(name);
    if (deleted) {
      this.scheduleSave();
      this.logger.debug(`删除地标: ${name}`);
    }
    return deleted;
  }

  updateLocation(name: string, info: string): boolean {
    const location = this.locations.get(name);
    if (!location) {
      return false;
    }

    location.info = info;
    location.updatedAt = Date.now();
    this.scheduleSave();
    this.logger.debug(`更新地标: ${name}`);
    return true;
  }

  getAllLocations(): Location[] {
    return Array.from(this.locations.values());
  }

  findNearby(center: Vec3, radius: number = 100): Location[] {
    const results: Location[] = [];

    for (const location of this.locations.values()) {
      const distance = location.position.distanceTo(center);
      if (distance <= radius) {
        results.push(location);
      }
    }

    results.sort((a, b) => a.position.distanceTo(center) - b.position.distanceTo(center));

    return results;
  }

  getAllLocationsString(): string {
    const locations = this.getAllLocations();

    if (locations.length === 0) {
      return '暂无地标';
    }

    const lines: string[] = ['已保存的地标:'];

    for (const location of locations) {
      lines.push(`  ${location.name}: ${location.info} (${location.position.x}, ${location.position.y}, ${location.position.z})`);
    }

    return lines.join('\n');
  }

  hasLocation(name: string): boolean {
    return this.locations.has(name);
  }

  async save(): Promise<void> {
    await this.forceSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveToFile();
    }, this.SAVE_INTERVAL);
  }

  private async saveToFile(): Promise<void> {
    try {
      const dir = this.persistPath.substring(0, this.persistPath.lastIndexOf('/'));
      if (dir) {
        await fs.mkdir(dir, { recursive: true });
      }

      const data = this.getAllLocations().map(loc => ({
        name: loc.name,
        position: {
          x: loc.position.x,
          y: loc.position.y,
          z: loc.position.z,
        },
        info: loc.info,
        createdAt: loc.createdAt,
        updatedAt: loc.updatedAt,
      }));
      await fs.writeFile(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
      this.logger.info(`LocationManager 保存完成，已保存 ${data.length} 个地标`);
    } catch (error) {
      this.logger.error('保存 LocationManager 失败', undefined, error as Error);
    }
  }

  private async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.persistPath, 'utf-8');
      const data: Array<{
        name: string;
        position: { x: number; y: number; z: number };
        info: string;
        createdAt?: number;
        updatedAt?: number;
      }> = JSON.parse(content);

      for (const item of data) {
        const position = new Vec3(item.position.x, item.position.y, item.position.z);
        const location: Location = {
          name: item.name,
          position,
          info: item.info,
          createdAt: item.createdAt || Date.now(),
          updatedAt: item.updatedAt || Date.now(),
        };
        this.locations.set(item.name, location);
      }
      this.logger.info(`LocationManager 加载完成，已加载 ${data.length} 个地标`);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.info('LocationManager 文件不存在，跳过加载');
      } else {
        this.logger.error('加载 LocationManager 失败', undefined, error as Error);
      }
    }
  }

  async forceSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    await this.saveToFile();
  }
}
