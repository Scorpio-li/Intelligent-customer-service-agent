# 架构优化建议报告

> 基线日期：2026-11-26 · 项目：阳光商城智能客服 Agent · 总代码量：3135 行
> 阅读前提：你已看过根 README 的「代码执行步骤全链路」章节和 `.ua/knowledge-graph.json` 图谱。

---

## 一、现状基线（可量化指标）

| 维度 | 数值 | 评估 |
|------|------|------|
| 总代码行数 | 3135 | ✅ 小型项目，架构在可控范围内 |
| 测试文件数 | **0** | ❌ **致命短板**，全项目零测试覆盖 |
| API Key 硬编码 | 0 | ✅ 环境变量管理干净 |
| TODO / FIXME 标记 | 0 | ⚠️ 没有技术债标记，但也意味着重构点不可追溯 |
| 文件行数超 400 | 0 | ✅ 符合工程化 R1 规则 |
| knowledge-base 核心模块 | 1339 行 / 16 文件 | ✅ 纯逻辑（bm25/fusion/similarity/intent/vector-index）与副作用（embeddings/rerank/qdrant/metrics）已分离 |
| try-catch 防御点 | 24 处 / 10 文件 | ✅ 关键路径都有降级 catch |
| `console.log/warn/error` | **18 处** | ❌ **生产级问题**，无结构化日志、无法按模块/级别过滤 |
| `as any` 硬断言 | **4 处** | ⚠️ service.ts 3 处 + chat.ts 2 处，绕过类型安全 |
| npm audit 漏洞 | 未运行 | ⚠️ 未接 CI 门禁 |
| 健康检查 endpoint | 0 | ❌ Docker compose / K8s healthcheck 无法接入 |
| CORS 中间件 | 0 | ❌ 前后端分域部署会直接跨域炸掉 |
| 速率限制 | 0 | ❌ SSE + Agent 接口可被恶意打爆 |
| Embedding query 级缓存 | 0 | ⚠️ 高频相同 query 每次实时向量化，浪费成本 |
| metrics 存储 | 进程内，重启清零 | ⚠️ 无法聚合多实例、无历史趋势 |

---

## 二、P0 · 必做（架构安全网，一周内）

### P0-1 测试基础设施（零测试 → 有测试）

**问题**：3135 行代码 0 测试，每次改 retrieval 阈值、改 BM25 权重、换 rerank 模型都靠手动 eval 脚本跑一遍，无法建立 CI 门禁。

**建议方案**：

```
backend/
├── vitest.config.ts              # 新增
├── src/knowledge-base/__tests__/
│   ├── bm25.test.ts              # 中文 bigram 切分、权重配比、边界条件
│   ├── fusion.test.ts            # RRF 数学性质：k→∞ 时分数趋同、单路召回不退化
│   ├── similarity.test.ts        # 零向量、维度不一致、cosine=1
│   ├── intent.test.ts            # 8 意图 + unknown 边界、中文关键词命中
│   ├── vector-index.test.ts      # contentHash 变更触发失效、版本/维度校验
│   └── retrieval.test.ts         # 降级链：rerank ↓ → fallbackRank、Qdrant ↓ → 本地索引
└── src/knowledge-base/__fixtures__/
    └── test-entries.ts           # 3 条 KNOWLEDGE_ENTRIES 副本
```

**覆盖优先级**（自下而上）：
1. 纯函数（bm25 / fusion / similarity / intent / vector-index）—— 零外部依赖，10 分钟起写
2. retrieval 降级链 —— 最大业务风险点，mock 掉 embeddings 和 qdrant
3. Agent prompt 模板快照测试 —— 防止意外改动 System Prompt

**预期效果**：retrieval 阈值从 0.4 改到 0.3 跑一遍就能看到 recall 是否掉、BM25 权重从 3:2:1 改到 4:1:1 立即知道 MRR 变化。

### P0-2 结构化日志（console → Pino 或 debug）

**问题**：18 处 `console.log/warn/error`，在 Qdrant 降级、rerank 失败、Agent 报错、工具调用时都有，但生产环境无法：
- 按 `[kb]` / `[agent]` / `[tool]` 模块过滤
- 按 level（debug/info/warn/error）过滤
- 采集到 Loki / CloudWatch 做告警
- 关联 trace id

**建议方案**：引入轻量 logger，零配置即可替换：

```
// backend/src/utils/logger.ts（新增）
import debug from 'debug'          // 或 pino，看体积偏好
export const log = {
  kb: debug('app:kb'),             // [kb] 模块
  agent: debug('app:agent'),       // [agent] 模块
  tool: debug('app:tool'),         // [tool] 模块
  error: (msg, err) => console.error(msg, err?.message ?? err)
}
```

