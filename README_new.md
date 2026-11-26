# 阳光商城 · 智能客服 Agent

前后端分离的智能客服系统：Vue 3 + Vite + TypeScript 前端，Node.js + Express + Vercel AI SDK 后端。
Agent 具备工具调用能力，支持多轮对话与 SSE 流式输出，可在 DeepSeek 和通义千问之间按请求热切换。

> 功能需求基线见 [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md)

## 功能

- **流式对话**：后端逐 token 推送 SSE，前端边收边渲染
- **工具调用**：LLM 自主决定调用工具，前端实时展示调用痕迹
- **模型热切换**：每次请求可选 DeepSeek（默认）或通义千问
- **知识库直出**：常见问题由知识库直接回答，不消耗模型调用
- **会话管理**：Pinia 维护消息历史，支持一键清空

## 架构

```
浏览器 (frontend :5173)
   │  POST /api/chat  { model, messages }
   ▼  (Vite 开发代理 /api → :3001)
Express (backend :3001)
   │  ai.streamText({ model, system, tools, maxSteps: 5 })
   ▼
LLM (DeepSeek / 通义千问)
   │  返回 tool_calls
   ▼
tools.ts 执行工具 → 结果回填 messages → 再次请求 LLM
   │
   ▼  最终文本 / 工具事件
SSE 推回前端：rag-hit / text-delta / tool-call / tool-result / finish / done
```

详细模块说明见 [AGENTS.md](./AGENTS.md)。

## 代码执行步骤全链路

> 从用户输入问题开始，到最终答案显示，完整走过哪些代码、逻辑如何分流。每步都附上对应的源码文件与函数名，点击即可跳转。

### ① 前端：用户输入 → 组装请求

```
用户打字 / 按 Enter
  │
  ▼ [frontend/src/views/ChatView.vue](file:///Users/lizhiliang/Desktop/Test/Project-init/frontend/src/views/ChatView.vue)  send()
  │  stores/chat.ts → appendUser(text)              写一条 user 消息
  │  stores/chat.ts → createAssistantPlaceholder()  占位 assistant 消息
  │  api/chat.ts    → streamChat(model, messages)    fetch('/api/chat', { body })
  │
  ▼ Vite 开发代理  /api → http://localhost:3001
  │
  ▼ [backend/src/routes/chat.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/routes/chat.ts)  POST /api/chat
```

### ② 后端入口：意图识别 + 知识库检索

```
POST /api/chat
  │
  ├─ classifyIntent(userText)                     ← [knowledge-base/intent.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/knowledge-base/intent.ts)
  │    8 个意图 × 中文关键词，得分 = 命中数 / √(关键词总数)
  │
  └─ retrieve(userText, intent)                   ← [knowledge-base/retrieval.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/knowledge-base/retrieval.ts)
       │
       ├── intent === 'unknown'  → 直接 miss（无知识库匹配）
       │
       ├── 并行召回（两条通道互不阻塞）
       │   │
       │   ├── 通道 A [同步]  BM25 稀疏召回            ← bm25.ts  rankByBm25()
       │   │     中文 bigram 切分、ASCII 整词
       │   │     权重：keywords×3  title×2  content×1
       │   │
       │   └── 通道 B [异步]  向量召回                  ← embeddings.ts + qdrant.ts
       │         embedTexts([query])                  DashScope text-embedding-v3
       │         searchEntries(queryVector, filter)    Qdrant Cosine 检索
       │         [降级] Qdrant 不可用 → 本地离线索引 + cosine 暴力比对
       │
       ├── 融合 rrfFuse([bm25List, vectorList], k=60) ← fusion.ts 按名次加权（不用原始分，因 BM25 原始分 0.48~2.28 与余弦 0~1 刻度不一致）
       │
       ├── 精排 rerankDocuments(query, fusedTop5)      ← rerank.ts  DashScope gte-rerank-v2
       │     [降级] 失败 → fallbackRank() 用原始证据判定（cosine ≥ 0.6 或 BM25 ≥ 0.4）
       │
       └── 阈值过滤
             rerank 可用    → score ≥ KB_RERANK_THRESHOLD (0.1，实测校准)
             rerank 不可用  → cosine ≥ KB_EMBEDDING_THRESHOLD (0.6)
                              或 BM25 ≥ KB_BM25_THRESHOLD (0.4)
```

### ③ 两条分支：命中短路 vs 未命中 Agent

