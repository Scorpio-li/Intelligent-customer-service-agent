# 智能客服系统需求清单

## 1. 文档说明

### 1.1 目的

本文档是「阳光商城 · 智能客服 Agent」的**长期需求基线**，用于回答两个问题：

1. 系统当前**已经实现**了哪些可验证的能力；
2. 每项能力的**验收标准**和**实现位置**分别是什么。

文档中的所有描述均以 `backend/src` 与 `frontend/src` 的实际源码为准，不从 README 推断。

### 1.2 与 README / AGENTS.md 的分工

| 文档 | 定位 | 读者 | 内容边界 |
|---|---|---|---|
| `README.md` | 快速上手与演示入口 | 第一次接触项目的人 | 一句话定位、启动命令、演示对话、API 速查 |
| `AGENTS.md` | 代码地图与架构说明 | 需要改代码的开发者 / AI | 目录结构、数据流、扩展示例 |
| `docs/REQUIREMENTS.md`（本文） | 需求基线与验收标准 | 需求方、测试、维护者 | 需求编号、四要素、非功能约束、非目标、变更记录 |

三者冲突时，**以源码为准，并应同步修正另外两份文档**。

### 1.3 维护方式

1. 新增能力：先在本文档追加带编号的需求，再改代码；代码合入后补全「实现位置」。
2. 修改已有能力：不改编号，只更新「描述 / 验收标准 / 实现位置」。
3. 删除能力：把该条需求状态标记为「废弃」，保留编号与原文，不物理删除。
4. 每次变更都在第 8 节「变更记录」追加一行。

### 1.4 编号规则

| 类别 | 格式 | 示例 | 说明 |
|---|---|---|---|
| 功能需求 | `FR-<模块>-<三位序号>` | `FR-SSE-003` | 模块取第 4 章 13 个子章节的英文缩写，见下表 |
| 非功能需求 | `NFR-<三位序号>` | `NFR-002` | 全局唯一，不按模块细分 |

模块缩写：

| 子章节 | 模块缩写 |
|---|---|
| 4.1 对话服务 | `CHAT` |
| 4.2 流式输出 | `SSE` |
| 4.3 Agent 编排 | `AGENT` |
| 4.4 工具能力 | `TOOL` |
| 4.5 模型切换 | `MODEL` |
| 4.6 知识库 | `KB` |
| 4.7 订单数据 | `ORDER` |
| 4.8 前端路由 | `ROUTE` |
| 4.9 聊天界面 | `UI` |
| 4.10 会话状态 | `STORE` |
| 4.11 开发代理与构建 | `BUILD` |
| 4.12 配置项 | `CONF` |
| 4.13 知识库检索（RAG） | `RAG` |

规则：**只增不改，废弃编号不复用**。同一模块内序号连续，不跳号。

---

## 2. 系统概述

### 2.1 一句话定位

一个前后端分离的演示级智能客服系统：浏览器里的 Vue 单页应用把用户消息发给 Express，Express 用 Vercel AI SDK 的 `streamText` 编排 DeepSeek / 通义千问模型与 3 个客服工具，最终把逐 token 的文本和工具调用事件通过 SSE 推回浏览器。

### 2.2 架构图

```
┌────────────────────┐   POST /api/chat  (application/json)   ┌───────────────────────────┐
│ 浏览器              │ ─────────────────────────────────────▶ │ Vite Dev Server (:5173)   │
│ Vue 3 SPA          │ ◀───────────────────────────────────── │  /api → :3001 开发代理     │
│ (ChatView.vue)     │   text/event-stream (SSE)              └─────────────┬─────────────┘
└────────────────────┘                                                  │ HTTP
                                                                        ▼
                                                          ┌───────────────────────────┐
                                                          │ Express (:3001)           │
                                                          │  GET  /health             │
                                                          │  POST /api/chat → SSE     │
                                                          └─────────────┬─────────────┘
                                                                        ▼
                                                          ┌───────────────────────────┐
                                                          │ Agent (streamText)        │
                                                          │  system prompt            │
                                                          │  tools ×3 / maxSteps: 5   │
                                                          └─────────────┬─────────────┘
                                                                        ▼
                                                          ┌───────────────────────────┐
                                                          │ LLM Provider              │
                                                          │ DeepSeek / DashScope      │
                                                          └───────────────────────────┘
```

### 2.3 技术栈

版本取自各自的 `package.json`。

| 层 | 技术 / 包 | 版本声明 | 用途 |
|---|---|---|---|
| 前端框架 | `vue` | `^3.5.13` | 单页应用 |
| 前端路由 | `vue-router` | `^4.5.0` | history 模式路由 |
| 前端状态 | `pinia` | `^2.3.0` | 会话状态 |
| 前端 HTTP | `axios` | `^1.7.9` | 通用请求实例（聊天流不使用） |
| 前端构建 | `vite` | `^6.0.5` | 开发服务器与打包 |
| 前端插件 | `@vitejs/plugin-vue` | `^5.2.1` | Vue SFC 编译 |
| 前端类型 | `typescript` / `vue-tsc` | `~5.7.2` / `^2.2.0` | 类型检查 |
| 后端运行时 | Node.js + ESM（`"type": "module"`） | — | 服务端运行环境 |
| 后端框架 | `express` | `^4.21.2` | HTTP 服务 |
| 后端 AI SDK | `ai` | `^4.1.10` | `streamText` / `tool` |
| DeepSeek Provider | `@ai-sdk/deepseek` | `0.1.17` | DeepSeek 模型接入 |
| 通义千问 Provider | `@ai-sdk/openai-compatible` | `^0.1.9` | DashScope OpenAI 兼容端点 |
| 参数校验 | `zod` | `^3.24.1` | 工具参数 schema |
| 后端中间件 | `cors` / `dotenv` | `^2.8.5` / `^16.4.7` | 跨域 / 环境变量 |
| 后端开发运行 | `tsx` | `^4.19.2` | 直接运行 TypeScript |

---

## 3. 术语表

| 术语 | 含义（结合本项目） |
|---|---|
| Agent | 由 `streamText()` 驱动的「模型 + 工具」循环体。模型可以连续多轮决定调用工具，直到给出最终文本。 |
| 工具调用（tool call） | 模型输出的一次结构化请求，形如 `{ toolName, args }`；后端据此执行 `tools.ts` 中对应的 `execute` 函数。 |
| 工具结果（tool result） | 工具 `execute` 的返回值，以 `tool-result` 事件推给前端，同时由 AI SDK 回填进对话再请求模型。 |
| Step | AI SDK 中的一次「模型调用 + 工具执行」单元。`maxSteps` 即 Step 的累计上限。 |
| `maxSteps` | `streamText` 的配置项，本项目固定为 `5`，用于限制工具调用循环的最大步数，防止死循环。 |
| SSE | Server-Sent Events。服务端单向推送 `text/event-stream`，本项目前端用 `fetch` + `ReadableStream` 消费。 |
| SSE 心跳 | 每 15 秒写入的注释行 `: ping`，不含 `event`/`data`，用于保活长连接。 |
| Provider | AI SDK 的模型接入层实例。本项目有两个：`deepseek`（`createDeepSeek`）与 `qwen`（`createOpenAICompatible`）。 |
| System Prompt | 每次请求固定注入的系统指令 `CUSTOMER_SERVICE_PROMPT`，定义客服身份、工具使用规则、回复风格和禁止事项。 |
| `fullStream` | `streamText()` 返回结果上的异步可迭代事件流，`routes/chat.ts` 遍历它并逐条转成 SSE。 |
| Mock | 写死在源码中的静态假数据，本项目用于订单库。 |
| 工具痕迹（tool trace） | 前端把 `tool-call` / `tool-result` 事件累积到 assistant 消息上，用一句话展示「调用了什么、返回了什么」。 |

---

## 4. 功能需求

### 4.1 对话服务

#### FR-CHAT-001 · 健康检查接口

- **描述**：提供 `GET /health`，返回服务存活状态与服务器当前毫秒时间戳。
- **触发条件**：任意客户端发起 `GET /health`，无需请求体与鉴权。
- **验收标准**：
  - 响应体为 JSON：`{ "status": "ok", "ts": <number> }`。
  - `ts` 取值为 `Date.now()`，每次请求都不同。
  - 不依赖任何环境变量，未配置 API Key 时同样返回 200。
- **实现位置**：`backend/src/index.ts` · `app.get('/health')`

#### FR-CHAT-002 · 聊天接口与请求体

- **描述**：提供 `POST /api/chat`，接收 `{ model?, messages }`，返回 SSE 流。路由挂载在 `/api/chat`，实际处理器路径为 `/`。
- **触发条件**：前端或其他客户端向 `/api/chat` 发起 POST，`Content-Type: application/json`。
- **验收标准**：
  - 请求体字段 `model` 可选，类型为 `'deepseek' | 'qwen'`；`messages` 必填，为 `ChatMessage[]`。
  - `ChatMessage` 结构：`{ role: 'system' | 'user' | 'assistant' | 'tool', content: string, tool_call_id?: string, toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }`。
  - 无论请求成功与否，响应状态码均为 200，错误通过 SSE `error` 事件表达。
