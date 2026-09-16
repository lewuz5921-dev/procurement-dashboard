const { chromium } = require('playwright-core')
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const B = 'http://localhost:4173/#'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push(String(e)))
  let fails = 0
  const ok = (n, c) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n) }

  await page.goto(B + '/query', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  ok('问答页默认模式标签 = 规则解析模式', (await page.locator('.filters .tag').first().innerText()).trim() === '规则解析模式')

  // 1. 六个示例问题在规则解析模式下都必须出答案
  const n = await page.locator('.example-btn').count()
  for (let i = 0; i < n; i++) {
    const q = (await page.locator('.example-btn').nth(i).innerText()).trim()
    await page.locator('.example-btn').nth(i).click()
    await page.waitForTimeout(500)
    const a = (await page.locator('.msg.bot .msg-content').last().innerText()).trim()
    ok(`示例「${q}」有答案`, !a.includes('没能理解'))
    console.log('    → ' + a.slice(0, 78))
  }

  // 2. API 设置（BYOK）
  await page.getByRole('button', { name: 'API 设置' }).click()
  await page.waitForTimeout(400)
  ok('API 设置面板可展开', await page.locator('.settings').isVisible())
  await page.screenshot({ path: 'verify/query-settings.png', fullPage: true })
  await page.locator('.set-input').first().fill('sk-TEST-0000000000000000')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(400)
  ok('保存密钥后切换为 LLM 模式', (await page.locator('.filters .tag').first().innerText()).trim() === 'LLM 模式')
  await page.getByRole('button', { name: 'API 设置' }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '清除本机密钥' }).click()
  await page.waitForTimeout(400)
  ok('清除后回到规则解析模式', (await page.locator('.filters .tag').first().innerText()).trim() === '规则解析模式')
  ok('localStorage 中密钥已清空', await page.evaluate(() => localStorage.getItem('pd.llm.key')) === null)

  // 3. 首页 → 口径说明 → 一次点击到达
  await page.goto(B + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  ok('首屏已无口径构成表', await page.locator('table').count() === 0)
  await page.locator('.drill', { hasText: '口径说明' }).click()
  await page.waitForTimeout(1200)
  ok('URL 带 focus=benchmark', page.url().includes('focus=benchmark'))
  const y = await page.locator('#benchmark').evaluate(el => Math.round(el.getBoundingClientRect().top))
  // 表格位于页尾，滚到底后仍不可能贴到顶部，因此判定标准是「已进入视口」
  ok('口径表一次点击即进入视口 (top=' + y + ' / 视口 1000)', y >= 0 && y < 1000)
  ok('落点高亮已生效', await page.locator('#benchmark.flash').count() === 1)
  await page.screenshot({ path: 'verify/insight-benchmark.png' })

  // 4. 洞察页：折叠 + 排序
  await page.goto(B + '/insight', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const y2 = await page.locator('.alert-card').first().evaluate(el => Math.round(el.getBoundingClientRect().top))
  ok('首条预警在首屏内 (top=' + y2 + ')', y2 < 1000)
  const levels = await page.locator('.alert-head .tag:first-child').allInnerTexts()
  console.log('   等级序:', levels.map(s => s.trim()).join(' → '))
  ok('前 2 项均为高风险', levels[0].trim() === '高风险' && levels[1].trim() === '高风险')
  const types = await page.locator('.alert-head .tag-outline').allInnerTexts()
  console.log('   R1 分型:', types.map(s => s.trim()).join(' / '))
  ok('R1 出现 4 种分型记录', types.length === 4)
  const minor = await page.locator('.row-minor').count()
  ok('存在降级行（样本不足）', minor >= 1)
  const minorTxt = await page.locator('.row-minor').first().innerText()
  ok('降级行含「样本不足」提示', minorTxt.includes('样本不足'))
  ok('全站无 ¥0.0 万 失真显示', !(await page.locator('body').innerText()).includes('¥0.0 万'))

  console.log('console errors:', errs.length ? errs : 'NONE')
  console.log(fails ? `\n${fails} 项未通过` : '\n全部通过')
  await browser.close()
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
