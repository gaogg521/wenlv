// 演示内容录入 + 用户旅程 —— 全程走真实 HTTP 接口（与后台 SPA / 小程序完全同路径），
// 模拟真实操作顺序，暴露链路问题。运行：node test/scenario-populate.mjs
import { hashPassword } from '../src/auth.mjs'
import { q } from '../src/db.mjs'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
const logs = []
function step(who, action) {
  const line = `[${who}] ${action}`
  logs.push(line); console.log(line)
}
let failures = 0
const ok = (cond, msg) => { if (!cond) { failures++; console.log('   ❌ ' + msg) } }

async function api(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json()
  if (j.code !== 0) throw new Error(`${method} ${path} -> ${j.code} ${j.msg}`)
  return j.data
}

async function main() {
  // ===== 环境准备（唯一不走 HTTP 的一步：清场 + 保证管理员在） =====
  await q('SET FOREIGN_KEY_CHECKS = 0')
  for (const t of await q("SELECT table_name tn FROM information_schema.tables WHERE table_schema='wanderlust' AND table_name NOT IN ('rule_config','bean_global_cap','admin_user')")) {
    await q('TRUNCATE TABLE `' + t.tn + '`')
  }
  await q('UPDATE bean_global_cap SET issued_sum = 0 WHERE id = 1')
  await q('SET FOREIGN_KEY_CHECKS = 1')
  if (Number((await q('SELECT COUNT(*) c FROM admin_user'))[0].c) === 0) {
    const pw = process.env.ADMIN_INIT_PASSWORD || 'admin123'
    await q(`INSERT INTO admin_user (username, password_hash, role, display_name) VALUES ('admin',?,'super','超级管理员'),('finance',?,'finance','财务'),('ops',?,'ops','运营')`,
      [hashPassword(pw), hashPassword(pw), hashPassword(pw)])
  }

  // ===== 第一幕：运营在后台录入内容（同 admin-ui 的操作路径）=====
  step('运营-赵敏', '打开 /admin-ui → 登录 admin')
  const admin = (await api('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const finance = (await api('POST', '/admin/login', { username: 'finance', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token

  step('运营-赵敏', '商户管理 → 新增 3 家商户（朱家角/安吉/苏州）')
  const mZJQ = await api('POST', '/admin/merchants', { name: '安麓大夫第 · 朱家角', cityCode: '310118', wxpaySubMchid: 'SUBMCH-ZJQ-001' }, admin)
  const mYoga = await api('POST', '/admin/merchants', { name: '安吉瑜伽谷民宿', cityCode: '330500', wxpaySubMchid: 'SUBMCH-YOGA-002' }, admin)
  const mSZ = await api('POST', '/admin/merchants', { name: '苏州园林文旅', cityCode: '320508' }, admin)

  step('运营-赵敏', '商品管理 → 新增 3 条线路（剧本/瑜伽/姐姐茶会）+ 3 个商城 SKU')
  const p1 = await api('POST', '/admin/products', { title: '朱家角剧本游 · 江南谜案', cat: 'script', cityCode: '310118', merchantId: mZJQ.id, priceFrom: 29800, beanGift: 298, daysDesc: '1天', status: 1 }, admin)
  const p2 = await api('POST', '/admin/products', { title: '安吉瑜伽谷 · 2天1夜', cat: 'yoga', cityCode: '330500', merchantId: mYoga.id, priceFrom: 68800, beanGift: 688, daysDesc: '2天1夜', status: 1 }, admin)
  const p3 = await api('POST', '/admin/products', { title: '苏州园林 · 姐姐茶会', cat: 'sister', cityCode: '320508', merchantId: mSZ.id, priceFrom: 39800, beanGift: 398, daysDesc: '1天', status: 1 }, admin)
  const skus = []
  for (const [title, price, mi] of [['江南扎染方巾', 6800, mZJQ.id], ['安吉白茶 · 明前 50g', 12800, mYoga.id], ['朱家角阿婆粽礼盒', 8800, mZJQ.id]]) {
    skus.push(await api('POST', '/admin/products', { title: title + '（商城好物）', cat: 'shop', cityCode: '310118', merchantId: mi, priceFrom: price, beanGift: 0, daysDesc: '实物', status: 1 }, admin))
  }

  step('运营-赵敏', '编辑线路内容（行程/费用包含/集合点/安全告知）+ 上传实拍示意图')
  const CONTENT = [
    [p1.id, 'zhujiajiao', ['实景搜证 · 双结局推理', 'NPC 全程入戏', '放生桥日落打卡'],
      '09:00 朱家角古镇集合换装 → 上午主线搜证（3 个点位）→ 午间阿婆茶歇 → 下午支线任务与终局推理 → 16:30 放生桥合影散场。',
      '门票 · 剧本道具 · 全程 NPC 领队 · 阿婆茶歇 · 旅行意外险',
      '地铁17号线朱家角站 2 号口，09:00 集合（领队举「向往的自由」橙色旗）',
      '古镇临水路段请勿奔跑；含 2 小时户外步行，请穿运动鞋；已投保公众责任险'],
    [p2.id, 'yoga', ['竹林晨间流瑜伽', '山野素食晚餐', '溪谷冥想'],
      'D1 上午抵达 · 竹林徒步 + 开营冥想 · 晚间山野素食；D2 清晨流瑜伽 + 溪谷正念行走 · 午后返程。',
      '1 晚山宿 · 两日素食 · 教练费 · 瑜伽垫 · 保险',
      '杭州东站/上海虹桥集合大巴直达安吉（含往返车费）',
      '瑜伽环节量力而行；山间夜温较低请带外套；报名时请告知饮食禁忌'],
    [p3.id, 'garden', ['旗袍旅拍', '姐姐茶会', '花艺手作'],
      '苏州园林包场半日：旗袍换装旅拍（含 9 张精修）→ 姐姐茶会（评弹伴席）→ 苏式花艺手作带走。',
      '园林门票 · 旗袍租赁 · 跟拍摄影 · 茶会 · 花艺材料',
      '苏州地铁 4 号线北寺塔站 4 号口，13:00 集合',
      '园林石板路湿滑请防滑；旗袍尺码下单后客服确认'],
  ]
  for (const [pid, sceneKey, highlights, intro, includes, meeting, safety] of CONTENT) {
    await api('PUT', '/admin/products/' + pid, { highlights, intro, includes, meetingPoint: meeting, safetyNote: safety }, admin)
    const img = fs.readFileSync(path.join(import.meta.dirname, '..', 'scripts', 'scene', sceneKey + '.jpg.png'))
    await api('POST', '/admin/products/' + pid + '/images', { data: img.toString('base64'), ext: 'png' }, admin)
  }
  ok(true, '3 条线路内容 + 示意图已上线（编辑/传图走管理接口）')

  step('运营-赵敏', '给每条线路加 3 个团期（周五/周六出发，20-30 席）')
  const sess = []
  for (const pid of [p1.id, p2.id, p3.id]) {
    for (let i = 0; i < 3; i++) {
      const d = new Date(Date.now() + (7 + i * 7) * 86400000).toISOString().slice(0, 10)
      sess.push(await api('POST', '/admin/sessions', { productId: pid, departDate: d, quota: 20 + Math.floor(Math.random() * 10), minGo: 8, priceAdult: [29800, 68800, 39800][[p1.id, p2.id, p3.id].indexOf(pid)] }, admin))
    }
  }
  for (const s of skus) {
    await api('POST', '/admin/sessions', { productId: s.id, departDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), quota: 999, minGo: 1, priceAdult: s.id === skus[0].id ? 6800 : s.id === skus[1].id ? 12800 : 8800 }, admin)
  }

  step('财务-周颖', '旅豆预算 → 新建批次「首期·消费返豆」600 万豆')
  const budget = await api('POST', '/admin/budgets', { name: '首期·消费返豆', total: 6000000 }, admin)

  // ===== 第二幕：推广员开通与分享 =====
  step('游客-小满', '微信登录（小程序 wx.login）')
  const buyer = (await api('POST', '/c/auth/login', { code: 'mock-xiaoman' })).token
  step('游客-陈姐', '微信登录（导游，想做推广）')
  const promoLogin = (await api('POST', '/c/auth/login', { code: 'mock-chenjie' }))
  step('运营-赵敏', '推广服务商 → 给陈姐开通（基础档 5%）')
  await api('POST', '/admin/promoters/register', { userId: promoLogin.user.id, tier: 1 }, admin)
  const { createScene } = await import('../src/domain/promo.mjs')
  const scene = await createScene(promoLogin.user.id, 'poster')
  step('推广-陈姐', '生成专属推广海报码：' + scene)

  // 小满扫了陈姐的海报进小程序（scene 随码带入）
  step('游客-小满', '扫码进入 → 首页浏览 → 打开「朱家角剧本游」详情')
  const home = await api('GET', '/c/home', null, buyer)
  const detail = await api('GET', '/c/tours/' + p1.id, null, buyer)
  ok(home.hot.length >= 6, '首页热门≥6')
  ok(detail.sessions.length === 3, '详情 3 个团期')

  // 小满先完成一个约稿任务拿豆（任务奖励链路），下单时抵扣
  const { grant, BIZ } = await import('../src/domain/bean.mjs')
  step('游客-小满', '完成社区约稿任务 → 获得 200 旅豆')
  const { one } = await import('../src/db.mjs')
  const buyerUid = (await one('SELECT id FROM user_account WHERE mini_a_openid = ?', ['mock-openid-mock-xiaoman'])).id
  await grant(Number(buyerUid), 200, BIZ.TASK, 'TASK-约稿·朱家角攻略', budget.id)

  step('游客-小满', '下单：1 人 · 用 200 旅豆抵 20 元 → 实付 ¥278')
  const order = await api('POST', '/c/orders', { sessionId: detail.sessions[0].id, qty: 1, beanDeduct: 200, promoScene: scene, contactName: '王小满', contactPhone: '13800001111' }, buyer)
  ok(order.amountPay === 27800, '实付 278 元')
  step('游客-小满', 'wx.requestPayment 支付（联调=MOCK 参数）')
  step('微信-回调', 'POST /callback/wxpay（真实回调路径）')
  await api('POST', '/callback/wxpay', { out_trade_no: order.orderNo, transaction_id: 'WX' + Date.now() })
  const paid = await api('GET', '/c/orders/' + order.orderNo, null, buyer)
  ok(paid.status === 30, '已支付→出票 status=30')
  step('游客-小满', '订单详情看到 1 张入园凭证')

  // 商户核销
  step('商户-安麓大夫第', '店员用小程序 B 登录（绑定门店）')
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,2)', [mZJQ.id, promoLogin.user.id])
  const merch = (await api('POST', '/m/auth/login', { code: 'mock-chenjie', merchantId: mZJQ.id })).token
  const wb = await api('GET', '/m/workbench', null, merch)
  ok(wb.pendingVerify === 1, '工作台待核销=1')
  step('游客-小满', '出游当天打开 60 秒动态核销码')
  const code = await api('GET', '/c/pass/' + paid.passes[0].id + '/code', null, buyer)
  step('商户-店员', '扫码核销 → 成功')
  const v = await api('POST', '/m/verify/scan', { payload: code.qr }, merch)
  ok(v.ok, '核销成功')

  // 观察期结束 → 返豆/佣金（真实=定时任务；剧本用后台触发）
  step('系统-jobs', '7 天观察期结束 → 返豆 278 + 陈姐佣金 12.90 元 + 小满升旅行家')
  await api('POST', '/admin/dev/complete', { orderNo: order.orderNo }, admin)
  const me = await api('GET', '/c/me', null, buyer)
  ok(me.bean === 278 && me.memberLevel >= 2, '返豆278·等级≥旅行家')

  // 游客评价（核销完成后一单一评 · 服务端机审）
  step('游客-小满', '写真实评价（5 星 · 一单一评）')
  const rv = await api('POST', '/c/orders/' + order.orderNo + '/review',
    { rating: 5, content: '实景搜证很过瘾，NPC 特别入戏，放生桥落日绝美，下次还来！' }, buyer)
  ok(rv.id > 0, '评价已提交（' + rv.rating + ' 星）')
  try {
    await api('POST', '/c/orders/' + order.orderNo + '/review', { rating: 1, content: '重复评价测试' }, buyer)
    ok(false, '同单重复评价未被拒')
  } catch (e) { ok(String(e).includes('1001'), '同单重复评价被拒（一单一评）') }

  // 第二单：陈姐自己报瑜伽团（不抵豆），随后申请退款
  step('游客-陈姐', '自己也下单瑜伽团（¥688，不抵豆）→ 支付')
  const chenT = promoLogin.token
  const order2 = await api('POST', '/c/orders', { sessionId: (await api('GET', '/c/tours/' + p2.id, null, chenT)).sessions[0].id, qty: 1 }, chenT)
  await api('POST', '/callback/wxpay', { out_trade_no: order2.orderNo, transaction_id: 'WX' + Date.now() + 'B' })
  step('游客-陈姐', '行程有变 → 申请退款（全量冲正）')
  const rf = await api('POST', '/c/orders/' + order2.orderNo + '/refund', { reason: '行程变更' }, chenT)
  ok(rf.refunded, '退款完成')

  // 周结算 + 后台总览
  step('财务-周颖', '周一出账：生成本周结算单 → 复核通过')
  const gen = await api('POST', '/admin/settlements/generate', { period: '2026-10-W43' }, finance)
  for (const id of gen.settlementIds) await api('POST', '/admin/settlements/' + id + '/confirm', {}, finance)
  const kpi = await api('GET', '/admin/dash/kpi', null, admin)
  step('运营-赵敏', `驾驶舱：今日 GMV ¥${kpi.gmvToday} · 订单 ${kpi.ordersToday} · 核销率 ${kpi.verifyRate} · 预算水位 ${kpi.budgetUsage}`)

  // ===== 终态校验 =====
  const { trialBalance } = await import('../src/domain/bean.mjs')
  const tb = await trialBalance()
  ok(tb.perOk && tb.globalOk, '账本试算平衡')
  const tours = await api('GET', '/c/tours', null, buyer)
  console.log(`\n剧本完成：${logs.length} 步真实操作 · 在架商品 ${tours.length} 条 · 失败 ${failures} 处`)
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error('SCENARIO ERROR:', e.message); process.exit(1) })
