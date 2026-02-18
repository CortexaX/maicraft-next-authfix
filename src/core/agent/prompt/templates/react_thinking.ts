// src/core/agent/prompt/templates/react_thinking.ts

import { PromptTemplate, promptManager } from '@/core/agent/prompt/prompt_manager';

/**
 * 注册 ReAct 思考模板
 */
export function initReActThinkingTemplate(): void {
  promptManager.registerTemplate(
    new PromptTemplate(
      'react_thinking',
      `# 当前观察

{observation}

# 最近的历史

{react_history}

# 相关记忆

{relevant_memories}

# 当前目标

{current_goal}

---

请基于以上信息：
1. 分析当前情况
2. 思考下一步应该做什么
3. 选择一个动作执行`,
      'ReAct决策',
      ['observation', 'react_history', 'relevant_memories', 'current_goal'],
    ),
  );
}