- **实现位置**：`backend/src/index.ts` · `app.use('/api/chat', chatRouter)`；`backend/src/routes/chat.ts` · `router.post('/')`；`backend/src/types/index.ts` · `ChatRequest` / `ChatMessage`

#### FR-CHAT-003 · `messages` 校验

- **描述**：请求缺少 `messages`、`messages` 非数组、或数组长度为 0 时，立即以 `error` 事件拒绝，不调用模型。
- **触发条件**：`req.body.messages` 不满足 `Array.isArray(...) && length > 0`。
- **验收标准**：
  - 立即写出 `event: error` + `data: {"message":"messages 不能为空"}`，随后 `res.end()`。
  - 不创建心跳定时器，不请求 LLM。
- **实现位置**：`backend/src/routes/chat.ts` · `router.post('/')` 内 `if (!body.messages ...)`

#### FR-CHAT-004 · API Key 存在性校验

- **描述**：根据 `model` 选择所需 Key 变量名（`qwen` → `DASHSCOPE_API_KEY`，其他值 → `DEEPSEEK_API_KEY`），缺失时以 `error` 事件拒绝。
- **触发条件**：对应环境变量为空或未设置。
- **验收标准**：
  - 返回 `event: error`，`data.message` 为 `` 后端未配置 ${modelKey}，请在 backend/.env 中设置 ``。
  - 校验发生在心跳启动之前，因此该分支不会产生 `: ping`。
  - 该分支不抛异常、不返回 5xx。
- **实现位置**：`backend/src/routes/chat.ts` · `router.post('/')` 内 `const modelKey = ...`

#### FR-CHAT-005 · 全局中间件

- **描述**：应用启动时启用 CORS 与 JSON 请求体解析，并设置 1 MB 上限。
- **触发条件**：任意进入 Express 的 HTTP 请求。
- **验收标准**：
  - `cors()` 以默认配置启用，允许跨域访问。
  - `express.json({ limit: '1mb' })` 生效，超过 1 MB 的 JSON 请求体被拒绝。
  - 未注册自定义 404 / 全局错误处理中间件，未匹配路由由 Express 默认处理。
- **实现位置**：`backend/src/index.ts` · `app.use(cors())`、`app.use(express.json({ limit: '1mb' }))`

#### FR-CHAT-006 · 端口与启动日志

- **描述**：服务监听端口取 `process.env.PORT`，非法或未设置时回退 `3001`；启动成功后打印一行日志。
- **触发条件**：执行 `npm run dev` / `npm start`。
- **验收标准**：
  - `Number(process.env.PORT) || 3001`，即 `PORT` 为非数字时也回退 3001。
  - 日志格式：`[backend] Agent server listening on http://localhost:${PORT}`。
  - 入口文件第一行导入 `dotenv/config`，`.env` 在模块加载时生效。
- **实现位置**：`backend/src/index.ts` · `const PORT`、`app.listen(PORT, ...)`、`import 'dotenv/config'`

### 4.2 流式输出

#### FR-SSE-001 · SSE 响应头

- **描述**：聊天处理器在进入任何校验之前先设置 4 个响应头，声明这是一条不缓存的 SSE 长连接。
- **触发条件**：`POST /api/chat` 进入处理器。
- **验收标准**：
  - `Content-Type: text/event-stream`（不带 charset）。
  - `Cache-Control: no-cache, no-transform`。
  - `Connection: keep-alive`。
  - `X-Accel-Buffering: no`（禁用 Nginx 缓冲）。
- **实现位置**：`backend/src/routes/chat.ts` · `res.setHeader(...)` ×4

#### FR-SSE-002 · 事件帧格式

- **描述**：所有事件由统一的 `sse(res, event, data)` 函数写出，`data` 经 `JSON.stringify` 序列化。
- **触发条件**：需要向前端推送任意事件。
- **验收标准**：
  - 帧严格为 `event: <名称>\n` + `data: <JSON>\n\n`。
  - 每个事件块以空行（`\n\n`）结束，事件名区分大小写、使用连字符。
- **实现位置**：`backend/src/routes/chat.ts` · `function sse(res, event, data)`

#### FR-SSE-003 · `text-delta` 事件

- **描述**：把模型输出的增量文本逐条推送给前端。
- **触发条件**：`fullStream` 中 `part.type === 'text-delta'`。
- **验收标准**：
  - 事件名 `text-delta`，`data` 为 `{ "text": part.textDelta }`。
  - 多个增量文本按到达顺序拼接后等于模型最终文本。
- **实现位置**：`backend/src/routes/chat.ts` · `case 'text-delta'`

#### FR-SSE-004 · `tool-call` 事件

- **描述**：模型决定调用工具时，把工具名和参数推给前端。
- **触发条件**：`part.type === 'tool-call'`。
- **验收标准**：
  - 事件名 `tool-call`，`data` 为 `{ "tool": part.toolName, "args": part.args }`。
  - 事件发生在对应工具执行之前。
- **实现位置**：`backend/src/routes/chat.ts` · `case 'tool-call'`

#### FR-SSE-005 · `tool-result` 事件

- **描述**：工具执行完成后，把返回值推给前端。
- **触发条件**：`part.type === 'tool-result'`。
- **验收标准**：
  - 事件名 `tool-result`，`data` 为 `{ "tool": part.toolName, "result": part.result }`。
  - `result` 类型不定：`queryOrder` / `askReturnPolicy` 为字符串，`transferToHuman` 为对象。
- **实现位置**：`backend/src/routes/chat.ts` · `case 'tool-result'`

#### FR-SSE-006 · `finish` 事件

- **描述**：模型一次 Step 结束时推送结束原因。
- **触发条件**：`part.type === 'finish'`。
- **验收标准**：
  - 事件名 `finish`，`data` 为 `{ "finishReason": part.finishReason }`（只含 `finishReason`，不含文本）。
  - 每个 Step 结束触发一次；发生工具调用时 `fullStream` 会进入下一步，该事件随之再次出现。
- **实现位置**：`backend/src/routes/chat.ts` · `case 'finish'`

#### FR-SSE-007 · `done` 事件

- **描述**：`fullStream` 正常遍历结束后发送统一的终止标记。
- **触发条件**：`for await` 循环正常退出。
- **验收标准**：
  - 事件名 `done`，`data` 为 `{}`。
  - `done` 之后不再有业务事件，随后连接关闭。
  - 异常路径（`catch`）不发送 `done`，只发送 `error`。
- **实现位置**：`backend/src/routes/chat.ts` · 循环之后的 `sse(res, 'done', {})`

#### FR-SSE-008 · `error` 事件

- **描述**：三类错误统一以 SSE 事件返回，不抛 HTTP 5xx：参数校验失败、Key 缺失、运行期异常。
- **触发条件**：`messages` 非法 / 对应 API Key 缺失 / `runAgent` 或流遍历抛异常。
- **验收标准**：
  - 事件名 `error`，`data` 为 `{ "message": string }`。
  - 运行期异常时 `message` 取 `err.message`，非 `Error` 实例时回退 `'Agent 运行出错'`。
  - 运行期异常同时写 `console.error('[chat] Agent 运行出错:', err)`。
- **实现位置**：`backend/src/routes/chat.ts` · 三处 `sse(res, 'error', ...)`、`catch (err: unknown)`

#### FR-SSE-009 · 15 秒心跳

- **描述**：连接期间每 15 秒写入一条 SSE 注释行保活。
- **触发条件**：通过参数与 Key 校验后创建 `setInterval`。
- **验收标准**：
  - 间隔精确为 `15000` ms，内容为 `: ping\n\n`。
  - 心跳行不含 `event:` / `data:`，前端解析时因无法 `JSON.parse` 而被跳过。
  - 连接结束（成功或异常）都必须清除定时器。
- **实现位置**：`backend/src/routes/chat.ts` · `const heartbeat = setInterval(...)`、`finally { clearInterval(heartbeat) }`

#### FR-SSE-010 · 未知事件忽略

- **描述**：`fullStream` 中除上述 4 类之外的 part 类型一律忽略，不透传给前端。
- **触发条件**：出现 `step-start`、`step-finish`、`reasoning`、`error` 等其他类型。
- **验收标准**：
  - `switch` 的 `default` 分支不做任何 `res.write`。
  - 因此前端只会收到 `text-delta` / `tool-call` / `tool-result` / `finish` / `done` / `error` 六种事件名。
- **实现位置**：`backend/src/routes/chat.ts` · `default: // ignore unknown events`

#### FR-SSE-011 · 流结束与资源释放

