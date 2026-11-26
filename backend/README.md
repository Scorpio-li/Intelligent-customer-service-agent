# 后端 · 智能客服 Agent 服务

基于 Express + Vercel AI SDK 的 Agent 服务。对外提供 SSE 流式聊天接口，内部编排 LLM 与工具调用循环。

## 技术栈

| 依赖 | 版本 | 用途 |
|---|---|---|
| express | ^4.21.2 | HTTP 服务 |
| ai | ^4.1.10 | Vercel AI SDK（streamText / tool） |
| @ai-sdk/deepseek | ^0.1.17 | DeepSeek provider（AI SDK 4 兼容版） |
| @ai-sdk/openai-compatible | ^0.1.9 | 通义千问（DashScope 兼容端点） |
| zod | ^3.24.1 | 工具参数 schema |
| @qdrant/js-client-rest | ^1.20.0 | Qdrant 向量库客户端 |
| cors | ^2.8.5 | 跨域 |
| dotenv | ^16.4.7 | 环境变量 |
| tsx | ^4.19.2 | 开发时直接运行 TS |

## 目录结构

```
backend/
├── .env.example            # 环境变量模板
├── package.json
├── tsconfig.json
├── scripts/
│   ├── build-vector-index.ts   # 离线构建本地向量索引（降级模式用）
│   ├── sync-knowledge.ts       # 种子条目全量同步到 Qdrant
│   └── eval-retrieval.ts       # 离线评测：BM25/向量/RRF/rerank 四组对比
├── data/                   # 生成物（git 忽略）
│   └── vector-index.json   # 本地降级索引：条目向量 + 内容指纹
└── src/
    ├── index.ts            # Express 入口：/health、/api/chat、/api/kb、/api/metrics
    ├── routes/
    │   ├── chat.ts         # POST /api/chat — SSE 推流
    │   ├── kb.ts           # 知识条目管理（列表 / 热更新 / 删除）
    │   └── metrics.ts      # GET /api/metrics — 召回/延迟/成本
    ├── agent/
    │   ├── index.ts        # barrel 统一导出
    │   ├── service.ts      # Agent 核心：streamText + maxSteps
    │   ├── tools.ts        # 3 个工具定义
    │   ├── convert.ts      # 纯函数：前端消息 → SDK 消息格式
    │   ├── knowledge.ts    # 退换货政策知识库
    │   └── prompt.ts       # System Prompt
    ├── mock/orders.ts      # 模拟订单库 + queryOrder()
    ├── knowledge-base/     # 知识库检索（RAG）
    │   ├── data.ts         # 知识条目种子数据
    │   ├── intent.ts       # 纯函数：关键词规则意图识别
    │   ├── bm25.ts         # 纯函数：BM25 稀疏召回（中文 bigram）
    │   ├── fusion.ts       # 纯函数：RRF 融合
    │   ├── similarity.ts   # 纯函数：余弦相似度
    │   ├── rerank.ts       # 副作用：DashScope gte-rerank 精排
    │   ├── metrics.ts      # 副作用：进程内指标（召回/延迟/成本）
    │   ├── qdrant-payload.ts # 纯函数：条目 ↔ Qdrant point 映射
    │   ├── qdrant.ts       # 副作用：client / collection / 读写 / 向量检索
    │   ├── repository.ts   # 数据源：Qdrant 权威存储 + 快照缓存 + 本地降级
    │   ├── vector-index.ts # 纯函数：本地索引结构 / 内容指纹 / 校验
    │   ├── vector-store.ts # 副作用：本地索引文件读写（降级模式）
    │   ├── embeddings.ts   # 实时向量化 + 本地索引缓存
    │   ├── retrieval.ts    # 混合检索编排（BM25 + 向量 → RRF → rerank）
    │   ├── types.ts        # Intent / KnowledgeEntry / RetrievalResult
    │   └── index.ts        # barrel 统一导出
    └── types/index.ts      # Order / ChatMessage / ChatRequest
```

## 脚本

```bash
npm run dev            # tsx watch src/index.ts
npm run build          # tsc 输出到 dist/
npm run kb:sync        # 种子条目全量写入 Qdrant（--recreate 先删 collection）
npm run build:index    # 构建本地降级索引 → data/vector-index.json
npm run eval:retrieval # 离线评测召回率 / 延迟 / 成本（会调用 embedding + rerank）
npm run start          # node dist/index.js
```

## 环境变量

