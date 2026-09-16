<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { store, load, filteredOrders, allMonths, setRange } from '../data/store'
import {
  groupByMonth, categoryBreakdown, supplierPareto, savingsRate,
  otdDragBySupplier, otdGap, otd, supplierOtdTrend, supplierRecentDrop,
  fmtMoney, fmtPct
} from '../utils/metrics'
import { runAllRules, RULES } from '../utils/rules'
import { useChart } from '../utils/useChart'

const router = useRouter()
const ready = ref(false)
const months = ref([])
const range = ref(['', ''])
/** 异常预警：与「智能洞察」页同口径，始终跑全量数据，保证检测结果一致 */
const alts = ref([])

onMounted(async () => {
  await load()
  months.value = allMonths()
  range.value = [months.value[0], months.value[months.value.length - 1]]
  alts.value = runAllRules(store.orders, store.suppliers)
  ready.value = true
})

/** 时间筛选范围内的订单（KPI 与图表跟随筛选） */
const orders = computed(() => filteredOrders())
const monthly = computed(() => groupByMonth(orders.value))
const catData = computed(() => categoryBreakdown(orders.value))
const pareto = computed(() => supplierPareto(orders.value))

const ruleName = Object.fromEntries(RULES.map(r => [r.id, r.name]))
const alertByRule = computed(() =>
  RULES.map(r => ({ ...r, count: alts.value.filter(a => a.rule === r.id).length }))
)

/** OTD 拖累归因：按供应商拆解「谁在拉低整体 OTD」 */
const drag = computed(() => otdDragBySupplier(orders.value))
const topDrag = computed(() => drag.value[0] || null)
const gap = computed(() => otdGap(orders.value, 90))

const kpi = computed(() => {
  const os = orders.value
  const total = os.reduce((s, o) => s + o.amount, 0)
  const m = monthly.value
  const last = m[m.length - 1], prev = m[m.length - 2]
  const mom = last && prev ? (last.amount - prev.amount) / prev.amount * 100 : 0
  return { total, count: os.length, ot: otd(os), mom, sv: savingsRate(os) }
})

/** 第一屏故事卡：华信精密（全量 12 个月口径） */
const STORY_ID = 'A01'
const story = computed(() => supplierRecentDrop(store.orders, STORY_ID, 3) || {
  supplierId: STORY_ID, supplierName: '—', from: '', months: 3,
  baseOtd: 0, recentOtd: 0, recentOrders: 0, lateOrders: 0, impactAmount: 0
})
const storyTrend = computed(() => supplierOtdTrend(store.orders, STORY_ID))
/** 备选供应商：同品类内交付评分为先、排除本身（不写死名字，随数据变化） */
const storyAlt = computed(() => {
  const cat = (store.suppliers.find(s => s.id === STORY_ID) || {}).category
  return store.suppliers
    .filter(s => s.category === cat && s.id !== STORY_ID)
    .sort((a, b) => b.scores.delivery - a.scores.delivery)
    .slice(0, 2)
    .map(s => s.name)
    .join(' / ')
})

const trendRef = ref(null)
const catRef = ref(null)
const paretoRef = ref(null)
const storyRef = ref(null)

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