- **描述**：无论正常结束还是抛异常，都清理心跳并关闭响应。
- **触发条件**：流遍历结束 / `catch` 捕获异常。
- **验收标准**：
  - `finally` 中依次执行 `clearInterval(heartbeat)` 与 `res.end()`。
  - 一次请求最多只调用一次 `res.end()`。
- **实现位置**：`backend/src/routes/chat.ts` · `finally { ... }`

#### FR-SSE-012 · 客户端中断行为

- **描述**：前端不提供主动停止按钮，也不使用 `AbortController`；请求中断时依靠 `try/finally` 复位状态。
- **触发条件**：网络断开、浏览器刷新、后端提前关闭连接。
- **验收标准**：
  - `frontend/src/api/chat.ts` 中不存在 `AbortController` / `signal`。
  - 流读取结束后若 assistant 消息仍为 `streaming`，兜底调用 `finishStreaming(assistantId)`。
  - `ChatView.send()` 的 `finally` 无条件把 `chat.loading` 置为 `false`。
- **实现位置**：`frontend/src/api/chat.ts` · `streamChat()` 末尾兜底；`frontend/src/views/ChatView.vue` · `send()` 的 `finally`

### 4.3 Agent 编排

#### FR-AGENT-001 · `streamText` 调用配置

- **描述**：`runAgent()` 按请求选择 provider 与模型名，转换消息后调用 `streamText`，返回其结果对象供路由层遍历。
- **触发条件**：`POST /api/chat` 通过校验后调用 `runAgent(body)`。
- **验收标准**：
  - 调用参数固定包含 `model`、`system: CUSTOMER_SERVICE_PROMPT`、`tools`、`messages`、`maxSteps: 5` 五项。
  - `system` 使用项目内置 prompt，不接受请求方覆盖。
  - 返回值为 `streamText` 的结果对象，路由层读取其 `fullStream`。
- **实现位置**：`backend/src/agent/service.ts` · `runAgent()`、`streamText({...})`

#### FR-AGENT-002 · `maxSteps: 5`

- **描述**：限制一次请求内「模型调用 + 工具执行」的最大步数为 5。
- **触发条件**：每次 `streamText` 调用。
- **验收标准**：
  - 该值在源码中硬编码为 `5`，不可通过请求体或环境变量调整。
  - 达到上限后不再继续发起工具调用，直接收敛出最终文本。
  - 当前依赖 AI SDK 4 的 `maxSteps` 语义；升级到 AI SDK 5 时必须同步改写。
- **实现位置**：`backend/src/agent/service.ts` · `maxSteps: 5`

#### FR-AGENT-003 · System Prompt：身份与工具规则

- **描述**：`CUSTOMER_SERVICE_PROMPT` 固定客服人设「阳光商城」、工号 `CS-AI-2024`，并规定三个工具的触发条件。
- **触发条件**：每次请求自动注入。
- **验收标准**：
  - 明确列出职责：准确回答订单/商品/退换货问题、主动解决问题、先安抚情绪再处理。
  - `queryOrder`：用户提到订单号、快递、物流时主动调用，不要求用户重复报号。
  - `askReturnPolicy`：用户问退货/换货/时限时调用，并需区分服装、数码、食品、其他类别。
  - `transferToHuman`：用户明确说「找人工」「人工客服」「我要投诉」时必须调用；连续 2 次未能正确回答也应主动转人工；转人工后需告知工单号与「预计 5 分钟内有专员联系」。
- **实现位置**：`backend/src/agent/prompt.ts` · `CUSTOMER_SERVICE_PROMPT`（「## 你的职责」「## 工具使用规则」段）

#### FR-AGENT-004 · System Prompt：风格与边界

- **描述**：规定回复风格与三类禁止行为。
- **触发条件**：每次请求自动注入。
- **验收标准**：
  - 风格约束：开头使用「好的~」「明白了」等口语化表达；结尾留「请问还需要其他帮助吗？」；分段回答；订单号/工单号用反引号包裹。
  - 禁止编造订单信息、政策内容或优惠活动。
  - 禁止承诺超出退换货政策的特殊处理。
  - 禁止回答与「阳光商城」购物无关的问题。
- **实现位置**：`backend/src/agent/prompt.ts` · `CUSTOMER_SERVICE_PROMPT`（「## 回复风格」「## 不能做的事」段）

#### FR-AGENT-005 · 消息历史转换

- **描述**：`toSdkMessages()` 把前端 `ChatMessage[]` 转为 AI SDK 的消息结构，是纯函数、无副作用。
- **触发条件**：`runAgent()` 内、`streamText` 之前。
- **验收标准**：
  - 带非空 `toolCalls` 的消息 → `{ role: 'assistant', content, toolCalls }`。
  - `role === 'tool'` 的消息 → `{ role: 'tool', toolCallId: tool_call_id ?? '', content: [{ type: 'text', text: content }] }`。
  - 其余消息 → `{ role, content }`，`role` 限 `'system' | 'user' | 'assistant'`。
  - 相同输入永远得到相同输出，不读写外部状态。
- **实现位置**：`backend/src/agent/convert.ts` · `toSdkMessages()`

#### FR-AGENT-006 · Agent 模块统一导出

- **描述**：`agent/index.ts` 作为 barrel，路由层只从它导入，不直接依赖内部文件名。
- **触发条件**：`routes/chat.ts` 导入 `runAgent`。
- **验收标准**：
  - `agent/index.ts` 导出 `runAgent`、`tools`、`CUSTOMER_SERVICE_PROMPT`、`toSdkMessages` 四项。
  - `routes/chat.ts` 的导入路径为 `../agent/index.js`，不出现 `service.js` / `tools.js` 等内部路径。
  - 相对导入统一带 `.js` 后缀（NodeNext + ESM 要求）。
- **实现位置**：`backend/src/agent/index.ts`；`backend/src/routes/chat.ts` · `import { runAgent } from '../agent/index.js'`

### 4.4 工具能力

#### FR-TOOL-001 · `queryOrder` 查订单

- **描述**：根据订单号查询订单完整信息。
- **触发条件**：模型判断用户提到订单号、快递或物流。
- **验收标准**：
  - 工具名 `queryOrder`，描述「根据订单号查询订单的完整信息，包括商品、金额、当前状态、快递单号等」。
  - 参数 schema：`z.object({ orderId: z.string().describe('订单号，格式如 SO20241125001，必须由用户提供') })`。
  - `execute` 调用 `mock/orders.ts` 的 `queryOrder(orderId)`，打印 `[tool] queryOrder(<orderId>)`，原样返回字符串。
- **实现位置**：`backend/src/agent/tools.ts` · `tools.queryOrder`；`backend/src/mock/orders.ts` · `queryOrder()`

#### FR-TOOL-002 · `askReturnPolicy` 查退换货政策

- **描述**：按商品类别返回退换货政策文本。
- **触发条件**：用户询问能否退货、如何换货、退货时限等。
- **验收标准**：
  - 工具名 `askReturnPolicy`，描述「查询某类商品的退换货政策、期限和注意事项」。
  - 参数 schema：`z.object({ productType: z.string().describe('商品类别，可选：服装、数码、食品；不确定时用"默认"') })`。
  - `execute` 调用 `getReturnPolicy(productType)`，打印 `[tool] askReturnPolicy(<productType>)`，原样返回政策字符串。
- **实现位置**：`backend/src/agent/tools.ts` · `tools.askReturnPolicy`；`backend/src/agent/knowledge.ts` · `getReturnPolicy()`

#### FR-TOOL-003 · `transferToHuman` 转人工

- **描述**：创建人工服务工单并返回工单号与预计等待时间。
- **触发条件**：用户明确要求人工客服或投诉，或模型判定连续失败。
- **验收标准**：
  - 工具名 `transferToHuman`，描述「将用户转接给人工客服，返回工单编号」。
  - 参数 schema：`z.object({ reason: z.string().describe('转接原因，例如"用户要求人工服务"、"AI未能解决问题"') })`。
  - 工单号格式为 `'TK' + Date.now().toString().slice(-8)`，即 `TK` 加 8 位数字。
  - 返回对象字段固定为 `ticketId`、`estimatedWaitTime`（固定 `'5 分钟'`）、`reason`、`message`（含工单号与「预计 5 分钟内有专员联系您。请保持手机畅通。」）。
  - 打印 `[tool] transferToHuman(<reason>) → <ticketId>`。
- **实现位置**：`backend/src/agent/tools.ts` · `tools.transferToHuman`

#### FR-TOOL-004 · 工具注册与发现

- **描述**：三个工具以对象字面量 `tools` 导出，整体传入 `streamText`，由模型根据 `description` 自主决定调用。
- **触发条件**：每次模型调用。
- **验收标准**：
  - `tools` 对象恰含 `queryOrder`、`askReturnPolicy`、`transferToHuman` 三个键。
  - `service.ts` 中 `tools` 直接引用同一对象，不做筛选或重命名。
  - 新增工具只需在 `tools.ts` 追加键值，无需改 prompt 或 `service.ts`。
