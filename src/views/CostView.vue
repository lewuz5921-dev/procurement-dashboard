<script setup>
import { ref, computed, onMounted } from 'vue'
import { store, load } from '../data/store'
import { tco, fmtMoney } from '../utils/metrics'
import { useChart } from '../utils/useChart'

const ready = ref(false)
const category = ref('结构件')
onMounted(async () => { await load(); ready.value = true })

const categories = computed(() => [...new Set(store.orders.map(o => o.category))])

/** 品类内各供应商：均价 / TCO 构成 */
const tcoRows = computed(() => {
  const list = store.orders.filter(o => o.category === category.value)
  const bySup = new Map()
  for (const o of list) {
    if (!bySup.has(o.supplierId)) bySup.set(o.supplierId, { id: o.supplierId, name: o.supplierName, prices: [] })
    bySup.get(o.supplierId).prices.push(o.unitPrice)
  }
  return [...bySup.values()].map(e => {
    const sup = store.suppliers.find(s => s.id === e.id)
    const avg = e.prices.reduce((a, b) => a + b, 0) / e.prices.length
    const f = sup.tcoFactors
    const unitTco = tco(avg, f)
    return {
      id: e.id, name: e.name, avg, n: e.prices.length,
      transport: avg * f.transportRate,
      quality: avg * f.qualityLossRate,
      admin: avg * f.adminRate,
      unitTco,
      /** 成本指数：以品类最低 TCO 为基准 100 */
      index: 0
    }
  }).sort((a, b) => a.unitTco - b.unitTco)
})

const minTco = computed(() => Math.min(...tcoRows.value.map(r => r.unitTco), Infinity))
const rowsWithIndex = computed(() => tcoRows.value.map(r => ({ ...r, index: minTco.value ? 100 * r.unitTco / minTco.value : 0 })))

const stackRef = ref(null)

useChart(stackRef, () => ({
  grid: { left: 90, right: 40, top: 40, bottom: 40 },
  tooltip: {
    trigger: 'axis',
    formatter: ps => {
      const row = rowsWithIndex.value.find(r => r.name === ps[0].name)
      if (!row) return ''
      return `<b>${row.name}</b><br/>成交均价：¥${row.avg.toFixed(1)}<br/>` +
        `运输成本：¥${row.transport.toFixed(1)}<br/>质量损失：¥${row.quality.toFixed(1)}<br/>` +
        `管理成本：¥${row.admin.toFixed(1)}<br/><b>TCO：¥${row.unitTco.toFixed(1)}</b>`
    }
  },
  legend: { data: ['成交均价', '运输成本', '质量损失', '管理成本'], top: 0 },
  xAxis: { type: 'value', name: '单位成本' },
  yAxis: { type: 'category', data: rowsWithIndex.value.map(r => r.name), inverse: true },
  series: [
    { name: '成交均价', type: 'bar', stack: 'tco', barMaxWidth: 22, itemStyle: { color: '#93b4f5' }, data: rowsWithIndex.value.map(r => +r.avg.toFixed(1)) },
    { name: '运输成本', type: 'bar', stack: 'tco', itemStyle: { color: '#d97706' }, data: rowsWithIndex.value.map(r => +r.transport.toFixed(1)) },
    { name: '质量损失', type: 'bar', stack: 'tco', itemStyle: { color: '#dc2626' }, data: rowsWithIndex.value.map(r => +r.quality.toFixed(1)) },
    { name: '管理成本', type: 'bar', stack: 'tco', itemStyle: { color: '#9ca3af' }, data: rowsWithIndex.value.map(r => +r.admin.toFixed(1)) }
  ]
}), () => [rowsWithIndex.value, category.value])

const priceTrendRef = ref(null)

useChart(priceTrendRef, () => {
  const months = [...new Set(store.orders.filter(o => o.category === category.value).map(o => o.month))].sort()
  const byMonth = months.map(m => {
    const list = store.orders.filter(o => o.category === category.value && o.month === m)
    return +(list.reduce((s, o) => s + o.unitPrice, 0) / list.length).toFixed(1)
  })
  return {
    grid: { left: 50, right: 30, top: 30, bottom: 30 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: months },
    yAxis: { type: 'value', scale: true, name: '均价' },
    series: [{ name: '品类均价', type: 'line', smooth: true, areaStyle: { opacity: 0.08 }, itemStyle: { color: '#2563eb' }, data: byMonth }]
  }
}, () => [category.value])

/** 品类均价 vs 最低价 vs 最高价 */
const categoryStats = computed(() => {
  const rows = []
  for (const cat of categories.value) {
    const list = store.orders.filter(o => o.category === cat)
    const prices = list.map(o => o.unitPrice)
    rows.push({
      cat,
      mean: prices.reduce((a, b) => a + b, 0) / prices.length,
      min: Math.min(...prices),
      max: Math.max(...prices),
      spend: list.reduce((s, o) => s + o.amount, 0)
    })
  }
  return rows.sort((a, b) => b.spend - a.spend)
})
</script>

<template>
  <div v-if="!ready" class="empty">数据加载中…</div>
  <div v-show="ready">
    <div class="page-header">
      <div>
        <router-link class="back-link" to="/">← 返回总览（下钻页）</router-link>
        <div class="page-title">成本分析 · TCO 全生命周期成本</div>
        <div class="page-desc">TCO = 成交均价 × (1 + 运输费率 + 质量损失率 + 管理费率) —— 打破“单价最低”直觉</div>
      </div>
      <div class="filters">
        <select v-model="category">
          <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
    </div>

    <div class="card">
      <div class="card-title">{{ category }} · 供应商 TCO 构成对比（堆叠图，按 TCO 升序）</div>
      <div ref="stackRef" class="chart-lg"></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">TCO 明细表（成本指数：以品类最低 TCO 为基准 100）</div>
        <table>
          <thead>
            <tr><th>供应商</th><th>成交均价</th><th>TCO</th><th>成本指数</th><th>订单数</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rowsWithIndex" :key="r.id" :class="{ 'row-warn': r.index > 120 }">
              <td>{{ r.name }}</td>
              <td>¥{{ r.avg.toFixed(1) }}</td>
              <td><b>¥{{ r.unitTco.toFixed(1) }}</b></td>
              <td>
                <span class="tag" :class="r.index > 120 ? 'tag-danger' : r.index > 110 ? 'tag-warning' : 'tag-ok'">{{ r.index.toFixed(0) }}</span>
              </td>
              <td>{{ r.n }}</td>
            </tr>
          </tbody>
        </table>
        <div class="page-desc" style="margin-top: 10px">提示：单价最低的供应商未必 TCO 最低 —— 关注质量损失与运输成本占比较高的供应商。</div>
      </div>
      <div class="card">
        <div class="card-title">{{ category }} · 品类均价趋势</div>
        <div ref="priceTrendRef" class="chart"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">各品类价格概览</div>
      <table>
        <thead>
          <tr><th>品类</th><th>采购金额</th><th>均价</th><th>最低价</th><th>最高价</th><th>价格离散度</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in categoryStats" :key="c.cat">
            <td>{{ c.cat }}</td>
            <td>¥{{ fmtMoney(c.spend) }}</td>
            <td>¥{{ c.mean.toFixed(1) }}</td>
            <td>¥{{ c.min.toFixed(1) }}</td>
            <td>¥{{ c.max.toFixed(1) }}</td>
            <td>{{ ((c.max - c.min) / c.mean * 100).toFixed(0) }}%</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.row-warn td { background: #fffbeb; }
</style>
