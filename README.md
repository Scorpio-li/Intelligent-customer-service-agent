# 阳光商城智能客服 Agent

> 前后端分离的智能客服系统：Vue 3 + Vite + TypeScript 前端，Node.js + Express + Vercel AI SDK 后端。Agent 具备工具调用能力，支持多轮对话、流式 SSE 输出，和可插拔 LLM 模型（DeepSeek / 通义千问）。知识库采用 BM25 + Qdrant 向量并行召回 → RRF 融合 → gte-rerank 精排的混合检索架构。

---

## 快速开始

```bash
# 后端
cd backend
cp .env.example .env          # 填入 API Key
pnpm install
pnpm run dev                  # 启动 Qdrant：docker run -p 6333:6333 qdrant/qdrant
# → http://localhost:3001

# 前端（另一个终端）
cd frontend
cp .env.development .env      # Vite 代理自动转发 /api
pnpm install
pnpm run dev
# → http://localhost:5173
```

---

## 功能列表

| 能力 | 状态 | 说明 |
|------|------|------|
| 流式 SSE 对话 | ✅ | `GET /api/chat` 走 text/event-stream，逐 token 推 |
| 多模型热切换 | ✅ | 请求体 `model: 'deepseek' \| 'qwen'`，不改代码切 |
| Agent 工具调用 | ✅ | queryOrder / askReturnPolicy / transferToHuman 三个 tool() |
| 知识库混合检索 | ✅ | BM25 ∥ 向量 → RRF → rerank，完整降级链 |
| 热更新知识条目 | ✅ | `PUT /api/kb/:id` 即时向量化入库 |
| 结构化日志 | ✅ | debug 包，`DEBUG=app:* pnpm dev` 看日志 |
| CORS 白名单 | ✅ | `ALLOWED_ORIGINS` 环境变量配置 |
| Rate Limit | ✅ | /chat 30/min · /kb 10/min · /metrics 60/min |
| 健康检查 | ✅ | `/healthz`（liveness）+ `/readyz`（readiness，含 Qdrant 探测） |
| 进程内监控指标 | ✅ | `GET /api/metrics`：召回率代理 · 延迟分位 · 成本估算 |
| 离线向量索引 | ✅ | `pnpm run build:index` 提前算好条目向量，Qdrant 挂了自动兜底 |
| 检索离线评测 | ✅ | `pnpm run eval:retrieval` 跑 17 条标注 query 输出 recall / MRR / 延迟 / 成本 |
| —— 测试覆盖 | ✅ | vitest，5 个测试文件，57 个纯函数用例 |

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│ 前端视图层        ChatView · HomeView · AboutView · NotFound    │
├─────────────────────────────────────────────────────────────────┤
│ 前端状态 & API   Pinia chat store · SSE fetch · chat-format     │
├─────────────────────────────────────────────────────────────────┤
│ 前端构建配置      Vite · TS · ESLint                              │
├─────────────────────────────────────────────────────────────────┤
│ ═══════════ Vite dev proxy /api → :3001 ═══════════════════════  │
├─────────────────────────────────────────────────────────────────┤
│ HTTP 协议层       Express                                         │
│   ├─ 安全中间件    CORS 白名单 · Rate Limit 三档 · 1mb body limit   │
│   ├─ 健康检查      /healthz (liveness) · /readyz (readiness+Qdrant)│
│   └─ 业务路由      /api/chat (SSE) · /api/kb (CRUD) · /api/metrics │
├─────────────────────────────────────────────────────────────────┤
│ Agent 对话层      Vercel AI SDK streamText                       │
│   ├─ 3 个工具      queryOrder · askReturnPolicy · transferToHuman  │
│   ├─ prompt        CUSTOMER_SERVICE_PROMPT（客服 System Prompt）   │
│   └─ 热切换模型    DeepSeek / qwen-plus，前端请求体选                │
├─────────────────────────────────────────────────────────────────┤
│ 混合检索层        retrieval.ts 主编排                              │
│   ├─ 并行召回      BM25（稀疏）∥ 向量（embedding + Qdrant）       │
│   ├─ 融合          rrfFuse（按名次 k=60）                        │
│   ├─ 精排          rerankDocuments（DashScope gte-rerank-v2）      │
│   ├─ 阈值过滤      rerank: 0.1（实测校准）· fallback: BM25≥0.4 ∥ cos≥0.6 │
│   └─ 降级链        Qdrant ↓ → rerank ↓ → embedding ↓ → miss     │
├─────────────────────────────────────────────────────────────────┤
│ 数据存储层                                                        │
│   ├─ Qdrant collection `knowledge_entries`（权威）                 │
│   ├─ 进程内快照缓存（TTL 30s + 写后即时失效）                       │
│   ├─ 本地离线索引 JSON（data/vector-index.json，Gitignore）        │
│   ├─ 种子条目 KNOWLEDGE_ENTRIES（8 条，首次部署自动导入）           │
│   └─ Mock 订单（3 条，Agent 工具直接查表）                          │
└─────────────────────────────────────────────────────────────────┘
```

详细模块说明见 [AGENTS.md](./AGENTS.md)。

---

## 代码执行步骤全链路

### ① 前端：用户输入 → 组装请求

```
用户打字 / 按 Enter
  │
  ▼ frontend/src/views/ChatView.vue  send()
  │  stores/chat.ts.appendUser(text)              写一条 user 消息
  │  stores/chat.ts.createAssistantPlaceholder()  占位 assistant 消息
  │  api/chat.ts.streamChat(model, messages)       fetch('/api/chat', { body })
  │
  ▼ Vite 开发代理  /api → http://localhost:3001
  │
  ▼ backend/src/routes/chat.ts  POST /api/chat