- **实现位置**：`backend/src/agent/tools.ts` · `export const tools`；`backend/src/agent/service.ts` · `tools,`

### 4.5 模型切换

#### FR-MODEL-001 · 请求级模型选择

- **描述**：每个请求可通过 `model` 字段独立选择模型，请求之间互不影响。
- **触发条件**：请求体包含 `model`。
- **验收标准**：
  - 合法取值为 `'deepseek'` 与 `'qwen'`。
  - 仅当 `model === 'qwen'` 时使用通义千问；`'deepseek'`、`undefined` 及其他任意值都落到 DeepSeek。
  - provider 选择与 API Key 选择使用同一判断条件，二者不会错配。
- **实现位置**：`backend/src/agent/service.ts` · `runAgent()` 前两行三元判断；`backend/src/routes/chat.ts` · `const modelKey = ...`

#### FR-MODEL-002 · 默认模型

- **描述**：未传 `model` 时默认使用 DeepSeek。
- **触发条件**：请求体缺少 `model` 字段。
- **验收标准**：
  - 走 `deepseek` provider，模型名取 `DEEPSEEK_MODEL`。
  - 前端 `useChatStore` 的初始值同样为 `'deepseek'`。
- **实现位置**：`backend/src/agent/service.ts` · `const modelFactory = req.model === 'qwen' ? qwen : deepseek`；`frontend/src/stores/chat.ts` · `model = ref<ModelChoice>('deepseek')`

#### FR-MODEL-003 · 模型名环境变量覆盖

- **描述**：两个模型名都支持环境变量覆盖，未设置时代码内默认值生效。
- **触发条件**：进程启动读取 `process.env`。
- **验收标准**：
  - `DEEPSEEK_MODEL` 未设置时默认 `'deepseek-flash'`。
  - `DASHSCOPE_MODEL` 未设置时默认 `'qwen-plus'`。
  - 变量在模块顶层读取一次，运行期修改环境变量不生效。
  - 当前 `backend/.env` 中已设置 `DEEPSEEK_MODEL=deepseek-flash` 与 `DASHSCOPE_MODEL=qwen3.6-plus`，会覆盖代码默认值。
- **实现位置**：`backend/src/agent/service.ts` · `const DEEPSEEK_MODEL`、`const DASHSCOPE_MODEL`

#### FR-MODEL-004 · Provider 初始化

- **描述**：两个 provider 实例在模块顶层创建一次，复用同一个实例处理所有请求。
- **触发条件**：后端进程启动加载 `service.ts`。
- **验收标准**：
  - `deepseek` 由 `createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY })` 创建。
  - `qwen` 由 `createOpenAICompatible({ name: 'qwen', apiKey: process.env.DASHSCOPE_API_KEY, baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })` 创建。
  - `qwen` 的 `baseURL` 固定为 DashScope OpenAI 兼容端点，不可配置。
- **实现位置**：`backend/src/agent/service.ts` · `const deepseek`、`const qwen`

#### FR-MODEL-005 · 前端模型契约

- **描述**：前端模型选项与后端取值严格一致，只有两项。
- **触发条件**：用户操作模型下拉框，或 `streamChat` 构造请求体。
- **验收标准**：
  - `ModelChoice` 类型为 `'deepseek' | 'qwen'`。
  - 下拉选项为 `DeepSeek (默认)` → `deepseek`、`通义千问` → `qwen`，顺序固定。
  - 请求体 `{ model, messages }` 中 `model` 直接取当前 store 值。
- **实现位置**：`frontend/src/stores/chat.ts` · `ModelChoice`；`frontend/src/views/ChatView.vue` · `modelOptions`；`frontend/src/api/chat.ts` · `body: JSON.stringify({ model, messages })`

### 4.6 知识库

#### FR-KB-001 · 四类政策内容

- **描述**：内置四份退换货政策文本：服装、数码、食品、默认。
- **触发条件**：`askReturnPolicy` 工具被调用。
- **验收标准**：
  - `服装`：7 天无理由（未穿着、吊牌完整）、30 天质量问题免费退换、尺码问题运费买家承担、贴身衣物拆封不支持无理由退换。
  - `数码`：7 天无理由（未激活、配件齐全）、15 天非人为故障免费换新、签收后外观损伤不退换、激活设备原则上不支持无理由退货。
  - `食品`：生鲜/临期 24 小时内变质破损全额退款、预包装未拆封 7 天无理由、拆封食用后仅食品安全问题可退换。
  - `默认`：普通商品 7 天无理由、30 天质量问题免费退换、定制/虚拟/个人护理类不支持无理由退换、退款 1-3 个工作日原路返回。
- **实现位置**：`backend/src/agent/knowledge.ts` · `const knowledge: Record<string, string>`

#### FR-KB-002 · 类别判定与回退

- **描述**：按商品类别精确查表，未命中一律回退到「默认」政策。
- **触发条件**：`getReturnPolicy(productType)` 被调用。
- **验收标准**：
  - 先 `productType.trim()` 去除首尾空白，再做精确键匹配（区分大小写，不做模糊匹配）。
  - 命中不到时返回 `knowledge.默认`，不抛异常、不返回空值。
  - 传入空字符串时同样回退到「默认」。
- **实现位置**：`backend/src/agent/knowledge.ts` · `getReturnPolicy()`

#### FR-KB-003 · 返回给 LLM 的形式

- **描述**：政策直接以纯文本字符串作为工具返回值，不切片、不摘要、不做向量检索。
- **触发条件**：`askReturnPolicy.execute` 返回。
- **验收标准**：
  - 返回值为包含标题行（如 `【服装类退换货政策】`）与多行条目的完整字符串。
  - 内容原样进入 `tool-result` 事件与下一次模型请求，服务端不做二次加工。
- **实现位置**：`backend/src/agent/knowledge.ts` · 各政策字符串；`backend/src/agent/tools.ts` · `askReturnPolicy.execute`

### 4.7 订单数据

#### FR-ORDER-001 · Mock 订单清单

- **描述**：内置 3 条订单，键为订单号，值为 `Order` 结构。
- **触发条件**：`queryOrder(orderId)` 被调用。
- **验收标准**：
  - `SO20241125001`：客户张先生，商品「纯棉T恤 白色 XL」×2（¥128）+「牛仔裤 32码」×1（¥299），合计 555，状态 `shipped`，下单 `2024-11-24 10:23:45`，发货 `2024-11-25 09:12:00`，快递 `SF1234567890123`。
  - `SO20241124003`：客户李女士，商品「无线耳机 Pro」×1（¥799），合计 799，状态 `delivered`，下单 `2024-11-23 14:05:12`，发货 `2024-11-23 18:30:00`，快递 `YT9876543210987`。
  - `SO20241122017`：客户王先生，商品「机械键盘 青轴」×1（¥459），合计 459，状态 `pending`，下单 `2024-11-25 08:47:33`，无发货时间与快递单号。
  - `Order` 字段：`orderId`、`customer`、`items[]`（`name`/`sku`/`quantity`/`price`）、`total`、`status`、`createdAt`、可选 `shippedAt`、可选 `trackingNumber`。
- **实现位置**：`backend/src/mock/orders.ts` · `const orders`；`backend/src/types/index.ts` · `Order` / `OrderItem`

#### FR-ORDER-002 · 状态映射

- **描述**：内部枚举状态映射为中文展示文案。
- **触发条件**：拼装订单详情文本时。
- **验收标准**：
  - 6 种映射：`pending`→待付款、`paid`→已付款、`shipped`→已发货、`delivered`→已签收、`cancelled`→已取消、`returning`→退货中。
  - 映射表覆盖 `Order['status']` 全部联合类型，无遗漏分支。
- **实现位置**：`backend/src/mock/orders.ts` · `const statusMap`；`backend/src/types/index.ts` · `Order['status']`

#### FR-ORDER-003 · 详情文本格式

- **描述**：订单信息拼装为多行纯文本返回给模型。
- **触发条件**：订单号命中。
- **验收标准**：
  - 依次输出订单号、客户、状态、下单时间、商品列表（每条 `  - <名称> × <数量>（¥<单价>）`）、合计 `¥<total>`。
  - 仅当状态为 `shipped` 或 `delivered` 时追加「发货时间」与「快递单号（可在对应快递官网查询）」两行。
  - `pending` 订单不出现发货与快递字段。
- **实现位置**：`backend/src/mock/orders.ts` · `queryOrder()` 内模板字符串与 `if (order.status === ...)`

#### FR-ORDER-004 · 订单不存在的行为

- **描述**：订单号查不到时返回提示文案，不抛异常。
- **触发条件**：`orders[orderId.trim()]` 为 `undefined`。
- **验收标准**：
  - 返回 `抱歉，未找到订单号 "<原始入参>"。请确认订单号是否正确（格式示例：SO20241125001）。`
  - 查询用 `trim()` 后的键，提示文案中回显原始入参。
  - 工具仍视为成功执行，产生 `tool-result` 事件而非 `error` 事件。
