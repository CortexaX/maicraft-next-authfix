import { createBot, Bot } from 'mineflayer';
import { pathfinder, Movements } from 'mineflayer-pathfinder-mai';
import armorManager from 'mineflayer-armor-manager';
import { plugin as pvpPlugin } from 'mineflayer-pvp';
import { plugin as toolPlugin } from 'mineflayer-tool';
import { plugin as collectBlock } from 'mineflayer-collectblock-colalab';

import * as fs from 'fs';
import * as path from 'path';

import { createServices, initializeServices, disposeServices, type AppServices } from '@/core/di';

import { type AppConfig } from '@/utils/Config';
import { getLogger, type Logger } from '@/utils/Logger';
import { ConfigLoader } from '@/utils/Config';

const basicErrorLogger: Logger = getLogger('BasicError');

class MaicraftNext {
  private services?: AppServices;
  private bot?: Bot;
  private config?: AppConfig;
  private logger: Logger = getLogger('MaicraftApp');

  private isShuttingDown = false;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;

  async initialize(): Promise<void> {
    try {
      const configLoader = new ConfigLoader();
      this.config = await configLoader.loadDefaultConfig();

      this.logger.info('🚀 Maicraft-Next 正在启动...');
      this.logger.info(`版本: ${this.config!.app.version}`);

      await this.connectToMinecraft();

      this.services = createServices(this.bot!, this.config!, this.logger);

      this.initializePluginSettings();

      await initializeServices(this.services, this.bot!, this.logger);

      this.services.wsServer.setMemoryManager(this.services.agent.getMemoryService());

      await this.services.agent.start();
      this.logger.info('✅ Agent已启动');

      this.logger.info('✅ Maicraft-Next 启动完成');
      this.logger.info('AI代理现在正在运行...');
    } catch (error) {
      this.logger.error('初始化失败', undefined, error as Error);
      throw error;
    }
  }

  getWebSocketServer() {
    return this.services?.wsServer;
  }

  private async connectToMinecraft(): Promise<void> {
    if (!this.config || !this.logger) {
      throw new Error('配置或日志系统未初始化');
    }

    const mcConfig = this.config.minecraft;

    this.logger.info('连接到Minecraft服务器', {
      host: mcConfig.host,
      port: mcConfig.port,
      username: mcConfig.username,
    });

    this.bot = createBot({
      host: mcConfig.host,
      port: mcConfig.port,
      username: mcConfig.username,
      password: mcConfig.password || undefined,
      auth: mcConfig.auth,
    });

    this.loadPlugins();
    this.setupBotEvents();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'));
      }, this.config!.minecraft.timeout);

      this.bot!.once('login', () => {
        clearTimeout(timeout);
        this.logger.info('✅ 已登录到Minecraft服务器');
        resolve();
      });

      this.bot!.once('error', error => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private loadPlugins(): void {
    if (!this.bot) return;

    this.bot.loadPlugin(pathfinder);
    this.logger.info('✅ 加载插件: pathfinder');

    this.bot.loadPlugin(armorManager);
    this.logger.info('✅ 加载插件: armor-manager');

    this.bot.loadPlugin(pvpPlugin);
    this.logger.info('✅ 加载插件: pvp');

    this.bot.loadPlugin(toolPlugin);
    this.logger.info('✅ 加载插件: tool');

    this.bot.loadPlugin(collectBlock);
    this.logger.info('✅ 加载插件: collectblock');
  }

  private initializePluginSettings(): void {
    if (!this.bot || !this.config) {
      this.logger.error('Bot或配置未初始化');
      return;
    }

    try {
      if (this.bot.pathfinder) {
        const defaultMove = new Movements(this.bot);

        const blocksCantBreakIds = new Set<number>();
        const defaultBlocks = ['chest', 'furnace', 'crafting_table', 'bed'];
        const blockNames = this.config.plugins.pathfinder?.blocks_cant_break || defaultBlocks;

        this.logger.info(`配置移动过程中不能破坏的方块列表: ${blockNames.join(', ')}`);

        for (const blockName of blockNames) {
          const block = this.bot.registry.blocksByName[blockName];
          if (block) {
            blocksCantBreakIds.add(block.id);
            this.logger.debug(`已添加移动过程中不能破坏的方块: ${blockName} (ID: ${block.id})`);
          } else {
            this.logger.warn(`未知的方块名称: ${blockName}`);
          }
        }

        defaultMove.blocksCantBreak = blocksCantBreakIds;
        this.bot.pathfinder.setMovements(defaultMove);

        this.logger.info('✅ Pathfinder movements 初始化完成');
      }

      if ((this.bot as any).collectBlock && this.bot.pathfinder) {
        (this.bot as any).collectBlock.movements = this.bot.pathfinder.movements;
        this.logger.info('✅ CollectBlock movements 已同步');
      }

      if (this.bot.armorManager) {
        this.bot.armorManager.equipAll();
        this.logger.info('✅ ArmorManager 自动装备已启用');
      }

      this.logger.info('✅ 所有插件设置初始化完成');
    } catch (error) {
      this.logger.error('初始化插件设置时发生错误', undefined, error as Error);
    }
  }

  private setupBotEvents(): void {
    if (!this.bot || !this.logger) {
      return;
    }

    this.bot.on('error', error => {
      this.logger.error('Bot错误', undefined, error as Error);
    });

    this.bot.on('kicked', reason => {
      this.logger.warn('被服务器踢出', { reason });
      this.handleDisconnect('kicked');
    });

    this.bot.on('end', reason => {
      this.logger.warn('连接断开', { reason });
      this.handleDisconnect('ended');
    });
  }

  private handleDisconnect(_reason: string): void {
    if (this.isShuttingDown) {
      return;
    }

    const mcConfig = this.config!.minecraft;

    if (!mcConfig.reconnect) {
      this.logger.info('自动重连已禁用，程序将退出');
      this.shutdown();
      return;
    }

    if (this.reconnectAttempts >= mcConfig.max_reconnect_attempts) {
      this.logger.error('达到最大重连次数，程序将退出');
      this.shutdown();
      return;
    }

    this.reconnectAttempts++;
    this.logger.info(`尝试重连 (${this.reconnectAttempts}/${mcConfig.max_reconnect_attempts})...`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.reconnect();
      } catch (error) {
        this.logger.error('重连失败', undefined, error as Error);
        this.handleDisconnect('reconnect_failed');
      }
    }, mcConfig.reconnect_delay);
  }

  private async reconnect(): Promise<void> {
    this.logger.info('开始重新连接...');

    if (this.services) {
      await disposeServices(this.services);
      this.services = undefined;
    }

    if (this.bot) {
      try {
        this.bot.quit('Reconnecting');
      } catch {
        // ignore
      }
      this.bot = undefined;
    }

    await this.connectToMinecraft();

    this.services = createServices(this.bot!, this.config!, this.logger);

    this.initializePluginSettings();

    await initializeServices(this.services, this.bot!, this.logger);

    this.services.wsServer.setMemoryManager(this.services.agent.getMemoryService());

    await this.services.agent.start();

    this.reconnectAttempts = 0;
    this.logger.info('✅ 重连成功');
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.logger?.info('👋 正在关闭Maicraft-Next...');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.services) {
      try {
        await disposeServices(this.services);
        this.logger?.info('✅ 服务已销毁');
      } catch (error) {
        this.logger?.error('销毁服务时出错', undefined, error as Error);
      }
    }

    if (this.bot) {
      try {
        this.bot.quit('Shutting down');
        this.logger?.info('✅ Bot连接已断开');
      } catch (error) {
        this.logger?.error('断开Bot连接时出错', undefined, error as Error);
      }
    }

    this.logger?.info('✅ Maicraft-Next 已关闭');

    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

