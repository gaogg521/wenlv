// V94 主体资源审批 · 关键流程截图证据(playwright-core,访问 18243 截图专用隔离环境)
// 产出:api/subject-approval-shots/*.png —— 登录页/主体工作台/编辑器审批模式/审批详情/影响确认/收件箱/权限配置/运营工作台
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = process.env.API_BASE || 'http://127.0.0.1:18243'
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'subject-approval-shots')
fs.mkdirSync(outDir, { recursive: true })
const call = async (method, p, body, tok) => (await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined })).json()
const login = async (u, pw) => (await (await fetch(base + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) })).json()).data

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-device-scale-factor=1.25'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const shot = async (name, p) => { const target = p || page; await target.waitForTimeout(900); await target.screenshot({ path: path.join(outDir, name + '.png'), fullPage: false }); console.log('  📸 ' + name) }

// 预置账号(ASCII 用户名 + 中文显示名)
const sup = await login('admin', process.env.ADMIN_INIT_PASSWORD || 'admin123')
const stamp = 'SHOT' + Date.now().toString(36).slice(-5)
const mkAcc = async (role, tag, name, subjectId) => {
  const cr = await call('POST', '/admin/accounts', { username: stamp + tag, displayName: name, role, subjectId: subjectId ? String(subjectId) : undefined, password: 'TempPass2026' }, sup.token)
  if (!cr.data) throw new Error('建号失败: ' + cr.msg)
  return cr.data
}
const mpAcc = await mkAcc('merchant_partner', 'mp', '商户主体·安麓大夫第(演示)', '1')
const opsAcc = await mkAcc('ops', 'ops', '平台运营·演示', null)
const mpLg = await login(stamp + 'mp', 'TempPass2026')
const opsLg = await login(stamp + 'ops', 'TempPass2026')
const mpTok = mpLg.token, supTok = sup.token, opsTok = opsLg.token

// 1) 登录页(含平台运营演示按钮)
await page.goto(base + '/admin-ui/')
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await page.reload()
await page.waitForSelector('#luser', { timeout: 15000 })
await shot('01-登录页-本地演示账号(含平台运营)')

// 2) 超管登录
await page.fill('#luser', 'admin')
await page.fill('#lpass', process.env.ADMIN_INIT_PASSWORD || 'admin123')
await page.click('#loginSubmit')
await page.waitForTimeout(2500)

// 3) 主体资源权限配置页 + 按员工动作授权
await page.goto(base + '/admin-ui/#accounts')
await page.waitForTimeout(1200)
await page.evaluate("window.__accTab='subjectperms'; accounts()")
await page.waitForTimeout(1000)
await shot('02-主体资源权限配置页(超管)')
await page.evaluate((a) => window.accountActionModal(a.id, a.name), { id: opsAcc.id, name: stamp + 'ops' })
await page.waitForTimeout(700)
await shot('03-按员工动作授权弹窗')
await page.evaluate((id) => { document.getElementById('aaReason').value = '演示:授予运营主体审批权'; window.accountActionSet(id, 'subject.approve', 1) }, opsAcc.id)
await page.waitForTimeout(700)
try { const b = page.locator('.modal-foot .btn.primary').last(); if (await b.count()) { await b.click(); await page.waitForTimeout(700) } } catch { /* 忽略 */ }
try { await page.evaluate("document.querySelector('.modal-x')?.click()") } catch { /* 忽略 */ }

// 4) 商户主体 → 主体工作台
const mpCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const mpPage = await mpCtx.newPage()
await mpPage.goto(base + '/admin-ui/')
await mpPage.evaluate((t) => { localStorage.setItem('admin_token', t); localStorage.setItem('admin_me', JSON.stringify({ uid: 999, role: 'merchant_partner', displayName: '商户主体·安麓大夫第(演示)' })) }, mpTok)
await mpPage.reload()
await mpPage.waitForTimeout(1800)
await mpPage.goto(base + '/admin-ui/#subjectwork')
await mpPage.waitForTimeout(1800)
await shot('04-主体工作台-商户主体(资源列表与入口)', mpPage)

