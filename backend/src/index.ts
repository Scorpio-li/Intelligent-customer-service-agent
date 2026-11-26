// backend/src/index.ts — Express 服务入口
//
// 启动顺序：
//   1. dotenv 加载 .env
//   2. 创建 Express app，mount /api/chat、/api/kb、/api/metrics 三个路由
//   3. 先 initRepository() 完成 Qdrant 初始化（失败自动降级本地模式）
//   4. 再 app.listen() 开始接收请求 — 确保首个请求到来时知识库已就绪
//
// 依赖（按目录主题分）：
//   routes/          → HTTP 协议层（chat SSE / kb 热更新 / metrics 监控）
//   agent/           → Vercel AI SDK streamText + 3 个工具
//   knowledge-base/  → 混合检索（BM25 + 向量 + RRF + rerank）+ Qdrant + 离线索引
//   types/           → 前后端共享 DTO（ChatRequest / ChatMessage / Order）
//
// 环境变量：见根 README.md 的 "backend/.env" 表格
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import chatRouter from './routes/chat.js'
import kbRouter from './routes/kb.js'
import metricsRouter from './routes/metrics.js'
import { initRepository } from './knowledge-base/index.js'

const app = express()
const PORT = Number(process.env.PORT) || 3001

app.use(cors())
app.use(express.json({ limit: '1mb' }))

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() })
})

// Chat agent
app.use('/api/chat', chatRouter)

// 知识条目管理（热更新，不需要改代码发版）
app.use('/api/kb', kbRouter)

// 检索监控指标
app.use('/api/metrics', metricsRouter)

// 先完成知识库初始化（Qdrant 不可用时自动降级本地模式），再开始接收请求
initRepository().finally(() => {
  app.listen(PORT, () => {
    console.log(`[backend] Agent server listening on http://localhost:${PORT}`)
  })
})
