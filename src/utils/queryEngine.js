/**
 * 查询执行 + 答案渲染层
 * 职责：把结构化查询参数执行成真实数据，再用模板拼成自然语言答案
 * 答案全部来自 metrics.js 的确定性计算 —— LLM 不参与答案生成（防幻觉）
 */
import { store, allMonths } from '../data/store'
import { otd, qualityRate, supplierPareto, categoryBreakdown, categoryPriceStats, tco, fmtMoney, fmtPct } from './metrics'

/** 时间范围过滤 */
function filterByTime(orders, time) {
  if (!time || time === 'all') return orders
  const n = time === 'last_month' ? 1 : time === 'last_3_months' ? 3 : 12
  const months = allMonths().slice(-n)
  return orders.filter(o => months.includes(o.month))
}

const TIME_LABEL = { last_month: '近 1 个月', last_3_months: '近 3 个月', last_12_months: '近 12 个月', all: '全部时间' }

/** 按供应商分组 */
function groupBySupplier(orders) {
  const map = new Map()
  for (const o of orders) {
    if (!map.has(o.supplierId)) map.set(o.supplierId, { id: o.supplierId, name: o.supplierName, list: [] })
    map.get(o.supplierId).list.push(o)
  }
  return [...map.values()]
}

/** 按品类分组 */
function groupByCategory(orders) {
  const map = new Map()
  for (const o of orders) {
    if (!map.has(o.category)) map.set(o.category, { name: o.category, list: [] })
    map.get(o.category).list.push(o)
  }
  return [...map.values()]
}

/**
 * 主入口：执行查询，返回 { ok, text, rows, source }
 */
export function executeQuery(q) {
  if (!q) return { ok: false, text: '抱歉，我没能理解这个问题，试试下面的示例问题吧。' }

  const orders = filterByTime(store.orders, q.time)
  const source = { time: TIME_LABEL[q.time] || '全部时间', orders: orders.length }
  if (!orders.length) return { ok: false, text: '当前时间范围内没有采购数据。', source }

  let result
  switch (q.metric) {
    case 'otd': result = qOtd(orders, q); break
    case 'spend': result = qSpend(orders, q); break
    case 'quality': result = qQuality(orders, q); break
    case 'concentration': result = qConcentration(orders, q); break
    case 'tco': result = qTco(orders, q); break
    case 'price_trend': result = qPriceTrend(orders, q); break
    default: return { ok: false, text: '该指标暂不支持查询。', source }
  }
  return { ok: true, ...result, source }
}

/* ---- 各类查询实现 ---- */

function qOtd(orders, q) {
  const rows = groupBySupplier(orders).map(s => ({ name: s.name, value: otd(s.list) }))
  let picked, text
  if (q.operator === '<') {
    picked = rows.filter(r => r.value < (q.value ?? 80)).sort((a, b) => a.value - b.value)
    text = picked.length
      ? `${TIME_LABEL[q.time]} OTD 低于 ${q.value ?? 80}% 的供应商共 ${picked.length} 家：` + picked.map(r => `${r.name}（${fmtPct(r.value)}）`).join('、')
      : `没有供应商的 OTD 低于 ${q.value ?? 80}%。`
  } else if (q.operator === '>') {
    picked = rows.filter(r => r.value > (q.value ?? 90)).sort((a, b) => b.value - a.value)
    text = picked.length
      ? `OTD 高于 ${q.value ?? 90}% 的供应商：` + picked.map(r => `${r.name}（${fmtPct(r.value)}）`).join('、')
      : `没有供应商的 OTD 高于 ${q.value ?? 90}%。`
  } else {
    picked = rows.sort((a, b) => a.value - b.value).slice(0, q.value ?? 5)
    text = `OTD 最低的 ${picked.length} 家供应商：` + picked.map(r => `${r.name}（${fmtPct(r.value)}）`).join('、')
  }
  return { text, rows: picked }
}

function qSpend(orders, q) {
  const pareto = supplierPareto(orders)
  const n = q.value ?? 5
  const rows = pareto.slice(0, n).map(p => ({ name: p.name, value: p.amount }))
  const text = `采购金额最大的 ${rows.length} 家供应商：` + rows.map(r => `${r.name}（¥${fmtMoney(r.value)}）`).join('、')
  return { text, rows }
}

function qQuality(orders, q) {
  const rows = groupBySupplier(orders).map(s => ({ name: s.name, value: qualityRate(s.list) }))
  const picked = rows.sort((a, b) => a.value - b.value).slice(0, q.value ?? 1)
  const text = `验收合格率最低的供应商：` + picked.map(r => `${r.name}（${fmtPct(r.value)}）`).join('、')
  return { text, rows: picked }
}

function qConcentration(orders, q) {
  const cats = groupByCategory(orders).map(c => {
    const pareto = supplierPareto(c.list)
    const top = pareto[0]
    return { name: c.name, topName: top.name, topPct: top.cumPct, amount: c.list.reduce((s, o) => s + o.amount, 0) }
  })
  const max = cats.reduce((a, b) => (b.topPct > a.topPct ? b : a), cats[0])
  const text =
    `${max.name}品类采购额集中度最高，其中 ${max.topName} 占 ${fmtPct(max.topPct)}` +
    (max.topPct > 60 ? `，超过 60% 预警线，存在单一供应商依赖风险，建议培育备选供应商。` : `。`)
  return { text, rows: cats.map(c => ({ name: c.name, value: c.topPct })).sort((a, b) => b.value - a.value) }
}

function qTco(orders, q) {
  const rows = groupBySupplier(orders).map(s => {
    const avg = s.list.reduce((a, o) => a + o.unitPrice, 0) / s.list.length
    const sup = store.suppliers.find(x => x.id === s.id)
    return { name: s.name, value: tco(avg, sup.tcoFactors) }
  })
  const picked = rows.sort((a, b) => b.value - a.value).slice(0, q.value ?? 1)
  const text = `全生命周期成本（TCO）最高的供应商：` + picked.map(r => `${r.name}（TCO ¥${r.value.toFixed(0)}）`).join('、') + '，建议结合单价与隐性成本综合比价。'
  return { text, rows: picked }
}

function qPriceTrend(orders, q) {
  const months = allMonths().slice(-3)
  const cats = groupByCategory(orders).map(c => {
    const first = c.list.filter(o => months[0] && o.month === months[0])
    const last = c.list.filter(o => months[months.length - 1] && o.month === months[months.length - 1])
    const p0 = first.reduce((s, o) => s + o.unitPrice, 0) / (first.length || 1)
    const p1 = last.reduce((s, o) => s + o.unitPrice, 0) / (last.length || 1)
    return { name: c.name, change: ((p1 - p0) / p0) * 100, from: p0, to: p1 }
  })
  const max = cats.reduce((a, b) => (b.change > a.change ? b : a), cats[0])
  const text =
    `价格涨幅最快的品类是 ${max.name}，近 3 个月均价从 ¥${max.from.toFixed(1)} 涨到 ¥${max.to.toFixed(1)}（+${max.change.toFixed(1)}%）。`
  return { text, rows: cats.sort((a, b) => b.change - a.change).map(c => ({ name: c.name, value: +c.change.toFixed(1) })) }
}
