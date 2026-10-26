import automator from 'miniprogram-automator'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PNG } from 'pngjs'
import jsQR from 'jsqr'
if (!/^wanderlust_qa_/.test(process.env.DB_NAME || '')) throw new Error('仅允许隔离验收库')
const { q, one } = await import('../src/db.mjs')
const dir = 'test/evidence-20261026', BASE = 'http://127.0.0.1:8081'
fs.mkdirSync(dir, { recursive: true })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (f, label, ms = 20000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { const result = await f(); if (result) return result } catch (e) { last = e } await wait(300) } throw new Error('等待失败：' + label + ' ' + (last?.message || '')) }
const http = async (path, method = 'GET', body, token) => { const j = await (await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') }, body: body ? JSON.stringify(body) : undefined })).json(); assert.equal(j.code, 0, path + ': ' + j.msg); return j.data }
const shot = async (mini, name) => { await mini.screenshot({ path: `${dir}/${name}.png` }); console.log('SCREENSHOT', name) }
const results = []
const ok = name => { results.push(name); console.log('UI PASS', name) }
const mid = (await one('SELECT id FROM merchant WHERE status=1 ORDER BY id LIMIT 1')).id
await q("UPDATE tour_product SET status=0 WHERE subtitle LIKE '%fixture%' OR title REGEXP '^P[0-9]'")
let fixture = await one("SELECT id FROM tour_product WHERE subtitle='remediation-ui-fixture'")
if (!fixture) {
  const r = await q(`INSERT INTO tour_product (channel,city_code,cat,title,subtitle,days_desc,price_from,bean_gift,merchant_id,status,rich_desc,meeting_point,safety_note) VALUES ('main','310118','script','朱家角 · 水乡寻迹','remediation-ui-fixture','1天',29800,298,?,1,?,?,?)`, [mid, JSON.stringify({ intro: '隔离验收线路：沿水而行，在桥巷中寻找故事线索。', highlights: ['水乡漫步','在地故事','小团同行'], includes: ['领队服务','体验材料'] }), '朱家角游客中心集合（验收示例）', '穿着舒适鞋履，雨天留意石板路。'])
  fixture = { id: r.insertId }
}
await q('UPDATE tour_product SET status=1 WHERE id=?', [fixture.id])
let session = await one('SELECT id FROM tour_session WHERE product_id=? AND status=1 AND quota-booked>0 LIMIT 1', [fixture.id])
if (!session) { const r = await q('INSERT INTO tour_session(product_id,depart_date,quota,booked,price_adult,status) VALUES (?,DATE_ADD(CURDATE(),INTERVAL 7 DAY),100,0,29800,1)', [fixture.id]); session = { id:r.insertId } }
const ownerCode = 'mock-remediation-ui-owner'
await http('/m/auth/login', 'POST', { code: ownerCode })
const owner = await one('SELECT id FROM user_account WHERE mini_b_openid=?', ['mock-openid-' + ownerCode])
await q('INSERT INTO merchant_staff(merchant_id,user_id,role,status) VALUES (?,?,3,1) ON DUPLICATE KEY UPDATE role=3,status=1', [mid,owner.id])

const runtime=path.resolve(dir,'mini-b-runtime');fs.cpSync('../mini-b',runtime,{recursive:true});const pc=JSON.parse(fs.readFileSync(runtime+'/project.config.json','utf8'));pc.appid=JSON.parse(fs.readFileSync('../mini-a/project.config.json','utf8')).appid;fs.writeFileSync(runtime+'/project.config.json',JSON.stringify(pc,null,2));
const cli='D:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat'
const openProject = async (project, port) => {
  execFileSync('powershell.exe',['-NoProfile','-Command', "& '" + cli + "' quit"],{stdio:'inherit',timeout:30000})
  await wait(5000)
  execFileSync('powershell.exe',['-NoProfile','-Command', "& '" + cli + "' auto --project '" + project.replaceAll("'","''") + "' --auto-port " + port + " --trust-project"],{stdio:'inherit',timeout:60000})
}
const connect = async port => { let m; for(let i=0;i<40&&!m;i++){ try {m=await automator.connect({wsEndpoint:'ws://127.0.0.1:'+port})}catch(e){await wait(1000)} } if(!m)throw new Error('连接预算耗尽');console.log('STAGE websocket connected');await until(async()=>(await m.currentPage())?.path,'模拟器首屏',60000);return m }
let A, B
try {
  console.log('STAGE opening mini-a'); await openProject(path.resolve('../mini-a'),9421); console.log('STAGE opened mini-a')
  A = await connect(9421); console.log('STAGE connected mini-a')
  console.log('STAGE mock login'); await A.mockWxMethod('login', { code: 'mock-remediation-ui-tourist' })
  console.log('STAGE configure'); await A.evaluate(() => { getApp().globalData.apiBase='http://127.0.0.1:8081';getApp().globalData.token='';wx.removeStorageSync('token') })
  console.log('STAGE home'); await A.switchTab('/pages/me/index'); await A.switchTab('/pages/home/index'); console.log('STAGE home ready')
  let page = await A.currentPage()
  const item = await until(async () => { for (const el of await page.$$('.tour-item')) if ((await el.text()).includes('水乡寻迹')) return el }, '首页线路卡片')
  await shot(A,'tourist-home'); await item.tap()
  await until(async () => (await A.currentPage()).path.includes('/detail/'), '线路详情')
  page = await A.currentPage(); await until(() => page.$('.btn'), '详情预订按钮')
  await shot(A,'tourist-detail'); await (await page.$('.btn')).tap()
  await until(async () => (await A.currentPage()).path.includes('/booking/'), '确认预订页')
  page = await A.currentPage(); await until(async () => (await page.data()).p, '预订数据')
  const inputs = await page.$$('.input-r'); assert.equal(inputs.length,2)
  await inputs[0].input('验收旅友'); await inputs[1].input('13800138000')
  await shot(A,'tourist-booking'); await (await page.$('.btn')).tap()
  await until(async () => (await A.currentPage()).path.includes('/pay-result/'), '支付结果')
  page = await A.currentPage(); const orderNo = (await page.data()).orderNo
  await until(async () => Number((await page.data()).status) === 30, '模拟支付出票')
  await shot(A,'tourist-payment-result'); ok('游客真实页面：发现→详情→确认预订→模拟支付出票')
  await (await page.$('.btn')).tap()
  await until(async () => (await A.currentPage()).path.includes('/orders/'), '订单列表')
  page = await A.currentPage()
  const orderCard = await until(async () => { for (const el of await page.$$('.tour-item')) if ((await el.attribute('data-no')) === orderNo) return el }, '新订单')
  await orderCard.tap(); await until(async () => (await A.currentPage()).path.includes('/order-detail/'),'订单详情')
  page = await A.currentPage(); const passRow = await until(() => page.$('.pass-row'),'凭证入口'); await passRow.tap()
  await until(async () => (await A.currentPage()).path.includes('/pass-code/'),'凭证页'); page = await A.currentPage()
  await until(async () => (await page.data()).cells?.length,'真实二维码'); await shot(A,'tourist-pass-code')
  const png = PNG.sync.read(fs.readFileSync(`${dir}/tourist-pass-code.png`))
  const decoded = jsQR(new Uint8ClampedArray(png.data),png.width,png.height)
  assert(decoded?.data?.startsWith('wl://v/'), '实际模拟器屏幕中的二维码必须可独立解码')
  ok('游客实际屏幕截图二维码可独立解码')

  await A.disconnect(); A=null
  await openProject(path.resolve(dir,'mini-b-runtime'),9422)
  B = await connect(9422)
  await B.mockWxMethod('login',{ code:ownerCode })
  await B.evaluate(() => { getApp().globalData.apiBase='http://127.0.0.1:8081';getApp().globalData.token='';getApp().globalData.merchant=null;wx.removeStorageSync('mtoken');wx.removeStorageSync('merchant') })
  await B.switchTab('/pages/me/index'); page=await B.currentPage()
  await until(()=>page.$('.btn'),'商户微信登录'); await (await page.$('.btn')).tap()
  await until(async ()=>(await page.data()).merchant,'商户已绑定'); await shot(B,'merchant-profile')
  await B.switchTab('/pages/index/index'); page=await B.currentPage(); await until(async ()=>(await page.data()).wb,'工作台'); await shot(B,'merchant-workbench')
  await (await page.$('.bigbtn')).tap(); await until(async ()=>(await B.currentPage()).path.includes('/verify/'),'核销页')
  await B.mockWxMethod('scanCode',{ result:decoded.data,scanType:'QR_CODE',charSet:'utf8' })
  page=await B.currentPage(); await (await page.$('.btn')).tap()
  await until(async ()=>(await one('SELECT status FROM orders WHERE order_no=?',[orderNo])).status===40,'扫码核销入库')
  await wait(1200); await shot(B,'merchant-verify'); ok('商户实际点击扫码：使用游客屏幕解码载荷完成核销（模拟相机回调）')
  assert.equal((await one('SELECT COUNT(*) c FROM verification_log v JOIN travel_pass p ON p.id=v.pass_id JOIN orders o ON o.id=p.order_id WHERE o.order_no=? AND v.result=1',[orderNo])).c,1)
  ok('重复扫码仅一条成功核销流水')
  await B.disconnect(); B=null
  await openProject(path.resolve('../mini-a'),9421); A=await connect(9421)
  await A.evaluate(()=>{getApp().globalData.apiBase='http://127.0.0.1:8081';getApp().globalData.token=wx.getStorageSync('token')})
  await A.navigateTo('/package-order/pages/order-detail/index?no='+orderNo); page=await A.currentPage(); await until(async ()=>(await page.data()).o.status===40,'游客侧核销状态')
  await shot(A,'tourist-order-verified'); ok('商户核销后游客订单同步为已核销')
  fs.writeFileSync(`${dir}/ui-result.json`,JSON.stringify({results,orderNo,at:new Date().toISOString(),limitations:['支付为本地模拟','相机输入来自真实截图解码','商户端使用本地 AppID 调试副本']},null,2))
  console.log('UI ALL PASS',results.length)
} finally { if (A) await A.disconnect(); if (B) await B.disconnect() }
process.exit(0)
