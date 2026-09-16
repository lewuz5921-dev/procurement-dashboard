<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { store, load } from '../data/store'
import { runAllRules, RULES, LEVEL_BASIS, IMPACT_BASIS, DROP_TYPES } from '../utils/rules'
import { savingsRate, fmtMoney, fmtMoneyWan, fmtPct } from '../utils/metrics'

const ready = ref(false)
const alerts = ref([])
const rulesOpen = ref(false)
const basisOpen = ref(false)
const flashBenchmark = ref(false)

const route = useRoute()

onMounted(async () => {
  await load()
  // 规则引擎在全量数据上运行（不随时间筛选变化，保证检测口径一致）
  alerts.value = runAllRules(store.orders, store.suppliers)
  ready.value = true
  // 首页「口径说明 →」直达：一次点击滚到口径构成表
  if (route.query.focus === 'benchmark') {
    await nextTick()
    await focusBenchmark()
  }
})

/**
 * 滚动到口径构成表。
 * 该表位于页尾，滚到底后仍不会贴到视口顶部，因此额外做一次高亮，
 * 让「已经跳过来了」这件事一眼可见，避免用户以为链接没生效。
 */
async function focusBenchmark() {
  for (let i = 0; i < 3; i++) {
    document.getElementById('benchmark')?.scrollIntoView({ behavior: 'auto', block: 'start' })
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 60)))
  }
  flashBenchmark.value = true
  setTimeout(() => { flashBenchmark.value = false }, 2400)
}

const levelName = { high: '高风险', medium: '中风险' }
const ruleName = Object.fromEntries(RULES.map(r => [r.id, r.name]))

const highCount = computed(() => alerts.value.filter(a => a.level === 'high').length)
const medCount = computed(() => alerts.value.filter(a => a.level === 'medium').length)

/** 基准覆盖率低于阈值时，成本节约率不可计算 —— 此处同步说明，不给数字 */
const sv = computed(() => savingsRate(store.orders))