```

### ② 后端入口：意图识别 + 知识库检索

```
POST /api/chat
  │
  ├─ classifyIntent(userText)          knowledge-base/intent.ts
  │    8 个意图 × 中文关键词，得分 = 命中数 / √(关键词总数)
  │
  └─ retrieve(userText, intent)         knowledge-base/retrieval.ts 主编排
       │
       ├── intent === 'unknown'  → 直接 miss
       │
       ├── 并行召回（两条通道互不阻塞）
       │   │
       │   ├── 通道 A [同步]  BM25 稀疏召回         bm25.ts rankByBm25()
       │   │     中文 bigram 切分、ASCII 整词
       │   │     权重：keywords×3  title×2  content×1
       │   │
       │   └── 通道 B [异步]  向量召回
       │         embedTexts([query])               DashScope text-embedding-v3
       │         searchEntries(queryVector, filter)  Qdrant Cosine + payload filter
       │         [降级] Qdrant 不可用 → 本地离线索引 + cosine 暴力比对
       │
       ├── 融合 rrfFuse([bm25List, vectorList], k=60)  fusion.ts
       │     按名次加权，不用原始分（BM25 0.48~2.28 与余弦 0~1 刻度不一致）
       │
       ├── 精排 rerankDocuments(query, fusedTop5)      rerank.ts DashScope gte-rerank-v2
       │     [降级] 失败 → fallbackRank() 用原始证据判定
       │
       └── 阈值过滤
             rerank 可用    → score ≥ KB_RERANK_THRESHOLD (0.1，实测校准)
             rerank 不可用  → cosine ≥ 0.6 或 BM25 ≥ 0.4
