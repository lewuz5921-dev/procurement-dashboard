/**
 * 规则引擎 —— 异常检测与归因（可解释、可配置）
 * 设计原则：确定性规则优先，LLM 仅作为表述层（本 demo 预置文案），
 * 保证每条预警都能追溯到明确的触发条件。
 */
import { otd, categoryPriceStats, supplierPareto, tco } from './metrics'

export const RULES = [
  { id: 'R1', name: 'OTD 连续下滑', short: '履约下滑', desc: '供应商近 3 个月 OTD 较前 9 个月基线下降超过 20 个百分点' },
  { id: 'R2', name: '报价离群', short: '报价离群', desc: '供应商成交均价高于同品类其他供应商均值 2 个标准差以上（留一法口径，剔除自身样本）' },
  { id: 'R3', name: '单一供应商依赖', short: '单一依赖', desc: '单一供应商占品类采购额超过 60%，存在断供风险' },
  { id: 'R4', name: '低价高 TCO', short: '低价高 TCO', desc: '供应商单价低于品类均价 15%，但 TCO 高于品类 TCO 均值' }
]

/**
 * 风险分级依据（与代码实现严格一致，页面同步披露）
 * 注意：等级表示「规则内的处置优先级」。各规则触发量纲不同
 * （百分点 / 集中度 / 标准差 / TCO），因此不做跨规则的统一数值排序。
 */
export const LEVEL_BASIS = [
  { rule: 'R1', level: 'high', cond: '近 3 个月 OTD < 40%' },
  { rule: 'R1', level: 'medium', cond: '近 3 个月 OTD ≥ 40%' },
  { rule: 'R2', level: 'medium', cond: '命中即中风险（成交均价 > 同品类其他供应商 +2σ）' },
  { rule: 'R3', level: 'high', cond: '命中即高风险（品类集中度 > 60%）' },
  { rule: 'R4', level: 'medium', cond: '命中即中风险（单价 < 品类均价 85% 且 TCO 高于品类均值）' }
]

/**
 * 「影响金额」的口径：各规则量纲不同，仅用于同等级内排序，不跨规则比较
 */
export const IMPACT_BASIS = [
  { rule: 'R1', desc: '近 3 个月逾期订单的金额合计' },
  { rule: 'R2', desc: '（成交均价 − 同品类其他供应商均价）× 已采购数量' },
  { rule: 'R3', desc: '该供应商在该品类的采购额（断供敞口）' },
  { rule: 'R4', desc: '（TCO − 品类 TCO 均值）× 已采购数量' }
]

/**
 * R1 归因分型：按顺序匹配，命中即停止（避免条件重叠时无法确定类型）
 * 1 断崖型    —— 近 3 月 OTD < 40%，交付接近中断
 * 2 高位回落型 —— 基线 OTD ≥ 95% 且近 3 月 OTD ≥ 50%
 * 3 渐进型    —— 下降 20–40pt 且近 3 月 OTD ≥ 50%
 * 4 观察型    —— 其余（下降幅度大但未达断崖，或样本形态混合）
 */
export const DROP_TYPES = [
  { key: 'cliff', name: '断崖型', cond: '近 3 个月 OTD < 40%' },
  { key: 'highfall', name: '高位回落型', cond: '基线 OTD ≥ 95% 且近 3 个月 OTD ≥ 50%' },
  { key: 'gradual', name: '渐进型', cond: '下降 20–40pt 且近 3 个月 OTD ≥ 50%' },
  { key: 'watch', name: '观察型', cond: '其他（不满足以上三类）' }
]

function classifyDrop(b, r, d) {
  if (r < 40) return DROP_TYPES[0]
  if (b >= 95 && r >= 50) return DROP_TYPES[1]
  if (d >= 20 && d <= 40 && r >= 50) return DROP_TYPES[2]
  return DROP_TYPES[3]
}

/** 归因文案：同类型共用模板，但每条都嵌入该供应商的实际数值，最终文本不会逐字相同 */
function dropAttribution(type, { name, b, r, d, baseN, recentN, lateN, gap, alt }) {
  const base = `OTD 由基线 ${b.toFixed(1)}% 降至近 3 个月 ${r.toFixed(1)}%（−${d.toFixed(1)}pt，近期 ${recentN} 单中 ${lateN} 单未准时）。`
  switch (type.key) {
    case 'cliff':
      return `${base}判定为「交付中断」：${r.toFixed(1)}% 的准时率已不具备正常履约能力，性质不同于渐进劣化。` +
        `建议：① 本周内核查在手订单交付状态与产能占用；② 立即启动备选供应商切换${alt ? `（同品类备选：${alt}）` : ''}；③ 未交付订单按产线齐套优先级排序催交。`
    case 'highfall':
      return `${base}基线 ${b.toFixed(1)}% 属高位，回落更可能来自新增订单超载，而非产能持续恶化。` +
        `建议：① 核查近 3 个月订单量是否激增（基线样本 ${baseN} 单）；② 若确为增量超载，按增量份额分配至备选供应商${alt ? `（${alt}）` : ''}，保留原有份额结构。`
    case 'gradual':
      return `${base}呈渐进劣化，未见突发中断，${r.toFixed(1)}% 低于 90% 目标 ${gap.toFixed(1)}pt。` +
        `建议：① 核查产能利用率与排产计划，确认是否为季节性波动；② 设定月度回升目标并纳入月度复盘，暂不启动供应商切换。`
    default:
      return `${base}下降幅度 ${d.toFixed(1)}pt，形态介于渐进与断崖之间。` +
        `建议：按周跟踪 OTD 走势，再确认是趋势性下滑还是单月波动后决定处置力度。`
  }
}