复制 `.env.example` 为 `.env` 后填写：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 用默认模型时必填 | https://platform.deepseek.com |
| `DASHSCOPE_API_KEY` | 用通义千问 / embedding / rerank 时必填 | https://dashscope.console.aliyun.com |
| `DEEPSEEK_MODEL` | 否 | 默认 `deepseek-flash` |
| `DASHSCOPE_MODEL` | 否 | 默认 `qwen-plus` |
| `PORT` | 否 | 默认 `3001` |
| `KB_EMBEDDING_THRESHOLD` | 否 | 向量余弦阈值，默认 `0.6`（rerank 不可用时生效） |
| `KB_EMBEDDING_ENABLED` | 否 | 是否启用向量召回，默认 `true` |
| `EMBEDDING_MODEL` | 否 | 向量模型名，默认 `text-embedding-v3` |
| `EMBEDDING_DIM` | 否 | 向量维度，需与模型一致，默认 `1024` |
| `KB_BM25_TOP_K` | 否 | BM25 召回条数，默认 `10` |
| `KB_VECTOR_TOP_K` | 否 | 向量召回条数，默认 `10` |
| `KB_RERANK_TOP_N` | 否 | 进入 rerank 的候选数，默认 `5` |
| `KB_FINAL_TOP_K` | 否 | 最终返回条数，默认 `3` |
| `KB_RRF_K` | 否 | RRF 平滑常数，默认 `60` |
| `KB_BM25_THRESHOLD` | 否 | BM25 原始分阈值，默认 `0.4`（rerank 不可用时生效） |
| `KB_RERANK_ENABLED` | 否 | 是否启用 rerank，默认 `true` |
| `RERANK_MODEL` | 否 | 默认 `gte-rerank-v2` |
| `KB_RERANK_THRESHOLD` | 否 | rerank 分数阈值，默认 `0.1`（gte-rerank 分数偏低） |
| `KB_COST_EMBED_CNY_PER_1K` | 否 | 成本估算单价，默认 `0.0007` 元/千 token |
| `KB_COST_RERANK_CNY_PER_1K` | 否 | 成本估算单价，默认 `0.0008` 元/千 token |
| `KB_VECTOR_STORE` | 否 | `qdrant`（默认）或 `local`（无 Qdrant 依赖，走本地索引） |
| `QDRANT_URL` | 否 | 默认 `http://localhost:6333` |
| `QDRANT_API_KEY` | 云实例必填 | Qdrant Cloud API Key |
| `QDRANT_COLLECTION` | 否 | 默认 `knowledge_entries` |
| `KB_CACHE_TTL_MS` | 否 | 条目快照 TTL，默认 `30000`，热更新会立即失效 |
| `KB_ADMIN_TOKEN` | 否 | `/api/kb` 的 Bearer Token，留空不校验 |
| `VECTOR_INDEX_PATH` | 否 | 本地降级索引路径，默认 `data/vector-index.json` |

两个 Key 都缺失时，`/api/chat` 会通过 SSE 返回 `error` 事件，而不是抛 500。

## 向量存储（Qdrant）

**权威数据在 Qdrant**：每条知识条目是一个 point，向量为条目 embedding，payload 保存原文与元数据：

```
{
  entry_id, title, intent, keywords, content,
  updated_at,      // 条目更新时间（ISO）
  model_version,   // 生成该向量的 embedding 模型
  hash             // title + keywords + content 的 sha256
}
```

point id 由业务 id 经 sha256 派生为确定性 UUID，写入/删除无需先反查。

### 启动 Qdrant

```bash
docker run -d --name qdrant -p 6333:6333 \
  -v qdrant_storage:/qdrant/storage qdrant/qdrant
# 云实例则配置 QDRANT_URL + QDRANT_API_KEY
```

服务启动时自动建 collection（含 `intent` / `model_version` payload 索引）；collection 为空时自动导入 `data.ts` 种子条目。已有存量条目时执行：

```bash
npm run kb:sync                # 种子条目 upsert
npm run kb:sync -- --recreate  # 切换模型 / 维度后重建
```

### 热更新（不需要改代码发版）

```bash
# 新增或修改条目：立即向量化入库并失效缓存，下个请求即生效
curl -X PUT http://localhost:3001/api/kb/KB-DELIVERY-01 \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <KB_ADMIN_TOKEN>' \
  -d '{
    "title": "配送时效",
    "intent": "delivery",
    "keywords": ["物流", "快递", "发货"],
    "content": "付款成功后 24 小时内发货……"
  }'

# 列表 / 删除
curl http://localhost:3001/api/kb
curl -X DELETE http://localhost:3001/api/kb/KB-DELIVERY-01
```

### 模型切换与降级

