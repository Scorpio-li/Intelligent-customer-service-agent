// vector-index.test.ts — 离线向量索引纯逻辑测试
//
// 覆盖：
//   parseVectorIndex —— 版本/模型/维度/entries 结构校验
//   findIndexedVector —— 模型匹配 + 内容指纹一致
//   contentHash —— title/keywords/content 任一变化 → hash 变化
//   embeddingText —— 拼接规则一致性
import { describe, it, expect } from 'vitest'
import {
  parseVectorIndex,
  findIndexedVector,
  contentHash,
  embeddingText,
  buildIndexEntry,
  VECTOR_INDEX_VERSION
} from '../vector-index.js'
import type { VectorIndexFile } from '../vector-index.js'
import type { KnowledgeEntry } from '../types.js'

const makeEntry = (
  id: string,
  title: string,
  keywords: string[],
  content: string
): KnowledgeEntry => ({
  id,
  title,
  intent: 'delivery',
  keywords,
  content,
  updatedAt: '2026-01-01T00:00:00.000Z'
})

const makeIndex = (model = 'text-embedding-v3', dim = 4) => {
  const entry = makeEntry('KB-DELIVERY-01', '配送时效', ['物流', '快递'], '全国 3-5 天到货')
  return {
    version: VECTOR_INDEX_VERSION,
    model,
    dim,
    createdAt: '2026-01-01T00:00:00.000Z',
    entries: {
      [entry.id]: buildIndexEntry(entry, [1, 0, 0, 0])
    }
  } satisfies VectorIndexFile
}

describe('embeddingText', () => {
  it('拼接规则：title + keywords.join + content，\\n 分隔', () => {
    const entry = makeEntry('e1', '配送时效', ['物流', '快递'], '3-5 天')
    expect(embeddingText(entry)).toBe('配送时效\n物流 快递\n3-5 天')
  })
})

describe('contentHash', () => {
  it('相同条目 → 相同 hash', () => {
    const a = makeEntry('e1', '配送时效', ['物流'], '3-5 天')
    const b = makeEntry('e1', '配送时效', ['物流'], '3-5 天')
    expect(contentHash(a)).toBe(contentHash(b))
  })

  it('title 变化 → hash 变化', () => {
    const a = makeEntry('e1', '配送时效', ['物流'], '3-5 天')
    const b = makeEntry('e1', '物流时效', ['物流'], '3-5 天')
    expect(contentHash(a)).not.toBe(contentHash(b))
  })

  it('keywords 变化 → hash 变化', () => {
    const a = makeEntry('e1', '配送时效', ['物流'], '3-5 天')
    const b = makeEntry('e1', '配送时效', ['快递'], '3-5 天')
    expect(contentHash(a)).not.toBe(contentHash(b))
  })

  it('content 变化 → hash 变化', () => {
    const a = makeEntry('e1', '配送时效', ['物流'], '3-5 天')
    const b = makeEntry('e1', '配送时效', ['物流'], '2-3 天')
    expect(contentHash(a)).not.toBe(contentHash(b))
  })

  it('hash 是 64 位 hex（sha256）', () => {
    const entry = makeEntry('e1', '配送时效', ['物流'], '3-5 天')
    const h = contentHash(entry)
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })
})

describe('parseVectorIndex', () => {
  const validIndex = makeIndex()

  it('结构正确 → 返回合法 VectorIndexFile', () => {
    const parsed = parseVectorIndex(validIndex)
    expect(parsed).not.toBeNull()
    expect(parsed!.version).toBe(VECTOR_INDEX_VERSION)
    expect(parsed!.model).toBe('text-embedding-v3')
  })

  it('null → null', () => {
    expect(parseVectorIndex(null)).toBeNull()
  })

  it('版本不匹配 → null', () => {
    expect(parseVectorIndex({ ...validIndex, version: 999 })).toBeNull()
  })

  it('model 非字符串 → null', () => {
    expect(parseVectorIndex({ ...validIndex, model: 123 })).toBeNull()
  })

  it('entries 非对象 → null', () => {
    expect(parseVectorIndex({ ...validIndex, entries: null })).toBeNull()
  })

  it('vector 长度 ≠ dim → null', () => {
    const badEntry = { hash: 'abc', vector: [1, 2] }
    const bad = { ...validIndex, entries: { 'KB-DELIVERY-01': badEntry } }
    expect(parseVectorIndex(bad)).toBeNull()
  })

  it('vector 含 NaN → null', () => {
    const bad = { ...validIndex, entries: { x: { hash: 'h', vector: [1, NaN, 3, 4] } } }
    expect(parseVectorIndex(bad)).toBeNull()
  })
})

describe('findIndexedVector', () => {
  const index = makeIndex()
  const entry = makeEntry('KB-DELIVERY-01', '配送时效', ['物流', '快递'], '全国 3-5 天到货')

  it('模型一致 + hash 一致 → 命中向量', () => {
    const v = findIndexedVector(entry, index, 'text-embedding-v3')
    expect(v).toEqual([1, 0, 0, 0])
  })

  it('模型不一致 → null（防混用不同 embedding 模型产出的向量）', () => {
    const v = findIndexedVector(entry, index, 'text-embedding-v2')
    expect(v).toBeNull()
  })

  it('index 为 null → null', () => {
    const v = findIndexedVector(entry, null, 'text-embedding-v3')
    expect(v).toBeNull()
  })

  it('hash 不一致（条目已改） → null（防过期向量）', () => {
    const changed = makeEntry('KB-DELIVERY-01', '配送时效', ['物流'], '内容变了')
    const v = findIndexedVector(changed, index, 'text-embedding-v3')
    expect(v).toBeNull()
  })

  it('index 不含该 entryId → null', () => {
    const missing = makeEntry('KB-DELIVERY-99', '其他', ['其他'], '其他')
    const v = findIndexedVector(missing, index, 'text-embedding-v3')
    expect(v).toBeNull()
  })
})
