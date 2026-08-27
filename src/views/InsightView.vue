<script setup>
import { ref, computed, onMounted } from 'vue'
import { store, load } from '../data/store'
import { runAllRules, RULES } from '../utils/rules'

const ready = ref(false)
const alerts = ref([])

onMounted(async () => {
  await load()
  // 规则引擎在全量数据上运行（不随时间筛选变化，保证检测口径一致）
  alerts.value = runAllRules(store.orders, store.suppliers)
  ready.value = true
})

const levelName = { high: '高风险', medium: '中风险' }
const ruleName = Object.fromEntries(RULES.map(r => [r.id, r.name]))

const highCount = computed(() => alerts.value.filter(a => a.level === 'high').length)
const medCount = computed(() => alerts.value.filter(a => a.level === 'medium').length)
</script>

<template>
  <div v-if="!ready" class="empty">规则引擎运行中…</div>
  <div v-show="ready">
    <div class="page-header">
      <div>
        <div class="page-title">智能洞察 · 异常检测与归因</div>
        <div class="page-desc">规则引擎自动扫描全量采购数据，输出可解释的风险预警与优化建议</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">规则引擎配置（触发条件均可解释、可配置）</div>
      <div class="rule-grid">
        <div v-for="r in RULES" :key="r.id" class="rule-item">
          <div><span class="tag tag-routine">{{ r.id }}</span> <b>{{ r.name }}</b></div>
          <div class="page-desc">{{ r.desc }}</div>
        </div>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom: 16px">
      <div class="card kpi">
        <div class="kpi-label">预警总数</div>
        <div class="kpi-value">{{ alerts.length }}</div>
        <div class="kpi-delta flat">覆盖 4 条规则</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">高风险</div>
        <div class="kpi-value" style="color: var(--danger)">{{ highCount }}</div>
        <div class="kpi-delta flat">需立即处理</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">中风险</div>
        <div class="kpi-value" style="color: var(--warning)">{{ medCount }}</div>
        <div class="kpi-delta flat">纳入观察清单</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">扫描范围</div>
        <div class="kpi-value" style="font-size: 18px; margin-top: 12px">{{ store.orders.length }} 条订单</div>
        <div class="kpi-delta flat">{{ store.suppliers.length }} 家供应商 · 5 大品类</div>
      </div>
    </div>

    <div v-for="(a, i) in alerts" :key="i" class="card alert-card">
      <div class="alert-head">
        <span class="tag" :class="a.level === 'high' ? 'tag-danger' : 'tag-warning'">{{ levelName[a.level] }}</span>
        <span class="tag tag-routine">{{ ruleName[a.rule] }}</span>
        <b class="alert-supplier">{{ a.supplierName }}</b>
      </div>
      <div class="alert-detail">{{ a.detail }}</div>
      <div class="alert-attr">
        <span class="attr-label">归因分析</span>{{ a.attribution }}
      </div>
    </div>

    <div v-if="!alerts.length" class="empty">未检测到异常</div>
  </div>
</template>

<style scoped>
.rule-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.rule-item { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; }
.alert-card { border-left: 3px solid var(--warning); }
.alert-card:has(.tag-danger) { border-left-color: var(--danger); }
.alert-head { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.alert-supplier { font-size: 15px; }
.alert-detail { font-size: 13px; margin-bottom: 8px; }
.alert-attr { font-size: 13px; color: var(--text-2); background: var(--bg); border-radius: 8px; padding: 10px 12px; line-height: 1.7; }
.attr-label { color: var(--primary); font-weight: 500; margin-right: 8px; }
</style>
