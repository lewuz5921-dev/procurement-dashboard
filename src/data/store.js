/**
 * 数据层：加载本地 JSON 模拟数据集
 * 真实场景中，本层替换为后端 API（如 Java/SQL 数据服务）即可，
 * 指标计算逻辑（utils/metrics.js）保持不变 —— 数据分层设计。
 */
import { reactive, readonly } from 'vue'

const state = reactive({
  suppliers: [],
  orders: [],
  loaded: false,
  // 全局筛选器（当前版本仅时间范围，降低复杂度）
  monthFrom: '',   // 'YYYY-MM'
  monthTo: ''
})

async function load() {
  if (state.loaded) return
  const [sup, ord] = await Promise.all([
    fetch('./data/suppliers.json').then(r => r.json()),
    fetch('./data/orders.json').then(r => r.json())
  ])
  state.suppliers = sup.suppliers
  state.orders = ord.orders
  const months = [...new Set(state.orders.map(o => o.month))].sort()
  state.monthFrom = months[0]
  state.monthTo = months[months.length - 1]
  state.loaded = true
}

function filteredOrders() {
  return state.orders.filter(o =>
    (!state.monthFrom || o.month >= state.monthFrom) &&
    (!state.monthTo || o.month <= state.monthTo)
  )
}

function allMonths() {
  return [...new Set(state.orders.map(o => o.month))].sort()
}

function setRange(from, to) {
  state.monthFrom = from
  state.monthTo = to
}

export const store = readonly(state)
export { load, filteredOrders, allMonths, setRange }

/** 供应商全量采购额（不受时间筛选影响，用于 Kraljic 定位） */
export function supplierSpendAll(supplierId) {
  return state.orders
    .filter(o => o.supplierId === supplierId)
    .reduce((s, o) => s + o.amount, 0)
}
