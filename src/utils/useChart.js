/**
 * ECharts 组合式封装：统一初始化、自适应、销毁、事件绑定
 */
import { onMounted, onBeforeUnmount, watch, shallowRef } from 'vue'
import * as echarts from 'echarts'

export function useChart(elRef, optionGetter, deps, onClick) {
  const chart = shallowRef(null)
  let ro = null

  function render() {
    if (!elRef.value) return
    if (!chart.value) {
      chart.value = echarts.init(elRef.value)
      if (onClick) chart.value.on('click', onClick)
    }
    chart.value.setOption(optionGetter(), true)
    chart.value.resize()
  }

  onMounted(() => {
    render()
    ro = new ResizeObserver(() => chart.value && chart.value.resize())
    if (elRef.value) ro.observe(elRef.value)
  })

  onBeforeUnmount(() => {
    ro && ro.disconnect()
    chart.value && chart.value.dispose()
  })

  // flush: 'post' 确保在 DOM 更新（v-if 切换后）再渲染，避免 elRef 尚未挂载
  if (deps) watch(deps, render, { deep: true, flush: 'post' })

  return { chart, render }
}