function isMaiBotConnectionError(error: Error): boolean {
  const errorObj = error as any;
  const isAggregateError = error.name === 'AggregateError';
  const isConnectionError = errorObj.code === 'ECONNREFUSED' || errorObj.code === 'ETIMEDOUT' || errorObj.code === 'ENOTFOUND';
  const isNetworkStack = error.stack?.includes('internalConnectMultiple') || error.stack?.includes('afterConnectMultiple');

  return isConnectionError && (isAggregateError && isNetworkStack) !== undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cleanData = args.includes('--clean-data');

  if (cleanData) {
    const dataDir = path.join(process.cwd(), 'data');
    const logDir = path.join(process.cwd(), 'logs');
    try {
      if (fs.existsSync(dataDir)) {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
      if (fs.existsSync(logDir)) {
        fs.rmSync(logDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('❌ 清空目录时出错:', error);
      process.exit(1);
    }
  }

  const app = new MaicraftNext();

  const shutdownHandler = async (_signal: string) => {
    try {
      await app.shutdown();
      process.exit(0);
    } catch (error) {
      console.error('关闭时出错:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

  process.on('uncaughtException', error => {
    if (isMaiBotConnectionError(error)) {
      basicErrorLogger.warn('⚠️ MaiBot 连接错误（不影响主程序运行）', { error });
      return;
    }
    basicErrorLogger.error('未捕获的异常', { error });
    app.shutdown().then(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason, _promise) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    if (isMaiBotConnectionError(err)) {
      basicErrorLogger.warn('⚠️ MaiBot 连接错误（不影响主程序运行）', { error: err });
      return;
    }
    basicErrorLogger.error('未处理的Promise拒绝', undefined, err);
    app.shutdown().then(() => process.exit(1));
  });

  try {
    await app.initialize();
  } catch (error) {
    basicErrorLogger.error('启动失败', undefined, error as Error);
    await app.shutdown();
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    basicErrorLogger.error('程序异常', undefined, error as Error);
    process.exit(1);
  });
}

export { MaicraftNext };
