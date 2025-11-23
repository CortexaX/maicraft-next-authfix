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

## 提示词覆盖功能

maicraft-next 支持通过 MaiBot 通信机制向 MaiBot 发送自定义提示词，覆盖 MaiBot 的默认提示词配置。这个功能允许 maicraft-next 根据需要动态调整 MaiBot 的行为和回复风格。

### 功能概述

- **主动覆盖**：maicraft-next 主动发送覆盖提示词给 MaiBot，而不是被 MaiBot 覆盖
- **消息级覆盖**：每次发送记忆消息时都会携带覆盖的提示词
- **灵活配置**：支持在配置文件中灵活配置覆盖规则
- **运行时管理**：支持动态启用/禁用和管理覆盖模板

### 配置

**提示词覆盖配置现在直接在代码中定义，无需配置文件。**

覆盖模板按照功能划分在不同的文件中定义：

- `src/core/agent/communication/templates/systemPrompt.ts` - 系统级提示词
- `src/core/agent/communication/templates/chatResponse.ts` - 聊天回复提示词
- `src/core/agent/communication/templates/performanceAnalysis.ts` - 性能分析提示词
- `src/core/agent/communication/templates/taskGuidance.ts` - 任务指导提示词

每个模板文件都包含该提示词的完整定义，例如 `systemPrompt.ts`：

```typescript
export const systemPrompt = {
  name: 'system_prompt',
  content: '你是一个专业的Minecraft助手，专门负责分析游戏数据并提供建设性建议。请用简洁明了的语言回复用户关于游戏的问题。',
  description: '系统级提示词，定义AI助手的核心角色和行为准则'
} as const;
```

这些模板在 `overrideTemplates.ts` 中被组合成完整的配置。如需修改特定提示词，请直接编辑对应的模板文件。

### 工作原理

#### 消息携带机制

当 MaiBot 通信启用且提示词覆盖功能开启时，maicraft-next 发送的每条消息都会自动携带覆盖的提示词信息：

```typescript
// 发送的消息结构
{
  message_info: {
    template_info: {
      template_items: {
        "system_prompt": "你是一个专业的Minecraft助手...",
        "chat_response": "基于玩家的游戏行为..."
      },
      template_name: {
        "system_prompt": "系统级提示词...",
        "chat_response": "聊天回复模板..."
      },
      template_default: false  // 标记为非默认，启用覆盖
    }
  },
  message_segment: { /* 实际消息内容 */ }
}
```

#### MaiBot 处理流程

MaiBot 收到消息后会：
1. 检查 `template_info.template_default` 是否为 `false`
2. 如果是，则启用覆盖机制
3. 使用 `global_prompt_manager.async_message_scope()` 创建临时作用域
4. 注册覆盖的提示词模板
5. 在处理该消息时优先使用覆盖的提示词

### 使用示例

#### 示例1：自定义助手角色

```toml
[prompt_override]
enabled = true
template_group_name = "custom_assistant"

[prompt_override.override_templates]
system_prompt = "你是一个严格的Minecraft老师，玩家做错时要严厉批评，做对时要表扬。回复要简短有力。"
```

#### 示例2：添加专业术语

```toml
[prompt_override.override_templates]
technical_response = "使用专业Minecraft术语回复：方块ID、合成配方、红石电路等。避免口语化表达。"
```

#### 示例3：情感化回复

```toml
[prompt_override.override_templates]
emotional_response = "在回复中加入适当的表情符号和情感表达，让回复更有感染力。"
```

### 配置验证

系统会对配置进行验证，确保：
- `enabled = true` 时必须有有效的 `override_templates`
- 模板名称不能为空
- 模板内容不能为空
- 模板描述是可选的，但如果提供必须对应有效的模板

### 运行时管理

#### 通过依赖注入访问

```typescript
import { container } from '@/core/di/bootstrap';
import { ServiceKeys } from '@/core/di/ServiceKeys';

const overrideManager = container.resolve(ServiceKeys.PromptOverrideManager);

// 检查是否有覆盖模板
if (overrideManager.hasTemplates()) {
  // 获取所有覆盖模板
  const templates = overrideManager.getAllTemplates();
  console.log('当前覆盖模板:', templates);
}
```