```

### ③ 两条分支：命中短路 vs 未命中 Agent

```
retrieve() 返回 { hit, stage, score, entries, scores }
  │
  ├── hit = true  ── 分支 A：RAG 短路返回（0 次 LLM 调用）
  │   ├─ sse('rag-hit',   { intent, stage, score, sources })
  │   ├─ sse('text-delta',{ text: entries.content.join('\n\n') })  直接推条目全文
  │   ├─ sse('finish',    { finishReason: 'stop' })
  │   ├─ sse('done',      {})
  │   └─ res.end()          不校验 API Key、不启动心跳
  │
  └── hit = false ── 分支 B：Agent + LLM 对话
      ├─ 校验所选模型 API Key
      ├─ setInterval(': ping\n\n', 15000)   15s 心跳防代理超时
      └─ runAgent(req)                      agent/service.ts
           ├─ toSdkMessages(messages)       纯函数格式转换
           ├─ modelFactory(modelName)       provider 抽象层热切换
           └─ streamText({ model, system: CUSTOMER_SERVICE_PROMPT, tools, messages, maxSteps: 5 })
                ├─ 逐 token text-delta     → sse('text-delta', ...)
                ├─ LLM 调工具 tool-call    → sse('tool-call', ...)
                │   ├─ queryOrder()         → mock/orders.ts
                │   ├─ askReturnPolicy()    → agent/knowledge.ts
                │   └─ transferToHuman()    → 生成工单号 TK+时间戳
                ├─ 工具执行 tool-result     → sse('tool-result', ...)
                ├─ 结果回填 messages → 再次请求 LLM（下一轮 step）
                └─ 最终 finish + done       → sse('done', {})
```

### ④ 后端启动时的基础设施（只跑一次）

```
backend/src/index.ts  initRepository()  先于 app.listen() 执行
  │
  ├── qdrantEnabled()               KB_VECTOR_STORE !== 'local'
  ├── YES → 连 Qdrant
  │   ├─ ensureCollection()         建 collection + intent / model_version 索引
  │   ├─ countPoints() === 0       首次启动自动导入 8 条种子 KNOWLEDGE_ENTRIES
  │   ├─ scrollEntries()           拉快照 → 内存缓存
  │   └─ source = 'qdrant'
  └── NO → 降级本地模式
      └─ source = 'local'          KNOWLEDGE_ENTRIES + data/vector-index.json
```

### ⑤ 前端接收 SSE 并渲染

```
api/chat.ts  fetch → ReadableStream → TextDecoder
  │  按双换行 '\n\n' 切事件块 → 解析 event + data → 分发 switch
  │
  ├─ text-delta   → chat.appendDelta(assistantId, text)      逐 token 拼到消息
  ├─ tool-call    → chat.pushToolTrace({ tool, args })
  ├─ tool-result  → chat.pushToolTrace({ tool, result })
  ├─ rag-hit      → onRagHit(payload) → chat.applyRagHit()   source='kb' + sources
  ├─ error        → chat.finishStreaming(id, message)
  └─ done         → chat.finishStreaming(id)                  streaming=false
  │
  ▼ ChatView.vue 渲染
     msg.source === 'kb'  → 绿色「知识库直出」徽标 + 来源标题
     msg.toolTraces 存在  → 🔧 调用 / 📦 返回 卡片
     streaming=true       → 末尾闪烁光标 ▊
```

### 完整降级链（检索层内部）

```
Qdrant 向量检索失败? ──YES──▶ 本地离线索引 cosine 暴力比对
        │ NO
        ▼
   rerank 失败? ──YES──▶ fallbackRank() 用原始证据（cosine ≥ 0.6 或 BM25 ≥ 0.4）
        │ NO
        ▼
   embedding 失败? ──YES──▶ 仅 BM25 单路召回
        │ NO
        ▼
   全部可用 ──▶ BM25 ∥ 向量 → RRF → rerank → 阈值 → 命中/未命中