/** 故事卡内核：单供应商 OTD 趋势 + 目标线，一眼看到断崖 */
useChart(storyRef, () => ({
  grid: { left: 44, right: 16, top: 24, bottom: 24 },
  tooltip: {
    trigger: 'axis',
    formatter: ps => {
      const p = ps[0]
      const t = storyTrend.value[p.dataIndex]
      return `${p.name}<br/>OTD <b>${p.value}%</b><br/>订单 ${t ? t.count : 0} 单`
    }
  },
  xAxis: { type: 'category', data: storyTrend.value.map(t => t.month.slice(2)), axisLabel: { fontSize: 10, interval: 1 } },
  yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', fontSize: 10 }, splitLine: { lineStyle: { type: 'dashed' } } },
  series: [{
    name: 'OTD', type: 'line', smooth: true, symbolSize: 6,
    data: storyTrend.value.map(t => +t.otd.toFixed(1)),
    itemStyle: { color: '#dc2626' }, lineStyle: { width: 2.5 },
    areaStyle: { opacity: 0.06 },
    markLine: {
      silent: true, symbol: 'none',
      data: [{ yAxis: 90, label: { formatter: '目标 90%', fontSize: 10 }, lineStyle: { color: '#2563eb', type: 'dashed' } }]
    }
  }]
}), () => [storyTrend.value])

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
function goFulfillment(supplierId) {
  router.push(supplierId ? { path: '/fulfillment', query: { supplier: supplierId } } : '/fulfillment')
}
const goCost = () => router.push('/cost')
const goInsight = () => router.push('/insight')
const goSupplier = () => router.push('/supplier')
</script>