#### 动态修改配置

```typescript
// 注册新的覆盖模板
overrideManager.registerTemplate(
  'custom_template',
  '这是自定义的提示词内容',
  '自定义模板描述'
);

// 移除覆盖模板
overrideManager.removeTemplate('old_template');
```

### 消息格式扩展

发送给 MaiBot 的消息现在包含额外的模板信息：

#### 思考记忆消息

```
[思考记忆]
我在思考如何优化我的建筑
上下文: {"goal":"建造房屋","mode":"creative"}
---
Template Override: system_prompt, custom_response
```

#### 决策记忆消息

```
[决策记忆] ✅
意图: 建造房屋
动作: {"actionType":"place_block","params":{"blockType":"planks"}}
结果: success
---
Template Override: building_expert, construction_tips
```

### 故障排除

#### 覆盖不生效

1. **检查配置**
   ```toml
   [prompt_override]
   enabled = true  # 确保启用
   ```

2. **验证模板**
   - 确保 `override_templates` 不为空
   - 检查模板名称和内容是否有效

3. **检查 MaiBot 日志**
   - 确认 MaiBot 正确处理了 `template_info`
   - 查看是否有作用域创建和模板注册的日志

#### 调试模式

启用调试日志查看详细的覆盖过程：

```toml
[logging]
level = "DEBUG"
```

### 性能影响

- **内存占用**：覆盖模板存储在内存中，影响很小
- **网络开销**：每次消息都会携带模板信息，增加少量网络流量
- **处理开销**：MaiBot 端需要处理模板注册，增加少量处理时间

### 最佳实践

#### 1. 模板命名规范

在代码中定义时，推荐使用驼峰命名：

```typescript
templates: {
  systemRoleDefinition: "...",
  chatResponseStyle: "...",
  technicalExpertise: "..."
}
```

#### 2. 模板内容优化

推荐：简洁明确的指令

```typescript
customAssistant: "你是一个专业的Minecraft助手。请用技术术语回答问题，保持回复简洁。"
```

#### 3. 动态管理

运行时可以动态添加或移除模板：

```typescript
// 添加新模板
overrideManager.registerTemplate('newTemplate', '新模板内容', '描述');

// 移除模板
overrideManager.removeTemplate('oldTemplate');
```

#### 4. 版本控制

建议将 bootstrap.ts 中的覆盖模板定义纳入版本控制，以便跟踪变化和回滚。

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
- `src/core/agent/communication/promptOverrideManager.ts` - 提示词覆盖管理器
- `src/core/agent/communication/templates/` - 提示词模板目录
  - `overrideTemplates.ts` - 模板配置和导出
  - `systemPrompt.ts` - 系统级提示词
  - `chatResponse.ts` - 聊天回复提示词
  - `performanceAnalysis.ts` - 性能分析提示词
  - `taskGuidance.ts` - 任务指导提示词
- `src/core/agent/memory/MemoryManager.ts` - 记忆管理集成
- `src/core/di/ServiceKeys.ts` - 服务键定义
- `src/core/di/bootstrap.ts` - 依赖注入配置

## 版本历史

- **v0.1.0** (2025-11-23)
  - 初始实现
  - 支持思考记忆和决策记忆发送
  - 支持接收 MaiBot 回复
  - 自动重连机制
  - 消息队列和批量发送

- **v0.2.0** (2025-11-23)
  - 添加提示词覆盖功能
  - 覆盖配置直接在代码中定义
  - 支持动态模板管理
  - 简化配置，无需配置文件

- **v0.3.0** (2025-11-23)
  - 重构目录结构
  - 将 `promptOverrideManager.ts` 移动到 `communication` 目录
  - 将覆盖模板按功能划分到单独文件
  - 创建 `systemPrompt.ts`, `chatResponse.ts`, `performanceAnalysis.ts`, `taskGuidance.ts`
  - 改进模块组织，便于维护

## 许可证

MIT License

