<script setup>
import { ref, computed, onMounted } from 'vue'
import { store, load, filteredOrders, allMonths, setRange } from '../data/store'
import { groupByMonth, categoryBreakdown, supplierPareto, savingsRate, fmtMoney, fmtPct } from '../utils/metrics'
import { useChart } from '../utils/useChart'

const ready = ref(false)
const months = ref([])
const range = ref(['', ''])

onMounted(async () => {
  await load()
  months.value = allMonths()
  range.value = [months.value[0], months.value[months.value.length - 1]]
  ready.value = true
})

const orders = computed(() => filteredOrders())
const monthly = computed(() => groupByMonth(orders.value))
const catData = computed(() => categoryBreakdown(orders.value))
const pareto = computed(() => supplierPareto(orders.value))

const kpi = computed(() => {
  const os = orders.value
  const total = os.reduce((s, o) => s + o.amount, 0)
  const ot = os.filter(o => o.onTime).length / (os.length || 1) * 100
  const sv = savingsRate(os)
  // 环比：最近月 vs 上一月
  const m = monthly.value
  const last = m[m.length - 1], prev = m[m.length - 2]
  const mom = last && prev ? (last.amount - prev.amount) / prev.amount * 100 : 0
  return { total, count: os.length, ot, savings: sv.savings, savingsRate: sv.rate, mom }
})

const trendRef = ref(null)
const catRef = ref(null)
const paretoRef = ref(null)

useChart(trendRef, () => ({
  grid: { left: 60, right: 60, top: 40, bottom: 30 },
  tooltip: { trigger: 'axis' },
  legend: { data: ['采购金额', 'OTD'], top: 0 },
  xAxis: { type: 'category', data: monthly.value.map(m => m.month) },
  yAxis: [
    { type: 'value', name: '金额(万元)', axisLabel: { formatter: v => (v / 1e4).toFixed(0) } },
    { type: 'value', name: 'OTD(%)', min: 50, max: 100, splitLine: { show: false } }
  ],
  series: [
    { name: '采购金额', type: 'bar', data: monthly.value.map(m => +m.amount.toFixed(0)), itemStyle: { color: '#93b4f5' }, barMaxWidth: 28 },
    { name: 'OTD', type: 'line', yAxisIndex: 1, smooth: true, data: monthly.value.map(m => +(100 * m.onTime / m.count).toFixed(1)), itemStyle: { color: '#2563eb' }, lineStyle: { width: 2 } }
  ]
}), () => [monthly.value])

useChart(catRef, () => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { orient: 'vertical', right: 10, top: 'center' },
  series: [{
    type: 'pie', radius: ['45%', '70%'], center: ['35%', '50%'],
    label: { show: false },
    data: catData.value.map(c => ({ name: c.name, value: +c.amount.toFixed(0) }))
  }]
}), () => [catData.value])

useChart(paretoRef, () => ({
  grid: { left: 60, right: 60, top: 30, bottom: 60 },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', data: pareto.value.map(p => p.name), axisLabel: { rotate: 40, fontSize: 11 } },
  yAxis: [
    { type: 'value', name: '金额(万元)', axisLabel: { formatter: v => (v / 1e4).toFixed(0) } },
    { type: 'value', name: '累计占比(%)', max: 100 }
  ],
  series: [
    { type: 'bar', data: pareto.value.map(p => +p.amount.toFixed(0)), itemStyle: { color: '#64748b' }, barMaxWidth: 24 },
    { type: 'line', yAxisIndex: 1, data: pareto.value.map(p => +p.cumPct.toFixed(1)), itemStyle: { color: '#d97706' }, markLine: { data: [{ yAxis: 80, label: { formatter: '80%' }, lineStyle: { color: '#dc2626', type: 'dashed' } }] } }
  ]
}), () => [pareto.value])

function applyRange() { setRange(range.value[0], range.value[1]) }
</script>

<template>
  <div v-if="!ready" class="empty">数据加载中…</div>
  <div v-show="ready">
    <div class="page-header">
      <div>
        <div class="page-title">采购总览</div>
        <div class="page-desc">全品类采购金额、履约与供应商集中度概览 · {{ range[0] }} 至 {{ range[1] }}</div>
      </div>
      <div class="filters">
        <select v-model="range[0]">
          <option v-for="m in months" :key="m" :value="m">{{ m }}</option>
        </select>
        <span style="color: var(--text-2)">至</span>
        <select v-model="range[1]">
          <option v-for="m in months" :key="m" :value="m">{{ m }}</option>
        </select>
        <button class="btn" @click="applyRange">应用</button>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom: 16px">
      <div class="card kpi">
        <div class="kpi-label">采购总金额</div>
        <div class="kpi-value">¥{{ fmtMoney(kpi.total) }}</div>
        <div class="kpi-delta" :class="kpi.mom >= 0 ? 'up' : 'down'">环比 {{ kpi.mom >= 0 ? '+' : '' }}{{ kpi.mom.toFixed(1) }}%</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">订单总数</div>
        <div class="kpi-value">{{ kpi.count.toLocaleString() }}</div>
        <div class="kpi-delta flat">覆盖 {{ store.suppliers.length }} 家供应商</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">准时交付率 OTD</div>
        <div class="kpi-value">{{ fmtPct(kpi.ot) }}</div>
        <div class="kpi-delta" :class="kpi.ot < 90 ? 'up' : 'flat'">{{ kpi.ot < 90 ? '低于目标 90%' : '达标' }}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">成本节约</div>
        <div class="kpi-value">¥{{ fmtMoney(kpi.savings) }}</div>
        <div class="kpi-delta down">节约率 {{ fmtPct(kpi.savingsRate) }}（相对品类均价）</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">月度采购金额与 OTD 趋势</div>
      <div ref="trendRef" class="chart"></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">品类结构（按采购金额）</div>
        <div ref="catRef" class="chart"></div>
      </div>
      <div class="card">
        <div class="card-title">供应商帕累托分析（TOP 供应商金额与累计占比）</div>
        <div ref="paretoRef" class="chart"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn { padding: 7px 16px; background: var(--primary); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; }
.btn:hover { opacity: 0.9; }
</style>