```

---

## API 契约（SSE）

### `POST /api/chat`

请求体：
```json
{ "model": "deepseek|qwen", "messages": [{ "role": "user|assistant", "content": "..." }] }
```

响应事件（SSE）：

| event | data | 触发条件 |
|-------|------|---------|
| `rag-hit` | `{ intent, stage, score, sources }` | 知识库命中短路返回 |
| `text-delta` | `{ text: "..." }` | 流式推送内容片段 |
| `tool-call` | `{ tool, args }` | LLM 决定调工具 |
| `tool-result` | `{ tool, result }` | 工具执行完成 |
| `finish` | `{ finishReason: "stop" }` | 流结束 |
| `done` | `{}` | 流结束标记（前端循环终止信号） |
| `error` | `{ message: "..." }` | 后端异常 |

### `GET /api/kb`

列出所有知识条目 + `source`（qdrant/local）+ `modelVersion`。

### `PUT /api/kb/:id`

热更新单条条目，即时向量化入库并失效快照缓存。`KB_ADMIN_TOKEN` 配置后要求 Bearer 鉴权。

### `DELETE /api/kb/:id`

删除单条知识条目。

### `GET /api/metrics`

检索引擎监控指标快照：召回率代理、分阶段延迟分位（bm25 / vector / rerank / total）、成本估算、当前配置。

### `GET /healthz`（Liveness）

```json
{ "status": "ok", "uptime": 123456 }
```

进程活着就行。Docker healthcheck 和 K8s `livenessProbe` 用这个。

### `GET /readyz`（Readiness）

```json
{ "status": "ready", "qdrant": "connected", "degraded": false }
```

额外检查 Qdrant 可达性。Qdrant 挂了降级时返回 `503 { status: "degraded" }`。K8s `readinessProbe` 用这个。

---

## 环境变量

全部变量见 `backend/.env.example`，按三组：

### ① 模型 & API Key

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEEPSEEK_API_KEY` | — | DeepSeek API Key（chat 模型） |
| `DASHSCOPE_API_KEY` | — | DashScope API Key（embedding / rerank） |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 默认 chat 模型 |
| `DASHSCOPE_MODEL` | `qwen-plus` | qwen 模型名 |
| `EMBEDDING_MODEL` | `text-embedding-v3` | 向量化模型 |
| `RERANK_MODEL` | `gte-rerank-v2` | 精排模型 |

### ② 知识库存储 & 混合检索

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `KB_VECTOR_STORE` | `qdrant` | `qdrant`（默认）/ `local`（无外部依赖） |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant 连接地址 |
| `QDRANT_API_KEY` | — | Qdrant API Key（云端部署） |
| `QDRANT_COLLECTION` | `knowledge_entries` | Collection 名 |
| `EMBEDDING_DIM` | `1024` | 向量维度（text-embedding-v3 是 1024） |
| `VECTOR_INDEX_PATH` | `data/vector-index.json` | 离线向量索引路径 |
| `KB_CACHE_TTL_MS` | `30000` | 条目快照缓存 TTL（毫秒），热更新即时失效 |
| `KB_BM25_TOP_K` | `10` | BM25 召回 top K |
| `KB_VECTOR_TOP_K` | `10` | 向量召回 top K |
| `KB_RERANK_TOP_N` | `5` | rerank 候选数 |
| `KB_FINAL_TOP_K` | `3` | 最终返回 K |
| `KB_RRF_K` | `60` | RRF 平滑参数（越大名次差异越平） |
| `KB_BM25_THRESHOLD` | `0.4` | rerank 不可用时的 BM25 原始分阈值 |
| `KB_RERANK_ENABLED` | `true` | 是否启用 rerank |
| `KB_RERANK_THRESHOLD` | `0.1` | rerank 分阈值（gte-rerank-v2 相关结果 0.12~0.9，过高会把相关结果一起过滤） |
| `KB_EMBEDDING_THRESHOLD` | `0.6` | rerank 不可用时的余弦阈值 |
| `KB_COST_EMBED_CNY_PER_1K` | `0.0007` | embedding 成本估算单价（元 / 千 token） |
| `KB_COST_RERANK_CNY_PER_1K` | `0.0008` | rerank 成本估算单价 |
| `KB_ADMIN_TOKEN` | — | /api/kb 管理接口 Bearer Token，留空不校验 |

