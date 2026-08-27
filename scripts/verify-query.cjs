// 验证智能问答页：渲染 + 点击示例问题 + 检查答案
const { chromium } = require('playwright-core')

;(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const logs = []
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()) })
  page.on('pageerror', e => logs.push('pageerror: ' + String(e)))

  await page.goto('http://localhost:4173/#/query', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // 找示例问题按钮，点第一个
  const btn = await page.$('.example-btn')
  await btn.click()
  await page.waitForTimeout(5000)  // 等 LLM 调用返回

  // 读取消息
  const msgs = await page.$$eval('.msg', els => els.map(e => ({
    role: e.className.includes('user') ? 'user' : 'bot',
    content: e.querySelector('.msg-content')?.innerText || '',
    meta: e.querySelector('.msg-meta')?.innerText || ''
  })))

  console.log('=== 消息内容 ===')
  msgs.forEach(m => console.log(`[${m.role}] ${m.content}`))
  console.log('=== meta ===')
  msgs.forEach(m => { if (m.meta) console.log(m.meta) })
  console.log('=== console logs ===')
  logs.forEach(l => console.log(l))

  await page.screenshot({ path: 'C:/Users/罗雨辰/WorkBuddy/2026-08-26-22-31-35/procurement-dashboard/verify/query.png', fullPage: true })
  await browser.close()
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
