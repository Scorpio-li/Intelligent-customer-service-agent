// 离线构建向量索引：知识条目 → 批量向量化 → 写入本地 JSON
// 用法：npm run build:index（需要 DASHSCOPE_API_KEY）
import 'dotenv/config'
import {
  KNOWLEDGE_ENTRIES,
  VECTOR_INDEX_VERSION,
  buildIndexEntry,
  embeddingText,
  embedTexts,
  writeVectorIndex,
  type VectorIndexEntry
} from '../src/knowledge-base/index.js'

// DashScope text-embedding-v3 单次最多 10 条输入
const BATCH_SIZE = 10

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

async function main(): Promise<void> {
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-v3'
  const vectors: number[][] = []

  for (const batch of chunk(KNOWLEDGE_ENTRIES, BATCH_SIZE)) {
    vectors.push(...(await embedTexts(batch.map(embeddingText))))
  }

  const entries: Record<string, VectorIndexEntry> = {}
  KNOWLEDGE_ENTRIES.forEach((entry, i) => {
    entries[entry.id] = buildIndexEntry(entry, vectors[i])
  })

  const file = await writeVectorIndex({
    version: VECTOR_INDEX_VERSION,
    model,
    dim: vectors[0]?.length ?? 0,
    createdAt: new Date().toISOString(),
    entries
  })

  console.log(`[kb] 向量索引已写入：${KNOWLEDGE_ENTRIES.length} 条，dim=${vectors[0]?.length ?? 0}，model=${model}`)
  console.log(`[kb] 文件路径：${file}`)
}

main().catch((err) => {
  console.error('[kb] 构建向量索引失败:', err)
  process.exitCode = 1
})
