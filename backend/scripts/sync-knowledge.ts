// 全量同步种子条目到 Qdrant：首次导入、切换 embedding 模型或重建 collection 后执行
// 用法：npm run kb:sync              增量 upsert 种子条目
//       npm run kb:sync -- --recreate  删除 collection 后重建并写入
import 'dotenv/config'
import { KNOWLEDGE_ENTRIES, ensureCollection, recreateCollection, syncEntries } from '../src/knowledge-base/index.js'

async function main(): Promise<void> {
  const recreate = process.argv.includes('--recreate')

  if (recreate) {
    console.log('[kb] 重建 Qdrant collection')
    await recreateCollection()
  } else {
    await ensureCollection()
  }

  const count = await syncEntries(KNOWLEDGE_ENTRIES)
  console.log(`[kb] 已同步 ${count} 条种子条目到 Qdrant`)
}

main().catch((err) => {
  console.error('[kb] 同步失败:', err)
  process.exitCode = 1
})
