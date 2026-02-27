# MaiBot 通信快速开始指南

## 快速配置（3步）

### 1. 启用 MaiBot 通信

编辑 `config.toml`，找到 `[maibot]` 部分：

```toml
[maibot]
enabled = true  # 改为 true
server_url = "ws://localhost:18040/ws"  # MaiBot 的 WebSocket 地址
api_key = "maicraft_key"  # 与 MaiBot 配置一致
platform = "minecraft"
```

### 2. 确保 MaiBot 已启动

确保 MaiBot 的 WebSocket 服务器在运行，监听地址为 `ws://localhost:18040/ws`。

### 3. 启动 maicraft-next

```bash
pnpm dev
```

## 验证连接

启动后，在日志中查找以下信息：

```
🤖 正在连接到 MaiBot...
✅ MaiBot 通信器已初始化
✅ 已连接到 MaiBot
✅ MaiBot 通信器已启动
```

如果看到这些日志，说明连接成功！

## 工作流程

```
1. maicraft-next 记录思考/决策
   ↓
2. 自动发送给 MaiBot
   ↓
3. MaiBot 处理并回复
   ↓
4. 回复添加到思考记忆
```

## 常见问题

### Q: 如何查看发送的消息？

A: 在日志中搜索：

- `📤 准备发送思考记忆`
- `📤 准备发送决策记忆`
- `✅ 已发送记忆消息`

### Q: 如何查看 MaiBot 回复？

A: 在日志中搜索：

- `📨 收到 MaiBot 回复`
- 思考记忆中会出现 `[MaiBot回复]` 标记

### Q: 连接失败怎么办？

A: 检查以下项：

1. MaiBot 是否启动
2. WebSocket 地址和端口是否正确
3. API 密钥是否一致
4. 防火墙是否阻止连接

### Q: 如何临时禁用？

A: 在 `config.toml` 中设置：

```toml
[maibot]
enabled = false  # 设为 false
```

## 进阶配置

### 只发送决策记忆

```toml
[maibot]
enabled = true
send_thought_memory = false  # 不发送思考
send_decision_memory = true   # 只发送决策
```

### 调整发送频率

```toml
[maibot]
memory_send_interval = 2000  # 改为2秒间隔（默认1秒）
decision_memory_batch_size = 10  # 10条决策一批（默认5条）
```

### 调整重连设置

```toml
[maibot]
reconnect_delay = 10000  # 10秒后重连（默认5秒）
max_reconnect_attempts = 20  # 最多重连20次（默认10次）
```

## 下一步

- 查看完整文档：`docs/maibot-communication.md`
- 了解消息格式和高级功能
- 自定义消息处理逻辑
