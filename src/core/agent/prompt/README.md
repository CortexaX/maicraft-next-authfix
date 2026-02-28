# 提示词管理系统

> **完全照搬 maicraft 原版设计**

## 🎯 设计理念

完全照搬原版 maicraft 的 Python 实现，仅将语言替换为 TypeScript。

## 📁 文件结构

```
src/core/agent/prompt/
├── PromptTemplate.ts        # PromptTemplate 和 PromptManager 类
├── templates/               # 模板注册
│   ├── initTemplates.ts    # 模板初始化
│   └── index.ts            # 导出
├── index.ts                 # 模块导出
└── README.md                # 本文档
```

## 🚀 快速开始

### 1. 初始化模板

```typescript
import { initTemplates, promptManager } from '@/core/agent/prompt';

// 初始化所有模板（在 Agent 或 Loop 构造时调用一次）
initTemplates();
```

### 2. 生成提示词

```typescript
// 收集所有数据
const inputData = {
  basic_info: '...',
  eat_action: '...',
  kill_mob_action: '...',
  // ... 其他参数
};

// 生成提示词
const prompt = promptManager.generatePrompt('main_thinking', inputData);

// 调用 LLM
const response = await llmManager.chat([{ role: 'user', content: prompt }]);
```

## 📝 核心 API

### PromptTemplate 类

```typescript
class PromptTemplate {
  constructor(name: string, template: string, description: string = '', parameters: string[] = []);

  // 验证参数
  validateParameters(params: Record<string, any>): string[];

  // 格式化模板
  format(params: Record<string, any>): string;
}
```

### PromptManager 类

```typescript
class PromptManager {
  // 注册模板
  registerTemplate(template: PromptTemplate): boolean;

  // 从字符串注册模板
  registerTemplateFromString(name: string, templateStr: string, description?: string): boolean;

  // 获取模板
  getTemplate(name: string): PromptTemplate | undefined;

  // 生成提示词（核心方法！）
  generatePrompt(templateName: string, params: Record<string, any>): string;

  // 列出所有模板
  listTemplates(): Array<{ name: string; description: string }>;
}
```

### 全局实例

```typescript
// 全局单例（类似 Python 的 prompt_manager）
import { promptManager } from '@/core/agent/prompt';

// 使用
const prompt = promptManager.generatePrompt('main_thinking', params);
```

## 🔧 与原版 maicraft 的对应

| maicraft (Python)                                | maicraft-next (TypeScript)                         |
| ------------------------------------------------ | -------------------------------------------------- |
| `PromptTemplate`                                 | `PromptTemplate`                                   |
| `PromptManager`                                  | `PromptManager`                                    |
| `prompt_manager = PromptManager()`               | `export const promptManager = new PromptManager()` |
| `template.format(**kwargs)`                      | `template.format(params)`                          |
| `prompt_manager.register_template(template)`     | `promptManager.registerTemplate(template)`         |
| `prompt_manager.generate_prompt(name, **kwargs)` | `promptManager.generatePrompt(name, params)`       |
| `init_templates()`                               | `initTemplates()`                                  |

## 📋 可用模板

### 1. basic_info

基础信息模板，包含玩家状态、目标、物品栏等信息。

**参数**：

- `bot_name`, `player_name`, `self_info`, `goal`, `to_do_list`
- `self_status_info`, `inventory_info`, `position`
- `nearby_block_info`, `container_cache_info`, `nearby_entities_info`
- `chat_str`, `mode`, `task`

### 2. main_thinking

主思考模板，用于主决策循环。

**参数**：

- `basic_info` - 通过 basic_info 模板生成
- `eat_action` - 动态生成（饥饿时）
- `kill_mob_action` - 动态生成（有敌对生物时）
- `failed_hint` - 失败提示
- `thinking_list` - 思考记录
- `nearby_block_info`, `position`, `chat_str`
- `judge_guidance` - 评估指导

## 🎨 添加新模板

在 `templates/initTemplates.ts` 中添加：

```typescript
export function initTemplates(): void {
  // ... 现有模板 ...

  promptManager.registerTemplate(
    new PromptTemplate(
      'my_template',
      `模板内容，使用 {param} 作为占位符`,
      '模板描述',
      ['param1', 'param2'], // 参数列表（可选，会自动提取）
    ),
  );
}
```

## 🔄 使用流程

```typescript
// 1. 初始化（在 AgentLoop 构造函数中）
initTemplates();

// 2. 收集数据（使用 PromptDataCollector）
const dataCollector = new PromptDataCollector(state, actionPromptGenerator);
const allData = dataCollector.collectAllData();

// 3. 构建上下文（使用 ContextBuilder）
const contextBuilder = new ContextBuilder(state);
const context = contextBuilder.buildContext();

// 4. 获取工具 Schema（使用 ToolRegistry）
const toolSchemas = toolRegistry.getAvailableToolSchemas();

// 5. LLM Function Calling
const toolCalls = await llmManager.callTool(context.userPrompt, toolSchemas, context.systemPrompt);
```

## 📖 相关文档

- 原版 maicraft 设计：`E:\01_Projects\Code\AI\Minecraft\maicraft\agent\prompt_manager\`
