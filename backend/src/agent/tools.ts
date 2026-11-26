// agent/tools.ts — Agent 可用工具定义（tool() + zod schema + execute）
//
// 每个工具由三部分组成：
//   description  → 给 LLM 的调用时机提示（LLM 看这个决定何时调用）
//   parameters   → zod schema，校验 LLM 生成的参数 JSON
//   execute      → 实际执行逻辑；纯 mock 数据或业务接口，无网络调用
//
// 新增工具 checklist：
//   1. 这里追加 tool() 定义
//   2. 无需改 service.ts 注册 — Vercel AI SDK 的 tools 对象直接喂给 streamText()
//   3. 建议在 prompt.ts 里给 AI 加一句调用时机提示
import { tool } from 'ai'
import { z } from 'zod'
import { log } from '../utils/logger.js'
import { queryOrder } from '../mock/orders.js'
import { getReturnPolicy } from './knowledge.js'

export const tools = {
  queryOrder: tool({
    description: '根据订单号查询订单的完整信息，包括商品、金额、当前状态、快递单号等',
    parameters: z.object({
      orderId: z
        .string()
        .describe('订单号，格式如 SO20241125001，必须由用户提供')
    }),
    execute: async ({ orderId }) => {
      const result = queryOrder(orderId)
      log.tool('queryOrder(%s)', orderId)
      return result
    }
  }),

  askReturnPolicy: tool({
    description: '查询某类商品的退换货政策、期限和注意事项',
    parameters: z.object({
      productType: z
        .string()
        .describe('商品类别，可选：服装、数码、食品；不确定时用"默认"')
    }),
    execute: async ({ productType }) => {
      const result = getReturnPolicy(productType)
      log.tool('askReturnPolicy(%s)', productType)
      return result
    }
  }),

  transferToHuman: tool({
    description: '将用户转接给人工客服，返回工单编号',
    parameters: z.object({
      reason: z.string().describe('转接原因，例如"用户要求人工服务"、"AI未能解决问题"')
    }),
    execute: async ({ reason }) => {
      const ticketId = 'TK' + Date.now().toString().slice(-8)
      log.tool('transferToHuman(%s) → %s', reason, ticketId)
      return {
        ticketId,
        estimatedWaitTime: '5 分钟',
        reason,
        message: `已为您创建人工服务工单 ${ticketId}，预计 5 分钟内有专员联系您。请保持手机畅通。`
      }
    }
  })
}

export type AgentTools = typeof tools
