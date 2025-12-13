/**
 * MaiBot 客户端
 *
 * 负责与 MaiBot 的 WebSocket 通信：
 * 1. 发送思考记忆和决策记忆给 MaiBot
 * 2. 接收 MaiBot 的回复
 * 3. 将回复添加到思考
 * 记忆中
 */

import {
  Router,
  RouteConfig,
  TargetConfig,
  MessageBase,
  BaseMessageInfo,
  SenderInfo,
  UserInfo,
  GroupInfo,
  Seg,
  TemplateInfo,
} from '@changingself/maim-message-ts';
import { getLogger, type Logger } from '@/utils/Logger';
import type { MaibotSection } from '@/utils/Config';
import type { ThoughtEntry, DecisionEntry } from '../memory/types';
import { getPromptOverrideManager } from './promptOverrideManager';

/**
 * 记忆消息类型
 */
export interface MemoryMessage {
  type: 'thought' | 'decision' | 'batch_decision';
  data: ThoughtEntry | DecisionEntry | DecisionEntry[];
  timestamp: number;
}

/**
 * MaiBot 客户端
 */
export class MaiBotClient {
  private router: Router | null = null;
  private config: MaibotSection;
  private logger: Logger;
  private isConnected = false;
  private isShuttingDown = false;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private messageQueue: MemoryMessage[] = [];
  private sendTimer?: NodeJS.Timeout;
  private lastSendTime = 0;

  // 回调函数：当收到 MaiBot 回复时调用
  private onReplyCallback?: (reply: string) => void;

  constructor(config: MaibotSection) {
    this.config = config;
    this.logger = getLogger('MaiBotClient');
  }

  /**
   * 启动通信（非阻塞，在后台运行）
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('MaiBot 通信未启用');
      return;
    }

    // 获取路由配置中的URL
    const routeUrls = Object.values(this.config.routes).map(route => route.url);

    this.logger.info('🤖 正在连接到 MaiBot（后台模式）...', {
      urls: routeUrls,
      platform: this.config.platform,
    });

    // 在后台异步连接，不阻塞启动流程
    this.connectInBackground().catch(error => {
      this.logger.warn('⚠️ MaiBot 初始连接失败，将自动重试', {
        error: error.message,
        willRetry: this.config.reconnect,
      });
    });
  }

  /**
   * 后台连接（不阻塞主流程）
   */
  private async connectInBackground(): Promise<void> {
    try {
      await this.connect();
      this.startSendTimer();
      this.logger.info('✅ 已连接到 MaiBot');
    } catch (error) {
      this.logger.warn('⚠️ 连接 MaiBot 失败', {
        error: (error as Error).message,
        willRetry: this.config.reconnect,
      });

      // 如果启用了重连，自动安排重连
      if (this.config.reconnect && !this.isShuttingDown) {
        this.scheduleReconnect();
      }

      // ⚠️ 不要重新抛出错误！这样会导致 uncaughtException
      // 连接失败是预期内的情况，不应该让应用崩溃
    }
  }

