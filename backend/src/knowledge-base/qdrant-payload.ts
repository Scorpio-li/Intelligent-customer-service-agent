// 纯逻辑：知识条目 ↔ Qdrant point 的映射（确定性 point id、payload 编解码）
import { createHash } from 'node:crypto'
import type { Intent, KnowledgeEntry } from './types.js'
import { contentHash } from './vector-index.js'

export interface KnowledgePayload {
  entry_id: string
  title: string
  intent: Intent
  keywords: string[]
  content: string
  updated_at: string
  model_version: string
  hash: string
}

export interface StoredKnowledgeEntry extends KnowledgeEntry {
  modelVersion: string
}

// Qdrant 只接受 uint64 / UUID：业务 id 经 sha256 派生为确定性 UUID，可直接 upsert / 删除
export function toPointId(entryId: string): string {
  const chars = createHash('sha256').update(entryId).digest('hex').slice(0, 32).split('')
  chars[12] = '5'
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16)
  return [
    chars.slice(0, 8).join(''),
    chars.slice(8, 12).join(''),
    chars.slice(12, 16).join(''),
    chars.slice(16, 20).join(''),
    chars.slice(20).join('')
  ].join('-')
}

export function toPayload(entry: KnowledgeEntry, model: string): KnowledgePayload {
  return {
    entry_id: entry.id,
    title: entry.title,
    intent: entry.intent,
    keywords: [...entry.keywords],
    content: entry.content,
    updated_at: entry.updatedAt,
    model_version: model,
    hash: contentHash(entry)
  }
}

// payload 结构不符（历史脏数据 / 手工改库）时返回 null，由调用方跳过该点
export function fromPayload(raw: unknown): StoredKnowledgeEntry | null {
  if (!raw || typeof raw !== 'object') return null

  const payload = raw as Partial<KnowledgePayload>
  if (typeof payload.entry_id !== 'string' || typeof payload.title !== 'string') return null
  if (typeof payload.intent !== 'string' || typeof payload.content !== 'string') return null
  if (!Array.isArray(payload.keywords) || payload.keywords.some((kw) => typeof kw !== 'string')) return null

  return {
    id: payload.entry_id,
    title: payload.title,
    intent: payload.intent as Intent,
    keywords: payload.keywords as string[],
    content: payload.content,
    updatedAt: typeof payload.updated_at === 'string' ? payload.updated_at : '',
    modelVersion: typeof payload.model_version === 'string' ? payload.model_version : ''
  }
}
