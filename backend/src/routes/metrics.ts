// 检索引擎监控：召回率代理指标、分阶段延迟、embedding/rerank 成本估算
import { Router } from 'express'
import { metricsSnapshot } from '../knowledge-base/index.js'

const router = Router()

router.get('/', (_req, res) => {
  res.json(metricsSnapshot())
})

export default router