- **实现位置**：`backend/src/mock/orders.ts` · `queryOrder()` 内 `if (!order)`

### 4.8 前端路由

#### FR-ROUTE-001 · 路由表与懒加载

- **描述**：基于 `createWebHistory` 声明 4 条路由，页面组件全部动态导入。
- **触发条件**：应用启动挂载 `router`。
- **验收标准**：
  - `/` → `name: 'home'` → `HomeView.vue`。
  - `/chat` → `name: 'chat'` → `ChatView.vue`。
  - `/about` → `name: 'about'` → `AboutView.vue`。
  - 每个 `component` 均为 `() => import('@/views/xxx.vue')` 形式，不静态导入。
  - history 基路径取 `import.meta.env.BASE_URL`。
- **实现位置**：`frontend/src/router/index.ts` · `routes`

#### FR-ROUTE-002 · 全局守卫

- **描述**：唯一的全局前置守卫负责设置页面标题，不做任何权限或跳转拦截。
- **触发条件**：每次路由切换。
- **验收标准**：
  - 有 `name` 时标题为 `<路由名> · Project Init`，否则为 `Project Init`。
  - 守卫内始终调用 `next()`，不阻断导航。
  - 不涉及登录态、白名单或重定向。
- **实现位置**：`frontend/src/router/index.ts` · `router.beforeEach(...)`；`frontend/index.html` · `<title>Project Init</title>`

#### FR-ROUTE-003 · 404 兜底

- **描述**：未匹配路径统一落到 404 页面。
- **触发条件**：访问任意未声明路径。
- **验收标准**：
  - 路径模式为 `/:pathMatch(.*)*`，名称为 `'not-found'`。
  - 页面渲染 `404` 标题、英文说明与返回首页链接。
- **实现位置**：`frontend/src/router/index.ts` · 最后一条路由；`frontend/src/views/NotFound.vue`

#### FR-ROUTE-004 · 首页与关于页内容

- **描述**：`/` 与 `/about` 是脚手架示例页，与客服业务无关。
- **触发条件**：访问 `/` 或 `/about`。
- **验收标准**：
  - 首页展示 `Home` 标题、计数器（`+` / `-` 操作 `useCounterStore`）、指向 `/about` 的链接。
  - 关于页展示 `About` 标题、说明文字、返回首页链接。
  - 两页均无任何网络请求。
- **实现位置**：`frontend/src/views/HomeView.vue`、`frontend/src/views/AboutView.vue`、`frontend/src/stores/counter.ts`

### 4.9 聊天界面

#### FR-UI-001 · 页面布局

- **描述**：`ChatView` 为三段式全屏布局：头部工具栏、消息滚动区、底部输入区。
- **触发条件**：进入 `/chat`。
- **验收标准**：
  - 容器高度 `100vh`，最大宽度 `760px`，左右居中，左右各 1px 边框。
  - 头部左侧为「← 返回首页」链接与标题「阳光商城 · 智能客服」，右侧为模型下拉与「清空会话」按钮。
  - 消息区 `flex: 1` + `overflow-y: auto`，输入区固定在底部。
- **实现位置**：`frontend/src/views/ChatView.vue` · `<template>` 的 `section.chat-page`

#### FR-UI-002 · 初始欢迎语

- **描述**：首次挂载且会话为空时，自动插入一条用户消息作为引导。
- **触发条件**：`onMounted` 且 `chat.messages.length === 0`。
- **验收标准**：
  - 插入内容为 `你好，我想咨询一下`，角色为 `user`。
  - 只写本地 store，**不发起**任何网络请求，也不产生 assistant 回复。
  - 该逻辑仅在组件挂载时执行一次；点击「清空会话」后不会再次插入。
- **实现位置**：`frontend/src/views/ChatView.vue` · `onMounted()`

#### FR-UI-003 · 发送流程

- **描述**：点击「发送」或按 Enter 触发一次完整对话请求。
- **触发条件**：`send()` 被调用。
- **验收标准**：
  - 先对输入 `trim()`，为空或 `chat.loading` 为真时直接返回。
  - 依次执行：写入用户消息 → 清空输入框 → `loading = true` → `await streamChat(...)`。
  - 请求消息列表为 `chat.messages.map(m => ({ role: m.role, content: m.content }))`，仅含 `role` 与 `content`。
  - `catch` 时若最后一条消息仍在流式中，调用 `finishStreaming(id, err.message)`；`finally` 复位 `loading`。
- **实现位置**：`frontend/src/views/ChatView.vue` · `send()`

#### FR-UI-004 · 键盘交互

- **描述**：Enter 发送，Shift+Enter 换行。
- **触发条件**：输入框内 `keydown`。
- **验收标准**：
  - `e.key === 'Enter' && !e.shiftKey` 时阻止默认换行并调用 `send()`。
  - 按住 Shift 再按 Enter 保持默认换行行为。
- **实现位置**：`frontend/src/views/ChatView.vue` · `onKeydown()`、`@keydown="onKeydown"`

#### FR-UI-005 · 流式打字效果

- **描述**：assistant 气泡内容随 `text-delta` 增量追加，流式期间显示闪烁光标。
- **触发条件**：收到 `text-delta` 事件；assistant 消息 `streaming === true`。
- **验收标准**：
  - 每个 `text-delta` 的 `text` 直接拼接到当前 assistant 消息 `content` 末尾。
  - `streaming` 为真时气泡尾部渲染 `▊`，带 `0.8s` 无限闪烁动画。
  - 流结束或出错后光标消失。
- **实现位置**：`frontend/src/views/ChatView.vue` · `.cursor`、`v-if="msg.streaming"`；`frontend/src/api/chat.ts` · `case 'text-delta'`；`frontend/src/stores/chat.ts` · `appendDelta()`

#### FR-UI-006 · 工具调用痕迹展示

- **描述**：工具事件以单行文本展示在 assistant 气泡顶部。
- **触发条件**：收到 `tool-call` 或 `tool-result`。
- **验收标准**：
  - `tool-call` 渲染 ``🔧 调用 `<tool>`：<JSON 字符串化的 args>``。
  - `tool-result`（无 args）渲染 ``📦 返回 `<tool>` 结果``。
  - `args` 与 `result` 同时存在或同时缺失时，`formatToolTrace` 返回 `null`，界面渲染空字符串。
  - 痕迹使用 `v-text` 输出，不解析 HTML。
  - 同一 assistant 消息内多条痕迹按到达顺序垂直排列。
- **实现位置**：`frontend/src/utils/chat-format.ts` · `formatToolTrace()`；`frontend/src/views/ChatView.vue` · `.tool-traces`；`frontend/src/api/chat.ts` · `case 'tool-call'` / `case 'tool-result'`

#### FR-UI-007 · 模型下拉与清空会话

- **描述**：头部提供模型切换与会话清空两个操作。
- **触发条件**：用户点击下拉或按钮。
- **验收标准**：
  - 下拉 `v-model="chat.model"`，切换只改 store，不重发历史请求。
  - 「清空会话」调用 `chat.reset()`，清空消息并把 `loading` 置回 `false`。
  - 两者在 `chat.loading` 为真时均 `disabled`。
- **实现位置**：`frontend/src/views/ChatView.vue` · `select` / `button`；`frontend/src/stores/chat.ts` · `reset()`

#### FR-UI-008 · 自动滚动

- **描述**：消息数量变化后自动平滑滚动到底部。
- **触发条件**：`chat.messages.length` 变化。
- **验收标准**：
  - 使用 `watch` 监听长度，`await nextTick()` 后执行 `scrollTo({ top: scrollHeight, behavior: 'smooth' })`。
  - 仅监听长度变化，消息内文本增量更新不额外触发滚动。
- **实现位置**：`frontend/src/views/ChatView.vue` · `watch(() => chat.messages.length, ...)`

#### FR-UI-009 · 禁用态与按钮文案

- **描述**：请求进行中锁定全部输入入口，避免并发请求。
- **触发条件**：`chat.loading === true`。
- **验收标准**：
  - 输入框 `disabled`，模型下拉 `disabled`，清空按钮 `disabled`。
  - 发送按钮在 `loading` 或输入为空时 `disabled`。
  - 发送按钮文案在 `loading` 时为「思考中…」，否则为「发送」。
  - 禁用时按钮背景色变为 `#aaa` 并显示 `not-allowed` 光标。
- **实现位置**：`frontend/src/views/ChatView.vue` · `:disabled` 绑定与 `{{ chat.loading ? '思考中…' : '发送' }}`

#### FR-UI-010 · 错误展示

- **描述**：请求或流式错误展示在对应 assistant 气泡底部。
- **触发条件**：HTTP 非 2xx / 无响应体 / 收到 `error` 事件。
- **验收标准**：
  - `res.ok === false` 或 `res.body` 为空时，错误文案为 `请求失败：<status>`。
  - 收到 `error` 事件时，错误文案取 `payload.message`，缺失时回退 `'未知错误'`。
  - 气泡内以 `⚠️ <error>` 形式展示，红色 12px。
  - 出错后 `streaming` 置为 `false`，光标消失。
