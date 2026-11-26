// routes/chat.ts — POST /api/chat — 流式 SSE 对话
//
// 请求体：{ model?: 'deepseek' | 'qwen', messages: ChatMessage[] }
// 响应：text/event-stream，事件序列如下
//   rag-hit   → 知识库命中，短路返回条目内容（不调 LLM）
//   text-delta → LLM 逐 token 输出（rag-hit 也会发，携带条目全文）
//   tool-call → AI 决定调用哪个工具，展示调用痕迹
//   tool-result → 工具执行结果回填给 AI
//   finish    → AI 结束本轮迭代
//   done      → 整个 SSE 流结束
//   error     → 异常消息（400 后立即 res.end）
//
// 两条路径：
//   1. 知识库命中 → 直接发 rag-hit + text-delta + finish + done，不校验 API Key
//   2. 未命中 → 校验所选模型的 API Key，运行 runAgent() 流式推结果
//
// 15 秒一次的 `: ping` 心跳保持长连接，防止代理超时断开
import { Router } from 'express'
import { runAgent } from '../agent/index.js'
import { log } from '../utils/logger.js'
import { classifyIntent, retrieve } from '../knowledge-base/index.js'
import type { ChatRequest } from '../types/index.js'

const router = Router()

// SSE 事件格式
function sse(res: any, event: string, data: unknown) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

router.post('/', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const body = req.body as ChatRequest

  // 意图识别 + 两阶段知识库检索：命中则短路返回，不调用 LLM、不校验 API Key
  const incoming = Array.isArray(body?.messages) ? body.messages : []
  const lastUser = [...incoming].reverse().find((m) => m.role === 'user')
  const userText = typeof lastUser?.content === 'string' ? lastUser.content : ''

  if (userText.trim()) {
    const { intent } = classifyIntent(userText)
    const r = await retrieve(userText, intent)

    if (r.hit) {
      log.chat('hit intent=%s stage=%s score=%s', intent, r.stage, r.score)
      sse(res, 'rag-hit', {
        intent,
        stage: r.stage,
        score: r.score,
        sources: r.entries.map((e) => ({ id: e.id, title: e.title }))
      })
      sse(res, 'text-delta', { text: r.entries.map((e) => e.content).join('\n\n') })
      sse(res, 'finish', { finishReason: 'stop' })
      sse(res, 'done', {})
      res.end()
      return
    }

    log.chat('miss intent=%s', intent)
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    sse(res, 'error', { message: 'messages 不能为空' })
    res.end()
    return
  }

  const modelKey = body.model === 'qwen' ? 'DASHSCOPE_API_KEY' : 'DEEPSEEK_API_KEY'
  if (!process.env[modelKey]) {
    sse(res, 'error', {
      message: `后端未配置 ${modelKey}，请在 backend/.env 中设置`
    })
    res.end()
    return
  }

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n')
  }, 15000)

  try {
    const result = runAgent(body)

    for await (const part of result.fullStream as AsyncIterable<any>) {
      switch (part.type) {
        case 'text-delta':
          sse(res, 'text-delta', { text: part.textDelta })
          break

        case 'tool-call':
          sse(res, 'tool-call', {
            tool: part.toolName,
            args: part.args
          })
          break

        case 'tool-result':
          sse(res, 'tool-result', {
            tool: part.toolName,
            result: part.result
          })
          break

        case 'finish':
          sse(res, 'finish', { finishReason: part.finishReason })
          break

        default:
          // ignore unknown events
          break
      }
    }

    sse(res, 'done', {})
  } catch (err: unknown) {
    log.error('Agent 运行出错', err)
    sse(res, 'error', {
      message: err instanceof Error ? err.message : 'Agent 运行出错'
    })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

export default router
