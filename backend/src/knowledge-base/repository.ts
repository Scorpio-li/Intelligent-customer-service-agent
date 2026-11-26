// 副作用：知识条目数据源——Qdrant 为权威存储，进程内快照缓存（TTL + 写后失效），不可用时降级本地种子
import { KNOWLEDGE_ENTRIES } from './data.js'
import { embedTexts, getEmbeddingModel } from './embeddings.js'
import { deleteEntryPoint, countPoints, ensureCollection, qdrantEnabled, scrollEntries, searchEntries, upsertEntries, type VectorHit } from './qdrant.js'
import type { StoredKnowledgeEntry } from './qdrant-payload.js'
import type { Intent, KnowledgeEntry } from './types.js'
import { embeddingText } from './vector-index.js'

export type KnowledgeSource = 'qdrant' | 'local'

export interface EntryInput {
  title: string
  intent: Intent
  keywords: string[]
  content: string
}

const DEFAULT_CACHE_TTL_MS = 30_000

let source: KnowledgeSource = qdrantEnabled() ? 'qdrant' : 'local'
let snapshot: StoredKnowledgeEntry[] | null = null
let loadedAt = 0

function cacheTtl(): number {
  const raw = Number(process.env.KB_CACHE_TTL_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CACHE_TTL_MS
}

function localEntries(): StoredKnowledgeEntry[] {
  const model = getEmbeddingModel()
  return KNOWLEDGE_ENTRIES.map((entry) => ({ ...entry, modelVersion: model }))
}

export function getKnowledgeSource(): KnowledgeSource {
  return source
}

function invalidateSnapshot(): void {
  snapshot = null
  loadedAt = 0
}

// 启动时建 collection；collection 为空自动导入种子，Qdrant 不可用则整库降级本地种子
export async function initRepository(): Promise<void> {
  if (!qdrantEnabled()) {
    source = 'local'
    console.log('[kb] KB_VECTOR_STORE=local，使用本地种子 + 离线索引')
    return
  }

  try {
    await ensureCollection()
    if ((await countPoints()) === 0) {
      const count = await syncEntries(KNOWLEDGE_ENTRIES)
      console.log(`[kb] Qdrant collection 为空，已写入 ${count} 条种子条目`)
    }
    snapshot = await scrollEntries()
    loadedAt = Date.now()
    source = 'qdrant'
    console.log(`[kb] Qdrant 就绪：${snapshot.length} 条条目 @ ${process.env.QDRANT_URL || 'http://localhost:6333'}`)
  } catch (err) {
    source = 'local'
    console.warn('[kb] Qdrant 初始化失败，降级本地种子 + 离线索引:', err)
  }
}

export async function getEntries(): Promise<StoredKnowledgeEntry[]> {
  if (source === 'local') return localEntries()

  if (snapshot && Date.now() - loadedAt < cacheTtl()) return snapshot

  try {
    snapshot = await scrollEntries()
    loadedAt = Date.now()
    return snapshot
  } catch (err) {
    console.warn('[kb] Qdrant 读取失败，本轮使用本地种子:', err)
    return localEntries()
  }
}

// 批量写入：种子导入、模型切换后重建、管理接口热更新都走这里
export async function syncEntries(entries: KnowledgeEntry[]): Promise<number> {
  const model = getEmbeddingModel()
  const vectors = await embedTexts(entries.map(embeddingText))
  await upsertEntries(
    entries.map((entry, i) => ({ entry, vector: vectors[i] })),
    model
  )
  invalidateSnapshot()
  return entries.length
}

export async function saveEntry(id: string, input: EntryInput): Promise<KnowledgeEntry> {
  assertWritable()
  const entry: KnowledgeEntry = { id, ...input, updatedAt: new Date().toISOString() }
  await syncEntries([entry])
  return entry
}

export async function removeEntry(id: string): Promise<void> {
  assertWritable()
  await deleteEntryPoint(id)
  invalidateSnapshot()
}

// 向量检索：返回 null 表示 Qdrant 不可用（调用方回退本地索引），空数组表示无命中
export async function searchByVector(queryVector: number[], intent: Intent, limit = 5): Promise<VectorHit[] | null> {
  if (source === 'local' || !qdrantEnabled()) return null

  try {
    return await searchEntries(queryVector, { intent, modelVersion: getEmbeddingModel() }, limit)
  } catch (err) {
    console.warn('[kb] Qdrant 向量检索失败，降级本地索引:', err)
    return null
  }
}

function assertWritable(): void {
  if (source === 'local') {
    throw new Error('当前为本地种子模式（Qdrant 不可用），无法写入；请检查 QDRANT_URL / QDRANT_API_KEY')
  }
}