- **实现位置**：`frontend/src/api/chat.ts` · `if (!res.ok || !res.body)`、`case 'error'`；`frontend/src/views/ChatView.vue` · `.error`

#### FR-UI-011 · 消息渲染与空态

- **描述**：用户与客服气泡左右分列，正文按换行渲染；列表为空时显示引导文案。
- **触发条件**：渲染消息列表。
- **验收标准**：
  - 用户气泡右对齐、绿底白字；assistant 气泡左对齐、灰底深色字；最大宽度 80%。
  - 气泡抬头：`role === 'user'` 显示「你」，否则显示「客服 AI」。
  - 正文通过 `v-html` 输出，并把 `\n` 替换为 `<br/>`；未做 HTML 转义。
  - `messages.length === 0` 时显示「输入问题开始对话，试试："查一下我的订单 SO20241125001"」。
- **实现位置**：`frontend/src/views/ChatView.vue` · `v-for` 气泡、`v-html="msg.content.replace(/\n/g, '<br/>')"`、`.empty`

#### FR-UI-012 · SSE 客户端解析

- **描述**：`streamChat()` 用 `fetch` 读取 `ReadableStream`，按空行分块解析 SSE 并分发给 store。
- **触发条件**：`streamChat(model, messages)` 被调用。
- **验收标准**：
  - 请求方式为 `POST '/api/chat'`，`Content-Type: application/json`；不使用 axios。
  - 调用开始时先创建 assistant 占位消息，后续所有增量都写入该消息 id。
  - 以 `\n\n` 为事件分隔符；逐行识别 `event:` 与 `data:` 前缀。
  - `data` 为空的块跳过；`JSON.parse` 失败的块跳过（心跳 `: ping` 走此路径）。
  - 事件分发：`text-delta` → `appendDelta`；`tool-call` → `pushToolTrace({ tool, args })`；`tool-result` → `pushToolTrace({ tool, result })`；`error` → `finishStreaming(message)`；`done` 与 `finish` 不做处理。
  - 读取结束后若消息仍在流式中，兜底 `finishStreaming(assistantId)`。
  - 返回 `{ assistantId }`。
- **实现位置**：`frontend/src/api/chat.ts` · `streamChat()`

### 4.10 会话状态

#### FR-STORE-001 · 唯一数据源

- **描述**：`useChatStore` 是聊天会话的唯一权威状态，页面组件不复制消息数组。
- **触发条件**：任意聊天相关组件读取状态。
- **验收标准**：
  - store 暴露状态 `messages`、`model`、`loading`。
  - `ChatView` 直接绑定 `chat.messages` 渲染，不维护本地副本。
  - 所有写操作都通过 store 动作完成。
- **实现位置**：`frontend/src/stores/chat.ts` · `useChatStore`

#### FR-STORE-002 · 消息结构

- **描述**：前端消息类型与后端不同，只区分 `user` 与 `assistant`。
- **触发条件**：创建消息时。
- **验收标准**：
  - `ChatRole` 仅为 `'user' | 'assistant'`。
  - 字段：`id: string`、`role`、`content: string`，可选 `toolTraces`、`streaming`、`error`。
  - `toolTraces` 元素结构：`{ tool: string; args?: unknown; result?: unknown }`。
- **实现位置**：`frontend/src/stores/chat.ts` · `ChatMessage`

#### FR-STORE-003 · 状态动作

- **描述**：store 提供 7 个动作覆盖会话全生命周期。
- **触发条件**：界面交互或 SSE 事件。
- **验收标准**：
  - `reset()`：清空 `messages`，`loading = false`，不重置 `model`。
  - `appendUser(text)`：追加用户消息并返回该消息对象。
  - `createAssistantPlaceholder()`：追加 `content: ''`、`streaming: true` 的 assistant 消息并返回。
  - `findMessage(id)`：按 id 返回消息或 `undefined`。
  - `finishStreaming(id, error?)`：置 `streaming = false`，有 `error` 时写入 `error` 字段。
  - `appendDelta(id, delta)`：把文本追加到指定消息 `content`。
  - `pushToolTrace(assistantId, trace)`：向指定消息追加工具痕迹，数组不存在时先初始化。
- **实现位置**：`frontend/src/stores/chat.ts` · `reset` / `appendUser` / `createAssistantPlaceholder` / `findMessage` / `finishStreaming` / `appendDelta` / `pushToolTrace`

#### FR-STORE-004 · 请求消息计算属性

- **描述**：store 提供 `wireMessages` 计算属性，把消息裁剪为 `{ role, content }`。
- **触发条件**：读取 `wireMessages` 时惰性计算。
- **验收标准**：
  - 输出为 `messages.map(m => ({ role: m.role, content: m.content }))`。
  - 当前 `ChatView.send()` 自行做同样的映射，`wireMessages` 无任何调用方；两者行为等价。
- **实现位置**：`frontend/src/stores/chat.ts` · `wireMessages`

#### FR-STORE-005 · 消息 id 生成

- **描述**：前端消息 id 由随机字符串生成，无全局递增序号。
- **触发条件**：`appendUser` 或 `createAssistantPlaceholder`。
- **验收标准**：
  - 取 `Math.random().toString(36)` 小数点后的前 8 个字符（`slice(2, 10)`），典型结果为 8 位 base36 字符串。
  - 同一会话内 id 作为 `v-for` 的 `key`，不参与后端交互。
- **实现位置**：`frontend/src/stores/chat.ts` · `makeId()`

#### FR-STORE-006 · 会话生命周期

- **描述**：会话只存在于浏览器内存，刷新即丢失；后端不保存会话。
- **触发条件**：页面刷新、关闭标签页或组件卸载。
- **验收标准**：
  - store 不使用 `localStorage` / `sessionStorage` / cookie。
  - 后端不持久化 `messages`，每次请求完全依赖客户端上传的历史。
  - 切换路由到 `/` 或 `/about` 再返回 `/chat` 时，Pinia 单例状态仍在（未刷新前提下）。
- **实现位置**：`frontend/src/stores/chat.ts`；`frontend/src/main.ts` · `app.use(createPinia())`

### 4.11 开发代理与构建

#### FR-BUILD-001 · `@/` 路径别名

- **描述**：`@` 指向 `frontend/src`，Vite 与 TypeScript 两侧同步配置。
- **触发条件**：前端源码中使用 `@/...` 导入。
- **验收标准**：
  - `vite.config.ts` 中 `resolve.alias['@'] = fileURLToPath(new URL('./src', import.meta.url))`。
  - `tsconfig.app.json` 中 `baseUrl: "."`、`paths: { "@/*": ["src/*"] }`。
  - 实际使用：`@/stores/chat`、`@/api/chat`、`@/utils/chat-format`、`@/views/*.vue`。
- **实现位置**：`frontend/vite.config.ts` · `resolve.alias`；`frontend/tsconfig.app.json` · `paths`

#### FR-BUILD-002 · 开发服务器

- **描述**：开发服务器监听所有网卡，端口可由 `VITE_PORT` 覆盖。
- **触发条件**：执行 `npm run dev`。
- **验收标准**：
  - `host: '0.0.0.0'`，`open: false`。
  - 端口为 `Number(env.VITE_PORT) || 5173`。
  - 环境变量通过 `loadEnv(mode, process.cwd(), '')` 读取，第三参数为空串表示加载全部变量而不限 `VITE_` 前缀。
- **实现位置**：`frontend/vite.config.ts` · `server`、`loadEnv(...)`

#### FR-BUILD-003 · `/api` 开发代理

- **描述**：开发服务器把 `/api` 前缀请求转发到后端，规避跨域。
- **触发条件**：前端请求 `/api/...`。
- **验收标准**：
  - 代理键为 `/api`，`changeOrigin: true`。
  - 目标为 `env.VITE_API_BASE_URL || 'http://localhost:3001'`。
  - 开发模式下 `.env.development` 生效，`VITE_API_BASE_URL` 为 `http://localhost:3001`；未提供该文件时 `.env` 中的 `/api` 会被当作代理目标（相对地址不指向后端，属于配置陷阱）。
  - 生产构建不启用该代理，需由部署侧自行转发。
- **实现位置**：`frontend/vite.config.ts` · `server.proxy['/api']`；`frontend/.env`、`frontend/.env.development`、`frontend/.env.production`

#### FR-BUILD-004 · 后端脚本与产物

- **描述**：后端提供开发、构建、启动三个脚本。
- **触发条件**：在 `backend/` 下执行对应 npm 脚本。
- **验收标准**：
  - `dev`：`tsx watch src/index.ts`，改动自动重启。
  - `build`：`tsc`，按 `tsconfig.json` 输出到 `dist/`（`outDir: dist`、`rootDir: src`、`declaration: false`、`sourceMap: false`）。
  - `start`：`node dist/index.js`，必须先 `build`。
  - 模块系统为 `NodeNext` + `"type": "module"`，相对导入必须带 `.js` 后缀。