```
retrieve() 返回 { hit, stage, score, entries, scores }
  │
  ├── hit = true  ── 分支 A：RAG 短路返回（0 次 LLM 调用）
  │   │
  │   ├─ sse('rag-hit',   { intent, stage, score, sources })
  │   ├─ sse('text-delta',{ text: entries.content.join('\n\n') })  ← 直接推条目全文
  │   ├─ sse('finish',    { finishReason: 'stop' })
  │   ├─ sse('done',      {})
  │   └─ res.end()   （不校验 API Key、不启动心跳）
  │
  └── hit = false ── 分支 B：Agent + LLM 对话
      │
      ├─ 校验所选模型 API Key（DEEPSEEK_API_KEY / DASHSCOPE_API_KEY）
      ├─ setInterval(': ping\n\n', 15000)   ← 15s 心跳防代理超时
      │
      └─ runAgent(req)                      ← [agent/service.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/agent/service.ts)
           │
           ├─ toSdkMessages(messages)       ← agent/convert.ts   纯函数转换
           ├─ modelFactory(modelName)       ← provider 抽象层热切换
           │   req.model === 'qwen'  →  qwen('qwen-plus')
           │   default                →  deepseek('deepseek-flash')
           │
           └─ streamText({                  ← Vercel AI SDK 4.x
                system: CUSTOMER_SERVICE_PROMPT,   ← agent/prompt.ts
                tools, messages, maxSteps: 5
              })
              │
              ├── 逐 token 输出 text-delta   → sse('text-delta', ...)
              ├── LLM 调工具 tool-call       → sse('tool-call', ...)
              │   ├── queryOrder()           ← agent/tools.ts → mock/orders.ts
              │   ├── askReturnPolicy()      ← agent/tools.ts → agent/knowledge.ts
              │   └── transferToHuman()      ← 生成工单号 TK+时间戳
              ├── 工具执行完 tool-result       → sse('tool-result', ...)
              ├── 结果回填 messages → 再次请求 LLM（下一轮 step）
              └── 最终 finish + done          → sse('done', {})
```

### ④ 后端启动时的基础设施（只跑一次）

```
backend/src/index.ts  initRepository()  先于 app.listen() 执行
  │
  ├─ qdrantEnabled()               KB_VECTOR_STORE !== 'local'？
  │
  ├── YES → 连 Qdrant
  │   ├─ ensureCollection()        建 collection + intent / model_version 索引
  │   ├─ countPoints() === 0 ？   首次启动自动导入 8 条种子 KNOWLEDGE_ENTRIES
  │   ├─ scrollEntries()           拉快照 → 内存缓存
  │   └─ source = 'qdrant'
  │
  └── NO → 降级本地模式
      └─ source = 'local'          KNOWLEDGE_ENTRIES + data/vector-index.json
```

### ⑤ 前端接收 SSE 并渲染

```
[api/chat.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/frontend/src/api/chat.ts)  fetch → ReadableStream → TextDecoder
  │  按双换行 '\n\n' 切事件块 → 解析 event + data → 分发 switch
  │
  ├─ text-delta   → chat.appendDelta(assistantId, text)      逐 token 拼到消息
  ├─ tool-call    → chat.pushToolTrace({ tool, args })
  ├─ tool-result  → chat.pushToolTrace({ tool, result })
  ├─ rag-hit      → onRagHit(payload) → chat.applyRagHit()   source='kb' + sources
  ├─ error        → chat.finishStreaming(id, message)
  └─ done         → chat.finishStreaming(id)                  streaming=false
  │
  ▼ [ChatView.vue](file:///Users/lizhiliang/Desktop/Test/Project-init/frontend/src/views/ChatView.vue) 渲染
     msg.source === 'kb'  → 显示绿色「知识库直出」徽标 + 来源标题
     msg.toolTraces 存在  → 显示 🔧 调用 / 📦 返回 卡片
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

### 10 层架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│ 前端视图层        ChatView · HomeView · AboutView · NotFound    │
├─────────────────────────────────────────────────────────────────┤
│ 前端状态 & API     Pinia chat store · SSE fetch · chat-format   │
├─────────────────────────────────────────────────────────────────┤
│ 前端构建配置      Vite · TS · ESLint                            │
├─────────────────────────────────────────────────────────────────┤
│       ═══════════ Vite dev proxy /api → :3001 ═══════════        │
├─────────────────────────────────────────────────────────────────┤
│ HTTP 协议层       Express routes/ (chat SSE · kb · metrics)     │
├─────────────────────────────────────────────────────────────────┤
│ Agent 对话层      service.ts streamText · tools × 3 · prompt    │
├─────────────────────────────────────────────────────────────────┤
│ 混合检索层        retrieval (主编排)                              │
│                   ├─ bm25.ts （纯函数，稀疏召回）                 │
│                   ├─ fusion.ts （RRF 融合）                      │
│                   ├─ similarity.ts （余弦相似度）                 │
│                   ├─ intent.ts （意图识别）                       │
│                   ├─ rerank.ts （副作用，DashScope gte-rerank）  │
│                   ├─ embeddings.ts （副作用，text-embedding-v3） │
│                   └─ metrics.ts （副作用，进程内指标）            │
├─────────────────────────────────────────────────────────────────┤
│ 数据存储层        Qdrant collection + repository.ts 快照缓存     │
│                   ├─ qdrant.ts （客户端封装）                     │
│                   ├─ qdrant-payload.ts （payload 编解码）         │
│                   ├─ data.ts （8 条种子 KNOWLEDGE_ENTRIES）       │
│                   ├─ vector-index.ts （离线索引结构）             │
│                   ├─ vector-store.ts （离线索引文件读写）         │
│                   └─ mock/orders.ts （3 条 mock 订单）            │
├─────────────────────────────────────────────────────────────────┤
│ 后端配置          .env.example · package.json · tsconfig         │
├─────────────────────────────────────────────────────────────────┤
│ 运维脚本          build-vector-index · sync-knowledge · eval     │
├─────────────────────────────────────────────────────────────────┤
│ 项目文档          README.md · AGENTS.md · docs/REQUIREMENTS.md  │
└─────────────────────────────────────────────────────────────────┘
```

