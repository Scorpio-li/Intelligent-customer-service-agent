# 前端 · 智能客服界面

基于 Vue 3 + Vite + TypeScript 的智能客服前端。负责聊天界面渲染、SSE 流式消费与本地会话状态管理。

## 技术栈

| 依赖 | 版本 | 用途 |
|---|---|---|
| vue | ^3.5.13 | 框架 |
| vue-router | ^4.5.0 | 路由（history 模式） |
| pinia | ^2.3.0 | 状态管理 |
| vite | ^6.0.5 | 构建 / 开发服务器 |
| typescript | ~5.7.2 | 类型检查 |
| axios | ^1.7.9 | 通用 HTTP 客户端（聊天流式请求不使用） |
| eslint / prettier | 9 / 3 | 代码检查与格式化 |

## 目录结构

```
frontend/
├── index.html
├── vite.config.ts          # @ 别名、端口、/api 开发代理
├── tsconfig.json           # 项目引用入口（app + node）
├── tsconfig.app.json       # 应用代码 strict 检查
├── tsconfig.node.json      # vite.config.ts 的 Node 环境
├── eslint.config.js        # ESLint 9 flat config
├── .prettierrc.json
├── .env                    # 共享模板
├── .env.development        # 开发环境
├── .env.production         # 生产环境
└── src/
    ├── main.ts             # 入口：Pinia + Router
    ├── App.vue             # 仅 <RouterView />
    ├── env.d.ts            # 环境变量与 .vue 类型声明
    ├── router/index.ts     # 路由表 + 全局守卫（页面标题）
    ├── api/
    │   ├── index.ts        # axios 实例（通用请求用）
    │   └── chat.ts         # fetch + ReadableStream 消费 SSE
    ├── stores/
    │   ├── counter.ts      # 示例 store
    │   └── chat.ts         # 会话消息、模型选择、loading
    ├── utils/chat-format.ts # 纯函数：工具调用痕迹格式化
    ├── styles/base.css     # 全局基础样式
    └── views/
        ├── HomeView.vue    # /
        ├── ChatView.vue    # /chat 聊天页（276 行）
        ├── AboutView.vue   # /about
        └── NotFound.vue    # 404
```

## 路由

| 路径 | 组件 | 说明 |
|---|---|---|
| `/` | `HomeView.vue` | 首页 |
| `/chat` | `ChatView.vue` | 智能客服聊天 |
| `/about` | `AboutView.vue` | 关于 |
| `/:pathMatch(.*)*` | `NotFound.vue` | 404 |

所有页面组件均为懒加载。

## 脚本

```bash
npm run dev        # 开发服务器（默认 5173）
npm run build      # vue-tsc 类型检查 + vite 生产构建
npm run preview    # 预览构建产物
npm run lint       # ESLint 检查并自动修复
npm run format     # Prettier 格式化
```

## 环境变量

| 文件 | 变量 | 值 |
|---|---|---|
| `.env` | `VITE_PORT` | `5173` |
| `.env` | `VITE_API_BASE_URL` | `/api` |
| `.env.development` | `VITE_API_BASE_URL` | `http://localhost:3001` |
| `.env.production` | `VITE_API_BASE_URL` | `https://api.example.com`（占位，部署前替换） |

`vite.config.ts` 用 `loadEnv` 读取这些变量：`VITE_PORT` 决定开发端口，`VITE_API_BASE_URL` 作为 `/api` 代理目标。

## 聊天实现要点

1. `ChatView.vue` 的 `send()` 先把用户消息写入 store，再调用 `streamChat()`。
2. `api/chat.ts` 使用 **fetch 而非 axios**——axios 不支持 `ReadableStream`。
3. 请求地址为相对路径 `/api/chat`，开发时由 Vite 代理转发到后端，避免跨域。
4. SSE 逐块解析（以 `\n\n` 分块），按事件类型分发：
   - `text-delta` → `chat.appendDelta()` 追加文本
   - `tool-call` / `tool-result` → `chat.pushToolTrace()` 记录工具痕迹
   - `error` → `chat.finishStreaming(id, message)`
5. 流结束或异常时兜底调用 `finishStreaming()`，保证 `streaming` 状态被清除。

## 开发约定

- `@/` 指向 `src/`，在 `vite.config.ts` 与 `tsconfig.app.json` 中同步配置
- 聊天状态以 `stores/chat.ts` 为唯一数据源，组件不重复存消息
- 纯格式化逻辑放 `utils/`，组件内只做调用
- 页面组件超过 200 行需在文件头注释说明职责、依赖、关键函数位置

## 联调前提

后端需先运行在 `http://localhost:3001`，并在 `backend/.env` 中配置 API Key，否则聊天会收到 `error` 事件。
