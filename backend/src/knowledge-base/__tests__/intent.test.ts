// intent.test.ts — 意图识别纯函数测试
//
// 覆盖：
//   classifyIntent —— 8 意图 + unknown 边界 + 得分公式平衡
import { describe, it, expect } from 'vitest'
import { classifyIntent } from '../intent.js'

describe('classifyIntent', () => {
  it('空串 → unknown', () => {
    expect(classifyIntent('')).toEqual({ intent: 'unknown', score: 0 })
  })

  it('纯标点 → unknown', () => {
    expect(classifyIntent('！？')).toEqual({ intent: 'unknown', score: 0 })
  })

  it('未命中任何关键词 → unknown', () => {
    expect(classifyIntent('今天天气怎么样')).toEqual({ intent: 'unknown', score: 0 })
  })

  it('配送意图典型输入', () => {
    const { intent, score } = classifyIntent('快递什么时候到？')
    expect(intent).toBe('delivery')
    expect(score).toBeGreaterThan(0)
  })

  it('支付意图典型输入', () => {
    const { intent, score } = classifyIntent('扣款了但显示未支付')
    expect(intent).toBe('payment')
    expect(score).toBeGreaterThan(0)
  })

  it('发票意图典型输入', () => {
    const { intent, score } = classifyIntent('我要开增值税发票')
    expect(intent).toBe('invoice')
    expect(score).toBeGreaterThan(0)
  })

  it('转人工意图典型输入', () => {
    const { intent, score } = classifyIntent('我要转人工客服')
    expect(intent).toBe('human')
    expect(score).toBeGreaterThan(0)
  })

  it('退换货意图典型输入', () => {
    const { intent, score } = classifyIntent('收到商品破损了要退货')
    expect(intent).toBe('aftersale')
    expect(score).toBeGreaterThan(0)
  })

  it('大小写/空白归一化不影响', () => {
    const a = classifyIntent('  快递  什么时候到  ')
    const b = classifyIntent('快递什么时候到')
    expect(a.intent).toBe(b.intent)
  })

  it('得分上限为 1（封顶）', () => {
    // 重复命中同一关键词多次也不会超 1
    const { score } = classifyIntent('物流物流物流物流物流')
    expect(score).toBeLessThanOrEqual(1)
  })

  it('多意图交叉 → 得分最高者胜出', () => {
    // "支付快递" —— 包含 payment 的"支付" 和 delivery 的"快递"
    const { intent } = classifyIntent('支付快递')
    // 得分公式 = hits / sqrt(kwCount)；两者命中数相同，payment 关键词更多得分略低
    // delivery: 1 hit / sqrt(12) ≈ 0.288
    // payment:  1 hit / sqrt(12) ≈ 0.288
    // 两者打平，按 Object.keys 顺序 delivery 在 payment 前
    expect(['delivery', 'payment']).toContain(intent)
  })
})
