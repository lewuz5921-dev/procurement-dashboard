<script setup>
import { ref, computed, onMounted } from 'vue'
import { store, load } from '../data/store'
import { groupByMonth, fmtPct } from '../utils/metrics'
import { useChart } from '../utils/useChart'

const ready = ref(false)
onMounted(async () => { await load(); ready.value = true })

const supplierFilter = ref('')   // '' = 全部

const allOrders = computed(() => store.orders)
const orders = computed(() =>
  supplierFilter.value ? allOrders.value.filter(o => o.supplierId === supplierFilter.value) : allOrders.value
)

const monthly = computed(() => groupByMonth(orders.value))

/** 异常订单：逾期交付 且 延误超过7天 */
const abnormalOrders = computed(() =>
  orders.value
    .filter(o => !o.onTime && (o.actualLeadDays - o.leadDays) > 7)
    .sort((a, b) => (b.actualLeadDays - b.leadDays) - (a.actualLeadDays - a.leadDays))
)

/** 延误分布 */
const delayBuckets = computed(() => {
  const buckets = [0, 0, 0, 0]  // 0天(准时) / 1-3 / 4-7 / >7
  for (const o of orders.value) {
    const d = o.actualLeadDays - o.leadDays
    if (d <= 0) buckets[0]++
    else if (d <= 3) buckets[1]++
    else if (d <= 7) buckets[2]++
    else buckets[3]++
  }
  return buckets
})

const otdRef = ref(null)
const delayRef = ref(null)

useChart(otdRef, () => ({
  grid: { left: 50, right: 30, top: 40, bottom: 30 },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', data: monthly.value.map(m => m.month) },
  yAxis: { type: 'value', min: 40, max: 100, axisLabel: { formatter: '{value}%' } },
  visualMap: { show: false, pieces: [{ lt: 80, color: '#dc2626' }, { gte: 80, lte: 90, color: '#d97706' }, { gt: 90, color: '#16a34a' }] },
  series: [{
    name: 'OTD', type: 'line', smooth: true,
    data: monthly.value.map(m => +(100 * m.onTime / m.count).toFixed(1)),
    markLine: { data: [{ yAxis: 90, label: { formatter: '目标 90%' }, lineStyle: { color: '#2563eb', type: 'dashed' } }] }
  }]
}), () => [monthly.value])

useChart(delayRef, () => ({
  grid: { left: 60, right: 30, top: 40, bottom: 30 },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', data: ['准时', '延误 1-3 天', '延误 4-7 天', '延误 >7 天'] },
  yAxis: { type: 'value', name: '订单数' },
  series: [{
    type: 'bar', barMaxWidth: 48,
    data: delayBuckets.value.map((v, i) => ({
      value: v,
      itemStyle: { color: ['#16a34a', '#facc15', '#d97706', '#dc2626'][i] }
    }))
  }]
}), () => [delayBuckets.value])

const kpi = computed(() => {
  const os = orders.value
  const ot = os.filter(o => o.onTime).length / (os.length || 1) * 100
  const avgDelay = abnormalOrders.value.length
    ? abnormalOrders.value.reduce((s, o) => s + o.actualLeadDays - o.leadDays, 0) / abnormalOrders.value.length
    : 0
  return { ot, abnormal: abnormalOrders.value.length, avgDelay }
})
</script>

<template>
  <div v-if="!ready" class="empty">数据加载中…</div>
  <div v-show="ready">
    <div class="page-header">
      <div>
        <div class="page-title">履约监控</div>
        <div class="page-desc">订单准时交付率（OTD）趋势、延误分布与异常订单预警</div>
      </div>
      <div class="filters">
        <select v-model="supplierFilter">
          <option value="">全部供应商</option>
          <option v-for="s in store.suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom: 16px">
      <div class="card kpi">
        <div class="kpi-label">准时交付率 OTD</div>
        <div class="kpi-value">{{ fmtPct(kpi.ot) }}</div>
        <div class="kpi-delta" :class="kpi.ot >= 90 ? 'down' : 'up'">目标 90%</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">异常订单数（延误>7天）</div>
        <div class="kpi-value">{{ kpi.abnormal }}</div>
        <div class="kpi-delta flat">触发预警规则</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">平均延误天数（异常单）</div>
        <div class="kpi-value">{{ kpi.avgDelay.toFixed(1) }} 天</div>
        <div class="kpi-delta flat">按延误订单加权</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">供应商切换</div>
        <div class="kpi-value" style="font-size: 16px; margin-top: 14px">{{ supplierFilter ? store.suppliers.find(s => s.id === supplierFilter).name : '全部' }}</div>
        <div class="kpi-delta flat">用于单供应商下钻</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">月度 OTD 趋势（红 &lt;80% / 黄 80-90% / 绿 &gt;90%）</div>
        <div ref="otdRef" class="chart"></div>
      </div>
      <div class="card">
        <div class="card-title">交付延误分布</div>
        <div ref="delayRef" class="chart"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">异常订单预警列表（延误 &gt; 7 天，按延误天数降序）</div>
      <table>
        <thead>
          <tr><th>订单号</th><th>日期</th><th>供应商</th><th>品类</th><th>金额</th><th>计划周期</th><th>实际周期</th><th>延误</th></tr>
        </thead>
        <tbody>
          <tr v-for="o in abnormalOrders.slice(0, 30)" :key="o.id">
            <td>{{ o.id }}</td>
            <td>{{ o.date }}</td>
            <td>{{ o.supplierName }}</td>
            <td>{{ o.category }}</td>
            <td>¥{{ o.amount.toFixed(0) }}</td>
            <td>{{ o.leadDays }} 天</td>
            <td>{{ o.actualLeadDays }} 天</td>
            <td><span class="tag tag-danger">+{{ o.actualLeadDays - o.leadDays }} 天</span></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!abnormalOrders.length" class="empty">当前筛选范围内无异常订单</div>
    </div>
  </div>
</template>
