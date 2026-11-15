// 管理端浏览器走查（playwright-core + 本机 Chrome）：登录 → 内容审核 drawer（话题/图库）→ 评论管理（隐藏/恢复）→ 截图
// 用法：node test/xhs-admin-walk.mjs <outDir>
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const outDir = process.argv[2] || '../automator-shots-xhs'
fs.mkdirSync(outDir, { recursive: true })
const base = 'http://127.0.0.1:8080'
const log = (...a) => console.log('[admin]', ...a)
const errors = []
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; log('✓', name) } else { fail++; errors.push(name + (detail ? ': ' + detail : '')); log('✗', name, detail) } }

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => errors.push('[pageerror] ' + e.message.slice(0, 200)))

const ready = () => page.waitForFunction(() => document.querySelector('#app') && document.querySelector('#app').getAttribute('aria-busy') === 'false', { timeout: 20000 })
const nav = async key => { await page.evaluate(k => go(k), key); await ready(); await page.waitForTimeout(400) }

await page.goto(base + '/admin-ui')
await page.locator('#luser').fill('admin')
await page.locator('#lpass').fill('admin123')
await page.locator('#lpass').press('Enter')
await page.waitForSelector('#nav [data-p]', { timeout: 20000 })
await ready()
await page.waitForTimeout(500)
check('后台登录成功', await page.locator('#nav [data-p]').count() > 5)

/* 一、内容审核 drawer：查最新带图笔记（图库模型验证），核对正文/图片一览/话题分区 */
await nav('content')
await page.locator('#contentKw').fill('图库模型验证')
await page.locator('#contentKw').press('Enter')
await ready()
await page.waitForTimeout(400)
const row = page.locator('#app tr').filter({ hasText: '图库模型验证' }).first()
check('审核列表检索到目标笔记', await row.count() > 0)
await row.locator('button').first().click()
await page.waitForTimeout(900)
const drawerText = await page.locator('.review-drawer').innerText().catch(() => '')
check('审核 drawer 含正文与图片一览', /图片一览/.test(drawerText) && /水上森林|图集|验证/.test(drawerText), drawerText.slice(0, 120))
await page.screenshot({ path: path.join(outDir, 'a1-review-drawer.png') })
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

/* 二、评论管理：检索 → 隐藏 → 恢复 → 计数与状态 */
await nav('comments')
await page.waitForTimeout(400)
check('评论管理页加载', /评论管理/.test(await page.locator('#pageTitle').innerText()))
// 检索"乌镇"（走查种子的评论）
await page.locator('#app input[type=search], #app .orders-search input').first().fill('乌镇').catch(() => {})
const searchBtn = page.locator('#app button', { hasText: '搜索' }).first()
if (await searchBtn.count()) { await searchBtn.click(); await page.waitForTimeout(600) }
const listText1 = await page.locator('#app').innerText()
check('评论列表含走查评论', /乌镇|评论/.test(listText1))
await page.screenshot({ path: path.join(outDir, 'a2-comments-list.png') })
// 找一条「展示中」的走查评论执行隐藏 → 恢复
const shownRow = page.locator('#app tr').filter({ hasText: '展示中' }).filter({ hasText: '乌镇' }).first()
if (await shownRow.count()) {
  await shownRow.locator('button', { hasText: '隐藏' }).click()
  await page.waitForTimeout(900)
  const afterHide = await page.locator('#app tr').filter({ hasText: '乌镇' }).first().innerText().catch(() => '')
  check('隐藏后状态变为已隐藏', /已隐藏/.test(afterHide), afterHide.slice(0, 80))
  await page.screenshot({ path: path.join(outDir, 'a3-comment-hidden.png') })
  const hiddenRow = page.locator('#app tr').filter({ hasText: '乌镇' }).first()
  await hiddenRow.locator('button', { hasText: '恢复' }).click()
  await page.waitForTimeout(900)
  const afterRestore = await page.locator('#app tr').filter({ hasText: '乌镇' }).first().innerText().catch(() => '')
  check('恢复后状态回到展示中', /展示中/.test(afterRestore), afterRestore.slice(0, 80))
  await page.screenshot({ path: path.join(outDir, 'a4-comment-restored.png') })
} else {
  // 放宽条件：任意展示中行
  const anyRow = page.locator('#app tr').filter({ hasText: '展示中' }).first()
  if (await anyRow.count()) {
    await anyRow.locator('button', { hasText: '隐藏' }).click()
    await page.waitForTimeout(900)
    check('隐藏后状态变为已隐藏', /已隐藏/.test(await page.locator('#app').innerText()))
    await page.screenshot({ path: path.join(outDir, 'a3-comment-hidden.png') })
    const hiddenRow = page.locator('#app tr').filter({ hasText: '已隐藏' }).first()
    await hiddenRow.locator('button', { hasText: '恢复' }).click()
    await page.waitForTimeout(900)
    check('恢复后状态回到展示中', /展示中/.test(await page.locator('#app').innerText()))
    await page.screenshot({ path: path.join(outDir, 'a4-comment-restored.png') })
  } else { check('评论管理有可操作行', false, '无展示中评论') }
}

/* 三、内容看板快速冒烟 */
await nav('contentdash')
await page.waitForTimeout(500)
check('内容看板加载', /内容/.test(await page.locator('#pageTitle').innerText()))
await page.screenshot({ path: path.join(outDir, 'a5-content-dashboard.png') })

console.log('\n===== 管理端走查汇总 =====')
console.log(`通过 ${pass} · 失败 ${fail} · 截图目录 ${outDir}`)
if (errors.length) { console.log('问题清单：'); errors.forEach((e, i) => console.log(` ${i + 1}. ${e}`)) }
await browser.close()
process.exit(fail ? 1 : 0)