- 将 repository.ts 的 6 处、retrieval.ts 的 3 处、rerank.ts 的 1 处 console 替换为 `log.kb()` / `log.error()`
- service.ts Agent 错误替换为 `log.error()` + trace id
- 环境变量 `DEBUG=app:*` 打开全部日志；`DEBUG=app:kb` 只看知识库

**不要上 Pino 就因为"结构化"**：项目体量小（3135 行），debug 包 4KB 足够。如果未来要发生产环境 JSON 格式，再换 Pino。

### P0-3 CORS + Rate Limit + Health Check（三条同时加）

这是生产部署的最低三条安全线：

**CORS**（5 行 Express 中间件）：
```typescript
import cors from 'cors'
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? 'http://localhost:5173' }))
```
**没有这行，前端部署到 Vercel / Netlify 后直接 403。**

**Rate Limit**（5 行）：
```typescript
import rateLimit from 'express-rate-limit'
app.use('/api/chat', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true }))
app.use('/api/kb', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true }))
```
默认 30 req/min/ip 给 chat（包含 SSE 长连接），10 给 kb（管理接口）。

**Health Check**（5 行）：
```typescript
app.get('/healthz', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }))
app.get('/readyz', async (_req, res) => {
  const qdrantOk = await checkQdrantConnection()      // 1 秒超时
  res.json({ qdrant: qdrantOk, db: true })           // 未来加 DB 检查
})
```
Docker compose healthcheck 和 K8s livenessProbe 都要用。

---

## 三、P1 · 高优（架构能力提升，两到三周）

### P1-1 Metrics 升级：进程内 → Prometheus 格式

**问题**：`metrics.ts` 当前是进程内对象数组（MAX_SAMPLES=500 滑动窗口），重启清零、多实例无法聚合、无历史趋势。但它的数据结构设计已经很好——分阶段 latency 分位数 + cost 估算 + retrieval 代理指标，只是输出方式需要换。

**建议方案**：
1. 引入 `prom-client` 库（7KB），在 metrics.ts 里把现有手动 latency p50/p95 计算换成 Summary 类型自动聚合
2. `/api/metrics` 同时支持 JSON（dashboard）和 `/metrics` Prometheus 格式（Grafana scrape）
3. 加一个 `processExit` 钩子把当前快照落到 `data/metrics-snapshot.json`（重启后恢复基线）
4. 多实例部署时各实例暴露 `/metrics`，Prometheus 拉取 + Grafana 聚合

**额外指标建议**：
- `kb_retrieval_embedding_cache_hit_rate`（加了 Redis 缓存后能观察效果）
- `kb_retrieval_rerank_fallback_rate`（监控 DashScope gte-rerank 可用性）
- `agent_stream_token_count_total`（实际 token 消耗，对比估算成本）

### P1-2 Embedding Query 级缓存

**问题**：用户输入相同 query（"转人工客服"、"查订单 SO20241125001"）时每次都调 DashScope `text-embedding-v3`。embedding API 按 token 计费，高频重复 query 纯粹浪费钱和延迟。

**建议方案**：
```typescript
// embeddings.ts 已有 entryCache Map，扩展 queryCache：
const queryCache = new Map<string, { vector: number[]; expiresAt: number }>()
const CACHE_TTL = 3600_000   // 1 小时
const MAX_CACHE = 5000       // LRU 上限

// embedTexts 内加：
const cached = queryCache.get(text)
if (cached && cached.expiresAt > Date.now()) return [cached.vector]
// ... 调 DashScope ...
queryCache.set(text, { vector, expiresAt: Date.now() + CACHE_TTL })
```

**效果估算**：17 条 eval query 重复跑 10 次可省 90% embedding 调用成本，延迟从 219ms 降到 1ms（内存查表）。

### P1-3 OpenTelemetry 链路追踪

**问题**：当前 SSE 从前端发出到后端返回，中间经过 BM25 → embedding → Qdrant → rerank → Agent → 3 个工具调用，出问题时只能看日志猜哪一步慢或失败。缺少 trace id 贯穿全链路。

**建议方案**（最小化接入）：
1. 引入 `@opentelemetry/sdk-trace-node` + `@opentelemetry/exporter-trace-otlp-http`（可选组件包体积约 50KB）
2. 在 routes/chat.ts 入口 `res.locals.traceId = generateTraceId()`
3. 每个降级 catch（repository.ts L63, retrieval.ts L78, rerank.ts L71）都 `span.recordException(err)`
4. Agent streamText 每次 tool-call 开一个子 span
5. 导出到 Jaeger（本地）/ Tempo（Grafana Cloud）

