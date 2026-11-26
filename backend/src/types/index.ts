// backend/src/types/index.ts — 前后端共享 DTO（数据传输对象）
//
// 两类：
//   1. Order / OrderItem  → mock/orders.ts 的返回值格式，Agent 工具 queryOrder 使用
//   2. ChatRole / ChatMessage / ChatRequest → /api/chat 接口的请求体格式
//
// 注意：这里是纯接口定义，没有运行时校验。入站参数的合法性由
// routes/chat.ts 的 Express 中间件和 AI SDK 自行处理。

/** 订单明细：一件 SKU 的数量与单价 */
export interface OrderItem {
  name: string
  sku: string
  quantity: number
  price: number
}

/** 订单头：queryOrder 工具返回的完整订单信息 */
export interface Order {
  orderId: string
  customer: string
  items: OrderItem[]
  total: number
  status: 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'returning'
  createdAt: string
  shippedAt?: string
  trackingNumber?: string
}

/** 聊天消息角色，覆盖前端 → AI SDK → 后端 Agent 三层 */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

/**
 * 聊天消息。
 *   role=assistant + toolCalls  → AI 输出的"我要调用工具 X，参数是 Y"
 *   role=tool                    → 工具执行完的结果（tool_call_id 关联到哪次 toolCalls）
 */
export interface ChatMessage {
  role: ChatRole
  content: string
  tool_call_id?: string
  toolCalls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

/** /api/chat 请求体 */
export interface ChatRequest {
  /** 模型选择；不传默认 deepseek */
  model?: 'deepseek' | 'qwen'
  /** 完整会话历史（前端把 messages 全量传来，后端不做持久化） */
  messages: ChatMessage[]
}
