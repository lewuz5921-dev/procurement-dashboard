/**
 * 线上验收：真实浏览器加载 + 穷尽拉取全部静态资源做密钥特征扫描 + 关键行为断言
 *
 * 用法：
 *   node scripts/verify-live.cjs [站点根地址]
 *   NODE_PATH=<playwright-core 所在目录> node scripts/verify-live.cjs
 *
 * 依赖系统 Chrome（executablePath 见下），如需其他浏览器请自行修改。
 * 入口 URL 会附带随机参数以绕过 CDN 边缘缓存 —— 发布后立刻验收时，
 * 不同边缘节点可能仍返回上一版产物，不带参数会得到误判。
 */
const { chromium } = require('playwright-core')
const path = require('path')

const EXE = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ROOT = (process.argv[2] || 'https://procurement-kpi-board-79919.app.workbuddy.host/').replace(/\/?$/, '/')
const OUT = path.join(__dirname, '..', 'verify')
const bust = () => ROOT + '?_=' + Date.now() + Math.random()

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errs = [], bad = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push(String(e)))
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()) })
  let fails = 0
  const ok = (n, c) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n) }

  // 1. 走完三个主线路由（触发懒加载分包），并做一次真实提问
  for (const [name, hash] of [['live-overview', '#/'], ['live-insight', '#/insight'], ['live-query', '#/query']]) {
    await page.goto(bust() + hash, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  }
  await page.locator('.example-btn').first().click()
  await page.waitForTimeout(900)
  const ans = (await page.locator('.msg.bot .msg-content').last().innerText()).trim()
  console.log('   规则模式答案:', ans.slice(0, 60) + '…')
  ok('规则解析模式可回答示例问题', ans.includes('供应商共'))

  // 2. 穷尽拉取全部已请求资源并做密钥特征扫描（含懒加载分包）
  const urls = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(r => r.name).filter(u => /\.(js|css|json)(\?|$)/.test(u)))
  console.log('   已请求静态资源数:', urls.length)
  const scan = await page.evaluate(async (list) => {
    const skRe = /sk-[A-Za-z0-9_-]{16,}/g
    const res = []
    for (const u of list) {
      try {
        const t = await (await fetch(u, { cache: 'reload' })).text()
        res.push({ u, sk: (t.match(skRe) || []).length, dom: (t.match(/deepseek/gi) || []).length })
      } catch (e) { res.push({ u, err: String(e.message) }) }
    }
    return res
  }, urls)
  const skHit = scan.filter(r => r.sk > 0)
  const domHit = scan.filter(r => r.dom > 0)
  console.log('   含 sk- 的资源:', skHit.length ? skHit : 'NONE')
  console.log('   含上游域名的资源:', domHit.length ? domHit.map(r => r.u.split('/').pop() + '×' + r.dom) : 'NONE')
  ok('线上全部资源无 sk- 特征', skHit.length === 0)
  ok('JS/CSS 分包无上游域名字面量', !domHit.some(r => /\.(js|css)$/.test(r.u.split('?')[0])))

  // 3. 关键行为断言
  await page.goto(bust() + '#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const body = await page.locator('body').innerText()
  ok('首屏无口径构成表（无表格类元素）', await page.locator('table').count() === 0)
  ok('首屏无与故事卡重复的「主要拖累」', !body.includes('主要拖累'))
  ok('存在「口径说明 →」入口', body.includes('口径说明'))
  ok('无 ¥0.0 万 失真显示', !body.includes('¥0.0 万'))
  await page.locator('.drill', { hasText: '口径说明' }).click()
  await page.waitForTimeout(1300)
  const y = await page.locator('#benchmark').evaluate(el => Math.round(el.getBoundingClientRect().top))
  ok('口径表一次点击即进入视口 (top=' + y + ')', y >= 0 && y < 1000)

  await page.goto(bust() + '#/insight', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const levels = (await page.locator('.alert-head .tag:first-child').allInnerTexts()).map(s => s.trim())
  console.log('   预警等级序:', levels.join(' → '))
  ok('列表前 2 项均为高风险', levels[0] === '高风险' && levels[1] === '高风险')
  const types = (await page.locator('.alert-head .tag-outline').allInnerTexts()).map(s => s.trim())
  console.log('   R1 分型:', types.join(' / '))
  ok('R1 分型 = 断崖型/高位回落型/渐进型/渐进型',
    JSON.stringify(types) === JSON.stringify(['断崖型', '高位回落型', '渐进型', '渐进型']))
  ok('风险分级依据区块存在', (await page.locator('body').innerText()).includes('风险分级依据'))
  ok('降级行含「样本不足」提示', (await page.locator('.row-minor').first().innerText()).includes('样本不足'))

  console.log('console errors:', errs.length ? errs : 'NONE')
  console.log('http >=400:', bad.length ? bad : 'NONE')
  console.log(fails ? `\n${fails} 项未通过` : '\n线上全部通过')
  await browser.close()
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