  /**
   * 建立连接
   */
  private async connect(): Promise<void> {
    try {
      // 从配置创建路由配置
      const routeMap = new Map<string, TargetConfig>();
      for (const [platform, config] of Object.entries(this.config.routes)) {
        routeMap.set(platform, new TargetConfig(config.url, config.token, config.ssl_verify));
      }
      const routeConfig = new RouteConfig(routeMap);

      // 创建 Router
      this.router = new Router(routeConfig);

      // 如果 Router 继承自 EventEmitter，添加错误监听器
      if (typeof (this.router as any).on === 'function') {
        (this.router as any).on('error', (error: Error) => {
          this.logger.warn('⚠️ Router 触发 error 事件', {
            error: error.message,
            willRetry: this.config.reconnect,
          });
          this.isConnected = false;

          // 如果启用了重连，尝试重连
          if (this.config.reconnect && !this.isShuttingDown) {
            this.scheduleReconnect();
          }
        });
      }

      // 注册消息处理器
      this.router.registerMessageHandler(async (message: MessageBase) => {
        await this.handleMaibotReply(message);
      });

      // 启动 Router（非阻塞），使用 Promise 链确保错误被捕获
      const runRouter = async () => {
        try {
          await this.router?.run();
        } catch (error) {
          this.logger.warn('⚠️ Router 运行失败', {
            error: (error as Error).message,
            willRetry: this.config.reconnect,
          });
          this.isConnected = false;

          // 如果启用了重连，尝试重连
          if (this.config.reconnect && !this.isShuttingDown) {
            this.logger.info(`🔄 将在 ${this.config.reconnect_delay}ms 后尝试重连 MaiBot`);
            this.scheduleReconnect();
          }
        }
      };

      // 使用 Promise.resolve() 让 Router 异步启动，确保错误在 Promise 链中被捕获
      Promise.resolve()
        .then(() => runRouter())
        .catch(error => {
          // 双重保护：确保任何未捕获的错误都被处理
          this.logger.warn('⚠️ Router 启动过程中发生未预期的错误', {
            error: (error as Error).message,
          });
          this.isConnected = false;

          // 如果启用了重连，尝试重连
          if (this.config.reconnect && !this.isShuttingDown) {
            this.scheduleReconnect();
          }
        });

      this.isConnected = true;
      this.reconnectAttempts = 0;

      this.logger.debug('Router 已创建，正在后台启动连接...');
    } catch (error) {
      this.logger.warn('⚠️ 创建 Router 失败', {
        error: (error as Error).message,
      });
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * 设置回复回调函数
   */
  setOnReplyCallback(callback: (reply: string) => void): void {
    this.onReplyCallback = callback;
  }

  /**
   * 发送思考记忆
   */
  sendThoughtMemory(entry: ThoughtEntry): void {
    if (!this.config.enabled || !this.config.send_thought_memory) {
      return;
    }

    this.logger.debug('📤 准备发送思考记忆', { id: entry.id });

    const memoryMessage: MemoryMessage = {
      type: 'thought',
      data: entry,
      timestamp: Date.now(),
    };

    this.messageQueue.push(memoryMessage);
  }

  /**
   * 发送决策记忆
   */
  sendDecisionMemory(entry: DecisionEntry): void {
    if (!this.config.enabled || !this.config.send_decision_memory) {
      return;
    }

    this.logger.debug('📤 准备发送决策记忆', { id: entry.id });

    const memoryMessage: MemoryMessage = {
      type: 'decision',
      data: entry,
      timestamp: Date.now(),
    };

    this.messageQueue.push(memoryMessage);
  }

  /**
   * 启动定时发送器
   */
  private startSendTimer(): void {
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
    }

    // 定期检查并发送消息队列
    this.sendTimer = setInterval(() => {
      this.processSendQueue();
    }, this.config.memory_send_interval);
  }

  /**
   * 处理发送队列
   */
  private async processSendQueue(): Promise<void> {
    if (!this.isConnected || this.messageQueue.length === 0) {
      return;
    }

    const now = Date.now();

    // 限制发送频率
    if (now - this.lastSendTime < this.config.memory_send_interval) {
      return;
    }

    try {
      // 批量发送决策记忆
      const decisionMessages = this.messageQueue.filter(m => m.type === 'decision');
      const thoughtMessages = this.messageQueue.filter(m => m.type === 'thought');

      // 发送思考记忆（逐条发送）
      for (const message of thoughtMessages) {
        await this.sendMessage(message);
        this.lastSendTime = Date.now();
      }

      // 批量发送决策记忆
      if (decisionMessages.length > 0) {
        const batchSize = Math.min(decisionMessages.length, this.config.decision_memory_batch_size);
        const batch = decisionMessages.slice(0, batchSize);

        await this.sendBatchDecisions(batch.map(m => m.data as DecisionEntry));
        this.lastSendTime = Date.now();

        // 移除已发送的消息
        this.messageQueue = this.messageQueue.filter(m => !batch.includes(m) && !thoughtMessages.includes(m));
      } else {
        // 移除已发送的思考消息
        this.messageQueue = this.messageQueue.filter(m => !thoughtMessages.includes(m));
      }
    } catch (error) {
      this.logger.error('发送消息队列失败', undefined, error as Error);
    }
  }

  /**
   * 构建发送者信息
   */
  private createSenderInfo(): SenderInfo {
    // 从配置中读取用户信息，如果未配置则使用默认值
    const userId = this.config.user_id || 'maicraft_bot';
    const userName = this.config.user_name || 'Maicraft AI';
    const userDisplayName = this.config.user_displayname || 'Minecraft AI助手';

    const userInfo = new UserInfo(this.config.platform, userId, userName, userDisplayName);

    // 从配置中读取群组信息，如果未配置则为null
    const groupInfo =
      this.config.group_id || this.config.group_name ? new GroupInfo(this.config.platform, this.config.group_id, this.config.group_name) : null;

    return new SenderInfo(groupInfo, userInfo);
  }

  /**
   * 发送单条消息
   */
  private async sendMessage(memoryMessage: MemoryMessage): Promise<void> {
    if (!this.router || !this.isConnected) {
      return;
    }

    const messageContent = this.formatMemoryMessage(memoryMessage);
    const senderInfo = this.createSenderInfo();

    // 从senderInfo中提取群组和用户信息
    const groupInfo = senderInfo.groupInfo || undefined;
    const userInfo = senderInfo.userInfo || undefined;

    // 获取提示词覆盖信息
    const templateInfo = this.getTemplateInfo();

    const messageInfo = new BaseMessageInfo(
      this.config.platform,
      `msg_${Date.now()}`,
      Date.now(),
      groupInfo,
      userInfo,
      undefined, // formatInfo
      templateInfo, // templateInfo - 添加覆盖的提示词信息
      undefined, // additionalConfig
      senderInfo,
      undefined, // receiverInfo
    );

    const messageSegment = new Seg('text', messageContent);
    const message = new MessageBase(messageInfo, messageSegment);

    this.logger.debug('💬 发送消息', { message: JSON.stringify(message.toDict()) });

    await this.router.sendMessage(message);
    this.logger.debug('✅ 已发送记忆消息', { type: memoryMessage.type });
  }

  /**
   * 批量发送决策记忆
   */
  private async sendBatchDecisions(decisions: DecisionEntry[]): Promise<void> {
    if (!this.router || !this.isConnected || decisions.length === 0) {
      return;
    }

    const messageContent = this.formatBatchDecisions(decisions);
    const senderInfo = this.createSenderInfo();

    // 从senderInfo中提取群组和用户信息
    const groupInfo = senderInfo.groupInfo || undefined;
    const userInfo = senderInfo.userInfo || undefined;

    // 获取提示词覆盖信息
    const templateInfo = this.getTemplateInfo();

    const messageInfo = new BaseMessageInfo(
      this.config.platform,
      `batch_${Date.now()}`,
      Date.now(),
      groupInfo,
      userInfo,
      undefined, // formatInfo
      templateInfo, // templateInfo - 添加覆盖的提示词信息
      undefined, // additionalConfig
      senderInfo,
      undefined, // receiverInfo
    );

    const messageSegment = new Seg('text', messageContent);
    const message = new MessageBase(messageInfo, messageSegment);

    await this.router.sendMessage(message);
    this.logger.info(`✅ 已批量发送 ${decisions.length} 条决策记忆`);
  }

  /**
   * 格式化记忆消息
   */
  private formatMemoryMessage(memoryMessage: MemoryMessage): string {
    const { type, data } = memoryMessage;

    if (type === 'thought') {
      const thought = data as ThoughtEntry;
      return `[思考记忆]\n${thought.content}${thought.context ? `\n上下文: ${JSON.stringify(thought.context)}` : ''}`;
    } else if (type === 'decision') {
      const decision = data as DecisionEntry;
      const resultIcon = decision.result === 'success' ? '✅' : decision.result === 'failed' ? '❌' : '⚠️';
      return `[决策记忆] ${resultIcon}\n意图: ${decision.intention}\n动作: ${JSON.stringify(decision.action)}\n结果: ${decision.result}${decision.feedback ? `\n反馈: ${decision.feedback}` : ''}`;
    }

    return '';
  }

  /**
   * 格式化批量决策记忆
   */
  private formatBatchDecisions(decisions: DecisionEntry[]): string {
    const lines = ['[批量决策记忆]'];

    for (const decision of decisions) {
      const resultIcon = decision.result === 'success' ? '✅' : decision.result === 'failed' ? '❌' : '⚠️';
      const actionType = (decision.action as any)?.actionType || '未知动作';
      lines.push(`${resultIcon} ${decision.intention} [${actionType}]`);
    }

    return lines.join('\n');
  }

  /**
   * 处理 MaiBot 的回复
   */
  private async handleMaibotReply(message: MessageBase): Promise<void> {
    try {
      // 提取文本内容
      let replyText = '';
      this.logger.info('💬 收到 MaiBot 回复', { message: JSON.stringify(message.toDict()) });

      if (message.messageSegment) {
        const segment = message.messageSegment;
        if (segment.type === 'text') {
          replyText = segment.data as string;
        } else if (segment.type === 'seglist') {
          const segments = segment.data as Seg[];
          replyText = segments
            .filter(seg => seg.type === 'text')
            .map(seg => seg.data as string)
            .join('');
        }
      }

      if (replyText) {
        this.logger.info('📨 收到 MaiBot 回复', {
          length: replyText.length,
          preview: replyText.substring(0, 50),
        });

        // 调用回调函数
        if (this.onReplyCallback) {
          this.onReplyCallback(replyText);
        }
      }
    } catch (error) {
      this.logger.error('处理 MaiBot 回复失败', undefined, error as Error);
    }
  }

  /**
   * 计划重连
   */
  private scheduleReconnect(): void {
    // 清除之前的重连定时器（如果有）
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.reconnectAttempts >= this.config.max_reconnect_attempts) {
      this.logger.warn(`⚠️ 已达到最大重连次数 (${this.config.max_reconnect_attempts})，将不再自动重连`);
      this.logger.info('💡 提示：如需重新连接 MaiBot，请重启程序');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnect_delay;

    this.logger.info(`🔄 将在 ${delay}ms 后尝试重连 MaiBot (尝试 ${this.reconnectAttempts}/${this.config.max_reconnect_attempts})`);

    this.reconnectTimer = setTimeout(async () => {
      if (this.isShuttingDown) {
        this.logger.info('程序正在关闭，取消重连');
        return;
      }

      this.logger.info(`🔄 正在尝试重连 MaiBot (第 ${this.reconnectAttempts} 次)...`);

      try {
        await this.connect();
        this.startSendTimer();
        this.logger.info('✅ 重连 MaiBot 成功');
        // 重置重连计数
        this.reconnectAttempts = 0;
      } catch (error) {
        this.logger.warn(`⚠️ 重连 MaiBot 失败 (第 ${this.reconnectAttempts} 次)`, {
          error: (error as Error).message,
        });
        // 继续尝试重连
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * 停止通信
   */
  async stop(): Promise<void> {
    this.logger.info('正在关闭 MaiBot 通信...');

    // 设置关闭标志，防止重连
    this.isShuttingDown = true;

    // 清除定时器
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = undefined;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    // 关闭 Router
    if (this.router) {
      try {
        await this.router.stop();
      } catch (error) {
        this.logger.error('关闭 MaiBot Router 失败', undefined, error as Error);
      }
      this.router = null;
    }

    this.isConnected = false;
    this.logger.info('✅ MaiBot 通信已关闭');
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * 获取消息队列长度
   */
  getQueueLength(): number {
    return this.messageQueue.length;
  }

  /**
   * 获取提示词覆盖信息
   * 如果启用了覆盖功能且有覆盖模板，则返回 TemplateInfo，否则返回 undefined
   */
  private getTemplateInfo(): TemplateInfo | undefined {
    const overrideManager = getPromptOverrideManager();
    if (!overrideManager || !overrideManager.hasTemplates()) {
      return undefined;
    }

    try {
      const templateInfoData = overrideManager.generateTemplateInfo();
      if (!templateInfoData) {
        return undefined;
      }

      // 从字典数据创建 TemplateInfo 对象
      return TemplateInfo.fromDict(templateInfoData);
    } catch (error) {
      this.logger.error('生成提示词覆盖信息失败', undefined, error as Error);
      return undefined;
    }
  }
}
