import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'overview', meta: { title: '采购总览' }, component: () => import('../views/OverviewView.vue') },
  { path: '/supplier', name: 'supplier', meta: { title: '供应商评估' }, component: () => import('../views/SupplierView.vue') },
  { path: '/fulfillment', name: 'fulfillment', meta: { title: '履约监控' }, component: () => import('../views/FulfillmentView.vue') },
  { path: '/cost', name: 'cost', meta: { title: '成本分析' }, component: () => import('../views/CostView.vue') },
  { path: '/insight', name: 'insight', meta: { title: '智能洞察' }, component: () => import('../views/InsightView.vue') },
  { path: '/query', name: 'query', meta: { title: '智能问答' }, component: () => import('../views/SmartQueryView.vue') }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