**不建议上来就接 OTel Collector**：项目体量不够，直接用 `@opentelemetry/exporter-trace-otlp-http` 发 OTLP JSON 给 Grafana Agent 足够。

### P1-4 Retrieval Pipeline 模块化（纯逻辑 vs 副作用 完全解耦）

**问题**：retrieval.ts 219 行虽然在阈值内，但编排层把"并行召回报编排"和"降级策略判定"和"阈值过滤"和"metrics 埋点"全部堆在一起，未来要改 RRF k 值或加新召回通道时修改面大。

**建议拆分**（从 retrieval.ts 拆出 2 个文件）：

```
knowledge-base/
├── retrieval.ts         → 主编排，只做时序 + stage 判定 + 调下面三个
├── retrieve-strategy.ts → 并行召回策略（BM25 ∥ recallVectors + Promise.all）
├── rerank-strategy.ts   → RRF → rerank → 阈值过滤 + fallbackRank
```

**原则**：strategies 是纯函数（给定候选 + query → 返回排序结果），retrieval.ts 是副作用（调外部 API、埋 metrics）。strategies 可以独立做 property-based 测试。

---

## 四、P2 · 中期（业务能力扩展，按需）

### P2-1 知识库 ACL（租户 / 角色维度）

**问题**：当前 Qdrant collection 所有条目对所有意图都可见，payload 只有 intent + model_version。如果多业务线共用一个知识库，商家 A 的问题可能匹配到商家 B 的条目。

**建议方案**：
- payload schema 加 `tenant: string` + `visibility: 'public' | 'internal' | 'private'`
- Qdrant filter 从 `must=[intent, model_version]` 扩展为 `must=[tenant?, intent, model_version]`
- 前端可选传 tenantId，不传默认 'default'

### P2-2 SSE 断线重连

**问题**：网络抖动 / 代理超时 / 前端切换 tab 导致 SSE 断开，当前前端无自动重连机制，用户需要重新发送消息。

**建议方案**：
1. 前端 api/chat.ts 加 `reconnect` 包装：断开后 3 秒内自动重连 + 从最后一个 assistantId 继续
2. 后端在 SSE 流里每 15 秒发一次 `: checkpoint { lastEventId }\n\n`（已有的 ping 心跳可以复用）
3. 重连时 `Last-Event-ID` header 传给后端，后端从对应位置继续推

### P2-3 会话持久化

**问题**：会话仅存前端 Pinia 内存，刷新即丢。后端无 session，Agent 的 `messages` 全由前端传来，跨设备无法续聊。

**建议方案**：
1. 后端 `POST /api/sessions` 创建 session，返回 `sessionId`（随机 24 字节）
2. Agent 每次 runAgent 完成后把 messages 快照存 Redis（TTL 24h）
3. 前端刷新时 `GET /api/sessions/:id` 恢复历史
4. Redis 作为唯一消息源，Pinia store 只做视图缓存

---

## 五、P3 · 长期（战略方向）

### P3-1 检索评估 CI 门禁

**问题**：eval-retrieval.ts 是手动脚本，阈值从 0.4 改到 0.3 后如果 recall 掉到 80% 以下，没人知道直到上线后才有用户反馈。

**建议方案**：
1. eval-retrieval.ts 加 `--fail-on-recall 0.95` 参数，低于则 exit 1
2. 加 GitHub Actions / GitLab CI job：`npm run eval:retrieval -- --fail-on-recall 0.95`
3. 每次改 retrieval.ts / bm25.ts / rerank.ts 的 PR 必须通过

### P3-2 Hot-Reload 知识库管线

**问题**：后端启动时 syncEntries 把 8 条种子导入 Qdrant，运行中只能通过 `/api/kb/:id` 单条热更新。批量新增 / 权限过滤 / 文档上传（Markdown → 切片 → embedding）都没有。

**建议方案**：
1. 新增 `knowledge-base/ingest.ts` —— Markdown / TXT → 按段落切片 → 每条切片作为一个 Qdrant entry
2. 新增 `scripts/ingest-from-dir.ts` —— `npx tsx scripts/ingest-from-dir.ts docs/faq/` 批量导入
3. 切片策略：按 `\n\n` 分句 + 每段 ≤ 500 字，overlap 50 字避免边界信息丢失
4. 切片条目 payload 加 `source_path` + `chunk_index`，方便溯源

### P3-3 Rerank 候选集大小自适应

**问题**：RRF 融合后固定取 top 5 给 rerank。如果 BM25 一路特别弱（所有分 < 0.4），但向量一路 top 5 很准，5 个可能不够覆盖真正的 RAG 证据。反之 BM25 特别强时 5 个里混进 2 个噪音候选。

