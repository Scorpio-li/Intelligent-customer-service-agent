// 知识条目管理接口：列表 / 热更新 / 删除；写操作即时向量化入库并失效快照缓存
import { Router } from 'express'
import { z } from 'zod'
import { getEmbeddingModel, getEntries, getKnowledgeSource, removeEntry, saveEntry } from '../knowledge-base/index.js'

const INTENTS = ['delivery', 'payment', 'invoice', 'membership', 'coupon', 'account', 'aftersale', 'human'] as const

const entrySchema = z.object({
  title: z.string().min(1),
  intent: z.enum(INTENTS),
  keywords: z.array(z.string().min(1)).min(1),
  content: z.string().min(1)
})

const router = Router()

// 配置 KB_ADMIN_TOKEN 后要求 Bearer 鉴权；未配置视为仅内网可用
router.use((req, res, next) => {
  const token = process.env.KB_ADMIN_TOKEN
  if (!token || req.headers.authorization === `Bearer ${token}`) {
    next()
    return
  }
  res.status(401).json({ error: '未授权' })
})

router.get('/', async (_req, res) => {
  const entries = await getEntries()
  res.json({
    source: getKnowledgeSource(),
    modelVersion: getEmbeddingModel(),
    count: entries.length,
    entries
  })
})

router.put('/:id', async (req, res) => {
  const parsed = entrySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '参数不合法', detail: parsed.error.flatten() })
    return
  }

  try {
    const entry = await saveEntry(req.params.id, parsed.data)
    console.log('[kb] 热更新条目', entry.id)
    res.json({ ok: true, entry })
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : '写入失败' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await removeEntry(req.params.id)
    console.log('[kb] 删除条目', req.params.id)
    res.json({ ok: true, id: req.params.id })
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : '删除失败' })
  }
})

export default router