/** OPT-11：样本量 < 10 单的基准口径行降级为小字 + 样本提示 */
const SMALL_SAMPLE = 10
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

    <!-- OPT-07：规则定义默认折叠，让首条预警进入首屏 -->
    <div class="card fold-card" :class="{ open: rulesOpen }">
      <div class="fold-head" @click="rulesOpen = !rulesOpen">
        <span class="fold-caret">{{ rulesOpen ? '▾' : '▸' }}</span>
        规则定义（点击展开）
        <span class="fold-hint">{{ RULES.length }} 条规则 · 触发条件均可解释、可配置</span>
      </div>
      <div v-show="rulesOpen" class="rule-grid">
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

    <!-- OPT-02：披露与代码一致的风险分级依据 -->
    <div class="card fold-card" :class="{ open: basisOpen }">
      <div class="fold-head" @click="basisOpen = !basisOpen">
        <span class="fold-caret">{{ basisOpen ? '▾' : '▸' }}</span>
        风险分级依据（点击展开）
        <span class="fold-hint">等级 = 规则内的处置优先级，不做跨规则统一排序</span>
      </div>
      <div v-show="basisOpen" class="basis-body">
        <table class="tbl">
          <thead>
            <tr><th>规则</th><th>等级</th><th>判定条件</th><th>影响金额口径</th></tr>
          </thead>
          <tbody>
            <tr v-for="(b, i) in LEVEL_BASIS" :key="i">
              <td><span class="tag tag-routine">{{ b.rule }}</span> {{ ruleName[b.rule] }}</td>
              <td :class="b.level === 'high' ? 'txt-danger' : 'txt-warn'">{{ levelName[b.level] }}</td>
              <td>{{ b.cond }}</td>
              <td class="dim">{{ (IMPACT_BASIS.find(x => x.rule === b.rule) || {}).desc }}</td>
            </tr>
          </tbody>
        </table>
        <div class="basis-note">
          各规则触发量纲不同（百分点 / 集中度 / 标准差 / TCO 金额），因此「高风险」只表示<b>在该规则内已达需立即处置的程度</b>，
          不表示跨规则可比的统一分值。列表排序为：风险等级降序 → 影响金额降序；影响金额仅在同一等级内比较。
        </div>
        <div class="basis-sub">R1 分型规则（按顺序匹配，命中即停止）</div>
        <table class="tbl">
          <thead><tr><th>顺序</th><th>类型</th><th>判定条件</th></tr></thead>
          <tbody>
            <tr v-for="(t, i) in DROP_TYPES" :key="t.key">
              <td>{{ i + 1 }}</td><td>{{ t.name }}</td><td>{{ t.cond }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-for="(a, i) in alerts" :key="i" class="card alert-card">
      <div class="alert-head">
        <span class="tag" :class="a.level === 'high' ? 'tag-danger' : 'tag-warning'">{{ levelName[a.level] }}</span>
        <span class="tag tag-routine">{{ ruleName[a.rule] }}</span>
        <span v-if="a.dropType" class="tag tag-outline">{{ a.dropType }}</span>
        <b class="alert-supplier">{{ a.supplierName }}</b>
        <span v-if="a.impactAmount" class="alert-impact">影响 {{ fmtMoney(a.impactAmount) }}</span>
      </div>
      <div class="alert-detail">{{ a.detail }}</div>
      <div class="alert-attr">
        <span class="attr-label">归因分析</span>{{ a.attribution }}
      </div>
    </div>

    <div v-if="!alerts.length" class="empty">未检测到异常</div>

    <!-- OPT-05：口径构成表由首屏迁入本页 -->
    <div class="card" id="benchmark" :class="{ 'flash': flashBenchmark }">
      <div class="card-title">
        成本节约率口径构成（按基准价来源拆解）
        <span class="card-hint">基准价四级优先取数：合同价 → 上次成交价（折算至本期行情）→ 当期询价最低有效报价 → 滚动 12 个月均价</span>
      </div>
      <template v-if="sv.computable">
        <table class="tbl">
          <thead>
            <tr><th>基准口径</th><th>订单数</th><th>基准金额</th><th>节约额</th><th>节约率</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in sv.bySource" :key="s.key" :class="{ 'row-minor': s.orders < SMALL_SAMPLE }">
              <td>
                <span :title="s.desc">{{ s.short }}</span>
                <span v-if="s.orders < SMALL_SAMPLE" class="sample-note">样本不足（{{ s.orders }} 单），仅供参考</span>
              </td>
              <td>{{ s.orders }}</td>
              <td>{{ fmtMoneyWan(s.benchmarkTotal) }}</td>
              <td :class="s.savings >= 0 ? 'txt-good' : 'txt-danger'">
                {{ s.orders < SMALL_SAMPLE ? fmtMoney(s.savings) : fmtMoneyWan(s.savings) }}
              </td>
              <td :class="s.rate >= 0 ? 'txt-good' : 'txt-danger'">{{ s.rate >= 0 ? '+' : '' }}{{ fmtPct(s.rate, 2) }}</td>
            </tr>
            <tr class="row-total">
              <td>合计（有基准价）</td>
              <td>{{ sv.covered }}</td>
              <td>{{ fmtMoneyWan(sv.benchmarkTotal) }}</td>
              <td :class="sv.savings >= 0 ? 'txt-good' : 'txt-danger'">{{ fmtMoneyWan(sv.savings) }}</td>
              <td :class="sv.rate >= 0 ? 'txt-good' : 'txt-danger'">{{ sv.rate >= 0 ? '+' : '' }}{{ fmtPct(sv.rate, 2) }}</td>
            </tr>
          </tbody>
        </table>
        <div class="page-desc" style="margin-top: 10px">
          基准覆盖率 {{ fmtPct(sv.coverage * 100, 1) }}（{{ sv.covered }} / {{ sv.total }} 单），
          {{ sv.uncovered }} 单无基准价未计入 —— 无基准的订单不补默认值，宁可少算，不可假算。
          ③ 口径为负说明成交价高于当期最低有效报价，询价环节仍有下探空间。
        </div>
      </template>
      <div v-else class="empty">基准覆盖率 {{ fmtPct(sv.coverage * 100, 1) }} 低于 {{ fmtPct(sv.threshold * 100, 0) }} 阈值，基准价缺失，暂不可计算</div>
    </div>
  </div>
</template>

<style scoped>
.fold-card { margin-bottom: 16px; }
.fold-head { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; cursor: pointer; user-select: none; }
.fold-caret { color: var(--text-2); font-size: 12px; width: 12px; }
.fold-hint { margin-left: auto; font-size: 12px; font-weight: 400; color: var(--text-2); }
.rule-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
.rule-item { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; }
.basis-body { margin-top: 14px; }
.basis-note { font-size: 12px; color: var(--text-2); line-height: 1.8; background: var(--bg); border-radius: 8px; padding: 10px 12px; margin-top: 10px; }
.basis-note b { color: var(--text); }
.basis-sub { font-size: 13px; font-weight: 500; margin: 16px 0 8px; }

.alert-card { border-left: 3px solid var(--warning); }
.alert-card:has(.tag-danger) { border-left-color: var(--danger); }
.alert-head { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.alert-supplier { font-size: 15px; }
.alert-impact { margin-left: auto; font-size: 12px; color: var(--text-2); }
.alert-detail { font-size: 13px; margin-bottom: 8px; }
.alert-attr { font-size: 13px; color: var(--text-2); background: var(--bg); border-radius: 8px; padding: 10px 12px; line-height: 1.7; }
.attr-label { color: var(--primary); font-weight: 500; margin-right: 8px; }

/* 下钻落点高亮：说明这张表是被「点进来的」 */
.flash { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-bg); transition: box-shadow .2s, border-color .2s; }

.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th, .tbl td { padding: 8px 10px; text-align: right; border-bottom: 1px solid var(--border); }
.tbl th:first-child, .tbl td:first-child { text-align: left; }
.tbl th { color: var(--text-2); font-weight: 500; font-size: 12px; }
.row-total td { font-weight: 600; border-top: 1px solid var(--border); border-bottom: none; }
.row-minor td { font-size: 12px; color: var(--text-2); }
.sample-note { display: block; font-size: 11px; color: var(--text-2); margin-top: 2px; }
.txt-good { color: var(--success); }
.txt-danger { color: var(--danger); }
.txt-warn { color: var(--warning); }
.dim { color: var(--text-2); font-size: 12px; text-align: left; }
</style>