**建议方案**：
- 观察 RRF 融合后 topK 的分差：如果 top1-top5 分差 > 3x（说明分布宽），取 8 条给 rerank
- 如果 top1-top5 分差 < 0.5x（说明分布窄，BM25 一路几乎没贡献），取 3 条即可
- 加 metrics `kb_retrieval_rrf_topk_adapted` 观察效果

---

## 六、路线图（按投入产出排序）

```
Week 1 ── P0-1 测试基础设施（vitest + pure functions 先起）
       ── P0-2 结构化日志（debug 包，1 天替换完 18 处）
       ── P0-3 CORS + Rate Limit + Health Check（各 10 行）
Week 2 ── P1-1 Prometheus metrics（prom-client + /metrics）
       ── P1-2 Embedding query 级缓存（5 行 Map + TTL）
Week 3 ── P1-3 OpenTelemetry 链路追踪（可选，不阻塞其他）
       ── P1-4 Retrieval 模块化（拆 strategies 纯函数）
Month 2 ── P2-1 / P2-2 / P2-3 按需加
Month 3+ ── P3-1 / P3-2 / P3-3 战略方向
```

---

## 七、架构图变更预览（如果全部建议落地）

```
┌──────────────────────────────────────────────────────────────┐
│ 前端视图层    ChatView · HomeView · AboutView · NotFound      │
├──────────────────────────────────────────────────────────────┤
│ 前端状态&API  Pinia + SSE fetch + chat-format + *断线重连*    │
├──────────────────────────────────────────────────────────────┤
│ 前端构建      Vite · TS · ESLint                              │
├──────────────────────────────────────────────────────────────┤
│ ═════════════ Vite dev proxy /api → :3001 ═══════════════════  │
├──────────────────────────────────────────────────────────────┤
│ HTTP 协议层   routes/ + *CORS* + *rate-limit* + *healthz*    │
├──────────────────────────────────────────────────────────────┤
│ Agent 对话层  streamText + tools × 3 + prompt + convert        │
├──────────────────────────────────────────────────────────────┤
│ 混合检索层    retrieval.ts 主编排                              │
│               ├─ retrieve-strategy.ts  纯函数（并行召回）       │
│               ├─ rerank-strategy.ts   纯函数（RRF→rerank→阈值）│
│               ├─ bm25 / fusion / similarity / intent          │
│               ├─ embeddings *[+ query 级缓存]*                │
│               ├─ rerank + qdrant                             │
│               └─ metrics *[+ Prometheus 格式]*               │
├──────────────────────────────────────────────────────────────┤
│ 数据存储层    Qdrant *[+ ACL tenant]* + repository.ts          │
│               + 离线索引 + 种子 + mock 订单 + *Redis session* │
├──────────────────────────────────────────────────────────────┤
│ 后端配置      .env.example · package.json · tsconfig          │
├──────────────────────────────────────────────────────────────┤
│ 运维脚本      build-vector-index · sync-knowledge              │
│               eval-retrieval *[+ CI 门禁]*                     │
│               *[+ ingest-from-dir（批量 Markdown 导入）]*     │
├──────────────────────────────────────────────────────────────┤
│ 可观测性      *结构化日志(debug/pino)* + *OpenTelemetry trace* │
│               + *Prometheus / Grafana*                        │
├──────────────────────────────────────────────────────────────┤
│ 项目文档      README.md · AGENTS.md · REQUIREMENTS.md         │
└──────────────────────────────────────────────────────────────┘
```

**加 *[斜体]* 的是本次建议新增的模块或能力。**

---

## 八、不建议做的事（避坑指南）

| 不建议 | 原因 |
|--------|------|
| 把 Express 换成 Fastify | 当前 3135 行，性能瓶颈在 DashScope rerank/embedding API（95% 时间花在网络 IO），Fastify 省不了任何时间 |
| 上 LangChain / LlamaIndex 封装 | 增加抽象层但不增加能力，当前直接用 Vercel AI SDK + 自己写的混合检索更透明 |
| 把 BM25 换成 Elasticsearch | 8 条种子数据用不到 600MB ES 进程；BM25.ts 87 行纯函数性能足够（1ms 级别） |
| 加 TypeScript strict 全量强制 | 4 处 `as any` 都是与外部 SDK（Vercel AI SDK、Express）类型边界处，硬改会引入 wrapper 层增加复杂度 |
| 上 K8s | 单实例 Docker compose 足够，指标已经考虑了多实例聚合但当前规模用不到 |
