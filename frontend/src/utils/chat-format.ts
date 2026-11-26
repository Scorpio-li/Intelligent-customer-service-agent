// chat-format.ts — 聊天相关的纯格式化函数（无副作用）
// 对应 ChatView.vue 里原 formatToolTrace()

export interface ToolTrace {
  tool: string
  args?: unknown
  result?: unknown
}

/**
 * 把工具调用痕迹格式化成前端可显示的字符串。
 * 入参相同 → 输出相同，不依赖外部状态。
 */
export function formatToolTrace(trace: ToolTrace): string | null {
  if (trace.args && !trace.result) {
    return `🔧 调用 \`${trace.tool}\`：${JSON.stringify(trace.args)}`
  }
  if (trace.result && !trace.args) {
    return `📦 返回 \`${trace.tool}\` 结果`
  }
  return null
}

/**
 * 把知识库来源格式化成一行文案，如「来源：发票开具说明」。
 * 多条来源用「、」连接；无来源返回空串。
 */
export function formatKbSources(
  sources?: Array<{ id: string; title: string }>
): string {
  if (!sources?.length) return ''
  return `来源：${sources.map((s) => s.title).join('、')}`
}
