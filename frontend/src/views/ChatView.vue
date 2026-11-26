<!--
  ChatView.vue — 智能客服聊天主页面 (310 行)
  职责：用户输入 → 调 /api/chat SSE → 流式渲染回复 + 工具调用痕迹 + 知识库直出标记
  依赖：
    - @/stores/chat      (会话状态、loading、模型选择、applyRagHit)
    - @/api/chat         (fetch + ReadableStream SSE 消费)
    - @/utils/chat-format (纯函数：formatToolTrace / formatKbSources)
  关键函数：send() (L44), onKeydown() (L71)
  容易踩坑：
    - fetch 必须走 vite 开发代理 (/api → :3001)，别硬写 localhost
    - streamChat 内部创建的 assistant placeholder id 要从返回值拿，别自己 generate
    - rag-hit 的 sources 只能写回 store 里的流式消息，组件不要另存副本
-->
<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue'
import { useChatStore, type ModelChoice } from '@/stores/chat'
import { streamChat } from '@/api/chat'
import { formatToolTrace, formatKbSources } from '@/utils/chat-format'

const chat = useChatStore()
const input = ref('')
const modelOptions: { label: string; value: ModelChoice }[] = [
  { label: 'DeepSeek (默认)', value: 'deepseek' },
  { label: '通义千问', value: 'qwen' }
]
const scrollRef = ref<HTMLElement | null>(null)

// 自动滚到底部
watch(
  () => chat.messages.length,
  async () => {
    await nextTick()
    scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight, behavior: 'smooth' })
  }
)

onMounted(() => {
  // 初始欢迎语
  if (chat.messages.length === 0) {
    chat.appendUser('你好，我想咨询一下')
  }
})

async function send() {
  const text = input.value.trim()
  if (!text || chat.loading) return

  chat.appendUser(text)
  input.value = ''
  chat.loading = true

  try {
    await streamChat(
      chat.model,
      chat.messages.map((m) => ({ role: m.role, content: m.content })),
      {
        // rag-hit 表示这条回复来自知识库：写回 store 里正在流式输出的那条 assistant 消息
        onRagHit: (hit) => chat.applyRagHit(hit)
      }
    )
  } catch (err: unknown) {
    const last = chat.messages[chat.messages.length - 1]
    if (last?.streaming) {
      chat.finishStreaming(last.id, err instanceof Error ? err.message : '请求失败')
    }
  } finally {
    chat.loading = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <section class="chat-page">
    <header class="chat-header">
      <div class="brand">
        <RouterLink to="/">← 返回首页</RouterLink>
        <h1>阳光商城 · 智能客服</h1>
      </div>
      <div class="controls">
        <label>
          模型：
          <select v-model="chat.model" :disabled="chat.loading">
            <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <button @click="chat.reset()" :disabled="chat.loading">清空会话</button>
      </div>
    </header>

    <div class="chat-messages" ref="scrollRef">
      <div v-if="chat.messages.length === 0" class="empty">
        输入问题开始对话，试试："查一下我的订单 SO20241125001"
      </div>

      <div
        v-for="msg in chat.messages"
        :key="msg.id"
        :class="['bubble', msg.role, { streaming: msg.streaming }]"
      >
        <div class="bubble-head">
          {{ msg.role === 'user' ? '你' : '客服 AI' }}
        </div>

        <!-- 工具痕迹 -->
        <div v-if="msg.toolTraces?.length" class="tool-traces">
          <div
            v-for="(t, i) in msg.toolTraces"
            :key="i"
            class="tool-trace"
            v-text="formatToolTrace(t) ?? ''"
          />
        </div>

        <!-- 知识库直出：徽标 + 来源标题 -->
        <div v-if="msg.source === 'kb'" class="kb-hit">
          <span class="kb-badge">知识库直出</span>
          <span v-if="msg.sources?.length" class="kb-sources">
            {{ formatKbSources(msg.sources) }}
          </span>
        </div>

        <div class="bubble-body" v-html="msg.content.replace(/\n/g, '<br/>')"></div>

        <div v-if="msg.streaming" class="cursor">▊</div>
        <div v-if="msg.error" class="error">⚠️ {{ msg.error }}</div>
      </div>
    </div>

    <footer class="chat-input">
      <textarea
        v-model="input"
        :disabled="chat.loading"
        placeholder="输入问题，按 Enter 发送 / Shift+Enter 换行"
        rows="2"
        @keydown="onKeydown"
      />
      <button @click="send" :disabled="chat.loading || !input.trim()">
        {{ chat.loading ? '思考中…' : '发送' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 760px;
  margin: 0 auto;
  border-left: 1px solid #eee;
  border-right: 1px solid #eee;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid #eee;
  background: #fafafa;
}

.brand h1 {
  font-size: 16px;
  margin: 4px 0 0;
}

.controls {
  display: flex;
  gap: 12px;
  align-items: center;
}
.controls select,
.controls button {
  padding: 6px 10px;
  font-size: 13px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty {
  color: #999;
  text-align: center;
  padding: 40px;
}

.bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.6;
  font-size: 14px;
  position: relative;
}

.bubble.user {
  align-self: flex-end;
  background: #42b883;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.bubble.assistant {
  align-self: flex-start;
  background: #f1f1f1;
  color: #213547;
  border-bottom-left-radius: 4px;
}

.bubble-head {
  font-size: 11px;
  opacity: 0.7;
  margin-bottom: 2px;
}

.tool-traces {
  margin-bottom: 6px;
}
.tool-trace {
  font-size: 12px;
  color: #666;
  background: rgba(0, 0, 0, 0.05);
  padding: 4px 8px;
  border-radius: 6px;
  margin-bottom: 3px;
}

.kb-hit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
}
.kb-badge {
  background: #42b883;
  color: #fff;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  line-height: 1.7;
}
.kb-sources {
  color: #213547;
  opacity: 0.75;
}

.cursor {
  display: inline-block;
  margin-left: 2px;
  animation: blink 0.8s infinite;
  font-weight: bold;
}
@keyframes blink {
  50% { opacity: 0; }
}

.error {
  color: #c0392b;
  font-size: 12px;
  margin-top: 4px;
}

.chat-input {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid #eee;
  background: #fff;
}
.chat-input textarea {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-family: inherit;
  font-size: 14px;
  resize: none;
}
.chat-input button {
  padding: 8px 20px;
  background: #42b883;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
}
.chat-input button:disabled {
  background: #aaa;
  cursor: not-allowed;
}
</style>
