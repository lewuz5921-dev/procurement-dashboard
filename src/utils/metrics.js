/**
 * 指标计算层 —— 口径集中定义，与数据来源解耦
 * 每个指标的计算公式见 README「指标口径表」
 */

/** 数值格式化 */
export function fmtMoney(v) {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿'
  if (v >= 1e4) return (v / 1e4).toFixed(1) + ' 万'
  return v.toFixed(0)
}
export function fmtPct(v, digits = 1) { return v.toFixed(digits) + '%' }

/** 按月聚合 */
export function groupByMonth(orders) {
  const map = new Map()
  for (const o of orders) {
    if (!map.has(o.month)) map.set(o.month, { month: o.month, amount: 0, count: 0, onTime: 0, delayDays: [] })
    const m = map.get(o.month)
    m.amount += o.amount
    m.count += 1
    if (o.onTime) m.onTime += 1
    m.delayDays.push(o.actualLeadDays - o.leadDays)
  }
  return [...map.values()].sort((a, b) => a.month < b.month ? -1 : 1)
}

/** OTD 准时交付率 = 按时到达订单数 / 总订单数 × 100% */
export function otd(orders) {
  if (!orders.length) return 0
  return 100 * orders.filter(o => o.onTime).length / orders.length
}

/** 验收合格率 */
export function qualityRate(orders) {
  if (!orders.length) return 0
  return 100 * orders.filter(o => o.qualityPass).length / orders.length
}

/** 平均交付周期（天） */
export function avgLeadTime(orders) {
  if (!orders.length) return 0
  return orders.reduce((s, o) => s + o.actualLeadDays, 0) / orders.length
}

/** 品类结构：金额与占比 */
export function categoryBreakdown(orders) {
  const map = new Map()
  for (const o of orders) map.set(o.category, (map.get(o.category) || 0) + o.amount)
  const total = [...map.values()].reduce((a, b) => a + b, 0)
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount, pct: 100 * amount / total }))
    .sort((a, b) => b.amount - a.amount)
}

/** 供应商帕累托（金额降序 + 累计占比） */
export function supplierPareto(orders) {
  const map = new Map()
  for (const o of orders) {
    const e = map.get(o.supplierId) || { supplierId: o.supplierId, name: o.supplierName, amount: 0, orders: 0 }
    e.amount += o.amount; e.orders += 1
    map.set(o.supplierId, e)
  }
  const total = [...map.values()].reduce((s, e) => s + e.amount, 0)
  let cum = 0
  return [...map.values()]
    .sort((a, b) => b.amount - a.amount)
    .map(e => { cum += e.amount; return { ...e, cumPct: 100 * cum / total } })
}

/**
 * 成本节约率（模拟口径）：
 * 同品类订单按品类均价与实际成交价之差衡量议价能力
 * savings = Σ(品类均价 - 成交单价) × 数量；比率 = savings / 总金额
 */
export function savingsRate(orders) {
  const cat = new Map()
  for (const o of orders) {
    if (!cat.has(o.category)) cat.set(o.category, [])
    cat.get(o.category).push(o)
  }
  let savings = 0, total = 0
  for (const list of cat.values()) {
    const avg = list.reduce((s, o) => s + o.unitPrice, 0) / list.length
    for (const o of list) savings += (avg - o.unitPrice) * o.qty
    total += list.reduce((s, o) => s + o.amount, 0)
  }
  return { savings: Math.max(savings, 0), rate: total ? 100 * savings / total : 0 }
}

/**
 * TCO 全生命周期成本（单位成本口径）：
 * TCO = 单价 × (1 + 运输费率 + 质量损失率 + 交易管理费率)
 */
export function tco(unitPrice, factors) {
  const mult = 1 + factors.transportRate + factors.qualityLossRate + factors.adminRate
  return unitPrice * mult
}

/** 品类内供应商单价统计（均值/标准差） */
export function categoryPriceStats(orders) {
  const map = new Map()
  for (const o of orders) {
    if (!map.has(o.category)) map.set(o.category, [])
    map.get(o.category).push(o)
  }
  const stats = {}
  for (const [cat, list] of map) {
    const prices = list.map(o => o.unitPrice)
    const mu = prices.reduce((a, b) => a + b, 0) / prices.length
    const sd = Math.sqrt(prices.reduce((s, p) => s + (p - mu) ** 2, 0) / prices.length)
    stats[cat] = { mean: mu, sd, n: list.length }
  }
  return stats
}
