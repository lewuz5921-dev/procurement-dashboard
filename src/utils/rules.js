/**
 * 规则引擎 —— 异常检测与归因（可解释、可配置）
 * 设计原则：确定性规则优先，LLM 仅作为表述层（本 demo 预置文案），
 * 保证每条预警都能追溯到明确的触发条件。
 */
import { otd, categoryPriceStats, supplierPareto, tco } from './metrics'

export const RULES = [
  { id: 'R1', name: 'OTD 连续下滑', desc: '供应商近 3 个月 OTD 较前 9 个月基线下降超过 20 个百分点' },
  { id: 'R2', name: '报价离群', desc: '供应商成交均价高于品类均值 2 个标准差以上' },
  { id: 'R3', name: '单一供应商依赖', desc: '单一供应商占品类采购额超过 60%，存在断供风险' },
  { id: 'R4', name: '低价高 TCO', desc: '供应商单价低于品类均价 15%，但 TCO 高于品类 TCO 均值' }
]

/**
 * R1: OTD 骤降检测
 * 基线 = 前 9 个月 OTD；近期 = 最近 3 个月 OTD；下降 > 20pp 触发
 */
export function detectOtdDrop(orders, allOrders) {
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
    if (b - r > 20) {
      results.push({
        rule: 'R1', level: r < 40 ? 'high' : 'medium', supplierId: sid, supplierName: name,
        detail: `基线 OTD ${b.toFixed(1)}% → 近3个月 ${r.toFixed(1)}%，下降 ${(b - r).toFixed(1)} 个百分点`,
        attribution: `交付能力恶化通常源于：产能瓶颈、物流变更或订单激增导致的排产冲突。建议：核查该供应商产能利用率与近期订单量变化，启动备选供应商切换预案。`
      })
    }
  }
  return results
}

/**
 * R2: 报价离群检测（品类均值 ± 2σ）
 */
export function detectPriceOutlier(orders) {
  const stats = categoryPriceStats(orders)
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
    const z = (avg - st.mean) / st.sd
    if (z > 2) {
      results.push({
        rule: 'R2', level: 'medium', supplierId: sid, supplierName: name,
        detail: `${category}品类均价 ¥${st.mean.toFixed(1)}，该供应商成交均价 ¥${avg.toFixed(1)}（+${z.toFixed(1)}σ）`,
        attribution: `价格持续高于市场基准，可能存在议价空间不足或隐性成本转嫁。建议：纳入比价清单重新招标，或以量换价谈判阶梯折扣。`
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
        detail: `${cat}品类 ¥${(top.amount / 1e4).toFixed(1)}万 采购额中，${top.name} 占 ${top.cumPct.toFixed(1)}%`,
        attribution: `品类过度集中于单一供应商，议价能力受限且存在断供风险。建议：培育 1-2 家备选供应商（先分配 15%-20% 份额），将集中度降至 50% 以下。`
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
        results.push({
          rule: 'R4', level: 'medium', supplierId: sid, supplierName: name,
          detail: `单价低于品类均价 ${((1 - avg / st.mean) * 100).toFixed(0)}%，但 TCO ¥${myTco.toFixed(0)} 高于品类 TCO 均值 ¥${catTcoMean[category].toFixed(0)}`,
          attribution: `低价来自隐性成本转移：运输费率 ${(sup.tcoFactors.transportRate * 100).toFixed(0)}%、质量损失率 ${(sup.tcoFactors.qualityLossRate * 100).toFixed(0)}%。建议：不应以单价作为唯一比价维度，重新评估质量与物流成本后决策。`
        })
      }
    }
  }
  return results
}

/** 执行全部规则 */
export function runAllRules(orders, suppliers) {
  return [
    ...detectOtdDrop(orders, orders),
    ...detectPriceOutlier(orders),
    ...detectSingleDependency(orders),
    ...detectLowPriceHighTco(orders, suppliers)
  ]
}
