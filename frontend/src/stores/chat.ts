import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ChatRole = 'user' | 'assistant'

/** 回复来源：kb = 知识库直出（未经 LLM），agent = Agent 生成 */
export type MessageSource = 'kb' | 'agent'

/** 知识库来源条目 */
export interface KbSource {
  id: string
  title: string
}

/** 后端 rag-hit 事件的 payload */
export interface RagHitPayload {
  intent?: string
  stage?: string
  score?: number
  sources?: KbSource[]
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** 工具调用痕迹（assistant 回复里用到工具时记录） */
  toolTraces?: Array<{
    tool: string
    args?: unknown
    result?: unknown
  }>
  /** 回复来源；'kb' 时展示「知识库直出」徽标 */
  source?: MessageSource
  /** 知识库直出的来源条目（仅 source 为 'kb' 时有意义） */
  sources?: KbSource[]
  streaming?: boolean
  error?: string
}

export type ModelChoice = 'deepseek' | 'qwen'

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])
  const model = ref<ModelChoice>('deepseek')
  const loading = ref(false)

  // 转换成后端需要的 ChatMessage 格式（只保留 role + content）
  const wireMessages = computed(() =>
    messages.value.map((m) => ({ role: m.role, content: m.content }))
  )

  function reset() {
    messages.value = []
    loading.value = false
  }

  function appendUser(text: string): ChatMessage {
    const msg: ChatMessage = { id: makeId(), role: 'user', content: text }
    messages.value.push(msg)
    return msg
  }

  function createAssistantPlaceholder(): ChatMessage {
    const msg: ChatMessage = {
      id: makeId(),
      role: 'assistant',
      content: '',
      // 默认按 Agent 生成处理；若后端先发 rag-hit，applyRagHit() 会改成 'kb'
      source: 'agent',
      streaming: true
    }
    messages.value.push(msg)
    return msg
  }

  function findMessage(id: string) {
    return messages.value.find((m) => m.id === id)
  }

  function finishStreaming(id: string, error?: string) {
    const m = findMessage(id)
    if (m) {
      m.streaming = false
      if (error) m.error = error
    }
  }

  function appendDelta(id: string, delta: string) {
    const m = findMessage(id)
    if (m) m.content += delta
  }

  function pushToolTrace(assistantId: string, trace: NonNullable<ChatMessage['toolTraces']>[number]) {
    const m = findMessage(assistantId)
    if (m) {
      if (!m.toolTraces) m.toolTraces = []
      m.toolTraces.push(trace)
    }
  }

  // 找到当前正在流式输出的 assistant 消息（store 是唯一数据源，从后往前扫）
  function findStreamingAssistant(): ChatMessage | undefined {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m = messages.value[i]
      if (m.role === 'assistant' && m.streaming) return m
    }
    return undefined
  }

  function findLastAssistant(): ChatMessage | undefined {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'assistant') return messages.value[i]
    }
    return undefined
  }

  /**
   * 收到后端 rag-hit 事件时调用：把命中的知识库来源写到当前流式输出的 assistant 消息上。
   * 找不到流式消息时退回最后一条 assistant，避免来源信息丢失。
   */
  function applyRagHit(payload: RagHitPayload) {
    const target = findStreamingAssistant() ?? findLastAssistant()
    if (!target) return
    target.source = 'kb'
    target.sources = payload.sources ?? []
  }

  return {
    messages,
    model,
    loading,
    wireMessages,
    reset,
    appendUser,
    createAssistantPlaceholder,
    findMessage,
    finishStreaming,
    appendDelta,
    pushToolTrace,
    applyRagHit
  }
})