- **实现位置**：`backend/package.json` · `scripts`；`backend/tsconfig.json`

#### FR-BUILD-005 · 前端脚本与产物

- **描述**：前端提供开发、构建、预览、检查、格式化脚本。
- **触发条件**：在 `frontend/` 下执行对应 npm 脚本。
- **验收标准**：
  - `dev`：`vite`。
  - `build`：`vue-tsc -b && vite build`，类型检查通过才产出构建物；输出目录为 Vite 默认 `dist/`。
  - `preview`：`vite preview`。
  - `lint`：`eslint . --fix`；`format`：`prettier --write .`。
  - 构建配置：`target: 'esnext'`、`sourcemap: false`、`chunkSizeWarningLimit: 1500`。
- **实现位置**：`frontend/package.json` · `scripts`；`frontend/vite.config.ts` · `build`

#### FR-BUILD-006 · 通用 axios 实例

- **描述**：提供一个 axios 实例供后续非流式接口使用。
- **触发条件**：导入 `@/api` 默认导出。
- **验收标准**：
  - `baseURL` 为 `import.meta.env.VITE_API_BASE_URL || '/api'`。
  - `timeout` 为 `60000` ms。
  - 当前项目中该实例无任何调用方，聊天请求走原生 `fetch`。
- **实现位置**：`frontend/src/api/index.ts` · `axios.create(...)`

### 4.12 配置项

#### FR-CONF-001 · 后端环境变量

- **描述**：后端通过 `dotenv` 从 `backend/.env` 读取 9 个变量。
- **触发条件**：进程启动。
- **验收标准**：

| 变量 | 必填性 | 默认值 | 作用 |
|---|---|---|---|
| `DEEPSEEK_API_KEY` | 使用 DeepSeek（默认落点）时必填 | 无 | 创建 `deepseek` provider 的 `apiKey`；缺失时 `/api/chat` 返回 `error` 事件 |
| `DASHSCOPE_API_KEY` | 请求 `model: "qwen"` 时必填 | 无 | 创建 `qwen` provider 的 `apiKey`；缺失时 `/api/chat` 返回 `error` 事件 |
| `DEEPSEEK_MODEL` | 否 | `deepseek-flash`（代码默认值） | 传给 DeepSeek provider 的模型名 |
| `DASHSCOPE_MODEL` | 否 | `qwen-plus`（代码默认值） | 传给通义千问 provider 的模型名 |
| `PORT` | 否 | `3001` | Express 监听端口 |
| `KB_KEYWORD_THRESHOLD` | 否 | `0.45` | 关键词检索命中阈值（得分归一化到 0~1） |
| `KB_EMBEDDING_THRESHOLD` | 否 | `0.6` | 向量检索余弦相似度命中阈值 |
| `KB_EMBEDDING_ENABLED` | 否 | `true` | 关键词未命中时是否启用 embedding 第二阶段 |
| `EMBEDDING_MODEL` | 否 | `text-embedding-v3` | DashScope 文本向量模型名 |

- **实现位置**：`backend/.env.example`；`backend/src/index.ts` · `PORT`；`backend/src/agent/service.ts` · 模型名常量；`backend/src/knowledge-base/*.ts` · 检索阈值

#### FR-CONF-002 · 前端环境变量

- **描述**：前端通过 Vite 环境文件读取构建期变量。
- **触发条件**：`vite` 启动或构建，以及 `import.meta.env` 访问。
- **验收标准**：

| 变量 | 必填性 | 默认值 | 作用 |
|---|---|---|---|
| `VITE_PORT` | 否 | `5173` | 开发服务器端口（仅在 `vite.config.ts` 中使用） |
| `VITE_API_BASE_URL` | 否 | `.env` 为 `/api`；`.env.development` 为 `http://localhost:3001`；`.env.production` 为 `https://api.example.com` | `/api` 开发代理目标；同时作为 `api/index.ts` 的 axios `baseURL` |
| `BASE_URL` | 否（Vite 内置，无需在 `.env` 中声明） | `/` | `createWebHistory()` 的基路径 |

- **实现位置**：`frontend/.env`、`.env.development`、`.env.production`；`frontend/vite.config.ts`；`frontend/src/router/index.ts` · `createWebHistory(import.meta.env.BASE_URL)`；`frontend/src/env.d.ts`

#### FR-CONF-003 · 配置加载方式

- **描述**：后端用 `dotenv/config` 在模块加载时注入 `.env`；前端用 Vite 按 mode 合并环境文件。
- **触发条件**：进程 / 开发服务器启动。
- **验收标准**：
  - `backend/src/index.ts` 与 `backend/src/agent/service.ts` 首行均导入 `'dotenv/config'`。
  - 后端变量只在模块加载时读取，运行期不重载。
  - 前端按 `.env` < `.env.[mode]` 的优先级覆盖，`mode=development` 时使用 `.env.development`。
  - `.env`、`.env.development`、`.env.production` 三个文件均存在，且不带真实密钥。
- **实现位置**：`backend/src/index.ts`、`backend/src/agent/service.ts`、`frontend/vite.config.ts`

### 4.13 知识库检索（RAG）

#### FR-RAG-001 · 意图识别

- **描述**：`POST /api/chat` 在进入 Agent 之前，对最后一条 `user` 消息做关键词规则意图识别，输出 `delivery` / `payment` / `invoice` / `membership` / `coupon` / `account` / `aftersale` / `human` / `unknown` 之一。
- **触发条件**：收到 `messages` 合法的 `/api/chat` 请求。
- **验收标准**：
  - 规则表为本地关键词匹配，纯函数实现，不发起网络请求、不依赖环境变量。
  - 按规则表顺序匹配，命中首个意图即返回；全部未命中返回 `unknown`。
  - 同一输入多次调用结果一致（无随机数、无时间依赖）。
  - 意图结果只用于检索，不改变原有工具调用能力。
- **实现位置**：`backend/src/knowledge-base/intent.ts` · 意图规则表与识别函数；对外由 `backend/src/knowledge-base/index.ts` 导出

#### FR-RAG-002 · 第一阶段关键词检索

- **描述**：按意图对知识条目做关键词打分，得分归一化到 `0~1`，达到阈值即视为命中。
- **触发条件**：意图识别完成。
- **验收标准**：
  - 相似度归一化至 `0~1` 区间。
  - 阈值读取 `KB_KEYWORD_THRESHOLD`，默认 `0.45`。
  - 最高分 ≥ 阈值 → 命中，跳过第二阶段与 LLM。
  - 最高分 < 阈值 → 进入第二阶段；意图为 `unknown` 时直接视为未命中。
  - 检索为纯计算，无网络调用。
- **实现位置**：`backend/src/knowledge-base/search.ts` · 关键词打分与归一化；`backend/src/knowledge-base/data.ts` · 知识条目

#### FR-RAG-003 · 第二阶段向量检索

- **描述**：关键词阶段未达阈值时，调用 DashScope `text-embedding-v3` 计算用户消息与知识条目的向量，按余弦相似度取最高分条目。
- **触发条件**：关键词阶段未命中且 `KB_EMBEDDING_ENABLED` 为真（默认 `true`）。
- **验收标准**：
  - 模型名读取 `EMBEDDING_MODEL`，默认 `text-embedding-v3`。
  - 余弦相似度阈值读取 `KB_EMBEDDING_THRESHOLD`，默认 `0.6`；≥ 阈值视为命中。
  - 单次调用 3 秒超时；超时或调用失败视为未命中，回退 Agent。
  - 调用使用 `DASHSCOPE_API_KEY`，缺失时按失败处理并回退 Agent。
  - 知识条目向量在进程内缓存复用（按条目 id + 模型名缓存），不持久化到磁盘或向量库。
- **实现位置**：`backend/src/knowledge-base/embeddings.ts` · DashScope 调用与缓存；`backend/src/knowledge-base/retrieval.ts` · 两阶段编排

#### FR-RAG-004 · 命中即直出

- **描述**：检索命中后由服务端直接以 SSE 返回知识条目，不创建 Agent、不调用 LLM。
- **触发条件**：关键词或向量任一阶段命中。
- **验收标准**：
  - 事件顺序固定为 `rag-hit` → `text-delta` → `finish` → `done`。
  - `rag-hit` 的 data 为 `{ intent, stage, score, sources }`，其中 `sources` 为 `{ id, title }` 数组，字段均可缺省。
  - 不发起任何 LLM 请求；未配置 `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY` 也能正常返回。
  - 条目文本拼接后通过单个 `text-delta` 推送，随后发送 `finish` 与 `done`。
- **实现位置**：`backend/src/routes/chat.ts` · 前置检索分支与 SSE 事件；`backend/src/knowledge-base/retrieval.ts` · 命中结果组装

