// convert.ts — AI SDK 消息格式转换（纯函数，无副作用）
// 前端 ChatMessage[] → Vercel AI SDK 需要的 message shape
import type { ChatMessage } from '../types/index.js'

/**
 * 把前端传来的 ChatMessage[] 转成 Vercel AI SDK 需要的格式。
 * tool_call_id 在 tool 消息里必须是数组格式（AI SDK 4.x 的 ToolContent 要求）。
 *
 * 纯函数：相同输入永远相同输出，不读/写外部状态。
 */
export function toSdkMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant' as const,
        content: m.content,
        toolCalls: m.toolCalls
      }
    }
    if (m.role === 'tool') {
      return {
        role: 'tool' as const,
        toolCallId: m.tool_call_id ?? '',
        content: [{ type: 'text' as const, text: m.content }]
      }
    }
    return {
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content
    }
  })
}
