import {
  useChatStore,
  type ModelChoice,
  type KbSource,
  type RagHitPayload
} from '@/stores/chat'

interface SSEPayload {
  text?: string
  message?: string
  args?: unknown
  result?: unknown
  tool?: string
  // rag-hit 事件字段
  intent?: string
  stage?: string
  score?: number
  sources?: KbSource[]
}

interface SSEResult {
  assistantId: string
}

export interface StreamChatOptions {
  /** 收到 rag-hit（知识库直出）事件时回调，写入 store 的动作由调用方提供 */
  onRagHit?: (payload: RagHitPayload) => void
}

/**
 * 向后端发起一次聊天请求，通过 SSE 流式消费回复。
 * 所有 UI 更新通过 chat store 完成，调用方只需 await。
 */
export async function streamChat(
  model: ModelChoice,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  options: StreamChatOptions = {}
): Promise<SSEResult> {
  const chat = useChatStore()
  const assistantMsg = chat.createAssistantPlaceholder()
  const assistantId = assistantMsg.id

  // 用 fetch（不是 axios）——axios 不支持流式 ReadableStream
  const url = '/api/chat'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages })
  })

  if (!res.ok || !res.body) {
    chat.finishStreaming(assistantId, `请求失败：${res.status}`)
    return { assistantId }
  }

  // SSE 解析 —— 每行形如：
  //   event: text-delta\n
  //   data: {"text":"..."}\n\n
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let currentEvent = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // 按双换行切事件块
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      let eventName = currentEvent
      let dataStr = ''

      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataStr += line.slice(5).trim()
        }
      }

      if (!dataStr) continue

      let payload: SSEPayload
      try {
        payload = JSON.parse(dataStr)
      } catch {
        // ping 或格式不对，跳过
        continue
      }

      switch (eventName) {
        case 'text-delta':
          chat.appendDelta(assistantId, payload.text ?? '')
          break

        case 'tool-call':
          chat.pushToolTrace(assistantId, { tool: payload.tool ?? '', args: payload.args })
          break

        case 'tool-result':
          chat.pushToolTrace(assistantId, {
            tool: payload.tool ?? '',
            result: payload.result
          })
          break

        case 'rag-hit':
          // 知识库直出：把来源交给调用方写入 store，后续仍会有 text-delta / finish / done
          options.onRagHit?.({
            intent: payload.intent,
            stage: payload.stage,
            score: payload.score,
            sources: payload.sources ?? []
          })
          break

        case 'error':
          chat.finishStreaming(assistantId, payload.message ?? '未知错误')
          break

        case 'done':
          break

        default:
          break
      }
    }
    currentEvent = ''
  }

  // 如果还没 finish（比如后端断了但没发 error），兜底收尾
  if (chat.findMessage(assistantId)?.streaming) {
    chat.finishStreaming(assistantId)
  }

  return { assistantId }
}
