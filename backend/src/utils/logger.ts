// utils/logger.ts —— 结构化日志（debug 包）
//
// 设计决策：
//   用 debug 包而不是 pino / winston —— 项目体量小，4KB 足够；
//   生产环境要 JSON 格式可以未来无痛切 pino（API 近似）。
//
// 使用：
//   DEBUG=app:* pnpm dev          打开全部模块 debug
//   DEBUG=app:kb pnpm dev         只看知识库模块
//   DEBUG=app:agent,app:tool ... 多模块
//
// 模块命名空间（与知识图谱 graph.layers 对应）：
//   app:kb       → knowledge-base/ 混合检索 + 数据层
//   app:agent    → agent/ 对话层
//   app:tool     → tools.ts 工具执行痕迹
//   app:chat     → routes/chat.ts SSE 流
//   app:kb-admin → routes/kb.ts 热更新 / 删除
//   app:server   → index.ts 启动
//
// 分级：
//   info   → debug 包 info 级别（带冒号分隔，开发友好）
//   warn   → console.warn 兜底（始终可见，warn 信息必须人工关注）
//   error  → console.error 兜底（始终可见，错误不可丢）
//
// 注意：debug 输出到 stderr，且只有 DEBUG=* 设置时才生效。
// 未设置 DEBUG 时所有 info 调用是零成本（debug 内部短路 return）。
import createDebug from 'debug';

// 各模块的 debug 实例
export const log = {
  /** knowledge-base/ 模块（混合检索 + 数据层） */
  kb: createDebug('app:kb'),
  /** agent/ 模块（对话 + 流式） */
  agent: createDebug('app:agent'),
  /** tools.ts 工具执行痕迹 */
  tool: createDebug('app:tool'),
  /** routes/chat.ts SSE 流 */
  chat: createDebug('app:chat'),
  /** routes/kb.ts 管理接口 */
  kbAdmin: createDebug('app:kb-admin'),
  /** index.ts 启动 */
  server: createDebug('app:server'),

  /** warn：始终输出，用 console.warn（不能丢） */
  warn(message: string, err?: unknown): void {
    const suffix = err ? `: ${formatErr(err)}` : '';
    console.warn(`[warn] ${message}${suffix}`);
  },

  /** error：始终输出，用 console.error（不能丢） */
  error(message: string, err?: unknown): void {
    const suffix = err ? `: ${formatErr(err)}` : '';
    console.error(`[error] ${message}${suffix}`);
  },
};

/** 从 Error 对象里拿到可读消息；非 Error 对象兜底 JSON.stringify */
function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