### ③ 安全 & 服务

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ALLOWED_ORIGINS` | 4 个 localhost | CORS 允许来源（逗号分隔），部署到 Vercel/Netlify 后加上线上域名 |
| `PORT` | `3001` | 后端端口 |

---

## 技术栈

**后端**：Node.js 20+ · Express 4 · Vercel AI SDK 4 · zod · Qdrant (vector store) · DashScope (embedding + rerank) · vitest · debug

**前端**：Vue 3 · Vite 6 · Pinia · Vue Router · TypeScript

---

## 演示对话

| 用户输入 | 后端判断 | 回复 |
|---------|---------|------|
| `转人工客服` | 命中知识库（stage=hybrid，score=0.92） | 直接返回人工客服条目（不调 LLM） |
| `收到商品破损了` | 命中知识库（stage=hybrid，score=0.15） | 直接返回退换货条目 |
| `查一下我的订单 SO20241125001` | 未命中知识库 → Agent 接管 | 调 queryOrder 工具返回 mock 订单详情 |
| `物流到哪了？` | 未命中 → Agent 问清楚单号再调工具 | |

---

## 测试 & 运维脚本

```bash
cd backend
pnpm test                     # 跑 vitest 57 个纯函数用例
pnpm run dev                  # 启动后端（tsx watch 热重载）
pnpm run build:index          # 构建离线向量索引（数据目录 data/vector-index.json）
pnpm run kb:sync              # 全量同步种子到 Qdrant（--recreate 重建 collection）
pnpm run eval:retrieval       # 17 条标注 query 跑 bm25 / vector / hybrid / full 四组对比
                              #   输出 recall@1 / recall@3 / MRR / 平均&p95 延迟 / 估算成本