### 代码锚点速查（按调用顺序）

| 步骤 | 文件 | 关键函数 | 作用 |
|------|------|---------|------|
| 前端入口 | [ChatView.vue](file:///Users/lizhiliang/Desktop/Test/Project-init/frontend/src/views/ChatView.vue) | `send()` | 组装请求 |
| 前端 SSE | [api/chat.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/frontend/src/api/chat.ts) | `streamChat()` | fetch + ReadableStream 解析 |
| 后端入口 | [routes/chat.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/routes/chat.ts) | `router.post()` | 请求分发 + SSE 协议 |
| 意图识别 | [intent.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/knowledge-base/intent.ts) | `classifyIntent()` | 8 个意图关键词匹配 |
| **主编排** | **[retrieval.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/knowledge-base/retrieval.ts)** | **`retrieve()`** | **BM25 ∥ 向量 → RRF → rerank → 阈值** |
| BM25 | [bm25.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/knowledge-base/bm25.ts) | `rankByBm25()` | 稀疏召回，中文 bigram |
| 向量 | [embeddings.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/knowledge-base/embeddings.ts) | `embedTexts()` | DashScope 向量化 |
| Qdrant | [qdrant.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/knowledge-base/qdrant.ts) | `searchEntries()` | 向量检索 + payload filter |
| 融合 | [fusion.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/knowledge-base/fusion.ts) | `rrfFuse()` | 倒数排名融合，k=60 |
| Rerank | [rerank.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/knowledge-base/rerank.ts) | `rerankDocuments()` | gte-rerank-v2 精排 |
| Agent | [service.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/agent/service.ts) | `runAgent()` | streamText + maxSteps:5 |
| 工具 | [tools.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/agent/tools.ts) | `tools` 对象 | 3 个 tool() + zod schema |
| 数据源 | [repository.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/knowledge-base/repository.ts) | `initRepository()` | Qdrant / 本地降级决策 |
| 指标 | [metrics.ts](file:///Users/lizhiliang/Desktop/Test/Project-init/backend/src/knowledge-base/metrics.ts) | `metricsSnapshot()` | 延迟分位 + 成本估算 |

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3.5 · Vite 6 · TypeScript 5.7 · Pinia 2.3 · Vue Router 4.5 |
| 后端 | Node.js · Express 4 · Vercel AI SDK 4 · Zod 3 · tsx |
| 模型 | DeepSeek（`@ai-sdk/deepseek`）、通义千问（DashScope OpenAI 兼容端点） |

## 快速开始

前置：Node.js（本地开发环境为 v24；项目使用 ESM）。

### 1. 启动后端

```bash
cd backend
cp .env.example .env      # 填入真实 API Key
npm install               # 或 pnpm install
npm run dev               # http://localhost:3001
```

### 2. 启动前端

```bash
cd frontend
npm install               # 或 pnpm install
npm run dev               # http://localhost:5173/chat
```

打开 <http://localhost:5173/chat> 即可对话。

## 环境变量

### backend/.env

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API Key（使用默认模型时必填） |
| `DASHSCOPE_API_KEY` | 阿里云 DashScope Key（通义千问 / embedding / rerank 都走它） |
| `DEEPSEEK_MODEL` | DeepSeek 模型名，默认 `deepseek-flash` |
| `DASHSCOPE_MODEL` | 通义千问模型名，默认 `qwen-plus` |
| `PORT` | 后端端口，默认 `3001` |
| **知识库存储** | |
| `KB_VECTOR_STORE` | `qdrant`（默认）或 `local`（无 Qdrant 依赖，走本地种子 + 离线索引） |
| `QDRANT_URL` | Qdrant 地址，默认 `http://localhost:6333` |
| `QDRANT_API_KEY` | Qdrant API Key（可选，本地开发留空） |
| `QDRANT_COLLECTION` | collection 名，默认 `knowledge_entries` |
| `EMBEDDING_DIM` | 向量维度，需与模型一致，默认 `1024` |
| `KB_CACHE_TTL_MS` | 条目快照缓存 TTL，默认 `30000`；热更新即时失效，多实例靠 TTL 收敛 |
| `VECTOR_INDEX_PATH` | 离线向量索引文件路径，默认 `data/vector-index.json` |
| **混合检索阈值与并发** | |
| `EMBEDDING_MODEL` | DashScope 向量模型名，默认 `text-embedding-v3` |
| `KB_EMBEDDING_ENABLED` | 禁用后仅 BM25 单路召回，默认 `true` |
| `KB_BM25_TOP_K` | BM25 候选数，默认 `10` |
| `KB_VECTOR_TOP_K` | 向量候选数，默认 `10` |
| `KB_RRF_K` | RRF 融合常数，默认 `60`（越大名次差异越平） |
| `KB_RERANK_ENABLED` | 是否启用 gte-rerank 精排，默认 `true` |
| `RERANK_MODEL` | rerank 模型名，默认 `gte-rerank-v2` |
| `KB_RERANK_TOP_N` | rerank 前从 RRF 取的候选数，默认 `5` |
| `KB_FINAL_TOP_K` | rerank 后最终返回的命中数，默认 `3` |
| `KB_RERANK_THRESHOLD` | rerank 分阈值，默认 `0.1`（gte-rerank-v2 相关结果普遍 0.12~0.9，阈值不能设太高） |
| `KB_EMBEDDING_THRESHOLD` | 向量余弦阈值（rerank 不可用时生效），默认 `0.6` |
| `KB_BM25_THRESHOLD` | BM25 原始分阈值（rerank 不可用时生效），默认 `0.4` |
| **成本估算 / 管理接口** | |
| `KB_COST_EMBED_CNY_PER_1K` | embedding 估算单价元/千 token，默认 `0.0007` |
| `KB_COST_RERANK_CNY_PER_1K` | rerank 估算单价元/千 token，默认 `0.0008` |
| `KB_ADMIN_TOKEN` | `/api/kb` Bearer Token；留空表示不校验（仅内网使用） |

### frontend/.env*

| 变量 | 说明 |
|---|---|
| `VITE_PORT` | 开发服务器端口，默认 `5173` |
| `VITE_API_BASE_URL` | 开发代理目标（`.env.development` 为 `http://localhost:3001`） |

API Key 只保存在 `backend/.env`，前端不接触任何密钥。

## API 契约

```
POST /api/chat
Content-Type: application/json

{ "model": "deepseek" | "qwen",
  "messages": [{ "role": "user", "content": "查一下订单 SO20241125001" }] }

Response: text/event-stream
```

| 事件 | data 示例 |
|---|---|
| `rag-hit` | `{"intent":"delivery","stage":"hybrid","score":0.92,"sources":[{"id":"KB-DELIVERY-01","title":"配送时效"}]}` — `stage` 取值 `bm25` / `vector` / `hybrid` / `none`，表示命中来自哪一路召回 |
| `text-delta` | `{"text":"您的订单"}` |
| `tool-call` | `{"tool":"queryOrder","args":{"orderId":"SO20241125001"}}` |
| `tool-result` | `{"tool":"queryOrder","result":"订单 SO20241125001 详情：..."}` |
| `finish` | `{"finishReason":"stop"}` |
| `done` | `{}` |
| `error` | `{"message":"后端未配置 DEEPSEEK_API_KEY"}` |

另有 15 秒一次的 `: ping` 心跳注释行，用于保持长连接。

## 演示对话

| 输入 | 触发工具 |
|---|---|
| `查一下订单 SO20241125001` | `queryOrder` |
| `这件数码产品能退吗？` | `askReturnPolicy` |
| `我要找人工客服` | `transferToHuman` |

可用的 mock 订单：`SO20241125001`（已发货）、`SO20241124003`（已签收）、`SO20241122017`（待付款）。

## 目录结构

```
Project-init/
├── AGENTS.md          # 架构与模块说明（AI / 新人入口）
├── frontend/          # Vue 前端，独立 package.json
└── backend/           # Agent 后端，独立 package.json
```

两个子项目各自维护 `package.json` 与 `node_modules`，互不依赖。

## 已知限制

- 订单数据为 `mock/orders.ts` 中的静态对象，未接数据库
- 会话仅存在于浏览器内存，刷新即丢失；后端无 session 持久化
- 无用户鉴权
- 知识库底层已接 Qdrant 向量库（`KB_VECTOR_STORE=qdrant`，默认），BM25 + 向量并行召回 → RRF 融合 → gte-rerank 精排；Qdrant 不可用时自动降级为本地种子 + `data/vector-index.json` 离线索引
