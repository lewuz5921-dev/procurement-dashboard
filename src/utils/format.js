/**
 * 金额格式化 —— 全站唯一口径，禁止在页面里另行 toFixed
 *
 * 分段规则（避免「¥279 → ¥0.0 万」这类失真显示）：
 *   ≥ 1 亿        → 亿元 + 2 位小数
 *   ≥ 100 万      → 万元 + 1 位小数
 *   1 万 ~ 100 万 → 万元 + 2 位小数
 *   < 1 万        → 元 + 千分位
 * 负数在货币符号前加负号：−¥279
 */
const MINUS = '\u2212'   // 真正的减号，与连字符区分

function group(n, min, max) {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: min, maximumFractionDigits: max })
}

/** 展示区（卡片 / 图表轴 / tooltip / 问答文案）：按量级自动分段 */
export function fmtMoney(v) {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v < 0 ? MINUS : ''
  const a = Math.abs(v)
  if (a >= 1e8) return `${sign}¥${group(a / 1e8, 2, 2)} 亿`
  if (a >= 1e6) return `${sign}¥${group(a / 1e4, 1, 1)} 万`
  if (a >= 1e4) return `${sign}¥${group(a / 1e4, 2, 2)} 万`
  return `${sign}¥${group(Math.round(a), 0, 0)}`
}

/** 表格主区：固定万元 + 指定小数位（该区各行金额均 ≥ 1 万，不会出现 ¥0.0 万） */
export function fmtMoneyWan(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v < 0 ? MINUS : ''
  return `${sign}¥${group(Math.abs(v) / 1e4, digits, digits)} 万`
}

/** 纯数值（图表轴标签用，不带货币符号） */
export function fmtWan(v, digits = 0) {
  return group((v || 0) / 1e4, digits, digits)
}
