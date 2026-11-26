// 副作用：离线向量索引的本地 JSON 持久化（读写文件 + 模块级单次加载）
import { log } from '../utils/logger.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { KnowledgeEntry } from './types.js'
import { findIndexedVector, parseVectorIndex, type VectorIndexFile } from './vector-index.js'

const DEFAULT_INDEX_FILE = 'data/vector-index.json'

export function vectorIndexPath(): string {
  return resolve(process.env.VECTOR_INDEX_PATH || DEFAULT_INDEX_FILE)
}

let indexPromise: Promise<VectorIndexFile | null> | null = null

// 每个进程只读一次磁盘；文件缺失或格式非法返回 null，由调用方回退实时向量化
export function loadVectorIndex(): Promise<VectorIndexFile | null> {
  if (!indexPromise) {
    indexPromise = readFile(vectorIndexPath(), 'utf8')
      .then((text) => parseVectorIndex(JSON.parse(text)))
      .catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') log.warn('向量索引加载失败，回退实时向量化', err)
        return null
      })
  }
  return indexPromise
}

export async function readIndexedVector(entry: KnowledgeEntry, model: string): Promise<number[] | null> {
  return findIndexedVector(entry, await loadVectorIndex(), model)
}

// 写入索引并同步进程内缓存，供构建脚本调用
export async function writeVectorIndex(index: VectorIndexFile): Promise<string> {
  const file = vectorIndexPath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(index)}\n`, 'utf8')
  indexPromise = Promise.resolve(index)
  return file
}
