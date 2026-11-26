// mock/orders.ts — 模拟订单数据库（静态对象）
//
// 对外只暴露一个函数：queryOrder(orderId) → 格式化后的订单详情字符串。
// Agent 工具 tools.ts 的 queryOrder.execute 直接调用它，返回值拼进 messages。
//
// 真实替换方案：
//   把 queryOrder() 内部换成 SQL/ORM 查询即可，函数对外签名不变。
//   statusMap、itemList 拼接逻辑可保留（作为返回格式约定）。
//
// 当前 Mock 数据（3 条）：
//   SO20241125001 → 张先生，shipped，有快递单号 SF1234567890123
//   SO20241124003 → 李女士，delivered，YT9876543210987
//   SO20241122017 → 王先生，pending，无物流信息
import type { Order } from '../types/index.js'

// Mock 订单数据库 —— 真实环境这里换成 DB 查询
const orders: Record<string, Order> = {
  SO20241125001: {
    orderId: 'SO20241125001',
    customer: '张先生',
    items: [
      { name: '纯棉T恤 白色 XL', sku: 'TS-WHT-XL', quantity: 2, price: 128 },
      { name: '牛仔裤 32码', sku: 'JN-BLU-32', quantity: 1, price: 299 }
    ],
    total: 555,
    status: 'shipped',
    createdAt: '2024-11-24 10:23:45',
    shippedAt: '2024-11-25 09:12:00',
    trackingNumber: 'SF1234567890123'
  },
  SO20241124003: {
    orderId: 'SO20241124003',
    customer: '李女士',
    items: [
      { name: '无线耳机 Pro', sku: 'HP-PRO-BLK', quantity: 1, price: 799 }
    ],
    total: 799,
    status: 'delivered',
    createdAt: '2024-11-23 14:05:12',
    shippedAt: '2024-11-23 18:30:00',
    trackingNumber: 'YT9876543210987'
  },
  SO20241122017: {
    orderId: 'SO20241122017',
    customer: '王先生',
    items: [
      { name: '机械键盘 青轴', sku: 'KB-MEC-BLU', quantity: 1, price: 459 }
    ],
    total: 459,
    status: 'pending',
    createdAt: '2024-11-25 08:47:33'
  }
}

export function queryOrder(orderId: string): string {
  const order = orders[orderId.trim()]
  if (!order) {
    return `抱歉，未找到订单号 "${orderId}"。请确认订单号是否正确（格式示例：SO20241125001）。`
  }

  const statusMap: Record<Order['status'], string> = {
    pending: '待付款',
    paid: '已付款',
    shipped: '已发货',
    delivered: '已签收',
    cancelled: '已取消',
    returning: '退货中'
  }

  const itemList = order.items
    .map((it) => `  - ${it.name} × ${it.quantity}（¥${it.price}）`)
    .join('\n')

  let result = `订单 ${order.orderId} 详情：
客户：${order.customer}
状态：${statusMap[order.status]}
下单时间：${order.createdAt}
商品：
${itemList}
合计：¥${order.total}`

  if (order.status === 'shipped' || order.status === 'delivered') {
    result += `
发货时间：${order.shippedAt}
快递单号：${order.trackingNumber}（可在对应快递官网查询）`
  }

  return result
}
