// 使用系统 Chrome 验证看板页面渲染（截图 + 控制台错误捕获）
const { chromium } = require('playwright-core')

const PAGES = [
  ['overview', 'http://localhost:4173/#/'],
  ['supplier', 'http://localhost:4173/#/supplier'],
  ['fulfillment', 'http://localhost:4173/#/fulfillment'],
  ['cost', 'http://localhost:4173/#/cost'],
  ['insight', 'http://localhost:4173/#/insight']
]

;(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))

  for (const [name, url] of PAGES) {
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `C:/Users/罗雨辰/WorkBuddy/2026-08-26-22-31-35/procurement-dashboard/verify/${name}.png`, fullPage: true })
    console.log('captured:', name)
  }
  console.log('console errors:', errors.length ? errors : 'NONE')
  await browser.close()
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
