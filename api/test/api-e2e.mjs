// HTTP 全链路 E2E：起服务 → 游客登录 → 浏览 → 下单 → 模拟支付回调 → 出票 →
// 商户登录 → 扫码核销 → 完成 → 返豆/佣金 → 结算五口径 → 退款冲正 → 参数中心双人复核 → 试算
// 运行：node test/api-e2e.mjs（自动重置业务数据）
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
let pass = 0, fail = 0
const ok = (c, n) => { c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n)) }

async function api(method, path, body, token, expectFail) {
  const r = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json()
  if (expectFail) return j
  if (j.code !== 0) throw new Error(`${method} ${path} -> ${j.code} ${j.msg}`)
  return j.data
}

async function main() {
  // 重置业务数据（保留 rule_config / bean_global_cap，issued_sum 归零）——保证可重复执行
  const dbx = await import('../src/db.mjs')
  await dbx.q('SET FOREIGN_KEY_CHECKS = 0')
  for (const t of await dbx.q("SELECT table_name tn FROM information_schema.tables WHERE table_schema = 'wanderlust' AND table_name NOT IN ('rule_config','bean_global_cap','admin_user','faq')")) {
    await dbx.q('TRUNCATE TABLE `' + t.tn + '`')
  }
  await dbx.q('UPDATE bean_global_cap SET issued_sum = 0 WHERE id = 1')
  // V13 FAQ 种子（复位时如空则重建）
  const fqCount = (await dbx.q('SELECT COUNT(*) c FROM faq'))[0].c
  if (Number(fqCount) === 0) {
    await dbx.q("INSERT INTO faq (question, answer, sort) VALUES ('旅豆是什么？','旅豆是消费与活动的积分奖励，100 豆=10 元，下单可抵扣最多 10%，核销完成 24 小时后到账。',1), ('核销码怎么用？','入园时向商户出示「我的-订单」里的 6 位动态码或二维码，每 60 秒自动轮换，一码一次有效。',2), ('退款规则是什么？','出发前 7 天免费退；3-7 天收 10%；72 小时内收 30%；出发后不退。拼团未成团自动全额退款。',3)")
  }
  // 参数恢复种子值（防上轮参数中心用例的残留污染：确定性重跑）
  const { DEFAULTS } = await import('../src/config.mjs')
  for (const [k, v] of Object.entries(DEFAULTS)) {
    await dbx.q('INSERT INTO rule_config (k, v, group_name, `sensitive`) VALUES (?,CAST(? AS JSON),?,0) ON DUPLICATE KEY UPDATE v = CAST(? AS JSON)',
      [k, v, k.split('.')[0], v]).catch(() => {})
  }
  await dbx.q('SET FOREIGN_KEY_CHECKS = 1')

  // 管理员自足：若被清空则直接补种（测试不依赖服务重启的 bootstrap）
  const admins = await dbx.q('SELECT COUNT(*) c FROM admin_user')
  if (Number(admins[0].c) === 0) {
    const { hashPassword } = await import('../src/auth.mjs')
    const pw = process.env.ADMIN_INIT_PASSWORD || 'admin123'
    await dbx.q(`INSERT INTO admin_user (username, password_hash, role, display_name) VALUES
      ('admin', ?, 'super', '超级管理员'), ('finance', ?, 'finance', '财务'), ('ops', ?, 'ops', '运营')`,
      [hashPassword(pw), hashPassword(pw), hashPassword(pw)])
  }

  console.log('== 0. 健康检查 ==')
  const h = await api('GET', '/c/health')
  ok(h.app === 'wanderlust-api' && (h.payMode === 'MOCK' || h.payMode === 'WECHAT-PAY-V3'), 'API 存活 · 支付通道 ' + h.payMode)

  console.log('== 1. 后台登录 + 内容填充（商户/商品/团期/预算）==')
  const admin = await api('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })
  const adminT = admin.token
  ok(!!adminT && admin.user.role === 'super', '后台超管登录（admin/super）')
  const merch = await api('POST', '/admin/merchants', { name: '安麓大夫第·朱家角', cityCode: '310118', wxpaySubMchid: 'SUBMCH001' }, adminT)
  ok(merch.merchantNo.startsWith('M'), '商户创建 ' + merch.merchantNo)
  const prod = await api('POST', '/admin/products', { title: '朱家角剧本游·江南谜案', cat: 'script', priceFrom: 29800, merchantId: merch.id, status: 1, daysDesc: '1天' }, adminT)
  const sess = await api('POST', '/admin/sessions', { productId: prod.id, departDate: '2026-12-20', quota: 2, priceAdult: 29800 }, adminT)
  ok(prod.id > 0 && sess.id > 0, '商品 + 团期创建（quota=2 · ¥298）')
  const budget = await api('POST', '/admin/budgets', { name: '12月·消费返豆', total: 1000000 }, adminT)
  ok(budget.id > 0, '旅豆预算批次 100 万豆')

  console.log('== 2. 游客登录与浏览 ==')
  const buyer = await api('POST', '/c/auth/login', { code: 'mock-e2e-buyer' })
  const buyerT = buyer.token
  ok(!!buyerT && buyer.user.memberLevel === 1, '游客登录（mock openid · 探索者）')
  const tours = await api('GET', '/c/tours?cat=script', null, buyerT)
  ok(tours.some((t) => t.title.includes('江南谜案')), '商品列表可见（cat=script）')
  const detail = await api('GET', '/c/tours/' + prod.id, null, buyerT)
  ok(detail.sessions.length > 0 && detail.priceLabel === '298.00', '详情含团期 · 价格标签 ¥298.00')

  console.log('== 3. 推广归因 ==')
  const promoUser = await api('POST', '/c/auth/login', { code: 'mock-e2e-promo' })
  await api('POST', '/admin/promoters/register', { userId: promoUser.user.id, tier: 1 }, adminT)
  const scene = (await import('../src/domain/promo.mjs')).createScene // 直接建码（生产由推广中心接口生成）
  const sceneCode = await scene(promoUser.user.id, 'poster')
  ok(sceneCode.startsWith('p'), '推广码生成 ' + sceneCode)
  // 预置旅豆：后台无直接发豆接口（红线：只能三渠道）→ 用任务奖励链路模拟（直接走域函数）
  const { grant, BIZ } = await import('../src/domain/bean.mjs')
  await grant(buyer.user.id, 200, BIZ.TASK, 'TASK-E2E', budget.id)

  console.log('== 4. 下单（豆抵扣 + 防超卖 + 支付参数）==')
  const o1 = await api('POST', '/c/orders', { sessionId: sess.id, qty: 1, beanDeduct: 200, promoScene: sceneCode, contactName: '王小满', contactPhone: '13800001111' }, buyerT)
  ok(o1.amountPay === 27800 && o1.beanDeducted === 200, '下单：200 豆抵 20 元 · 实付 ¥278')
  ok(o1.payParams && (o1.payParams.mock || o1.payParams.paySign), '支付参数返回（' + (o1.payParams.mock ? 'MOCK' : 'V3') + '）')
  const o2 = await api('POST', '/c/orders', { sessionId: sess.id, qty: 1, beanDeduct: 0 }, buyerT)
  let overbooked = false
  try { await api('POST', '/c/orders', { sessionId: sess.id, qty: 1 }, buyerT) } catch (e) { overbooked = e.message.includes('名额') }
  ok(overbooked, 'quota=2 卖满后第三单被拒（防超卖）')
  // o2 不支付 → 超时关单测试（直接调域函数模拟 15 分钟）
  const { closeTimeout } = await import('../src/domain/order.mjs')
  await (await import('../src/db.mjs')).q('UPDATE orders SET created_at = created_at - INTERVAL 20 MINUTE WHERE order_no = ?', [o2.orderNo])
  const closed = await closeTimeout()
  ok(closed >= 1, '超时关单任务生效（o2 关闭并释放名额）')

  console.log('== 5. 支付回调（幂等）→ 出票 ==')
  await api('POST', '/admin/dev/mock-pay', { orderNo: o1.orderNo }, adminT)
  const o1v = await api('GET', '/c/orders/' + o1.orderNo, null, buyerT)
  ok(o1v.status === 30, '支付→确认→出票（status=30）')
  ok(o1v.passes.length === 1, '1 张 travel_pass 已签发')
  const dupPay = await api('POST', '/admin/dev/mock-pay', { orderNo: o1.orderNo }, adminT)
  ok(dupPay.duplicated === true, '重复支付回调幂等跳过')

  console.log('== 6. 商户端登录 + 扫码核销（防重放）==')
  // 绑店员：后台造 merchant_staff（生产由商户端注册流）
  const { q } = await import('../src/db.mjs')
  await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,3)', [merch.id, promoUser.user.id])
  const mLogin = await api('POST', '/m/auth/login', { code: 'mock-e2e-promo', merchantId: merch.id })
  const mT = mLogin.token
  ok(mT && mLogin.role === 3, '商户端登录（老板角色）')
  const wb = await api('GET', '/m/workbench', null, mT)
  ok(wb.todayOrders === 1 && wb.pendingVerify === 1, '工作台：今日 1 单 · 待核销 1')
  const code1 = await api('GET', '/c/pass/' + o1v.passes[0].id + '/code', null, buyerT)
  ok(code1.qr.startsWith('wl://v/') && code1.display.length === 6, '动态码：二维码 + 6 位展示码（窗口 ' + code1.window + '）')
  const v1 = await api('POST', '/m/verify/scan', { payload: code1.qr }, mT)
  ok(v1.ok === true, '扫码核销成功')
  const v2 = await api('POST', '/m/verify/scan', { payload: code1.qr }, mT)
  ok(v2.ok === false && v2.reason.includes('已核销'), '同码重放被拒')
  const o1v2 = await api('GET', '/c/orders/' + o1.orderNo, null, buyerT)
  ok(o1v2.status === 40, '订单全部核销（status=40）')
  const recs = await api('GET', '/m/verify/records', null, mT)
  ok(recs.length >= 2, '核销流水（成功+重复拦截都留痕）')

  console.log('== 7. 观察期完成 → 返豆 + 佣金 ==')
  await api('POST', '/admin/dev/complete', { orderNo: o1.orderNo }, adminT)
  const o1v3 = await api('GET', '/c/orders/' + o1.orderNo, null, buyerT)
  ok(o1v3.status === 50, '订单完成（status=50）')
  const beanAcc = await api('GET', '/c/bean/account', null, buyerT)
  ok(beanAcc.balance === 278, '返豆 278（实付 ¥278 × 10%）')
  const me = await api('GET', '/c/me', null, buyerT)
  ok(me.growth === 27800 && me.memberLevel === 3, '成长值 27800 → 城市探索官')

  console.log('== 8. 结算五口径 ==')
  const gen = await api('POST', '/admin/settlements/generate', { period: '2026-10-W43' }, adminT)
  ok(gen.settlementIds.length === 1, '周结算单生成')
  const sts = await api('GET', '/admin/settlements', null, adminT)
  const s0 = sts[0]
  const five = Number(s0.amt_fulfill) + Number(s0.amt_service) + Number(s0.amt_promoter) + Number(s0.amt_beanbudget) + Number(s0.amt_retained)
  ok(Number(s0.total_amount) === 27800 && five === 27800, '五口径恒等：' + [s0.amt_fulfill, s0.amt_service, s0.amt_promoter, s0.amt_beanbudget, s0.amt_retained].join('+') + ' = 27800')
  const gen2 = await api('POST', '/admin/settlements/generate', { period: '2026-10-W44' }, adminT)
  ok((gen2.settlementIds || []).length === 0, '重复分账拦截（已结算订单不进新期）')
  ok(Number(s0.amt_promoter) === Math.floor((27800 - 2000) * 500 / 10000), '推广口径=实际佣金 5%（基数 25800=实付-豆抵扣 → 1290 分）')

  console.log('== 9. 退款链（全量冲正）==')
  const o3 = await api('POST', '/c/orders', { sessionId: sess.id, qty: 1, beanDeduct: 0 }, buyerT)
  await api('POST', '/admin/dev/mock-pay', { orderNo: o3.orderNo }, adminT)
  const r3 = await api('POST', '/c/orders/' + o3.orderNo + '/refund', { reason: '行程变更' }, buyerT)
  ok(r3.refunded === true, '用户自助退款成功')
  const o3v = await api('GET', '/c/orders/' + o3.orderNo, null, buyerT)
  ok(o3v.status === 70 && o3v.passes.every((p) => p.status === 4), '订单已退款 · 凭证全部冲正')

  console.log('== 10. 参数中心（双人复核）==')
  const prop = await api('POST', '/admin/config/proposal', { key: 'bean.order_rate', newValue: '0.08', reason: 'E2E 提案' }, adminT)
  ok(prop.sensitive === true && prop.preview && prop.preview.beanNew === Math.round(27800 / 10 * 0.08), '提案+影响预览（返豆 278→' + prop.preview.beanNew + '）')
  const finance = await api('POST', '/admin/login', { username: 'finance', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })
  let selfApproveBlocked = false
  try { await api('POST', '/admin/config/approve', { historyId: prop.historyId }, adminT) }
  catch (e) { selfApproveBlocked = e.message.includes('提案人') }
  ok(selfApproveBlocked, '同人提案同人审批被拒（双人复核）')
  await api('POST', '/admin/config/approve', { historyId: prop.historyId }, finance.token)
  const cfgs = await api('GET', '/admin/config', null, adminT)
  ok(cfgs.find((c) => c.k === 'bean.order_rate').v === '0.08', '财务审批后参数生效（10%→8%）')
  await api('POST', '/admin/config/rollback', { key: 'bean.order_rate' }, adminT)
  const cfgs2 = await api('GET', '/admin/config', null, adminT)
  ok(Number(cfgs2.find((c) => c.k === 'bean.order_rate').v) === 0.10, '回滚恢复 10%')

  console.log('== 11. 账本试算 + 审计 ==')
  const { trialBalance } = await import('../src/domain/bean.mjs')
  const tb = await trialBalance()
  ok(tb.perOk && tb.globalOk, `账本试算：每户零差异 · Σ贷=Σ借（${tb.credit} 豆）`)
  const logs = await api('GET', '/admin/audit-logs', null, adminT)
  ok(logs.some((l) => l.module === 'config') && logs.some((l) => l.module === 'merchant'), '审计留痕（config/merchant 均有记录）')

  console.log('== 12. 管理后台静态页 ==')
  const html = await fetch(BASE + '/admin-ui/').then((r) => r.text())
  ok(html.includes('向往的自由') && html.includes('欢迎回来'), '后台 SPA 可访问（/admin-ui，新版设计系统）')

  console.log(`\nHTTP E2E RESULT: ${pass} PASS / ${fail} FAIL`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1) })
