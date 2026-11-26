// 纯函数：BM25 稀疏召回。中文按字 bigram 切分，ASCII 连续串整体成词
import type { KnowledgeEntry } from './types.js'

const K1 = 1.5
const B = 0.75
// 字段加权：关键词 > 标题 > 正文，用重复 token 实现
const TITLE_WEIGHT = 2
const KEYWORD_WEIGHT = 3

export interface Bm25Hit {
  entry: KnowledgeEntry
  score: number
}

// 标点/空白作分隔；中文串取相邻两字组成 bigram，单字串保留自身
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const normalized = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ')

  for (const chunk of normalized.split(' ')) {
    if (!chunk) continue
    if (!/[\u4e00-\u9fff]/.test(chunk)) {
      tokens.push(chunk)
      continue
    }
    const chars = [...chunk]
    if (chars.length === 1) {
      tokens.push(chunk)
      continue
    }
    for (let i = 0; i < chars.length - 1; i += 1) tokens.push(chars[i] + chars[i + 1])
  }

  return tokens
}

function repeat(tokens: string[], times: number): string[] {
  const out: string[] = []
  for (let i = 0; i < times; i += 1) out.push(...tokens)
  return out
}

function documentTokens(entry: KnowledgeEntry): string[] {
  return [
    ...repeat(tokenize(entry.title), TITLE_WEIGHT),
    ...repeat(tokenize(entry.keywords.join(' ')), KEYWORD_WEIGHT),
    ...tokenize(entry.content)
  ]
}

export function rankByBm25(query: string, entries: KnowledgeEntry[], limit = 10): Bm25Hit[] {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0 || entries.length === 0) return []

  const docs = entries.map(documentTokens)
  const totalLen = docs.reduce((sum, tokens) => sum + tokens.length, 0)
  const avgLen = totalLen > 0 ? totalLen / docs.length : 1

  // 文档频率：每篇文档内 token 去重后计数
  const df = new Map<string, number>()
  for (const tokens of docs) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1)
  }

  const N = docs.length
  const hits: Bm25Hit[] = []

  entries.forEach((entry, i) => {
    const tokens = docs[i]
    const len = tokens.length
    const tf = new Map<string, number>()
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)

    let score = 0
    for (const token of queryTokens) {
      const freq = tf.get(token)
      if (!freq) continue
      const n = df.get(token) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += idf * ((freq * (K1 + 1)) / (freq + K1 * (1 - B + (B * len) / avgLen)))
    }

    if (score > 0) hits.push({ entry, score })
  })

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
