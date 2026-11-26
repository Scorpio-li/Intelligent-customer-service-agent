// similarity.test.ts — 余弦相似度纯函数测试
//
// 覆盖：
//   cosineSimilarity 数学性质：
//     - 自相似 = 1
//     - 正交向量 = 0
//     - 相反向量 ≈ -1
//     - 维度不一致 / 零向量 → 0 兜底
import { describe, it, expect } from 'vitest'
import { cosineSimilarity } from '../similarity.js'

describe('cosineSimilarity', () => {
  it('相同向量 → 1', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6)
  })

  it('自相似（任意非零向量对自己）→ 1', () => {
    const v = [0.1, -0.3, 0.7, 0.02]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6)
  })

  it('正交向量 → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6)
  })

  it('相反向量 → -1', () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 6)
  })

  it('维度不一致 → 0（兜底，不抛）', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
    expect(cosineSimilarity([1], [1, 2, 3, 4, 5])).toBe(0)
  })

  it('空向量 → 0', () => {
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity([1, 2], [])).toBe(0)
  })

  it('零向量 → 0（normA=0 兜底）', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0)
  })

  it('非零有限结果在 [-1, 1] 区间内', () => {
    // 10 对随机维度向量
    for (let d = 2; d <= 8; d += 2) {
      const a = Array.from({ length: d }, (_, i) => Math.sin(i * 0.3))
      const b = Array.from({ length: d }, (_, i) => Math.cos(i * 0.7))
      const s = cosineSimilarity(a, b)
      expect(s).toBeGreaterThanOrEqual(-1)
      expect(s).toBeLessThanOrEqual(1)
    }
  })
})