// 5) 编辑器审批模式(商品修改申请 + 草稿)
const prods = await call('GET', '/admin/products?page=1&pageSize=20', null, mpTok)
const prodsArr = Array.isArray(prods?.data) ? prods.data : (prods.data?.items || prods.items || [])
const pid = prodsArr[0]?.id
let draft = null
if (pid) {
  await mpPage.evaluate(`swEditProduct(${pid})`)
  await mpPage.waitForTimeout(1400)
  await shot('05-资源编辑-审批模式(字段投影+申请信息)', mpPage)
  await mpPage.evaluate("(() => { const n=document.getElementById('eeApNote'); if(n) n.value='演示:旺季调价依据'; const i=document.getElementById('eeApImpact'); if(i) i.value='演示:已下单游客按原约定履约'; const el=document.querySelector('[data-field=\"price_from\"] input'); if (el) { el.value='328'; el.dispatchEvent(new Event('input',{bubbles:true})) } })()")
  await mpPage.click('#eeDraft')
  await mpPage.waitForTimeout(1200)
  await shot('06-保存草稿成功', mpPage)
  const reqs = await call('GET', '/admin/subject-requests?view=mine&status=0', null, mpTok)
  draft = (reqs.data?.items || reqs.items || [])[0]
  if (draft) {
    await mpPage.evaluate(`swDetail(${draft.id})`)
    await mpPage.waitForTimeout(900)
    await shot('07-申请详情(主体视角-草稿)', mpPage)
    await mpPage.evaluate("document.querySelector('.modal-x')?.click()")
    await mpPage.waitForTimeout(400)
    await mpPage.evaluate((id) => { window.swSubmitDraft(id) }, draft.id)
    await mpPage.waitForTimeout(700)
    await shot('08-提交审核确认', mpPage)
    try { const c = mpPage.locator('.modal-foot .btn.primary').last(); if (await c.count()) { await c.click(); await mpPage.waitForTimeout(1200) } } catch { /* 忽略 */ }
    await shot('09-提交成功-待审核', mpPage)
  }
}

// 6) 超管审批页:列表 + 详情三列对比 + 批准弹窗影响勾选
await page.goto(base + '/admin-ui/#subjectapprove')
await page.waitForTimeout(1600)
await shot('10-审批列表页')
if (draft) {
  await page.evaluate(`saDetail(${draft.id})`)
  await page.waitForTimeout(1100)
  await shot('11-审批详情-三列对比与重点影响')
  await page.evaluate("document.querySelector('.modal-x')?.click()")
  await page.waitForTimeout(400)
  await page.evaluate(`saApprove(${draft.id})`)
  await page.waitForTimeout(900)
  await shot('12-批准弹窗-影响勾选确认')
  await page.evaluate((id) => { document.querySelectorAll('[id^="saCf_"]').forEach(el => el.checked = true); const n=document.getElementById('saNote'); if (n) n.value='演示:同意调价'; window.saApproveDo(id) }, draft.id)
  await page.waitForTimeout(1200)
  await shot('13-批准生效-结果回到详情')
  await page.evaluate("document.querySelector('.modal-x')?.click()")
}

// 7) 提交人收件箱(批准结果);防御性重登录(D-08 可能已清 token)
const mpLg2 = await login(stamp + 'mp', 'TempPass2026')
await mpPage.evaluate((t) => { localStorage.setItem('admin_token', t) }, mpLg2.token)
await mpPage.reload()
await mpPage.waitForTimeout(1500)
await mpPage.goto(base + '/admin-ui/#subjectwork')
await mpPage.waitForTimeout(1400)
await mpPage.evaluate('openInbox()')
await mpPage.waitForTimeout(900)
await shot('14-站内收件箱-提交人收到批准结果', mpPage)
await mpPage.evaluate("document.querySelector('.modal-x')?.click()")

// 8) 运营工作台
await page.goto(base + '/admin-ui/#opsdesk')
await page.waitForTimeout(1600)
await shot('15-运营工作台')

// 9) 小程序渠道申请(双端来源)+ 详情
try {
  const miniLg = await call('POST', '/m/auth/login', { code: 'shot-chenjie', merchantId: 1 })
  if (miniLg.code === 0 && miniLg.data?.token) {
    const supply = await call('GET', '/m/supply?paged=1&page=1&pageSize=30', null, miniLg.data.token)
    const s1 = (supply.data?.items || []).find((x) => Number(x.status) === 1 && Number(x.pending_cnt) === 0)
    if (s1) {
      await call('POST', '/m/supply/' + s1.id, { action: 'price', value: Math.max(100, Math.round(Number(s1.price_adult) * 0.92)), reason: '小程序端演示提交' }, miniLg.data.token)
      await page.goto(base + '/admin-ui/#subjectapprove')
      await page.waitForTimeout(1500)
      await shot('16-审批列表-含小程序来源申请')
      const pend = await call('GET', '/admin/subject-requests?view=approval&status=1', null, opsTok)
      const item = (pend.data?.items || []).find((r) => r.channel === 'mini')
      if (item) {
        await page.evaluate(`saDetail(${item.id})`)
        await page.waitForTimeout(1000)
        await shot('17-小程序来源申请详情')
        await page.evaluate("document.querySelector('.modal-x')?.click()")
      }
    }
  }
} catch (e) { console.log('(mini 渠道截图跳过:' + e.message + ')') }

await browser.close()
console.log('截图完成 → ' + outDir)
