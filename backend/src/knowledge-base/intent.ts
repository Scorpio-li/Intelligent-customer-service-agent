// 纯函数意图识别：仅做关键词统计，禁止网络调用 / 读取环境变量
import type { Intent } from './types.js'

type KnownIntent = Exclude<Intent, 'unknown'>

export const INTENT_KEYWORDS: Record<KnownIntent, string[]> = {
  delivery: ['物流', '快递', '发货', '到货', '配送', '运费', '包邮', '签收', '物流单号', '什么时候到', '多久到', '送到'],
  payment: ['支付', '付款', '支付失败', '扣款', '未到账', '支付宝', '微信支付', '银行卡', '花呗', '重复扣款', '付不了', '扣了钱'],
  invoice: ['发票', '开票', '报销凭证', '增值税', '抬头', '税号', '电子发票', '专票', '普票', '票据', '单据', '报销', '开具发票'],
  membership: ['会员', '等级', '积分', '权益', '升级', '会员卡', '成长值', '会员折扣', '积分兑换', '会员价', 'vip'],
  coupon: ['优惠券', '券', '满减', '折扣券', '优惠码', '抵扣', '用不了', '过期', '叠加', '优惠', '代金券'],
  account: ['账号', '账户', '登录', '注册', '密码', '手机号', '验证码', '实名', '注销', '换绑', '登不上', '改绑'],
  aftersale: ['退换货', '退货', '换货', '退款', '售后', '质量问题', '破损', '少发', '漏发', '七天无理由', '退', '坏了', '不好用', '有瑕疵'],
  human: ['人工', '转人工', '客服', '真人', '电话', '投诉', '工单', '人工服务', '联系你们', '找你们']
}

const INTENT_ORDER = Object.keys(INTENT_KEYWORDS) as KnownIntent[]

function normalize(text: string): string {
  return text.trim().toLowerCase()
}

// 得分 = 命中关键词数 / √(该意图关键词总数)，封顶 1，用于平衡各意图关键词数量差异
export function classifyIntent(text: string): { intent: Intent; score: number } {
  const q = normalize(text)
  if (!q) return { intent: 'unknown', score: 0 }

  let bestIntent: Intent = 'unknown'
  let bestScore = 0

  for (const intent of INTENT_ORDER) {
    const keywords = INTENT_KEYWORDS[intent]
    const hits = keywords.filter((kw) => q.includes(normalize(kw))).length
    if (hits === 0) continue

    const score = Math.min(1, hits / Math.sqrt(keywords.length))
    if (score > bestScore) {
      bestScore = score
      bestIntent = intent
    }
  }

  if (bestScore === 0) return { intent: 'unknown', score: 0 }
  return { intent: bestIntent, score: Math.round(bestScore * 1000) / 1000 }
}