DEBUG=app:* pnpm run dev      # 打开全部 debug 模块日志
DEBUG=app:kb pnpm run dev     # 只看知识库模块日志
```

---

## 目录结构

```
Project-init/
├── AGENTS.md                   # 代码地图：每个文件职责 + 架构图 + 环境变量表 + 启动命令
├── README.md                   # ← 你现在在读的文件
├── docs/
│   └── REQUIREMENTS.md         # 需求基线（功能列表 / 接口规范 / 环境变量默认值）
└── backend/
    ├── .env.example            # 所有环境变量（三组分）
    ├── .env                    # 你的本地配置（不在 Git）
    ├── vitest.config.ts        # vitest 配置（Node environment，include src/**/__tests__/*.test.ts）
    ├── src/
    │   ├── index.ts            # Express 入口：CORS → Rate Limit → 业务路由 → initRepository → listen
    │   ├── utils/
    │   │   └── logger.ts       # 结构化日志（debug 包 6 模块 + warn/error 兜底）
    │   ├── routes/
    │   │   ├── chat.ts         # POST /api/chat SSE（两条路径：RAG 短路 / Agent + LLM）
    │   │   ├── kb.ts           # GET/PUT/DELETE /api/kb/:id（热更新 + Bearer 鉴权）
    │   │   └── metrics.ts      # GET /api/metrics（进程内快照）
    │   ├── agent/
    │   │   ├── service.ts      # streamText 封装 + maxSteps:5 + 模型热切换
    │   │   ├── tools.ts        # queryOrder / askReturnPolicy / transferToHuman 三个 tool()
    │   │   ├── convert.ts      # 消息格式转换（纯函数）
    │   │   ├── prompt.ts       # 客服 System Prompt
    │   │   ├── knowledge.ts    # 退换货政策查表
    │   │   └── index.ts        # barrel 统一导出
    │   ├── knowledge-base/
    │   │   ├── retrieval.ts    # 混合检索主编排（BM25 ∥ 向量 → RRF → rerank → 阈值）
    │   │   ├── bm25.ts         # BM25 稀疏召回（中文 bigram / ASCII 整词，keywords×3 title×2 content×1）
    │   │   ├── fusion.ts       # RRF 融合（按名次 k=60，不用原始分）
    │   │   ├── similarity.ts    # 余弦相似度（维度不一致 / 零向量兜底）
    │   │   ├── intent.ts       # 8 意图分类（关键词命中数 / √关键词总数，封顶 1）
    │   │   ├── embeddings.ts   # DashScope text-embedding-v3 向量化（3 秒超时 + 三级缓存）
    │   │   ├── rerank.ts       # DashScope gte-rerank-v2 精排（3 秒超时，失败返回 null 降级）
    │   │   ├── qdrant.ts       # Qdrant 客户端封装（collection 生命周期 + timeout ms 坑）
    │   │   ├── qdrant-payload.ts # payload schema + sha256 派生确定性 UUID
    │   │   ├── repository.ts   # 权威数据源 + 快照缓存（TTL 30s + 写后失效）+ 降级决策
    │   │   ├── vector-index.ts # 离线向量索引结构 + contentHash 指纹（纯逻辑无 IO）
    │   │   ├── vector-store.ts  # 离线索引 JSON 读写（单次加载 Promise 缓存）
    │   │   ├── metrics.ts      # 进程内指标（召回率代理 / 延迟分位 / 成本估算）
    │   │   ├── data.ts         # 8 条 KNOWLEDGE_ENTRIES 种子
    │   │   ├── types.ts        # 知识库对外类型（Intent / KnowledgeEntry / RetrievalResult）
    │   │   ├── index.ts        # barrel 统一导出
    │   │   └── __tests__/      # vitest 纯函数测试
    │   │       ├── bm25.test.ts
    │   │       ├── fusion.test.ts
    │   │       ├── similarity.test.ts
    │   │       ├── intent.test.ts
    │   │       └── vector-index.test.ts
    │   ├── mock/
    │   │   └── orders.ts       # 3 条 mock 订单（Agent 工具 queryOrder 查表）
    │   └── types/
    │       └── index.ts        # 前后端共享 DTO（ChatRequest / ChatMessage / Order）
    └── scripts/
        ├── build-vector-index.ts   # 批量 embed 种子条目 → data/vector-index.json
        ├── sync-knowledge.ts        # 全量同步种子到 Qdrant
        └── eval-retrieval.ts       # 17 条标注 query 跑四组对比输出 recall / MRR / 延迟 / 成本
└── frontend/
    ├── vite.config.ts            # Vite + /api 代理 → localhost:3001
    └── src/
        ├── main.ts               # Vue 入口（createApp + Pinia + router）
        ├── App.vue               # 根组件（RouterView）
        ├── router/index.ts       # 路由（hash 模式适合静态部署）
        ├── views/
        │   ├── ChatView.vue      # 聊天主页面（流式渲染 + 工具痕迹 + KB 直出徽标）
        │   ├── HomeView.vue      # 首页
        │   ├── AboutView.vue     # 关于页
        │   └── NotFound.vue      # 404
        ├── stores/
        │   └── chat.ts           # Pinia 单一数据源（messages[] / loading / model）
        ├── api/
        │   ├── chat.ts           # SSE fetch 消费层（ReadableStream + TextDecoder + 双换行切事件）
        │   └── index.ts          # axios 通用请求（注意：chat.ts 用 fetch 不用 axios）
        ├── utils/
        │   └── chat-format.ts    # 纯格式化（🔧 调用 / 📦 返回 卡片）
        └── styles/base.css       # 全局样式