<template>
  <div v-if="!ready" class="empty">数据加载中…</div>
  <div v-show="ready">
    <div class="page-header">
      <div>
        <div class="page-title">采购总览</div>
        <div class="page-desc">
          发生了什么 → 为什么 → 该干什么 · {{ range[0] }} 至 {{ range[1] }} ·
          {{ kpi.count.toLocaleString() }} 单 / {{ store.suppliers.length }} 家供应商
        </div>
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

    <!-- 第一屏：每张卡都自带「下一步去哪看」 -->
    <div class="grid grid-4" style="margin-bottom: 16px">
      <div class="card kpi">
        <div class="kpi-label">采购总金额</div>
        <div class="kpi-value">¥{{ fmtMoney(kpi.total) }}</div>
        <div class="kpi-delta" :class="kpi.mom >= 0 ? 'up' : 'down'">
          环比 {{ kpi.mom >= 0 ? '+' : '' }}{{ kpi.mom.toFixed(1) }}%
          <span class="kpi-sub">· {{ kpi.count.toLocaleString() }} 单 · {{ store.suppliers.length }} 家供应商</span>
        </div>
      </div>

      <div class="card kpi kpi-link" @click="goFulfillment(kpi.ot < 90 && topDrag ? topDrag.supplierId : '')">
        <div class="kpi-label">准时交付率 OTD</div>
        <div class="kpi-value" :class="{ 'val-bad': gap > 0 }">{{ fmtPct(kpi.ot) }}</div>
        <div class="kpi-delta" :class="gap > 0 ? 'up' : 'down'">
          <template v-if="gap > 0">
            低于目标 90% 共 {{ gap.toFixed(1) }}pt ｜ 主要拖累：
            <b>{{ topDrag ? topDrag.supplierName : '—' }}（−{{ topDrag ? topDrag.dragPt.toFixed(1) : '0.0' }}pt）</b>
          </template>
          <template v-else>达标（目标 90%）</template>
          <span class="drill">查看履约明细 →</span>
        </div>
      </div>

      <div class="card kpi kpi-link" @click="goCost">
        <div class="kpi-label">成本节约（相对基准价 v2）</div>
        <template v-if="kpi.sv.computable">
          <div class="kpi-value" :class="kpi.sv.savings >= 0 ? 'val-good' : 'val-bad'">¥{{ fmtMoney(kpi.sv.savings) }}</div>
          <div class="kpi-delta flat">
            节约率 <b>{{ fmtPct(kpi.sv.rate, 2) }}</b>（基准覆盖率 {{ fmtPct(kpi.sv.coverage * 100, 1) }}，{{ kpi.sv.uncovered }} 单无基准价未计入）
            <span class="drill">查看成本分析 →</span>
          </div>
        </template>
        <template v-else>
          <div class="kpi-value" style="font-size: 18px; margin-top: 12px">基准价缺失，暂不可计算</div>
          <div class="kpi-delta flat">基准覆盖率 {{ fmtPct(kpi.sv.coverage * 100, 1) }}，低于 {{ fmtPct(kpi.sv.threshold * 100, 0) }} 阈值</div>
        </template>
      </div>

      <div class="card kpi kpi-link" @click="goInsight">
        <div class="kpi-label">异常预警</div>
        <div class="kpi-value" :class="{ 'val-bad': alts.length > 0 }">{{ alts.length }} 条待处理</div>
        <div class="kpi-delta flat">
          <span v-for="r in alertByRule" :key="r.id" class="mini-chip" :class="{ on: r.count > 0 }" :title="r.desc">
            {{ r.id }} {{ r.short }}<i v-if="r.count">×{{ r.count }}</i><i v-else class="ok">正常</i>
          </span>
          <span class="drill">查看归因 →</span>
        </div>
      </div>
    </div>

    <!-- 第一屏下半部分最显眼的位置：一条单供应商 OTD 趋势 -->
    <div class="card story">
      <div class="story-left">
        <div class="story-tag">
          <span class="tag tag-danger">R1 履约下滑</span>
          <span class="tag tag-routine">全量 12 个月口径</span>
        </div>
        <div class="story-title">
          {{ story.supplierName }}（{{ story.supplierId }}）近 {{ story.months }} 个月 OTD
          由 {{ story.baseOtd.toFixed(1) }}% 降至 {{ story.recentOtd.toFixed(1) }}%
        </div>
        <div class="story-nums">
          <div class="story-num">
            <span class="n">{{ story.lateOrders }}</span><span class="u">单未交付</span>
          </div>
          <div class="story-num">
            <span class="n">¥{{ fmtMoney(story.impactAmount) }}</span><span class="u">影响金额</span>
          </div>
          <div class="story-num">
            <span class="n">{{ story.months }}</span><span class="u">个月统计窗口</span>
          </div>
        </div>
        <div class="story-action">
          <b>建议：</b>本周约谈，核查产能与排产计划；同步评估启用备选供应商{{ storyAlt ? `（${storyAlt}）` : '' }}。
        </div>
        <button class="btn" @click="goFulfillment(STORY_ID)">查看该供应商履约明细 →</button>
      </div>
      <div class="story-right">
        <div class="story-chart-title">{{ story.supplierName }} · 月度 OTD</div>
        <div ref="storyRef" class="story-chart"></div>
      </div>
    </div>

    <!-- 节约率口径构成：把「我凭什么这么算」摆在第一屏 -->
    <div class="card">
      <div class="card-title">
        成本节约率口径构成（v2 · 按基准价来源拆解）
        <span class="card-hint">v1 口径用品类均价当基准，代数上恒等于 0，已废弃 —— 修订过程见 README「口径 revision」</span>
      </div>
      <table>
        <thead>
          <tr><th>基准价来源</th><th>口径说明</th><th>订单数</th><th>基准金额</th><th>节约额</th><th>节约率</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in kpi.sv.bySource" :key="s.key">
            <td><b>{{ s.short }}</b> {{ s.label }}</td>
            <td class="muted">{{ s.desc }}</td>
            <td>{{ s.orders }}</td>
            <td>¥{{ fmtMoney(s.benchmarkTotal) }}</td>
            <td :class="s.savings >= 0 ? 'pos' : 'neg'">{{ s.savings >= 0 ? '' : '−' }}¥{{ fmtMoney(Math.abs(s.savings)) }}</td>
            <td :class="s.rate >= 0 ? 'pos' : 'neg'"><b>{{ s.rate >= 0 ? '+' : '' }}{{ s.rate.toFixed(2) }}%</b></td>
          </tr>
          <tr class="total-row">
            <td><b>合计（已覆盖）</b></td>
            <td class="muted">基准覆盖率 {{ fmtPct(kpi.sv.coverage * 100, 1) }}，{{ kpi.sv.uncovered }} 单无基准价未计入</td>
            <td>{{ kpi.sv.covered }}</td>
            <td>¥{{ fmtMoney(kpi.sv.benchmarkTotal) }}</td>
            <td :class="kpi.sv.savings >= 0 ? 'pos' : 'neg'"><b>{{ kpi.sv.savings >= 0 ? '' : '−' }}¥{{ fmtMoney(Math.abs(kpi.sv.savings)) }}</b></td>
            <td :class="kpi.sv.rate >= 0 ? 'pos' : 'neg'"><b>{{ kpi.sv.rate >= 0 ? '+' : '' }}{{ kpi.sv.rate.toFixed(2) }}%</b></td>
          </tr>
        </tbody>
      </table>
      <div class="page-desc" style="margin-top: 10px">
        注意 ③ 口径为负：成交价高于当期最低有效报价 —— 说明询价环节仍有下探空间；这正是「单一节约率数字」藏不住、必须拆开看的原因。
      </div>
    </div>

    <div class="card">
      <div class="card-title">月度采购金额与 OTD 趋势</div>
      <div ref="trendRef" class="chart"></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-title">品类结构（按采购金额）<span class="card-hint link" @click="goCost">成本分析 →</span></div>
        <div ref="catRef" class="chart"></div>
      </div>
      <div class="card">
        <div class="card-title">供应商帕累托分析（TOP 供应商金额与累计占比）<span class="card-hint link" @click="goSupplier">供应商评估 →</span></div>
        <div ref="paretoRef" class="chart"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn { padding: 7px 16px; background: var(--primary); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; }
