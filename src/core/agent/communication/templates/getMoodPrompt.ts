/**
 * 情绪状态获取提示词模板
 *
 * 用于分析直播间氛围并更新虚拟主播的情绪状态
 */

export const getMoodPrompt = {
  name: 'get_mood_prompt',
  content: `{chat_talking_prompt}
以上是直播间正在进行的弹幕和游戏内容

{identity_block}
你先前的情绪状态是：{mood_state}
你的情绪特点是:{emotion_style}

现在，请你根据先前的直播氛围和现在的弹幕内容，总结推断你作为虚拟主播现在的情绪状态，用简短的词句来描述情绪状态
请只输出新的情绪状态，不要输出其他内容：`,
  description: '虚拟主播情绪状态分析提示词模板',
} as const;