#### FR-RAG-005 · 未命中回退 Agent

- **描述**：两阶段均未命中或向量检索降级时，回退到原有 Agent + 工具流程。
- **触发条件**：关键词未达阈值，且 embedding 关闭 / 超时 / 调用失败 / 未达阈值。
- **验收标准**：
  - 回退后的事件与改动前一致：`text-delta` / `tool-call` / `tool-result` / `finish` / `done`。
  - 不发送 `rag-hit` 事件。
  - 模型 Key 校验、`maxSteps: 5`、工具集合保持不变。
  - embedding 异常只记录日志，不向客户端返回 `error`。
- **实现位置**：`backend/src/routes/chat.ts` · 回退分支

#### FR-RAG-006 · 检索可观测

- **描述**：检索过程留下事件与日志，便于判断命中来源与降级原因。
- **触发条件**：每次 `/api/chat` 请求。
- **验收标准**：
  - `rag-hit` 字段：`intent`（意图）、`stage`（命中阶段，取值 `keyword` / `embedding`）、`score`（命中得分）、`sources`（`{ id, title }[]` 来源条目）。
  - 日志三类：① 命中时打印 `[kb] hit`（意图、阶段、得分）；② 未命中时打印 `[kb] miss`（意图）；③ embedding 失败或超时时打印 `[kb] embedding fallback`（降级原因）。
  - 日志不输出 API Key 等敏感信息。
- **实现位置**：`backend/src/knowledge-base/retrieval.ts`、`backend/src/knowledge-base/embeddings.ts`、`backend/src/routes/chat.ts` · 日志输出

---

## 5. 非功能需求

#### NFR-001 · 密钥只在后端

- **描述**：所有 LLM API Key 只允许存在于 `backend/.env`，不得进入前端产物或仓库。
- **验收标准**：
  - 前端源码与 `.env*` 中不出现 `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY`。
  - Vite 只注入 `VITE_` 前缀变量，后端 Key 无法被前端读取。
  - `backend/.gitignore` 忽略 `.env`，仓库只保留 `.env.example` 占位值。
- **实现位置**：`backend/.env.example`、`backend/.gitignore`；`frontend/src/env.d.ts`

#### NFR-002 · 流式连接稳定性

- **描述**：长连接在代理与反向代理环境下不被提前断开或缓冲。
- **验收标准**：
  - 每 15 秒发送 `: ping` 注释行保活。
  - 响应头包含 `X-Accel-Buffering: no` 与 `Cache-Control: no-cache, no-transform`。
  - 请求结束的任意路径都会 `clearInterval` 并 `res.end()`。
- **实现位置**：`backend/src/routes/chat.ts` · `heartbeat`、响应头、`finally`

#### NFR-003 · 错误可观测性

- **描述**：服务端错误与工具调用必须留下可检索的日志。
- **验收标准**：
  - Agent 异常统一打印 `[chat] Agent 运行出错:` 加原始错误对象。
  - 每次工具执行打印 `[tool] <工具名>(<入参>)`，转人工额外打印工单号。
  - 启动时打印监听地址。
  - 当前无结构化日志、无请求 ID、无耗时统计，排障依赖 stdout。
- **实现位置**：`backend/src/routes/chat.ts` · `console.error`；`backend/src/agent/tools.ts` · 各 `execute`；`backend/src/index.ts` · `app.listen`

#### NFR-004 · 文档与代码一致性

- **描述**：需求、README、AGENTS.md 与源码保持同步，冲突时以源码为准。
- **验收标准**：
  - 事件名、工具名、环境变量名、端口、路径在各份文档与源码中完全一致。
  - 目录、命令、配置变化时同步更新文档；过期描述直接修正或删除。
  - 已知偏差必须在变更记录中登记，不允许长期沉默。
- **实现位置**：`README.md`、`AGENTS.md`、`docs/REQUIREMENTS.md`、`backend/README.md`、`frontend/README.md`

#### NFR-005 · 依赖版本对齐

- **描述**：AI SDK 4 只支持 provider specification v1，provider 主版本必须与 `ai` 对齐。
- **验收标准**：
  - 当前组合为 `ai@^4.1.10` + `@ai-sdk/deepseek@0.1.17` + `@ai-sdk/openai-compatible@^0.1.9`。
  - 不得安装 `@ai-sdk/deepseek@1.x`（spec v2），否则运行时报 `UnsupportedModelVersionError`。
  - 升级到 AI SDK 5 时必须同步改写 `maxSteps`、流事件字段与 `inputSchema`。
- **实现位置**：`backend/package.json` · `dependencies`；`backend/README.md` · 「约定与坑」

#### NFR-006 · 模块边界与纯逻辑分离

- **描述**：后端按职责分文件，纯计算与副作用隔离，对外只暴露 barrel。
- **验收标准**：
  - `agent/index.ts` 是 `agent/` 的唯一出口，路由层不直接引用内部文件。
  - `convert.ts` 为纯函数，不引入网络或环境依赖；`service.ts` 承担 provider 初始化与 LLM 调用等副作用。
  - `mock/orders.ts` 只做数据与格式化，不感知 HTTP。
- **实现位置**：`backend/src/agent/index.ts`、`backend/src/agent/convert.ts`、`backend/src/agent/service.ts`、`backend/src/mock/orders.ts`

#### NFR-007 · 文件规模与头注释

- **描述**：单个源码文件保持在可维护规模；超过 200 行的组件需在文件头说明职责。
- **验收标准**：
  - 当前最大文件为 `frontend/src/views/ChatView.vue`（276 行），低于 400 行阈值。
  - `ChatView.vue` 头部注释包含职责、依赖列表、关键函数位置与常见坑。
  - 新增代码不得把单文件推过 400 行（Vue 组件 500 行）。
- **实现位置**：`frontend/src/views/ChatView.vue` · 文件头 HTML 注释；`backend/src/agent/convert.ts` · 文件头注释

#### NFR-008 · 类型与代码质量

- **描述**：前后端均开启严格类型检查，并提供 lint / format 脚本。
- **验收标准**：
  - 后端 `tsconfig.json`：`strict: true`、`module/moduleResolution: NodeNext`。
  - 前端 `tsconfig.app.json`：`strict`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch` 均为 `true`。
  - 前端可通过 `npm run lint`（ESLint 9 flat config）与 `npm run format`（Prettier 3）统一风格。
- **实现位置**：`backend/tsconfig.json`；`frontend/tsconfig.app.json`；`frontend/eslint.config.js`；`frontend/.prettierrc.json`

---

## 6. 非目标

以下能力**当前明确不做**，任何新增需求都需先在第 7 节登记并评估。

| 编号 | 非目标 | 现状 |
|---|---|---|
| NG-01 | 用户鉴权 / 登录态 | 所有接口匿名可访问，无 token、无用户体系 |
| NG-02 | 会话持久化 | 消息仅存于 Pinia 内存，刷新即丢失；后端不保存会话 |
| NG-03 | 真实数据库 | 订单写死在 `mock/orders.ts`，无 SQL / ORM |
| NG-04 | 向量数据库 / 大规模向量检索 | 检索在进程内完成（关键词 + embedding 余弦相似度），无向量库、无索引持久化 |
| NG-05 | 多 Agent 协作 | 仅单个 `streamText` Agent，无 Agent 间委派 |
| NG-06 | 多轮工单系统 | 转人工只生成工单号与提示文案，无工单状态流转与查询接口 |
| NG-07 | 前端 UI 组件库 | 使用原生 HTML + scoped CSS，未引入 Element Plus / Ant Design 等 |
| NG-08 | 流式主动取消与重试 | 前端无 `AbortController`、无停止按钮、无失败重试逻辑 |

---

## 7. 待追加需求

新需求先登记到本表，评审通过后再进入第 4 章并分配正式 `FR-` 编号。

| 编号 | 需求名 | 提出日期 | 优先级 | 状态 |
|---|---|---|---|---|
| REQ-001 | （示例）订单查询接入真实数据库 | YYYY-MM-DD | P1 | 待评审 |

追加流程：

1. **登记**：在表格末尾追加一行，编号用 `REQ-<三位序号>`，填写需求名、提出日期、优先级（P0/P1/P2）与状态（待评审 / 已评审 / 已排期 / 已实现 / 已拒绝）。
2. **评审**：确认是否与第 6 节非目标冲突；若冲突需先修改非目标清单。
3. **转正**：进入开发前，在第 4 章对应子章节新增 `FR-<模块>-<序号>`，补齐描述、触发条件、验收标准、实现位置，并把本表该行状态改为「已排期」；上线后改为「已实现」。

---

## 8. 变更记录

| 日期 | 版本 | 变更内容 | 变更人 |
|---|---|---|---|
| 2026-11-25 | v1.1 | 新增意图识别与两阶段知识库检索（FR-RAG-001~006），命中时跳过 LLM | — |