```

---

## 已知限制

1. **多实例 metrics 无法聚合**：进程内 `/api/metrics` 重启清零，多实例部署各实例独立暴露，外部 Prometheus scrape + Grafana 聚合。
2. **向量检索 embedding query 级缓存**：相同 query 每次实时向量化（三级缓存只缓存条目向量），高频重复 query 可加 Redis 短 TTL。
3. **知识库增量导入管线**：当前仅热更新单条 / 全量种子同步，批量导入（Markdown → 切片 → embedding → upsert）尚未实现。
4. **ACL**：Qdrant payload 无 tenant / visibility，多业务线共用可能串数据。
5. **SSE 断线重连**：前端无自动重连机制（网络抖动需要重新发消息）。

---

## 扩展指南

### 加新意图

1. `knowledge-base/intent.ts` 的 `INTENT_KEYWORDS` 数组加新条目（关键词数量影响得分公式 √(kwCount)）
2. `knowledge-base/types.ts` 的 `Intent` 联合类型加新字面量
3. 往 Qdrant 加对应 `intent` 值的知识条目（或改 seeds）

### 加新 Agent 工具

1. `agent/tools.ts` 加 `const myTool = tool({ description, parameters: z.object({...}), execute })`
2. `agent/index.ts` 的 `tools` 对象里注册
3. 在客服 System Prompt 里提一下什么时候该用这个工具

### 切 embedding / rerank 模型

改环境变量 `EMBEDDING_MODEL` / `RERANK_MODEL` + `EMBEDDING_DIM`（维度不同要 `pnpm run kb:sync --recreate` 重建 collection，否则会因维度校验失败回退）。

### 本地完全离线跑（无 Qdrant）

```bash
# 后端 .env
KB_VECTOR_STORE=local
EMBEDDING_ENABLED=false  # 纯 BM25 召回
# 这样就不需要任何外部服务，依赖仅 pnpm install
```

---

## 启动后端基础设施

```bash
# Qdrant（Docker）
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
# 首次自动建 collection，8 条种子条目自动导入

# 后端（另一个终端）
cd backend && pnpm run dev
# 如果 Qdrant 连不上会自动降级本地模式，日志会有 warn
```

---

## 关键技术决策（快速索引）

| 决策 | 选了什么 | 为什么 |
|------|---------|--------|
| Agent 框架 | Vercel AI SDK 4.x streamText | 直接对接 deepseek/qwen，少一层封装 |
| SSE 实现 | Express res.write + 双换行协议 | 不要第三方包，自己实现更透明 |
| 前端 SSE 消费 | fetch + ReadableStream（不是 axios） | axios 不支持流式 ReadableStream |
| 检索架构 | BM25 ∥ Qdrant 并行召回 → RRF → gte-rerank | 稠密 + 稀疏互补，RRF 融合避免刻度差异 |
| RRF k 值 | 60（业界常用值） | 越大名次差异越平，避免单路分数异常主导 |
| rerank 阈值 | 0.1（非默认 0.4） | gte-rerank-v2 相关结果分只有 0.12~0.9，0.4 会把相关结果一起过滤 |
| Qdrant 降级链 | Qdrant ↓ → 本地离线索引 ↓ → BM25 ↓ → miss | 四级兜底保证知识库不阻塞主链路 |
| 向量持久化 | Qdrant（权威）+ 本地离线索引（兜底） | 双保险：Qdrant 挂了还有种子向量 |
| payload 过滤 | model_version + intent 精确匹配 | 防止不同 embedding 模型的向量混用 |
| point id | sha256(entryId) 派生确定性 UUID | 业务 id 与 point id 一一对应，可直接 upsert / delete |
| 安全 | CORS 白名单 + Rate Limit 三档 + healthz/readyz | 最小够用的生产安全网 |
| 日志 | debug 包（4KB） | 体量小，生产接 Pino 可无痛切换 API 近似 |
| 测试 | vitest（纯函数 57 用例） | 零外部依赖，10ms 内跑完 |

详细技术决策（包括踩过的坑）见 [AGENTS.md](./AGENTS.md) 的「关键技术决策」章节。
