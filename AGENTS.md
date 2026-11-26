# 智能客服 Agent 项目

基于 Vue 3 + Vite + TypeScript（前端）和 Node.js + Vercel AI SDK（后端）的智能客服系统。
Agent 具备工具调用能力，支持多轮对话、流式 SSE 输出，和可插拔 LLM 模型。

> 功能需求基线见 [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md)

## 项目结构

```
Project-init/
├── AGENTS.md              # 本文档
├── frontend/              # Vue 前端（独立 package.json）
│   ├── src/
│   │   ├── main.ts
│   │   ├── App.vue
│   │   ├── env.d.ts
│   │   ├── router/index.ts        # 含 /chat 路由
│   │   ├── api/
│   │   │   ├── index.ts           # axios 实例（通用请求）
│   │   │   └── chat.ts            # fetch + ReadableStream 消费 SSE
│   │   ├── utils/chat-format.ts   # 纯函数：工具痕迹格式化
│   │   ├── stores/
│   │   │   ├── counter.ts
│   │   │   └── chat.ts           # 聊天会话状态
│   │   ├── views/
│   │   │   ├── HomeView.vue
│   │   │   ├── AboutView.vue
│   │   │   ├── NotFound.vue
│   │   │   └── ChatView.vue      # 聊天页面
│   │   └── styles/base.css
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── .env                       # VITE_API_BASE_URL
└── backend/               # Agent 后端（独立 package.json）
    ├── scripts/
    │   ├── build-vector-index.ts  # 离线构建本地降级索引
    │   ├── sync-knowledge.ts      # 种子条目同步到 Qdrant
    │   └── eval-retrieval.ts      # 离线评测 recall / 延迟 / 成本
    ├── data/vector-index.json     # 本地降级索引（git 忽略），条目向量 + 内容指纹
    ├── src/
    │   ├── index.ts              # Express 入口，mount /api/chat、/api/kb、/api/metrics
    │   ├── routes/
    │   │   ├── chat.ts           # POST /api/chat — 流式 SSE
    │   │   ├── kb.ts             # 知识条目管理（热更新）
    │   │   └── metrics.ts        # GET /api/metrics — 召回/延迟/成本
    │   ├── agent/
    │   │   ├── service.ts        # Agent 核心：streamText + maxSteps
    │   │   ├── tools.ts          # 3 个工具定义（tool() + zod schema）
    │   │   ├── knowledge.ts      # 退换货政策知识库
    │   │   └── prompt.ts         # System Prompt
    │   ├── mock/orders.ts        # 模拟订单数据库
    │   ├── knowledge-base/       # 知识库检索（RAG）
    │   │   ├── data.ts           # 知识条目种子数据
    │   │   ├── intent.ts         # 纯函数：关键词规则意图识别
    │   │   ├── bm25.ts           # 纯函数：BM25 稀疏召回（中文 bigram）
    │   │   ├── fusion.ts         # 纯函数：RRF 融合
    │   │   ├── similarity.ts     # 纯函数：余弦相似度
    │   │   ├── rerank.ts         # 副作用：DashScope gte-rerank
    │   │   ├── metrics.ts        # 副作用：进程内指标
    │   │   ├── qdrant-payload.ts # 纯函数：条目 ↔ Qdrant point 映射
    │   │   ├── qdrant.ts         # 副作用：client / collection / 读写 / 检索
    │   │   ├── repository.ts     # 数据源：Qdrant 权威存储 + 快照缓存 + 降级
    │   │   ├── vector-index.ts   # 纯函数：本地索引结构 / 内容指纹 / 校验
    │   │   ├── vector-store.ts   # 副作用：本地索引文件读写
    │   │   ├── embeddings.ts     # 实时向量化 + 本地索引缓存
    │   │   ├── retrieval.ts      # 混合检索编排
    │   │   ├── types.ts          # Intent / KnowledgeEntry / RetrievalResult
    │   │   └── index.ts          # barrel 统一导出
    │   └── types/index.ts
    ├── tsconfig.json
    ├── package.json
    └── .env                       # DEEPSEEK_API_KEY + DASHSCOPE_API_KEY
```

## 核心架构

```
用户浏览器
    │
    ▼ POST /api/chat  { model, messages }
frontend/ChatView.vue  ◄────── fetch + ReadableStream (SSE)
    │
    ▼
backend/src/routes/chat.ts
    │
    │  用户消息 → 意图识别 → 知识库检索 → 命中：直接 SSE 返回条目 / 未命中：Agent + 工具
    │
    ▼
backend/src/agent/service.ts
    │  ai.streamText({
    │    model: getModel('deepseek' | 'qwen'),
    │    system: CUSTOMER_SERVICE_PROMPT,
    │    tools: { queryOrder, askReturnPolicy, transferToHuman },
    │    maxSteps: 5
    │  })
    │
    ▼ LLM 返回 tool_calls
backend/src/agent/tools.ts  — 执行工具函数
    │  ├── queryOrder         → mock/orders.ts
    │  ├── askReturnPolicy    → agent/knowledge.ts
    │  └── transferToHuman    → 生成工单号
    │
    ▼ 工具结果追加到 messages → 再次请求 LLM
    │
    ▼ LLM 返回最终文本
backend 把 result.fullStream 作为 SSE 推回前端
```

