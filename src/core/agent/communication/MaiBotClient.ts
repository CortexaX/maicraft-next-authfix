/**
 * MaiBot 客户端
 *
 * 负责与 MaiBot 的 WebSocket 通信：
 * 1. 发送思考记忆和决策记忆给 MaiBot
 * 2. 接收 MaiBot 的回复
 * 3. 将回复添加到思考记忆中
 */

import { MessageClient, MessageBase, BaseMessageInfo, SenderInfo, UserInfo, GroupInfo, Seg } from '@changingself/maim-message-ts';
import { getLogger, type Logger } from '@/utils/Logger';
import type { MaibotSection } from '@/utils/Config';
import type { ThoughtEntry, DecisionEntry } from '../memory/types';

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
  private client: MessageClient | null = null;
  private config: MaibotSection;
  private logger: Logger;
  private isConnected = false;
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
   * 启动通信
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('MaiBot 通信未启用');
      return;
    }

    this.logger.info('🤖 正在连接到 MaiBot...', {
      url: this.config.server_url,
      platform: this.config.platform,
    });

    try {
      await this.connect();
      this.startSendTimer();
      this.logger.info('✅ 已连接到 MaiBot');
    } catch (error) {
      this.logger.error('连接 MaiBot 失败', undefined, error as Error);
      if (this.config.reconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * 建立连接
   */
  private async connect(): Promise<void> {
    // 创建消息客户端
    this.client = new MessageClient();

    // 连接到服务器
    await this.client.connect(this.config.server_url, this.config.platform, this.config.api_key);

    // 注册消息处理器
    this.client.registerMessageHandler(async (message: any) => {
      await this.handleMaibotReply(message);
    });

    // 启动客户端
    await this.client.run();
    this.isConnected = true;
    this.reconnectAttempts = 0;
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
    if (!this.client || !this.isConnected) {
      return;
    }

    const messageContent = this.formatMemoryMessage(memoryMessage);
    const senderInfo = this.createSenderInfo();

    // 从senderInfo中提取群组和用户信息
    const groupInfo = senderInfo.groupInfo || undefined;
    const userInfo = senderInfo.userInfo || undefined;

    const messageInfo = new BaseMessageInfo(
      this.config.platform,
      `msg_${Date.now()}`,
      Date.now(),
      groupInfo,
      userInfo,
      undefined, // formatInfo
      undefined, // templateInfo
      undefined, // additionalConfig
      senderInfo,
      undefined, // receiverInfo
    );

    const messageSegment = new Seg('text', messageContent);
    const message = new MessageBase(messageInfo, messageSegment, messageContent);

    this.logger.info('💬 发送消息', { message: JSON.stringify(message.toDict()) });

    await this.client.sendMessage(message.toDict());
    this.logger.debug('✅ 已发送记忆消息', { type: memoryMessage.type });
  }

  /**
   * 批量发送决策记忆
   */
  private async sendBatchDecisions(decisions: DecisionEntry[]): Promise<void> {
    if (!this.client || !this.isConnected || decisions.length === 0) {
      return;
    }

    const messageContent = this.formatBatchDecisions(decisions);
    const senderInfo = this.createSenderInfo();

    // 从senderInfo中提取群组和用户信息
    const groupInfo = senderInfo.groupInfo || undefined;
    const userInfo = senderInfo.userInfo || undefined;

    const messageInfo = new BaseMessageInfo(
      this.config.platform,
      `batch_${Date.now()}`,
      Date.now(),
      groupInfo,
      userInfo,
      undefined, // formatInfo
      undefined, // templateInfo
      undefined, // additionalConfig
      senderInfo,
      undefined, // receiverInfo
    );

    const messageSegment = new Seg('text', messageContent);
    const message = new MessageBase(messageInfo, messageSegment);

    await this.client.sendMessage(message.toDict());
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
    if (this.reconnectAttempts >= this.config.max_reconnect_attempts) {
      this.logger.error('达到最大重连次数，停止重连');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnect_delay;

    this.logger.info(`将在 ${delay}ms 后尝试重连 MaiBot (${this.reconnectAttempts}/${this.config.max_reconnect_attempts})`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        this.logger.info('✅ 重连 MaiBot 成功');
      } catch (error) {
        this.logger.error('重连 MaiBot 失败', undefined, error as Error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * 停止通信
   */
  async stop(): Promise<void> {
    this.logger.info('正在关闭 MaiBot 通信...');

    // 清除定时器
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = undefined;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    // 关闭客户端
    if (this.client) {
      try {
        await this.client.stop();
      } catch (error) {
        this.logger.error('关闭 MaiBot 客户端失败', undefined, error as Error);
      }
      this.client = null;
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
}
