// fusion.test.ts — RRF 融合纯函数测试
//
// 覆盖：
//   rrfFuse 数学性质：
//     - 单路召回 → 分数 = 1/(k+rank)，等价于不退化
//     - 双路召回同一 item → 分数累加
//     - k→∞ 时所有 rank 差异趋同（flat）
import { describe, it, expect } from 'vitest'
import { rrfFuse } from '../fusion.js'

describe('rrfFuse', () => {
  it('空 lists → 空结果', () => {
    expect(rrfFuse<string>([], (x) => x)).toEqual([])
  })

  it('单路召回 → 分数 = 1/(k+rank)，按 rank 降序', () => {
    const hits = rrfFuse<string>([['a', 'b', 'c']], (x) => x, 60)
    expect(hits).toEqual([
      { item: 'a', score: 1 / 61, rank: 1 },
      { item: 'b', score: 1 / 62, rank: 2 },
      { item: 'c', score: 1 / 63, rank: 3 }
    ])
  })

  it('双路同一 item → 分数累加，rank 取较小者', () => {
    const hits = rrfFuse([['a', 'b'], ['b', 'c']], (x) => x, 60)
    // b 在第一路 rank=2，第二路 rank=1
    const b = hits.find((h) => h.item === 'b')!
    expect(b.score).toBeCloseTo(1 / 62 + 1 / 61, 6)
    expect(b.rank).toBe(1) // min(2,1) = 1

    // a 只在第一路 rank=1
    const a = hits.find((h) => h.item === 'a')!
    expect(a.score).toBeCloseTo(1 / 61, 6)
  })

  it('多路完全相同 → 分数 = N / (k+rank)', () => {
    const hits = rrfFuse([['a', 'b'], ['a', 'b'], ['a', 'b']], (x) => x, 60)
    const a = hits.find((h) => h.item === 'a')!
    expect(a.score).toBeCloseTo(3 / 61, 6)
  })

  it('k 越大，名次差异越平（flat）', () => {
    const smallK = rrfFuse([['a', 'b', 'c']], (x) => x, 1)
    const bigK = rrfFuse([['a', 'b', 'c']], (x) => x, 10000)
    // smallK 时 a 比 c 领先很多
    const smallDiff = smallK[0].score - smallK[2].score
    // bigK 时 a 比 c 领先很少
    const bigDiff = bigK[0].score - bigK[2].score
    expect(smallDiff).toBeGreaterThan(bigDiff)
  })

  it('分数降序', () => {
    const hits = rrfFuse([['x', 'y', 'z'], ['y', 'w']], (x) => x, 60)
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score)
    }
  })

  it('空路 → 不影响', () => {
    const hits = rrfFuse([[], ['a', 'b']], (x) => x, 60)
    expect(hits.length).toBe(2)
    expect(hits[0].item).toBe('a')
  })
})