- 检索时按 `model_version` 过滤，旧模型向量不会被混用；换模型后执行 `npm run kb:sync -- --recreate` 重建
- collection 维度与 `EMBEDDING_DIM` 不一致会直接报错并提示重建，避免静默写坏数据
- 多实例部署靠 `KB_CACHE_TTL_MS` 收敛快照（写操作只失效当前实例的缓存）
- Qdrant 不可用（或 `KB_VECTOR_STORE=local`）时，自动降级为本地种子 + `data/vector-index.json` 离线索引，关键词与向量检索仍可用

## 混合检索与监控

检索链路（`knowledge-base/retrieval.ts`）：

```
query → 意图识别 → 同 intent 候选
        ├── BM25 稀疏召回 top10（进程内，中文 bigram）
        └── 向量召回 top10（Qdrant；不可用时本地离线索引）
                  ↓ RRF 融合（k=60）
               候选 top5
                  ↓ gte-rerank 精排
               阈值过滤 → 返回 top3
```

- **BM25**（`bm25.ts`）：中文按字 bigram、ASCII 整词切分；关键词 / 标题 / 正文权重 3:2:1
- **RRF**（`fusion.ts`）：按各路名次融合，不依赖分数量纲
- **rerank**（`rerank.ts`）：DashScope `gte-rerank-v2`，3 秒超时；未启用或失败时自动保持 RRF 顺序
- **命中判定**：rerank 可用时用精排分（`KB_RERANK_THRESHOLD`）；不可用时用原始证据（余弦 ≥ `KB_EMBEDDING_THRESHOLD` 或 BM25 ≥ `KB_BM25_THRESHOLD`）
- `RetrievalResult.scores` 回传 bm25 / vector / rrf / rerank 各阶段分数；`rag-hit.stage` 为 `bm25` / `vector` / `hybrid`

### 监控指标

`GET /api/metrics`（进程内累计，重启清零）：

| 指标 | 说明 |
|---|---|
| `retrieval.hitRate` / `byStage` | 命中率与各路贡献占比 |
| `retrieval.degraded` | 向量召回降级次数（Qdrant 不可用 / embedding 失败） |
| `latencyMs.{bm25,vector,rerank,total}` | avg、p50、p95、max |
| `cost.*` | embedding 调用数与字符数、rerank 文档数与 token、估算成本（元） |

成本按 `KB_COST_*_CNY_PER_1K` 估算（字符数近似 token），用于趋势观察，不等于真实账单。

### 召回率评测

```bash
npm run eval:retrieval
```

用 17 条标注 query（覆盖 8 个意图）对比 BM25、向量、RRF 融合、融合+rerank 四组，输出 recall@1 / recall@3 / MRR / 平均与 p95 延迟 / API 调用次数 / 估算成本。在线侧拿不到 ground truth，所以召回率以该离线脚本为准；知识条目变更后应重跑。

## 本地降级索引

仅在 `KB_VECTOR_STORE=local` 或 Qdrant 不可用时使用，用于在没有 Qdrant 的环境下跑通检索：

```bash
npm run build:index   # 读取 data.ts → 批量向量化 → 写 data/vector-index.json
```

- `hash` 为 `title + keywords + content` 的 sha256；条目内容、模型名或索引版本不匹配时该条回退实时向量化
- 文件缺失或损坏时整体降级为实时向量化，不影响启动
- 索引进程内只加载一次，重建后需重启服务生效
- 查询向量始终实时调用 DashScope，`DASHSCOPE_API_KEY` 必填

## 接口

### `GET /health`

```json
{ "status": "ok", "ts": 1732600000000 }
```

### `GET /api/metrics`

检索监控快照：命中率、阶段分布、分阶段延迟分位、API 成本估算，字段说明见上文「混合检索与监控」。

### `POST /api/chat`

请求体：

```json
{
  "model": "deepseek",
  "messages": [
    { "role": "user", "content": "查一下订单 SO20241125001" }
  ]
}
```

- `model`：`deepseek`（默认）或 `qwen`
- `messages` 为空或非数组时，立即返回 `error` 事件并结束

响应为 `text/event-stream`：

| event | data |
|---|---|
| `rag-hit` | `{ "intent": "...", "stage": "...", "score": 0.63, "sources": [{ "id": "...", "title": "..." }] }` |
| `text-delta` | `{ "text": "..." }` |
| `tool-call` | `{ "tool": "...", "args": {...} }` |
| `tool-result` | `{ "tool": "...", "result": ... }` |
| `finish` | `{ "finishReason": "stop" }` |
| `done` | `{}` |
| `error` | `{ "message": "..." }` |

连接期间每 15 秒发送一次 `: ping` 注释行作为心跳；响应头包含 `X-Accel-Buffering: no`，避免 Nginx 缓冲。

