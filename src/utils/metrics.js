/**
 * 指标计算层 —— 口径集中定义，与数据来源解耦
 * 每个指标的计算公式见 README「指标口径表」
 */

/** 数值格式化 */
export function fmtMoney(v) {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿'
  if (v >= 1e4) return (v / 1e4).toFixed(1) + ' 万'
  return Math.round(v).toLocaleString('zh-CN')
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
 * 成本节约率 v1 口径（已废弃，仅保留作为口径修订的对照）
 * savings = Σ(品类均价 − 成交单价) × 数量；比率 = savings / 总金额
 *
 * ⚠️ 为什么废弃：品类均价本身就是这批订单算出的数量加权均价，代进去必然抵消：
 *      Σ(均价 − 单价ᵢ) × 数量ᵢ = 均价 × Σ数量ᵢ − Σ(单价ᵢ × 数量ᵢ) ≡ 0
 *    即「拿自己当基准量自己」。详见 README「口径 revision：节约率从 v1 到 v2」。
 * @deprecated 请使用 savingsRate()
 */
export function savingsRateV1(orders) {
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
 * 基准价来源（四级优先级，见 scripts/gen_data.py 的 attach_benchmarks）
 * 口径说明集中在此处定义，页面只做展示，不重复实现取数逻辑。
 */
export const BENCHMARK_SOURCES = [
  { key: 'contract_price', short: '①合同价', label: '年度框架合同价',
    desc: '年初与「品类 × 供应商」签订、全年固定不随行就市' },
  { key: 'last_deal_price', short: '②上次成交', label: '上次成交价（折算至本期行情）',
    desc: '同物料同供应商最近一次成交，按品类行情指数折算后可比' },
  { key: 'best_quote', short: '③当期询价', label: '当期询价(RFQ)最低有效报价',
    desc: '本期询价中的最低有效报价，衡量成交价与最优市场的差距' },
  { key: 'hist_avg_12m', short: '④滚动均价', label: '滚动 12 个月成交均价（折算至本期行情）',
    desc: '同物料同供应商近 12 个月的成交均价，样本 ≥3 笔启用' }
]

/** 覆盖率阈值：低于该值视为基准样本不足，直接显示「暂不可计算」，不给数字 */
export const MIN_COVERAGE = 0.6

/**
 * 成本节约率 v2 口径（现行）
 *   节约额 = Σ(基准单价ᵢ − 成交单价ᵢ) × 数量ᵢ                （仅计有基准价的订单）
 *   节约率 = 节约额 / Σ(基准单价ᵢ × 数量ᵢ)                    （分母用基准口径总额）
 *
 * 与 v1 的本质区别：基准价取自本合同价 / 历史成交 / 当期询价等**独立于被评估订单**
 * 的参照，不与被评估订单构成同一求和项，因此代数上不会抵消。
 *
 * 无基准价的订单不参与计算、也不补默认值 —— 宁可少算，不可假算。
 * @returns {{savings:number, benchmarkTotal:number, rate:number, covered:number,
 *            uncovered:number, total:number, coverage:number, computable:boolean,
 *            threshold:number, bySource:Array}}
 */
export function savingsRate(orders) {
  const covered = orders.filter(o => o.benchmarkPrice != null)
  let benchmarkTotal = 0, savings = 0
  const src = new Map()
  for (const o of covered) {
    const base = o.benchmarkPrice * o.qty
    const save = (o.benchmarkPrice - o.unitPrice) * o.qty
    benchmarkTotal += base
    savings += save
    const e = src.get(o.benchmarkSource) || { orders: 0, benchmarkTotal: 0, savings: 0 }
    e.orders += 1; e.benchmarkTotal += base; e.savings += save
    src.set(o.benchmarkSource, e)
  }
  const bySource = BENCHMARK_SOURCES
    .map(s => {
      const e = src.get(s.key)
      return e ? {
        ...s, orders: e.orders,
        benchmarkTotal: e.benchmarkTotal,
        savings: e.savings,
        rate: e.benchmarkTotal ? 100 * e.savings / e.benchmarkTotal : 0
      } : null
    })
    .filter(Boolean)

  const total = orders.length
  const coverage = total ? covered.length / total : 0
  return {
    savings,
    benchmarkTotal,
    rate: benchmarkTotal ? 100 * savings / benchmarkTotal : 0,
    covered: covered.length,
    uncovered: total - covered.length,
    total,
    coverage,                                  // 0~1 基准覆盖率（按订单笔数）
    computable: coverage >= MIN_COVERAGE,      // 覆盖率不足时页面应显示「暂不可计算」
    threshold: MIN_COVERAGE,
    bySource
  }
}

/**
 * OTD 拖累归因：每个供应商「逾期订单数 / 全量订单数」对整体 OTD 的百分点拖累。
 * 口径：整体 OTD = 100% − Σ(各供应商逾期单数 / 总单数)，故单项拖累可加和、可排序。
 * @returns {Array<{supplierId, supplierName, orders, lateOrders, dragPt}>} 按拖累降序
 */
export function otdDragBySupplier(orders) {
  const n = orders.length
  if (!n) return []
  const map = new Map()
  for (const o of orders) {
    const e = map.get(o.supplierId) || { supplierId: o.supplierId, supplierName: o.supplierName, orders: 0, lateOrders: 0 }
    e.orders += 1
    if (!o.onTime) e.lateOrders += 1
    map.set(o.supplierId, e)
  }
  return [...map.values()]
    .map(e => ({ ...e, dragPt: 100 * e.lateOrders / n }))
    .sort((a, b) => b.dragPt - a.dragPt)
}

/** OTD 目标差距（百分点）：目标值 − 实际值，正数表示未达标 */
export function otdGap(orders, target = 90) {
  return target - otd(orders)
}

/** 单供应商逐月 OTD 趋势序列 */
export function supplierOtdTrend(orders, supplierId) {
  return groupByMonth(orders.filter(o => o.supplierId === supplierId))
    .map(m => ({ month: m.month, otd: 100 * m.onTime / m.count, count: m.count, amount: m.amount }))
}

/** 单供应商近期表现：近 n 个月 vs 基线，及逾期订单的金额影响 */
export function supplierRecentDrop(orders, supplierId, recentMonths = 3) {
  const list = orders.filter(o => o.supplierId === supplierId)
  if (!list.length) return null
  const months = [...new Set(orders.map(o => o.month))].sort()
  const from = months[months.length - recentMonths]
  const base = list.filter(o => o.month < from)
  const recent = list.filter(o => o.month >= from)
  const lateRecent = recent.filter(o => !o.onTime)
  return {
    supplierName: list[0].supplierName,
    supplierId,
    from, months: recentMonths,
    baseOtd: base.length ? otd(base) : null,
    recentOtd: recent.length ? otd(recent) : null,
    recentOrders: recent.length,
    lateOrders: lateRecent.length,
    impactAmount: lateRecent.reduce((s, o) => s + o.amount, 0)
  }
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