.btn:hover { opacity: 0.9; }

/* KPI 卡：整卡可下钻 */
.kpi-link { cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.kpi-link:hover { border-color: var(--primary); box-shadow: 0 2px 10px rgba(37, 99, 235, .08); }
.kpi-link:hover .drill { opacity: 1; }
.drill { display: block; margin-top: 4px; color: var(--primary); font-weight: 500; opacity: .75; }
.kpi-sub { color: var(--text-2); }
.val-good { color: var(--success); }
.val-bad { color: var(--danger); }

/* 异常预警卡上的规则小标签 */
.mini-chip { display: inline-block; padding: 1px 7px; margin: 2px 4px 2px 0; border-radius: 999px; font-size: 11px; background: #f3f4f6; color: var(--text-2); }
.mini-chip.on { background: var(--warning-bg); color: var(--warning); }
.mini-chip i { font-style: normal; font-weight: 600; }
.mini-chip i.ok { color: var(--success); font-weight: 400; }

/* 故事卡 */
.story { display: grid; grid-template-columns: 1.35fr 1fr; gap: 22px; border-left: 3px solid var(--danger); }
.story-tag { display: flex; gap: 8px; margin-bottom: 10px; }
.story-title { font-size: 17px; font-weight: 600; line-height: 1.5; }
.story-nums { display: flex; gap: 28px; margin: 14px 0 12px; }
.story-num .n { font-size: 24px; font-weight: 600; color: var(--danger); font-variant-numeric: tabular-nums; }
.story-num .u { font-size: 12px; color: var(--text-2); margin-left: 6px; }
.story-action { font-size: 13px; color: var(--text-2); background: var(--bg); border-radius: 8px; padding: 10px 12px; line-height: 1.7; margin-bottom: 14px; }
.story-action b { color: var(--text); }
.story-chart-title { font-size: 12px; color: var(--text-2); margin-bottom: 4px; }
.story-chart { width: 100%; height: 170px; }

/* 口径构成表 */
.card-title .card-hint { font-weight: 400; font-size: 12px; color: var(--text-2); margin-left: 10px; }
.card-hint.link { color: var(--primary); cursor: pointer; }
.muted { color: var(--text-2); font-size: 12px; }
.pos { color: var(--success); }
.neg { color: var(--danger); }
.total-row td { border-top: 1px solid var(--border); background: #fafbfc; }

@media (max-width: 1100px) {
  .story { grid-template-columns: 1fr; }
}
</style>
