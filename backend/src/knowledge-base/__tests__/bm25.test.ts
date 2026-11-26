// bm25.test.ts — BM25 稀疏召回纯函数测试
//
// 覆盖：
//   tokenize      —— 中文 bigram、ASCII 整词、空串/标点边界
//   rankByBm25    —— 基本打分、关键词/标题权重、空输入
import { describe, it, expect } from 'vitest'
import { tokenize, rankByBm25 } from '../bm25.js'
import type { KnowledgeEntry } from '../types.js'

const makeEntry = (title: string, keywords: string[], content: string): KnowledgeEntry => ({
  id: 'KB-TEST-01',
  title,
  intent: 'delivery',
  keywords,
  content,
  updatedAt: '2026-01-01T00:00:00.000Z'
})

describe('tokenize', () => {
  it('中文连续串 → 相邻两字 bigram', () => {
    expect(tokenize('配送时效')).toEqual(['配送', '送时', '时效'])
  })

  it('单字 → 保留自身', () => {
    expect(tokenize('快')).toEqual(['快'])
  })

  it('ASCII 连续串 → 整词', () => {
    expect(tokenize('tracking number')).toEqual(['tracking', 'number'])
  })

  it('空串 → 空数组', () => {
    expect(tokenize('')).toEqual([])
  })

  it('纯标点/空白 → 空数组', () => {
    expect(tokenize('  ！？— —  ')).toEqual([])
  })

  it('混合中英文 → 中文取 bigram，英文整词', () => {
    const toks = tokenize('物流单号 tracking NO')
    expect(toks).toContain('物流')
    expect(toks).toContain('流单')
    expect(toks).toContain('单号')
    expect(toks).toContain('tracking')
    expect(toks).toContain('no')
  })
})

describe('rankByBm25', () => {
  const docs: KnowledgeEntry[] = [
    makeEntry('配送时效说明', ['物流', '快递'], '全国一般 3-5 天到货'),
    makeEntry('退换货政策', ['退换货', '七天无理由'], '服装支持七天无理由退换'),
    makeEntry('支付问题', ['支付失败', '扣款'], '支付宝支付失败可联系客服')
  ]

  it('空 query → 空数组', () => {
    expect(rankByBm25('', docs)).toEqual([])
  })

  it('空 entries → 空数组', () => {
    expect(rankByBm25('物流', [])).toEqual([])
  })

  it('命中关键词的条目分更高', () => {
    const hits = rankByBm25('物流快递', docs)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].entry.title).toBe('配送时效说明')
    expect(hits[0].score).toBeGreaterThan(0)
  })

  it('标题命中 > 正文命中（TITLE_WEIGHT=2）', () => {
    // title 含关键词 vs 仅 content 含关键词
    const docs2: KnowledgeEntry[] = [
      makeEntry('物流说明', ['物流'], '这里讲物流时效'),           // title + kw 都有"物流"
      makeEntry('其他内容', ['其他'], '这里也讲物流但只有正文命中') // 只有 content 有"物流"
    ]
    const hits = rankByBm25('物流', docs2)
    expect(hits[0].entry.title).toBe('物流说明')
  })

  it('limit 生效', () => {
    const hits = rankByBm25('物流快递支付', docs, 2)
    expect(hits.length).toBeLessThanOrEqual(2)
  })

  it('分数降序', () => {
    const hits = rankByBm25('物流快递支付', docs)
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score)
    }
  })

  it('分数非负（BM25 原始分可能为 0，不会负）', () => {
    const hits = rankByBm25('物流快递支付', docs)
    for (const h of hits) expect(h.score).toBeGreaterThanOrEqual(0)
  })
})
