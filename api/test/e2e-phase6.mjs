// 六期 E2E：暗号玩法 / 逐品佣金覆盖 / KYC 实名审核 / 共创投资分润（V14，旧后台评估吸收四项）
// 前置：服务运行中 + V14 迁移已应用。运行：node test/e2e-phase6.mjs（自建隔离夹具）
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
  const u = await api('POST', '/c/auth/login', { code: 'phase6-tourist' })
  const m0 = await one('SELECT id FROM merchant LIMIT 1')

  // ---- 夹具：独立产品 + 团期 ----
  const pid = (await q(`INSERT INTO tour_product (channel, city_code, cat, title, subtitle, price_from, merchant_id, status)
    VALUES ('main','310118','trend','P6四项验证·乌镇夜戏','phase6-fixture',19900,?,1)`, [m0.id])).insertId
  const sid = (await dbx.q('INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult, status) VALUES (?,?,?,?,?,1)',
    [pid, day(5), 20, 2, 19900])).insertId

  console.log('== A. 暗号玩法层（后台配对 → 游客可见 → 商户对暗号整单核销）==')
  const phU = '桥边等船否' + String(Date.now()).slice(-6), phM = '漕港河里载秋来'
  await api('POST', '/admin/phrases/' + pid, { userPhrase: phU, merchantPhrase: phM }, admin)
  const plist = await api('GET', '/admin/phrases', null, admin)
  ok(plist.some((x) => x.id === pid && x.phrase_user === phU), '后台配置产品暗号对')
  const o1 = await api('POST', '/c/orders', { sessionId: sid, qty: 1 }, u.token)
  let paid1 = null
  for (let i = 0; i < 20; i++) {
    paid1 = await api('GET', '/c/orders/' + o1.orderNo, null, u.token)
    if (paid1.status >= 20) break
    await new Promise((r) => setTimeout(r, 500))
  }
  ok(paid1.status >= 20, '夹具订单已支付（' + o1.orderNo + '）')
  const ph = await api('GET', '/c/orders/' + o1.orderNo + '/phrase', null, u.token)
  ok(ph.enabled === true && ph.userPhrase === phU, '游客凭证暗号可见（' + ph.userPhrase + '）')
  // 无暗号产品返回 enabled:false
  const phNone = await api('GET', '/c/orders/WL_NOTHING/phrase', null, u.token, true)
  ok(phNone.code === 2003, '他人订单不可见暗号（2003）')
  // 商户登录
  await api('POST', '/m/auth/login', { code: 'phase6-merchant', merchantId: m0.id })
  const mLogin = await api('POST', '/m/auth/login', { code: 'phase6-merchant', merchantId: m0.id })
  const wrong = await api('POST', '/m/verify/phrase', { phrase: '说错的话' }, mLogin.token)
  ok(wrong.ok === false, '错暗号被拒（' + wrong.reason + '）')
  const hit = await api('POST', '/m/verify/phrase', { phrase: phU }, mLogin.token)
  ok(hit.ok === true && hit.verified === 1 && hit.counterPhrase === '漕港河里载秋来', '对上暗号整单核销 + 返回对答句')
  const pidSt = await one('SELECT status FROM travel_pass WHERE order_id = ?', [paid1.id])
  ok(Number(pidSt.status) === 2, '凭证已置已核销')
  const again = await api('POST', '/m/verify/phrase', { phrase: phU }, mLogin.token)
  ok(again.ok === false, '重复对暗号不再命中（凭证已消费）')

  console.log('== B. 逐品佣金覆盖（单品费率优先于档位，12% 封顶）==')
  const over = await api('POST', '/admin/rate-overrides/' + pid, { rateBp: 2000 }, admin, true)
  ok(over.code === 1001, '超 12% 被拒（' + over.msg + '）')
  await api('POST', '/admin/rate-overrides/' + pid, { rateBp: 950 }, admin) // 9.5%
  // 推广商下单计佣
  const promoUser = await api('POST', '/c/auth/login', { code: 'phase6-promoter' })
  await api('POST', '/admin/promoters/register', { userId: promoUser.user.id, tier: 1 }, admin) // 档位 5%
  const scene = await api('GET', '/c/promote/scene', null, promoUser.token)
  const o2 = await api('POST', '/c/orders', { sessionId: sid, qty: 1, promoScene: scene.scene }, u.token)
  for (let i = 0; i < 20; i++) {
    const st = await api('GET', '/c/orders/' + o2.orderNo, null, u.token)
    if (st.status >= 20) break
    await new Promise((r) => setTimeout(r, 500))
  }
  // 模拟完成到 50（直接 SQL 推状态 + 调计佣）
  const o2row = await one('SELECT id FROM orders WHERE order_no = ?', [o2.orderNo])
  await dbx.q("UPDATE orders SET status = 50, completed_at = NOW(3) WHERE order_no = ?", [o2.orderNo])
  const { createCommission } = await import('../src/domain/promo.mjs')
  await createCommission(o2.orderNo)
  const cm = await one('SELECT rate_bp, base_amount, amount FROM commission WHERE order_id = ?', [o2row.id])
  ok(cm && Number(cm.rate_bp) === 950, '单品费率 9.5% 覆盖档位 5% 生效')
  ok(Number(cm.amount) === Math.floor(Number(cm.base_amount) * 950 / 10000), '佣金按覆盖费率计算（' + cm.amount + ' 分）')
  const ovList = await api('GET', '/admin/rate-overrides', null, admin)
  ok(ovList.some((x) => x.id === pid), '后台覆盖清单可见')
  await api('POST', '/admin/rate-overrides/' + pid, { rateBp: null }, admin)
  const cm2 = await one('SELECT promo_rate_bp FROM tour_product WHERE id = ?', [pid])
  ok(cm2.promo_rate_bp === null, '清除覆盖恢复档位费率')

  console.log('== C. KYC 实名审核（游客提交 → 后台通过/驳回）==')
  const badId = await api('POST', '/c/kyc/submit', { realName: '张三', idNo: '12345' }, u.token, true)
  ok(badId.code === 1001, '非法身份证号被拒')
  const sub = await api('POST', '/c/kyc/submit', { realName: '赵小明', idNo: '310110199001011234' }, u.token)
  ok(sub.submitted === true && sub.masked.startsWith('310') && sub.masked.endsWith('1234'), '提交成功且脱敏返回（' + sub.masked + '）')
  const mine = await api('GET', '/c/kyc/mine', null, u.token)
  ok(mine.status === 0 && !mine.id_no_enc, '游客端可见审核中状态（不漏加密号）')
  const kycList = await api('GET', '/admin/kyc?status=0', null, admin)
  const target = kycList.find((x) => x.id_no_mask === sub.masked)
  ok(!!target, '后台待审队列可见')
  const encRow = await one('SELECT id_no_enc, id_no_mask FROM kyc_application WHERE id = ?', [target.id])
  ok(encRow.id_no_enc.length > 0 && encRow.id_no_mask !== '310110199001011234', '库中加密落库、掩码不泄露全文')
  await api('POST', '/admin/kyc/' + target.id + '/resolve', { action: 'reject', note: '照片模糊' }, admin)
  const againResolve = await api('POST', '/admin/kyc/' + target.id + '/resolve', { action: 'pass' }, admin, true)
  ok(againResolve.code === 1004, '重复审核被拒（状态机守卫）')
  const resub = await api('POST', '/c/kyc/submit', { realName: '赵小明', idNo: '310110199001011234' }, u.token)
  ok(resub.submitted === true, '驳回后可重新提交（一户一档更新）')
  const kyc2 = await api('GET', '/admin/kyc?status=0', null, admin)
  const t2 = kyc2.find((x) => x.id_no_mask === sub.masked)
  await api('POST', '/admin/kyc/' + t2.id + '/resolve', { action: 'pass' }, admin)
  const mine2 = await api('GET', '/c/kyc/mine', null, u.token)
  ok(mine2.status === 1, '审核通过（游客端可见已实名）')

  console.log('== D. 共创投资分润（登记 → 结算期自动入账 → 台账打款）==')
  const coBad = await api('POST', '/admin/co-creators', { productId: pid, name: '测试商', mobile: '13800000000', role: 1, sharePct: 6000 }, admin, true)
  ok(coBad.code === 1001, '分润比例 >50% 被拒')
  const co = await api('POST', '/admin/co-creators', { productId: pid, name: '古镇文旅基金', mobile: '13800000001', role: 1, investAmount: 5000000, sharePct: 800 }, admin)
  ok(/^C\d{11,}$/.test(co.coNo), '共创人登记（编号 ' + co.coNo + '）')
  // 订单已到 50 → 生成结算单
  const period = '2026-W44'
  const sid2 = await (async () => {
    const { generateSettlement } = await import('../src/domain/promo.mjs')
    return generateSettlement(Number(m0.id), period)
  })()
  ok(sid2 > 0, '结算单生成 #' + sid2)
  const cp = await one('SELECT * FROM co_profit WHERE co_creator_id = ? AND settlement_id = ?', [co.id, sid2])
  ok(!!cp, '共创分润台账自动入账')
  const o2amt = await one('SELECT amount_pay - insurance_fee gmv FROM orders WHERE order_no = ?', [o2.orderNo])
  const stRow = await one('SELECT total_amount, amt_retained FROM settlement WHERE id = ?', [sid2])
  const expectAmt = Math.round(Number(stRow.amt_retained) * Number(o2amt.gmv) / Number(stRow.total_amount) * 800 / 10000)
  ok(Math.abs(Number(cp.amount) - expectAmt) <= 2, '分润额=产品GMV占比×留存毛利×8%（' + cp.amount + '≈' + expectAmt + '）')
  const regen = await (async () => {
    const { generateSettlement } = await import('../src/domain/promo.mjs')
    return generateSettlement(Number(m0.id), period)
  })()
  const cpCount = await one('SELECT COUNT(*) c FROM co_profit WHERE settlement_id = ?', [sid2])
  ok(Number(cpCount.c) === 1, '重建结算单不重复分润（幂等）')
  const cpList = await api('GET', '/admin/co-profits', null, admin)
  ok(cpList.some((x) => x.settlement_id === sid2), '后台共创台账可见')
  await api('POST', '/admin/co-profits/' + cp.id + '/pay', {}, admin)
  const paid = await one('SELECT status FROM co_profit WHERE id = ?', [cp.id])
  ok(Number(paid.status) === 1, '标记打款完成')

  console.log(`\n结果：${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
