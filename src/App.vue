<script setup>
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()

/**
 * 主线收敛：侧边栏只保留「发生了什么 → 为什么 → 直接问」三项主流程。
 * 履约监控 / 成本分析 / 供应商评估 降级为总览页的下钻页，不占平级导航
 * （路由未删除，仍可通过 URL 直达，例如 /fulfillment?supplier=A01）。
 */
const navs = [
  { path: '/', label: '采购总览', sub: '发生了什么' },
  { path: '/insight', label: '智能洞察', sub: '为什么' },
  { path: '/query', label: '智能问答', sub: '直接问数' }
]
const active = computed(() => route.path)
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">采购数字化看板</div>
      <div class="logo-sub">Procurement Dashboard</div>
      <router-link v-for="n in navs" :key="n.path" :to="n.path" class="nav-item"
        :class="{ active: active === n.path }">
        <span>{{ n.label }}</span>
        <span class="nav-sub">{{ n.sub }}</span>
      </router-link>
    </aside>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>
