// 四期 E2E：早鸟价 / 拼团未成团自动取消+全额退款 / 免费改签（P1，总方案 §4/§9）
// 前置：服务运行中 + V10 迁移已应用。运行：node test/e2e-phase4.mjs（不重置数据，自建隔离夹具）
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
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function main() {
  const dbx = await import('../src/db.mjs')
  const { q, one } = dbx
  const admin = (await api('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const u = await api('POST', '/c/auth/login', { code: 'phase4-tourist' })

  // ---- 夹具：每次运行独立商品（团期 uk_prod_date 唯一 + 订单 FK 引用，不复用旧团期）----
  const m0 = await one('SELECT id FROM merchant LIMIT 1')
  const pid = (await q(`INSERT INTO tour_product (channel, city_code, cat, title, subtitle, price_from, merchant_id, status)
    VALUES ('main','310118','trend','P4拼团测试·朱家角夜游','phase4-fixture',29800,?,1)`, [m0.id])).insertId
  const mk = async (date, price) => (await dbx.q(`INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult, status) VALUES (?,?,?,?,?,1)`, [pid, date, 20, 2, price])).insertId
  const sidA = await mk(day(10), 29800) // 早鸟窗内（出发前 10 天 ≥ 7 天）
  const sidB = await mk(day(2), 29800)  // 早鸟窗外（仅剩 2 天）
  const sidC = await mk(day(1), 29800)  // 48h 内、booked=1 < min_go=2 → 将被取消
  const sidD = await mk(day(9), 29800)  // 改签目标（同价）
  const sidE = await mk(day(8), 39800)  // 异价对照
  await dbx.q('UPDATE tour_session SET early_price = 23800, early_days = 7 WHERE id IN (?, ?)', [sidA, sidB])

  console.log('== A. 早鸟价（§9 P1：出发前 N 天享早鸟价，临近恢复原价）==')
  const tour = await api('GET', '/c/tours/' + pid)
  const sA = tour.sessions.find((s) => s.id === sidA), sB = tour.sessions.find((s) => s.id === sidB)
  ok(sA.isEarly === true && sA.priceNow === 23800, '远期团期展示早鸟价 ¥238（原 ¥298）')
  ok(sB.isEarly === false && sB.priceNow === 29800, '近端团期早鸟窗已过，恢复原价 ¥298')
  ok(sA.groupProgress && sA.groupProgress.minGo === 2, '成团进度字段下发（min_go=' + sA.groupProgress.minGo + '）')
  const o1 = await api('POST', '/c/orders', { sessionId: sidA, qty: 1 }, u.token)
  ok(o1.amountPay === 23800, '早鸟窗内下单按早鸟价结算（实付 ' + o1.amountPay + ' 分）')
  const u2 = await api('POST', '/c/auth/login', { code: 'phase4-tourist-2' })
  const o2 = await api('POST', '/c/orders', { sessionId: sidB, qty: 1 }, u2.token)
  ok(o2.amountPay === 29800, '窗外下单按原价结算（实付 ' + o2.amountPay + ' 分）')
  for (const no of [o1.orderNo, o2.orderNo]) {
    for (let i = 0; i < 20; i++) {
      const s = await api('GET', '/c/orders/' + no, null, u.token).catch(() => null)
      if (s && s.status >= 20) break
      await new Promise((r) => setTimeout(r, 500))
    }
    await dbx.q("UPDATE orders SET status = 90, close_reason = 'pay_timeout' WHERE order_no = ? AND status = 10", [no])
  }
  await dbx.q('UPDATE tour_session SET booked = GREATEST(booked - 1, 0) WHERE id IN (?, ?)', [sidA, sidB])

  console.log('== B. 商户设置早鸟价（mini-b supply early 动作）==')
  const mid = (await one('SELECT merchant_id FROM tour_product WHERE id = ?', [pid])).merchant_id
  await api('POST', '/m/auth/login', { code: 'phase4-merchant', merchantId: mid }) // 首登绑定 staff（role=1）
  await dbx.q(`UPDATE merchant_staff SET role = 2 WHERE user_id = (SELECT id FROM user_account WHERE mini_b_openid = 'mock-openid-phase4-merchant') AND merchant_id = ?`, [mid])
  const mLogin = await api('POST', '/m/auth/login', { code: 'phase4-merchant', merchantId: mid }) // 重登取新角色 token
  const badEarly = await api('POST', '/m/supply/' + sidA, { action: 'early', value: { price: 29800, days: 7 } }, mLogin.token, true)
  ok(badEarly.code === 1001, '早鸟价 ≥ 原价被拒（' + badEarly.msg + '）')
  await api('POST', '/m/supply/' + sidE, { action: 'early', value: { price: 34800, days: 5 } }, mLogin.token)
  const sup = (await api('GET', '/m/supply', null, mLogin.token)).find((s) => s.id === sidE)
  ok(Number(sup.early_price) === 34800 && Number(sup.early_days) === 5, '商户设置早鸟价成功并回读')
  await api('POST', '/m/supply/' + sidE, { action: 'early', value: { price: null } }, mLogin.token)
  const sup2 = (await api('GET', '/m/supply', null, mLogin.token)).find((s) => s.id === sidE)
  ok(sup2.early_price === null, '早鸟价可关闭（置 NULL）')

  console.log('== C. 未成团自动取消（§4：48h 内 booked < min_go → 取消+全额退款）==')
  const o3 = await api('POST', '/c/orders', { sessionId: sidC, qty: 1 }, u.token)
  let st = null
  // 等条件不等时间：MOCK 支付回调落库（铁律 20）
  for (let i = 0; i < 20; i++) {
    st = await api('GET', '/c/orders/' + o3.orderNo, null, u.token)
    if (st.status >= 20) break // 20已支付 / 30已确认（MOCK 回调自动确认出票）
    await new Promise((r) => setTimeout(r, 500))
  }
  ok(st.status >= 20, '订单已支付（占位1人 < min_go=2，status=' + st.status + '）')
  const cancelled = await group_cancel()
  ok(cancelled.some((x) => String(x).startsWith('session:')), '取消任务执行（' + cancelled.join(',') + '）')
  st = await api('GET', '/c/orders/' + o3.orderNo, null, u.token)
  ok(st.status === 70 && st.close_reason === 'group_cancel', '已支付单全额退款（70 + close_reason=group_cancel）')
  const rf = await one(`SELECT status FROM refunds WHERE order_id = ? AND status = 2`, [st.id])
  ok(rf && Number(rf.status) === 2, 'refunds 落单且冲正完成')
  ok(st.passes.every((p) => p.status === 4), '凭证已作废（防核销死票）')
  const sessC = await one('SELECT status FROM tour_session WHERE id = ?', [sidC])
  ok(Number(sessC.status) === 5, '团期置为 5 已取消')
  const bookAgain = await api('POST', '/c/orders', { sessionId: sidC, qty: 1 }, u2.token, true)
  ok(bookAgain.code === 2001, '已取消团期不可再报名')

  console.log('== D. 免费改签（§4：同频道同价团期，免支付出票）==')
  const det = await api('GET', '/c/orders/' + o3.orderNo, null, u.token)
  ok(det.canRebook === true, '改签资格下发（canRebook）')
  ok(det.rebookOptions.some((s) => s.id === sidD), '改签候选含同价团期 D，排除异价 E')
  const wrongPrice = await api('POST', '/c/orders/' + o3.orderNo + '/rebook', { sessionId: sidE }, u.token, true)
  ok(wrongPrice.code === 1001, '异价团期改签被拒（' + wrongPrice.msg + '）')
  const rb = await api('POST', '/c/orders/' + o3.orderNo + '/rebook', { sessionId: sidD }, u.token)
  ok(!!rb.orderNo, '改签出票（新单 ' + rb.orderNo + '）')
  const nst = await api('GET', '/c/orders/' + rb.orderNo, null, u.token)
  ok(nst.status === 20 && Number(nst.amount_pay) === Number(st.amount_goods), '新单已支付态、金额=原 goods（免支付）')
  ok(nst.passes.length === 1 && nst.passes.every((p) => p.status === 1), '新凭证已出票（可核销）')
  ok(nst.rebook_of === o3.orderNo, 'rebook_of 溯源到原单')
  const again = await api('POST', '/c/orders/' + o3.orderNo + '/rebook', { sessionId: sidD }, u.token, true)
  ok(again.code === 1001, '同一退款单只能改签一次')

  console.log('== E. 离线核销队列（§10：名单同步 → 断网放行 → 恢复上传二次校验 → 冲突人工队列）==')
  // 两张凭证的新订单（qty=2）
  const sidF = (await dbx.q('INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult, status) VALUES (?,?,?,?,?,1)',
    [pid, day(7), 20, 2, 29800])).insertId
  const o4 = await api('POST', '/c/orders', { sessionId: sidF, qty: 2 }, u.token)
  let paid4 = null
  for (let i = 0; i < 20; i++) {
    paid4 = await api('GET', '/c/orders/' + o4.orderNo, null, u.token)
    if (paid4.status >= 20) break
    await new Promise((r) => setTimeout(r, 500))
  }
  ok(paid4.status >= 20 && paid4.passes.length === 2, '离线场景夹具：qty=2 订单已出 2 张有效凭证')
  const passA = paid4.passes[0].id, passB = paid4.passes[1].id

  const list = await api('GET', '/m/verify/offline-list', null, mLogin.token)
  ok(list.passes.some((x) => x.pass_id === passA) && list.passes.some((x) => x.pass_id === passB), '离线名单含本店 2 张有效凭证')
  const codeA = (await api('GET', '/c/pass/' + passA + '/code', null, u.token)).display // 游客当前屏显码
  ok(/^\d{6}$/.test(codeA || ''), '展示码映射已下发（6 位）')

  // 断网模拟：直接调 offline-batch（等价于商户端本地队列恢复上传）
  const up1 = await api('POST', '/m/verify/offline-batch', { items: [{ payload: codeA, offlineAt: new Date().toISOString() }] }, mLogin.token)
  ok(up1.uploaded === 1 && up1.conflicts === 0, '恢复上传：离线输码二次校验通过（uploaded=1）')
  const pa = await one('SELECT status FROM travel_pass WHERE id = ?', [passA])
  ok(Number(pa.status) === 2, '凭证 A 已核销')

  const up2 = await api('POST', '/m/verify/offline-batch', { items: [{ payload: codeA, offlineAt: new Date().toISOString() }] }, mLogin.token)
  ok(up2.conflicts === 1 && up2.uploaded === 0, '重复上传 → 冲突不通过（防重放）')
  const cf = await one("SELECT id, status FROM verify_offline_conflict WHERE payload = ? AND status = 0", [codeA])
  ok(!!cf, '冲突已进人工队列（status=0 待处理）')

  // QR 载荷路径（wl://v/passId/window/sign）
  const qrB = await api('GET', '/c/pass/' + passB + '/code', null, u.token)
  const up3 = await api('POST', '/m/verify/offline-batch', { items: [{ payload: qrB.qr, offlineAt: new Date().toISOString() }] }, mLogin.token)
  ok(up3.uploaded === 1, 'QR 载荷离线上传二次校验通过（HMAC 窗口有效）')

  // 人工队列：确认核销凭证 B → 全单核销完订单 30→40
  await dbx.q("INSERT INTO verify_offline_conflict (merchant_id, pass_id, payload, offline_at, reason) VALUES (?,?,?,?, '离线演示冲突')",
    [(await one('SELECT merchant_id FROM tour_product WHERE id = ?', [pid])).merchant_id, passB, codeA, new Date()])
  const cfList = await api('GET', '/admin/verify/conflicts?status=0', null, admin)
  const target = cfList.find((x) => x.pass_id === passB)
  ok(!!target, '人工队列可见待处理冲突')
  await api('POST', '/admin/verify/conflicts/' + target.id + '/resolve', { action: 'confirm' }, admin)
  const pb = await one('SELECT status FROM travel_pass WHERE id = ?', [passB])
  ok(Number(pb.status) === 2, '人工确认 → 凭证 B 核销')
  const o4now = await api('GET', '/c/orders/' + o4.orderNo, null, u.token)
  ok(o4now.status === 40, '全单核销完 → 订单 30→40（人工确认同样驱动状态机）')
  const resolved = await one('SELECT status FROM verify_offline_conflict WHERE id = ?', [target.id])
  ok(Number(resolved.status) === 1, '冲突单置为已确认核销')

  console.log(`\n结果：${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
}

async function group_cancel() {
  const { cancelDueSessions } = await import('../src/domain/group.mjs')
  return cancelDueSessions()
}

main().catch((e) => { console.error(e); process.exit(1) })
