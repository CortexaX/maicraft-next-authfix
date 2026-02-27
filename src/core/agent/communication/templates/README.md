# MaiBot 提示词覆盖模板

此目录包含 maicraft-next 发送给 MaiBot 的覆盖提示词模板。每个提示词模板都单独定义在一个文件中，便于维护和管理。

## 文件结构

### 聊天场景覆盖模板（虚拟主播）

对应MaiBot中实际存在的提示词模板：

- `chatTargetGroup1.ts` - 直播场景描述（详细）
- `chatTargetGroup2.ts` - 直播场景描述（简短）
- `chatTargetPrivate1.ts` - 私信场景描述（详细）
- `chatTargetPrivate2.ts` - 私信场景描述（简短）
- `replyerPrompt.ts` - 直播回复生成提示词
- `privateReplyerPrompt.ts` - 私信回复生成提示词
- `identity.ts` - 虚拟主播身份定义
- `getMoodPrompt.ts` - 直播氛围情绪分析

- `overrideTemplates.ts` - 模板配置聚合文件，导入并组合所有模板

## 如何添加新的提示词模板

1. **创建新的模板文件**：

   ```typescript
   // src/core/agent/communication/templates/yourTemplateName.ts
   export const yourTemplateName = {
     name: 'your_template_name', // 下划线命名，用于API
     content: '你的提示词内容...',
     description: '模板的描述信息',
   } as const;
   ```

2. **在 `overrideTemplates.ts` 中导入并注册**：

   ```typescript
   import { yourTemplateName } from './yourTemplateName';

   // 在 templates 和 descriptions 对象中添加：
   templates: {
     [yourTemplateName.name]: yourTemplateName.content,
     // ... 其他模板
   },
   descriptions: {
     [yourTemplateName.name]: yourTemplateName.description,
     // ... 其他描述
   }
   ```

3. **导出新的模板**：
   ```typescript
   export { yourTemplateName } from './yourTemplateName';
   ```

## 命名约定

- **文件名**：使用驼峰命名，如 `systemPrompt.ts`
- **模板名称**：使用下划线命名，如 `'system_prompt'`
- **变量名**：与文件名保持一致，如 `systemPrompt`

## 注意事项

- 所有模板文件都应使用 `as const` 断言，确保类型安全
- 模板内容支持变量插值，如 `{game_context}`，这些变量会在运行时被替换
- 修改模板后需要重启应用才能生效
