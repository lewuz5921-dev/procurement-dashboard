<script setup>
import { ref, computed, onMounted } from 'vue'
import { store, load, supplierSpendAll } from '../data/store'
import { fmtMoney } from '../utils/metrics'
import { useChart } from '../utils/useChart'

const ready = ref(false)
const selected = ref(null)

onMounted(async () => { await load(); ready.value = true })

/** Kraljic 分级：供应风险 × 采购业务影响（0.5 为分界） */
function tierOf(k) {
  if (k.supplyRisk >= 0.5 && k.profitImpact >= 0.5) return { key: 'strategic', label: '战略型' }
  if (k.supplyRisk < 0.5 && k.profitImpact >= 0.5) return { key: 'leverage', label: '杠杆型' }
  if (k.supplyRisk >= 0.5 && k.profitImpact < 0.5) return { key: 'bottleneck', label: '瓶颈型' }
  return { key: 'routine', label: '常规型' }
}

const suppliers = computed(() =>
  store.suppliers.map(s => ({
    ...s,
    tier: tierOf(s.kraljic),
    spend: supplierSpendAll(s.id)
  }))
)

const kraljicRef = ref(null)
const radarRef = ref(null)

function onKraljicClick(e) {
  const sid = e?.data?.[2]
  if (sid) selected.value = suppliers.value.find(s => s.id === sid) || null
}

useChart(kraljicRef, () => ({
  grid: { left: 60, right: 40, top: 40, bottom: 50 },
  tooltip: {
    formatter: p => {
      const s = suppliers.value.find(x => x.id === p.data[2])
      return s ? `<b>${s.name}</b><br/>供应风险 ${s.kraljic.supplyRisk.toFixed(2)}<br/>业务影响 ${s.kraljic.profitImpact.toFixed(2)}<br/>年采购额 ¥${fmtMoney(s.spend)}<br/>${s.tier.label}供应商` : ''
    }
  },
  xAxis: { name: '供应风险 →', nameLocation: 'middle', nameGap: 28, min: 0, max: 1, splitLine: { show: false } },
  yAxis: { name: '采购业务影响 →', min: 0, max: 1, splitLine: { show: false } },
  series: [{
    type: 'scatter',
    symbolSize: d => Math.max(10, Math.sqrt(d[3] / 1e4)),
    itemStyle: { opacity: 0.85 },
    data: suppliers.value.map(s => [s.kraljic.supplyRisk, s.kraljic.profitImpact, s.id, s.spend, s.tier.key])
  }],
  visualMap: {
    dimension: 4, show: false,
    inRange: { color: ['#9ca3af', '#16a34a', '#d97706', '#2563eb'] },
    categories: ['routine', 'leverage', 'bottleneck', 'strategic']
  }
}), () => [suppliers.value, ready.value], onKraljicClick)

useChart(radarRef, () => {
  const s = selected.value
  if (!s) return {}
  return {
    tooltip: {},
    radar: {
      indicator: [
        { name: '质量', max: 100 }, { name: '交付', max: 100 },
        { name: '价格竞争力', max: 100 }, { name: '服务', max: 100 }
      ],
      radius: '65%'
    },
    series: [{
      type: 'radar',
      areaStyle: { opacity: 0.2 },
      itemStyle: { color: '#2563eb' },
      data: [{ value: [s.scores.quality, s.scores.delivery, s.scores.price, s.scores.service], name: s.name }]
    }]
  }
}, () => [selected.value, ready.value])

const sortedSuppliers = computed(() => [...suppliers.value].sort((a, b) => b.spend - a.spend))
</script>

<template>
  <div v-if="!ready" class="empty">数据加载中…</div>
  <div v-show="ready">
    <div class="page-header">
      <div>
        <div class="page-title">供应商评估</div>
        <div class="page-desc">基于 Kraljic 矩阵分级（供应风险 × 业务影响），气泡大小 = 年采购额 · 点击气泡查看绩效雷达</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Kraljic 采购品类定位矩阵</div>
      <div ref="kraljicRef" class="chart-lg"></div>
      <div class="legend-row">
        <span class="tag tag-strategic">战略型：深度合作/长期协议</span>
        <span class="tag tag-leverage">杠杆型：集中议价/招投标</span>
        <span class="tag tag-bottleneck">瓶颈型：备选供应商/安全库存</span>
        <span class="tag tag-routine">常规型：流程简化/自动补货</span>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">供应商绩效雷达{{ selected ? ' · ' + selected.name : '' }}</div>
        <div v-if="!selected" class="empty">点击左侧矩阵中的供应商气泡查看四维绩效</div>
        <div v-else ref="radarRef" class="chart"></div>
      </div>
      <div class="card">
        <div class="card-title">供应商清单（按年采购额排序）</div>
        <div style="max-height: 340px; overflow-y: auto">
          <table>
            <thead>
              <tr><th>供应商</th><th>主供品类</th><th>分级</th><th>年采购额</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in sortedSuppliers" :key="s.id">
                <td>{{ s.name }}</td>
                <td>{{ s.category }}</td>
                <td><span class="tag" :class="'tag-' + s.tier.key">{{ s.tier.label }}</span></td>
                <td>¥{{ fmtMoney(s.spend) }}</td>
                <td><a href="javascript:;" style="color: var(--primary)" @click="selected = s">雷达</a></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.legend-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
</style>