## Agent 工具清单

| 工具 | 功能 | 参数 | 返回 |
|---|---|---|---|
| `queryOrder` | 查订单 | `{ orderId: string }` | 订单号、商品、状态、物流、下单时间 |
| `askReturnPolicy` | 查退换货政策 | `{ productType: string }` | 对应商品类别的退换货条件和时限 |
| `transferToHuman` | 转人工 | `{ reason: string }` | 工单编号（格式：TK + 时间戳） |

## LLM 模型支持

通过 Vercel AI SDK 的 provider 抽象层实现热切换：

| 模型 | Provider 包 | 环境变量 | API |
|---|---|---|---|
| DeepSeek (默认) | `@ai-sdk/deepseek` | `DEEPSEEK_API_KEY` | `deepseek.com` |
| 通义千问 | `@ai-sdk/openai-compatible` | `DASHSCOPE_API_KEY` | DashScope OpenAI 兼容端点 |

切换方式：请求 body 里传 `model: 'deepseek'` 或 `model: 'qwen'`，后端自动选 provider。

## 前端对接契约

```
POST /api/chat
Content-Type: application/json

{
  "model": "deepseek" | "qwen",
  "messages": [
    { "role": "user", "content": "查一下我的订单 SO20241125001" }
  ]
}

Response: text/event-stream  (SSE)
  event: rag-hit
  data: {"intent": "delivery", "stage": "hybrid", "score": 0.92, "sources": [{"id": "KB-DELIVERY-01", "title": "配送时效"}]}
  # stage 取值：bm25（仅稀疏分命中）/ vector（仅向量余弦命中）/ hybrid（两路都命中，RRF+rerank 精排）/ none（无命中，不会发 rag-hit）

  event: text-delta
  data: {"text": "您的订单"}

  event: tool-call
  data: {"tool": "queryOrder", "args": {"orderId": "SO20241125001"}}

  event: tool-result
  data: {"tool": "queryOrder", "result": {...}}

  event: finish
  data: {"finishReason": "stop"}

  event: done
  data: {}
```

## 启动方式

```bash
# 后端
cd backend
cp .env.example .env   # 填入 API Key
npm install

# 知识库向量存储（二选一）
docker run -d --name qdrant -p 6333:6333 -v qdrant_storage:/qdrant/storage qdrant/qdrant
# 或无 Qdrant 时在 .env 设 KB_VECTOR_STORE=local 并 npm run build:index

npm run kb:sync        # 种子条目写入 Qdrant（collection 为空时启动会自动导入）
npm run dev            # http://localhost:3001

# 前端
cd frontend
npm install
npm run dev            # http://localhost:5173
```

## 关键技术决策

- **Agent 框架**：Vercel AI SDK `streamText()`，`maxSteps: 5` 控制迭代上限
- **流式输出**：SSE（Server-Sent Events），前端用 `fetch` + `ReadableStream` 逐 token 渲染
- **后端运行**：Node.js + Express + `tsx`（直接跑 TypeScript 无需编译）
- **前端状态**：Pinia store `chat.ts` 管理会话历史、loading、模型选择
- **API Key 安全**：仅存于 backend/.env，前端永不接触
- **知识库存储**：Qdrant 为权威数据源，条目原文与向量同存一个 point；payload 含 `updated_at` / `model_version` / `hash`，检索按 `model_version` 过滤避免混用
- **热更新**：`PUT /api/kb/:id` 即时向量化入库并失效快照缓存，不需要改代码发版；多实例靠 `KB_CACHE_TTL_MS` 收敛
- **降级**：Qdrant 不可用或 `KB_VECTOR_STORE=local` 时走本地种子 + `data/vector-index.json` 离线索引
- **混合检索**：BM25 与向量并行召回 → RRF（k=60）融合 → gte-rerank 精排；rerank 失败自动保持 RRF 顺序
- **监控**：`GET /api/metrics` 暴露命中率/阶段分布/分阶段延迟分位/成本估算；召回率用 `npm run eval:retrieval` 离线评测（17 条标注 query）

## 非目标（当前不做）

- ❌ 真实数据库（订单用 mock 数据）
- ❌ 用户鉴权、会话持久化（内存 session）
- ❌ 多 agent 协作
- ❌ 大规模分布式向量检索 / 多租户隔离（单 collection 足够当前数据量）
- ❌ 前端 UI 组件库（原生 HTML + scoped CSS）

## 扩展指南

### 新增工具
1. 在 `backend/src/agent/tools.ts` 按 `tool({ description, parameters, execute })` 格式追加
2. 在 `service.ts` 的 `tools` 对象里注册
3. LLM 自动发现新工具，无需改 prompt

### 新增模型
1. `npm install @ai-sdk/<新provider>`
2. `.env` 里加新 API Key
3. `backend/src/agent/service.ts` 的 `getModel()` 加一个 case
4. 前端请求 body 里选新 model 值

### 替换 Mock 数据为真实数据库
- `queryOrder` 的 `execute` 函数内部换成 SQL/ORM 查询即可，工具的对外接口不变
