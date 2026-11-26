// knowledge-base 模块统一出口：外部只允许从本文件导入
export { KNOWLEDGE_ENTRIES } from './data.js'
export { INTENT_KEYWORDS, classifyIntent } from './intent.js'
export { cosineSimilarity } from './similarity.js'
export { rankByBm25, tokenize } from './bm25.js'
export { rrfFuse } from './fusion.js'
export { rerankDocuments, rerankEnabled } from './rerank.js'
export { metricsSnapshot, resetMetrics } from './metrics.js'
export { embedTexts, getEmbeddingModel, getEntryEmbedding } from './embeddings.js'
export { retrieve } from './retrieval.js'
export {
  getEntries,
  getKnowledgeSource,
  initRepository,
  removeEntry,
  saveEntry,
  searchByVector,
  syncEntries
} from './repository.js'
export { collectionName, embeddingDim, ensureCollection, qdrantEnabled, recreateCollection } from './qdrant.js'
export { fromPayload, toPayload, toPointId } from './qdrant-payload.js'
export {
  VECTOR_INDEX_VERSION,
  buildIndexEntry,
  contentHash,
  embeddingText,
  findIndexedVector,
  parseVectorIndex
} from './vector-index.js'
export { loadVectorIndex, readIndexedVector, vectorIndexPath, writeVectorIndex } from './vector-store.js'
export type { EntryInput, KnowledgeSource } from './repository.js'
export type { VectorHit } from './qdrant.js'
export type { Bm25Hit } from './bm25.js'
export type { FusedHit } from './fusion.js'
export type { RerankHit } from './rerank.js'
export type { KnowledgePayload, StoredKnowledgeEntry } from './qdrant-payload.js'
export type { Intent, KnowledgeEntry, RetrievalResult, RetrievalScores, RetrievalStage } from './types.js'
export type { VectorIndexEntry, VectorIndexFile } from './vector-index.js'
