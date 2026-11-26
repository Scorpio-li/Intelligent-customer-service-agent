// 纯逻辑：离线向量索引的文件结构、条目指纹与有效性校验（不含任何 IO）
import { createHash } from 'node:crypto'
import type { KnowledgeEntry } from './types.js'

// 结构变更时自增；运行时读到不匹配版本即判定失效，回退实时向量化
export const VECTOR_INDEX_VERSION = 1

export interface VectorIndexEntry {
  hash: string
  vector: number[]
}

export interface VectorIndexFile {
  version: number
  model: string
  dim: number
  createdAt: string
  entries: Record<string, VectorIndexEntry>
}

// 参与向量化的文本：构建索引与运行时查询必须使用同一拼接规则
export function embeddingText(entry: KnowledgeEntry): string {
  return `${entry.title}\n${entry.keywords.join(' ')}\n${entry.content}`
}

// 条目指纹：title / keywords / content 任一变化都会让旧向量自动失效
export function contentHash(entry: KnowledgeEntry): string {
  return createHash('sha256').update(embeddingText(entry)).digest('hex')
}

export function buildIndexEntry(entry: KnowledgeEntry, vector: number[]): VectorIndexEntry {
  return { hash: contentHash(entry), vector }
}

// 校验读入的 JSON：结构、版本、维度任一不符即整体不可用
export function parseVectorIndex(raw: unknown): VectorIndexFile | null {
  if (!raw || typeof raw !== 'object') return null

  const candidate = raw as Partial<VectorIndexFile>
  if (candidate.version !== VECTOR_INDEX_VERSION) return null
  if (typeof candidate.model !== 'string' || typeof candidate.dim !== 'number') return null
  if (!candidate.entries || typeof candidate.entries !== 'object') return null

  const entries: Record<string, VectorIndexEntry> = {}
  for (const [id, value] of Object.entries(candidate.entries)) {
    const item = value as Partial<VectorIndexEntry> | undefined
    if (!item || typeof item.hash !== 'string' || !Array.isArray(item.vector)) return null
    if (item.vector.length !== candidate.dim) return null
    if (item.vector.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null
    entries[id] = { hash: item.hash, vector: item.vector as number[] }
  }

  return {
    version: candidate.version,
    model: candidate.model,
    dim: candidate.dim,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
    entries
  }
}

// 命中条件：模型一致 + 条目存在 + 内容指纹一致（防止知识条目已改但向量过期）
export function findIndexedVector(
  entry: KnowledgeEntry,
  index: VectorIndexFile | null,
  model: string
): number[] | null {
  if (!index || index.model !== model) return null

  const item = index.entries[entry.id]
  if (!item || item.hash !== contentHash(entry)) return null

  return item.vector
}