/**
 * R1: OTD 骤降检测
 * 基线 = 前 9 个月 OTD；近期 = 最近 3 个月 OTD；下降 > 20pp 触发
 */
export function detectOtdDrop(orders, allOrders, suppliers = []) {
  const months = [...new Set(allOrders.map(o => o.month))].sort()
  if (months.length < 6) return []
  const recentFrom = months[months.length - 3]
  const results = []
  const bySupplier = new Map()
  for (const o of allOrders) {
    if (!bySupplier.has(o.supplierId)) bySupplier.set(o.supplierId, { name: o.supplierName, list: [] })
    bySupplier.get(o.supplierId).list.push(o)
  }
  for (const [sid, { name, list }] of bySupplier) {
    const base = list.filter(o => o.month < recentFrom)
    const recent = list.filter(o => o.month >= recentFrom)
    if (base.length < 5 || recent.length < 3) continue
    const b = otd(base), r = otd(recent)
    const d = b - r
    if (d > 20) {
      const lateN = recent.filter(o => !o.onTime).length
      const impactAmount = recent.filter(o => !o.onTime).reduce((s, o) => s + o.amount, 0)
      const sup = suppliers.find(s => s.id === sid)
      const alt = sup
        ? suppliers
            .filter(s => s.category === sup.category && s.id !== sid)
            .sort((a, b2) => (b2.scores?.delivery || 0) - (a.scores?.delivery || 0))
            .slice(0, 2)
            .map(s => s.name)
            .join(' / ')
        : ''
      const type = classifyDrop(b, r, d)
      results.push({
        rule: 'R1', level: r < 40 ? 'high' : 'medium', supplierId: sid, supplierName: name,
        dropType: type.name,
        impactAmount,
        detail: `基线 OTD ${b.toFixed(1)}% → 近3个月 ${r.toFixed(1)}%，下降 ${d.toFixed(1)} 个百分点（${type.name}）`,
        attribution: dropAttribution(type, {
          name, b, r, d, baseN: base.length, recentN: recent.length,
          lateN, gap: Math.max(0, 90 - r), alt
        })
      })
    }
  }
  return results
}

/**
 * R2: 报价离群检测（品类均值 ± 2σ）
 *
 * ⚠️ 口径说明（留一法）：计算品类均值与标准差时必须剔除**候选供应商自身**的订单。
 * 若把离群供应商自己算进 σ，它会把自己的离群"洗白"——实测鑫源材料（A12）
 * 在含自身口径下仅 +1.50σ（不触发），改用留一法后为 +2.57σ（触发），
 * 与 README 记载的 2.6σ 一致。规则代码必须与对外声明的口径严格一致。
 */
export function detectPriceOutlier(orders) {
  const bySup = new Map()
  for (const o of orders) {
    if (!bySup.has(o.supplierId)) bySup.set(o.supplierId, { name: o.supplierName, category: o.category, list: [] })
    bySup.get(o.supplierId).list.push(o)
  }
  const results = []
  for (const [sid, { name, category, list }] of bySup) {
    if (list.length < 5) continue
    // 留一法：同品类其他供应商的成交价作为基准样本
    const others = orders.filter(o => o.category === category && o.supplierId !== sid).map(o => o.unitPrice)
    if (others.length < 5) continue
    const mu = others.reduce((a, b) => a + b, 0) / others.length
    const sd = Math.sqrt(others.reduce((s, p) => s + (p - mu) ** 2, 0) / others.length)
    if (!sd) continue
    const avg = list.reduce((s, o) => s + o.unitPrice, 0) / list.length
    const z = (avg - mu) / sd
    if (z > 2) {
      const qty = list.reduce((s, o) => s + o.qty, 0)
      results.push({
        rule: 'R2', level: 'medium', supplierId: sid, supplierName: name,
        impactAmount: (avg - mu) * qty,
        detail: `${category}品类其他供应商均价 ¥${mu.toFixed(1)}，该供应商成交均价 ¥${avg.toFixed(1)}（+${z.toFixed(1)}σ，留一法口径）`,
        attribution: `溢价幅度 ${(((avg - mu) / mu) * 100).toFixed(1)}%，按已采购 ${qty.toLocaleString()} 件折算，多支出约 ¥${Math.round((avg - mu) * qty).toLocaleString()}。` +
          `建议：纳入比价清单重新招标，或以量换价谈判阶梯折扣；比价时同步核对规格与账期，排除口径差异导致的假性溢价。`
      })
    }
  }
  return results
}

