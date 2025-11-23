# MaiBot 通信集成文档

## 概述

maicraft-next 现在支持通过 WebSocket 与 MaiBot 进行实时通信，实现以下功能：

1. **发送记忆给 MaiBot**：将思考记忆（Thought Memory）和决策记忆（Decision Memory）发送给 MaiBot
2. **接收 MaiBot 回复**：接收 MaiBot 的回复消息
3. **回复添加到记忆**：将 MaiBot 的回复自动添加到思考记忆中

## 架构说明

```
maicraft-next                    maibot
     ↓                              ↓
  MemoryManager  ←→  MaibotCommunicator  ←→  WebSocket Server
     ↓                              ↑
  - 思考记忆 ─────────────────────→ 发送
  - 决策记忆 ─────────────────────→ 发送
     ↑                              
     └───────── 回复添加 ←──────────
```

### 核心组件

1. **MaiBotClient** (`src/core/agent/communication/MaiBotClient.ts`)
   - 负责 WebSocket 客户端连接
   - 管理消息队列和发送
   - 处理 MaiBot 回复
   - 自动重连机制
   - 通过依赖注入容器管理生命周期

2. **MemoryManager** (`src/core/agent/memory/MemoryManager.ts`)
   - 集成 MaiBotClient
   - 在记录记忆时自动发送给 MaiBot
   - 将 MaiBot 回复添加到思考记忆
   - 通过依赖注入系统接收 MaiBotClient

3. **依赖注入容器** (`src/core/di/bootstrap.ts`)
   - 自动创建和配置 MaiBotClient
   - 管理 MaiBotClient 的生命周期（启动/停止）
   - 自动注入到 MemoryManager

## 配置

### 1. 配置文件设置

编辑 `config.toml`，添加或修改 `[maibot]` 部分：

```toml
[maibot]
# MaiBot 通信配置
enabled = true                                  # 是否启用与 MaiBot 的通信
server_url = "ws://localhost:18040/ws"          # MaiBot WebSocket 服务器地址
api_key = "maicraft_key"                        # API 密钥
platform = "minecraft"                          # 平台标识
reconnect = true                                # 连接断开时是否自动重连
reconnect_delay = 5000                          # 重连延迟（毫秒）
max_reconnect_attempts = 10                     # 最大重连次数
heartbeat_interval = 30000                      # 心跳间隔（毫秒）
send_thought_memory = true                      # 是否发送思考记忆
send_decision_memory = true                     # 是否发送决策记忆
decision_memory_batch_size = 5                  # 决策记忆批量发送数量
memory_send_interval = 1000                     # 记忆发送间隔（毫秒，避免过于频繁）
```

### 2. 配置说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | false | 是否启用 MaiBot 通信功能 |
| `server_url` | string | ws://localhost:18040/ws | MaiBot WebSocket 服务器地址 |
| `api_key` | string | maicraft_key | API 密钥，需要与 MaiBot 配置一致 |
| `platform` | string | minecraft | 平台标识 |
| `reconnect` | boolean | true | 是否自动重连 |
| `reconnect_delay` | number | 5000 | 重连延迟（毫秒） |
| `max_reconnect_attempts` | number | 10 | 最大重连尝试次数 |
| `heartbeat_interval` | number | 30000 | 心跳间隔（毫秒） |
| `send_thought_memory` | boolean | true | 是否发送思考记忆 |
| `send_decision_memory` | boolean | true | 是否发送决策记忆 |
| `decision_memory_batch_size` | number | 5 | 决策记忆批量发送的条数 |
| `memory_send_interval` | number | 1000 | 记忆发送最小间隔（毫秒） |

## 使用方法

### 启动 MaiBot 通信

1. **确保 MaiBot 已启动**

   首先确保 MaiBot 的 WebSocket 服务器已经启动并监听在配置的地址和端口。

2. **启用配置**

   在 `config.toml` 中设置 `enabled = true`。

3. **启动 maicraft-next**

   ```bash
   pnpm dev
   ```

   启动日志中会显示：
   ```
   🤖 正在连接到 MaiBot...
   ✅ MaiBot 通信器已初始化
   ✅ 已连接到 MaiBot
   ✅ MaiBot 通信器已启动
   ```

### 发送记忆

记忆会自动发送，无需手动操作。当 Agent 记录思考或决策时，会自动发送给 MaiBot：

```typescript
// 思考记忆会自动发送
this.state.memory.recordThought('我在思考如何完成任务');

// 决策记忆也会自动发送
this.state.memory.recordDecision(
  '挖掘木头',
  { actionType: 'mine_by_type', params: { blockType: 'log' } },
  'success',
  '成功挖掘了3个木头'
);
```

### 接收 MaiBot 回复

MaiBot 的回复会自动添加到思考记忆中，标记为 `[MaiBot回复]`：

```typescript
// MaiBot 回复会自动添加到思考记忆
// 例如：[MaiBot回复] 你做得很好，继续保持！
```

### 禁用特定记忆类型

如果只想发送某一种类型的记忆，可以在配置中设置：

```toml
[maibot]
enabled = true
send_thought_memory = true   # 只发送思考记忆
send_decision_memory = false  # 不发送决策记忆
```

## 消息格式

### 发送给 MaiBot 的消息格式

#### 思考记忆

```
[思考记忆]
我在思考如何完成任务
上下文: {"goal":"探索世界","mode":"main"}
```

