// agent/service.ts — Agent 核心：封装 Vercel AI SDK streamText() 调用
//
// 职责：给定 ChatRequest（模型 + 消息历史），返回可 SSE 推流的 result 对象。
// 不负责：知识库检索（在 routes/chat.ts 里短路处理）、SSE 协议（routes 层负责）。
//
// 模型热切换：
//   前端请求 body 里传 model: 'deepseek' | 'qwen'，这里用 Vercel AI SDK provider
//   抽象层选对应的 factory（createDeepSeek / createOpenAICompatible），API Key 在
//   启动时从 .env 读入。新增模型 → 安装 provider 包 + 加一个 factory + 前端加选项。
//
// 迭代上限：maxSteps: 5 — 防止 LLM 在多轮工具调用里死循环。
//   如果 Agent 运行过程中失败（API Key 未配 / 网络错误），这里抛异常由 routes
//   层 catch 后发 error 事件。
import 'dotenv/config'
import { streamText } from 'ai'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { CUSTOMER_SERVICE_PROMPT } from './prompt.js'
import { tools } from './tools.js'
import { toSdkMessages } from './convert.js'
import type { ChatRequest } from '../types/index.js'

// 模型名可通过环境变量覆盖，未配置时使用默认值
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash'
const DASHSCOPE_MODEL = process.env.DASHSCOPE_MODEL || 'qwen-plus'

// Provider 初始化（副作用：读 process.env）
const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY
})

const qwen = createOpenAICompatible({
  name: 'qwen',
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
})

/**
 * 运行一次 Agent：接收用户请求，返回可 SSE 推流的 ReadableStream。
 *
 * 副作用：调 LLM（网络 IO）。纯逻辑部分（消息格式转换）在 convert.ts。
 */
export function runAgent(req: ChatRequest) {
  const modelFactory = req.model === 'qwen' ? qwen : deepseek
  const modelName = req.model === 'qwen' ? DASHSCOPE_MODEL : DEEPSEEK_MODEL
  const model = modelFactory(modelName) as ReturnType<typeof deepseek>

  const messages = toSdkMessages(req.messages)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = streamText({
    model: model as any,
    system: CUSTOMER_SERVICE_PROMPT,
    tools,
    messages: messages as any,
    maxSteps: 5
  })

  return result
}
