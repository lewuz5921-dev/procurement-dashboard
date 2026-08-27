<script setup>
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const navs = [
  { path: '/', label: '采购总览' },
  { path: '/supplier', label: '供应商评估' },
  { path: '/fulfillment', label: '履约监控' },
  { path: '/cost', label: '成本分析' },
  { path: '/insight', label: '智能洞察' },
  { path: '/query', label: '智能问答' }
]
const active = computed(() => route.path)
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">采购数字化看板</div>
      <div class="logo-sub">Procurement Dashboard</div>
      <router-link v-for="n in navs" :key="n.path" :to="n.path" class="nav-item"
        :class="{ active: active === n.path }">{{ n.label }}</router-link>
    </aside>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>