/**
 * R3: 单一供应商依赖（品类集中度）
 */
export function detectSingleDependency(orders) {
  const catMap = new Map()
  for (const o of orders) {
    if (!catMap.has(o.category)) catMap.set(o.category, [])
    catMap.get(o.category).push(o)
  }
  const results = []
  for (const [cat, list] of catMap) {
    const pareto = supplierPareto(list)
    const top = pareto[0]
    if (top && top.cumPct > 60) {
      results.push({
        rule: 'R3', level: 'high', supplierName: top.name,
        impactAmount: top.amount,
        detail: `${cat}品类 ¥${(top.amount / 1e4).toFixed(1)}万 采购额中，${top.name} 占 ${top.cumPct.toFixed(1)}%`,
        attribution: `集中度 ${top.cumPct.toFixed(1)}% 已超过 60% 阈值，涉及年化采购额 ¥${(top.amount / 1e4).toFixed(1)}万，一旦断供将直接影响该品类齐套。` +
          `建议：培育 1-2 家备选供应商（先分配 15%-20% 份额），将集中度降至 50% 以下；切换前先确认模具/认证等转移成本。`
      })
    }
  }
  return results
}

/**
 * R4: 低价高 TCO 识别（打破“单价最低”直觉）
 */
export function detectLowPriceHighTco(orders, suppliers) {
  const stats = categoryPriceStats(orders)
  // 品类 TCO 均值
  const catTco = new Map()
  for (const o of orders) {
    const sup = suppliers.find(s => s.id === o.supplierId)
    if (!sup) continue
    if (!catTco.has(o.category)) catTco.set(o.category, [])
    catTco.get(o.category).push(tco(o.unitPrice, sup.tcoFactors))
  }
  const catTcoMean = {}
  for (const [cat, list] of catTco) catTcoMean[cat] = list.reduce((a, b) => a + b, 0) / list.length
  // 供应商均价
  const bySup = new Map()
  for (const o of orders) {
    if (!bySup.has(o.supplierId)) bySup.set(o.supplierId, { name: o.supplierName, category: o.category, list: [] })
    bySup.get(o.supplierId).list.push(o)
  }
  const results = []
  for (const [sid, { name, category, list }] of bySup) {
    const st = stats[category]
    if (!st || list.length < 5) continue
    const avg = list.reduce((s, o) => s + o.unitPrice, 0) / list.length
    const sup = suppliers.find(s => s.id === sid)
    if (avg < st.mean * 0.85 && sup) {
      const myTco = tco(avg, sup.tcoFactors)
      if (myTco > catTcoMean[category]) {
        const qty = list.reduce((s, o) => s + o.qty, 0)
        results.push({
          rule: 'R4', level: 'medium', supplierId: sid, supplierName: name,
          impactAmount: (myTco - catTcoMean[category]) * qty,
          detail: `单价低于品类均价 ${((1 - avg / st.mean) * 100).toFixed(0)}%，但 TCO ¥${myTco.toFixed(0)} 高于品类 TCO 均值 ¥${catTcoMean[category].toFixed(0)}`,
          attribution: `低价来自隐性成本转移：运输费率 ${(sup.tcoFactors.transportRate * 100).toFixed(0)}%、质量损失率 ${(sup.tcoFactors.qualityLossRate * 100).toFixed(0)}%，` +
            `按 ${qty.toLocaleString()} 件折算，实际多付约 ¥${Math.round((myTco - catTcoMean[category]) * qty).toLocaleString()}。` +
            `建议：不应以单价作为唯一比价维度，按 TCO 重新评标后决策。`
        })
      }
    }
  }
  return results
}

const LEVEL_ORDER = { high: 0, medium: 1, low: 2 }

/** 执行全部规则；输出按「风险等级降序 → 影响金额降序」排序 */
export function runAllRules(orders, suppliers) {
  const list = [
    ...detectOtdDrop(orders, orders, suppliers),
    ...detectPriceOutlier(orders),
    ...detectSingleDependency(orders),
    ...detectLowPriceHighTco(orders, suppliers)
  ]
  return list.sort((a, b) =>
    (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) ||
    (b.impactAmount || 0) - (a.impactAmount || 0)
  )
}