#### 决策记忆（单条）

```
[决策记忆] ✅
意图: 挖掘木头
动作: {"actionType":"mine_by_type","params":{"blockType":"log"}}
结果: success
反馈: 成功挖掘了3个木头
```

#### 决策记忆（批量）

```
[批量决策记忆]
✅ 挖掘木头 [mine_by_type]
✅ 合成木板 [craft]
❌ 放置箱子 [place_block]
```

### MaiBot 回复格式

MaiBot 可以发送任何文本内容，maicraft-next 会自动提取并添加到思考记忆：

```typescript
// MaiBot 发送的消息
{
  messageSegment: {
    type: 'text',
    data: '你做得很好，建议接下来去挖矿'
  }
}

// 会被添加到思考记忆为：
// [MaiBot回复] 你做得很好，建议接下来去挖矿
```

## 高级功能

### 消息队列

MaibotCommunicator 内置消息队列机制：

- 思考记忆逐条发送
- 决策记忆批量发送（默认5条一批）
- 发送间隔限制（默认1000ms）
- 避免过于频繁的消息发送

### 自动重连

当连接断开时，会自动尝试重连：

- 默认重连延迟：5秒
- 默认最大重连次数：10次
- 重连成功后自动恢复通信

### 日志记录

通信过程会记录详细日志：

```
📤 准备发送思考记忆
✅ 已发送记忆消息
📨 收到 MaiBot 回复
✅ 已批量发送 5 条决策记忆
```

## 故障排除

### 连接失败

1. **检查 MaiBot 是否运行**
   ```bash
   # 检查 MaiBot WebSocket 服务器是否启动
   netstat -an | grep 18040
   ```

2. **检查防火墙设置**
   确保 WebSocket 端口未被防火墙阻止。

3. **检查配置**
   确认 `server_url`、`api_key`、`platform` 配置正确。

### 消息未发送

1. **检查配置**
   确认 `enabled = true` 且对应的记忆类型启用：
   - `send_thought_memory = true`
   - `send_decision_memory = true`

2. **查看日志**
   检查是否有错误信息：
   ```
   ❌ 发送消息队列失败
   ```

3. **检查连接状态**
   在日志中查找连接状态信息。

### 未收到回复

1. **检查 MaiBot 是否发送回复**
   确认 MaiBot 正确处理消息并发送回复。

2. **检查消息格式**
   确认 MaiBot 发送的消息格式符合要求（包含文本内容）。

## 性能考虑

### 内存使用

- 消息队列会占用一定内存
- 建议定期清理思考记忆（系统会自动保留最近50条）

### 网络带宽

- 思考记忆和决策记忆都是文本格式，带宽占用很小
- 批量发送决策记忆可以减少网络请求次数

### 发送频率

- `memory_send_interval` 控制最小发送间隔
- 默认1000ms可以平衡实时性和性能
- 可以根据需要调整（100-5000ms）

## 示例场景

### 场景1：实时监控 Agent 思考

启用思考记忆发送，MaiBot 可以实时看到 Agent 的思考过程：

```
[思考记忆] 🤔 LLM思维: 我需要先收集木头来制作工具
[思考记忆] 🌲 发现了一棵树，准备砍伐
[思考记忆] ✅ 成功收集了5个木头
```

### 场景2：MaiBot 提供建议

Agent 完成任务后，MaiBot 可以提供建议：

```
maicraft-next → MaiBot: [决策记忆] ✅ 挖掘木头 成功
MaiBot → maicraft-next: 很好！建议接下来制作工作台和工具
maicraft-next: [思考记忆] [MaiBot回复] 很好！建议接下来制作工作台和工具
```

### 场景3：批量分析决策

MaiBot 可以批量接收决策记忆并进行分析：

```
[批量决策记忆]
✅ 挖掘木头 [mine_by_type]
✅ 合成木板 [craft]
✅ 合成工作台 [craft]
❌ 放置箱子 [place_block]
```

MaiBot 可以分析成功率并给出改进建议。

## 开发指南

### 扩展消息格式

如需自定义消息格式，修改 `MaibotCommunicator.ts` 中的格式化方法：

```typescript
private formatMemoryMessage(memoryMessage: MemoryMessage): string {
  // 自定义格式化逻辑
}
```

### 添加新的记忆类型

1. 在 `MemoryManager.ts` 中添加发送逻辑
2. 在 `MaibotCommunicator.ts` 中添加对应的格式化方法

### 自定义回复处理

修改 `MaibotCommunicator.ts` 中的回复处理：

```typescript
private async handleMaibotReply(message: APIMessageBase): Promise<void> {
  // 自定义回复处理逻辑
}
```

## 相关文件

- `src/core/agent/communication/MaiBotClient.ts` - 通信核心实现
- `src/core/agent/communication/index.ts` - 通信模块导出
- `src/core/agent/memory/MemoryManager.ts` - 记忆管理集成
- `src/core/di/ServiceKeys.ts` - 服务键定义
- `src/core/di/bootstrap.ts` - 依赖注入配置
- `src/utils/Config.ts` - 配置类型定义
- `config-template.toml` - 配置模板

## 版本历史

- **v0.1.0** (2025-11-23)
  - 初始实现
  - 支持思考记忆和决策记忆发送
  - 支持接收 MaiBot 回复
  - 自动重连机制
  - 消息队列和批量发送

## 许可证

MIT License

