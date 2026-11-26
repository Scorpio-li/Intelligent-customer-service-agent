// backend/src/index.ts — Express 服务入口
//
// 启动顺序：
//   1. dotenv 加载 .env
//   2. 创建 Express app，加安全中间件链（CORS → rate-limit → JSON body）
//   3. mount 三个业务路由 + 两个健康检查端点
//   4. initRepository() 先完成知识库初始化（Qdrant 不可用时自动降级本地模式）
//   5. 再 app.listen() 开始接收请求 — 确保首个请求到来时知识库已就绪
//
// 安全中间件链：
//   CORS —— 允许的源由 ALLOWED_ORIGINS 环境变量配置，默认 localhost
//   Rate Limit —— /api/chat 30 req/min/ip，/api/kb 10 req/min/ip（管理接口更严）
//   JSON body limit —— 1mb，防止大包 OOM
//
// 健康检查：
//   GET /healthz —— Liveness，node 进程活着就返回 ok
//   GET /readyz  —— Readiness，额外检查 Qdrant 可达性（本地降级也 ok）
//   区别：K8s livenessProbe 用 /healthz（挂了重启），readinessProbe 用 /readyz（挂了摘流量）
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
import rateLimit from 'express-rate-limit'
import { log } from './utils/logger.js'
import chatRouter from './routes/chat.js'
import kbRouter from './routes/kb.js'
import metricsRouter from './routes/metrics.js'
import { initRepository, qdrantEnabled } from './knowledge-base/index.js'

const app = express()
const PORT = Number(process.env.PORT) || 3001

// ── 1. CORS 配置 ────────────────────────────────────────────────────────────
// ALLOWED_ORIGINS 逗号分隔；默认只允许本地 Vite dev server
const allowedOrigins =
  process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://localhost:3002'
  ]

app.use(
  cors({
    origin: (origin, callback) => {
      // 无 Origin 头（curl / 后端间调用）也允许
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
      log.warn('CORS 拒绝来源 %s', origin)
      // 返回 false 让 cors 包发 403 + CORS 头，而不是抛 Error 导致 500
      callback(null, false)
    },
    credentials: true
  })
)

// ── 2. Rate Limit ──────────────────────────────────────────────────────────
// /api/chat（含 SSE 长连接）：30 req/min/ip
const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,    // 返回 X-RateLimit-* 响应头
  legacyHeaders: false,     // 关闭旧的 X-Rate-Limit-* 头
  message: { error: '请求过于频繁，请稍后再试' }
})

// /api/kb（管理接口）：更严 —— 10 req/min/ip
const kbLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '管理接口请求过于频繁' }
})

// /api/metrics：只读指标，宽松 —— 60 req/min/ip
const metricsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '指标接口请求过于频繁' }
})

app.use(express.json({ limit: '1mb' }))

// ── 3. 健康检查 ────────────────────────────────────────────────────────────
// /healthz —— Liveness：进程活着就 ok
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime() * 1000) })
})

// /readyz —— Readiness：额外检查 Qdrant 可达性
app.get('/readyz', (_req, res) => {
  const qdrantOk = qdrantEnabled()
  const degraded = !qdrantOk
  res.status(degraded ? 503 : 200).json({
    status: degraded ? 'degraded' : 'ready',
    uptime: Math.round(process.uptime() * 1000),
    qdrant: qdrantOk ? 'connected' : 'unavailable (local fallback)',
    degraded
  })
})

// ── 4. 业务路由 ────────────────────────────────────────────────────────────
app.use('/api/chat', chatLimiter, chatRouter)
app.use('/api/kb', kbLimiter, kbRouter)
app.use('/api/metrics', metricsLimiter, metricsRouter)

// 404 —— 所有未匹配路由返回 JSON 错误，不要回 HTML
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' })
})

// 全局错误兜底 —— 防止未捕获异常 crash 掉进程
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error('未捕获错误', err)
  res.status(500).json({ error: 'Internal Server Error' })
})

// ── 5. 启动：先 initRepository，再 listen ─────────────────────────────────
initRepository().finally(() => {
  app.listen(PORT, () => {
    log.server('Agent server listening on http://localhost:%d (origins=%s)', PORT, allowedOrigins.join(','))
  })
})