### `/api/kb` 知识条目管理

配置了 `KB_ADMIN_TOKEN` 时，所有请求需带 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/kb` | 返回 `{ source: "qdrant" \| "local", modelVersion, count, entries }` |
| `PUT` | `/api/kb/:id` | upsert 条目：`{ title, intent, keywords, content }`，同步生成 embedding 并失效缓存 |
| `DELETE` | `/api/kb/:id` | 删除条目 |

`PUT` 的 `intent` 取值：`delivery` / `payment` / `invoice` / `membership` / `coupon` / `account` / `aftersale` / `human`。写入失败（如 Qdrant 不可用）返回 503。

## Agent 运行机制

`/api/chat` 先做意图识别与混合检索（BM25 + 向量 → RRF → rerank）：命中时直接返回 `rag-hit` → `text-delta` → `finish` → `done`，不调用 LLM，也无需模型 Key；未命中才进入下面的 Agent 流程。

`agent/service.ts` 的 `runAgent()`：

1. 根据 `model` 选择 provider（`deepseek` / `qwen-plus`）
2. 用 `convert.ts` 的 `toSdkMessages()` 转换历史消息（纯函数）
3. 调用 `streamText({ system, tools, messages, maxSteps: 5 })`
4. `maxSteps: 5` 限制工具调用迭代次数，防止死循环
5. `routes/chat.ts` 遍历 `result.fullStream`，把事件逐条转成 SSE

## 工具清单

| 工具 | 参数 | 行为 |
|---|---|---|
| `queryOrder` | `{ orderId: string }` | 从 `mock/orders.ts` 查订单，格式化为文本 |
| `askReturnPolicy` | `{ productType: string }` | 从 `knowledge.ts` 查政策，未知类别回退「默认」 |
| `transferToHuman` | `{ reason: string }` | 生成工单号 `TK` + 时间戳后 8 位，返回预计等待时间 |

知识库覆盖：服装、数码、食品、默认。mock 订单：`SO20241125001`、`SO20241124003`、`SO20241122017`。

## 扩展

### 新增工具

1. 在 `agent/tools.ts` 的 `tools` 对象中追加 `tool({ description, parameters, execute })`
2. 无需改 `service.ts`——`tools` 整体传入 `streamText`，LLM 自动发现
3. `description` 写清楚「什么时候该调」，比参数说明更影响调用准确率

### 新增模型

1. `npm install @ai-sdk/<provider>`
2. `.env` 增加对应 API Key
3. `service.ts` 里创建 provider 实例，并在 `runAgent()` 中按 `req.model` 分支
4. 前端 `stores/chat.ts` 的 `ModelChoice` 增加新值

### 接入真实数据

`mock/orders.ts` 的 `queryOrder(orderId)` 换成数据库查询即可，工具对外签名不变。

## 约定与坑

- **ESM + NodeNext**：相对导入必须带 `.js` 后缀（如 `./prompt.js`），即使源文件是 `.ts`
- **AI SDK 版本必须对齐**：本项目用 `ai@4.x`（只支持 provider specification v1）。`@ai-sdk/deepseek@1.x` 是 AI SDK 5 的 provider（spec v2），装上去会报 `UnsupportedModelVersionError`。要升级 provider 必须同步把 `ai` 升到 5.x 并改写 `maxSteps`、流事件字段、`inputSchema` 等
- 模块边界：`agent/index.ts`、`knowledge-base/index.ts` 是唯一导出入口，路由层只从 barrel import
- 纯逻辑（消息转换、payload 映射）与副作用（LLM 调用、Qdrant/文件读写）分文件，便于单独测试
- **知识条目写入后必须失效快照缓存**：`repository.ts` 的写操作会调用 `invalidateSnapshot()`；多实例靠 `KB_CACHE_TTL_MS` 收敛
- **Qdrant 是权威存储，`data.ts` 只是种子**：线上改条目请走 `/api/kb`，不要改代码重发版；改种子后需 `npm run kb:sync`
- **rerank 分数尺度因模型而异**：`gte-rerank-v2` 相关结果只有 0.12~0.9，`KB_RERANK_THRESHOLD` 默认 0.1 是按实测校准的；换模型必须重新标定
- **BM25 阈值与语料规模相关**：doc 数变化会改变 IDF 尺度，`KB_BM25_THRESHOLD` 只用于 rerank 不可用的兜底判定，调整后跑一遍 `eval:retrieval`
- **指标是进程内累积**：多实例部署需按实例抓取 `/api/metrics` 再聚合，重启即清零
- 订单与政策均为静态 mock，重启不会变化；无鉴权（除 `/api/kb` 可选 Token）、无会话持久化
