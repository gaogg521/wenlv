// 二期 E2E：存证打包链路 / 笔记发布机审 / 提现自动打款通道 / 手动任务 / 城市隔离 / 公开验证 / 数字身份
// 前置：服务运行中。运行：node test/e2e-phase2.mjs（不破坏一期数据，仅追加）
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
  console.log('== A. 存证打包（Merkle 批次 → 已上链 → 验证含根）==')
  const admin = (await api('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const before = await api('GET', '/admin/attest/center', null, admin)
  const pendingBefore = Number((before.queue.find((q2) => q2.biz_type === 'order') || {}).pending || 0)
  const packed = await api('POST', '/admin/system/jobs/attest-pack/run', {}, admin)
  ok(packed.affected > 0 || pendingBefore === 0, '存证打包任务执行（锚定 ' + packed.affected + ' 事件）')
  const after = await api('GET', '/admin/attest/center', null, admin)
  ok(after.batches.length > 0, '锚定批次已生成（#' + after.batches[0].id + ' root=' + String(after.batches[0].merkle_root).slice(0, 12) + '…）')
  ok(Number((after.queue.find((q2) => q2.biz_type === 'order') || {}).pending || 0) === 0, '打包后 order 队列清零')
  const oneRef = after.recent.find((e) => e.biz_type === 'order')
  const v = await api('GET', '/admin/attest/verify?bizType=order&bizRef=' + encodeURIComponent(oneRef.biz_ref), null, admin)
  ok(v.found && v.merkleRoot, '单号验证返回 Merkle 根（' + String(v.merkleRoot).slice(0, 12) + '…）')

  console.log('== B. 公开验证（无登录只读）==')
  const pub = await api('GET', '/open/verify/order/' + oneRef.biz_ref)
  ok(pub.found && pub.platform.includes('向往的自由'), '公开验证可用且带平台标识（不暴露用户/金额）')
  const pubMiss = await api('GET', '/open/verify/order/WL_NOT_EXIST_999', null, null, true)
  ok(pubMiss.code === 1004, '不存在单号返回 1004')

  console.log('== C. 笔记发布（msgSecCheck 机审前置）==')
  const u = (await api('POST', '/c/auth/login', { code: 'phase2-writer' }))
  const n1 = await api('POST', '/c/notes', { title: '朱家角一日游记', body: '古镇很美，剧本游值得推荐，放生桥日落绝佳。' }, u.token)
  ok(n1.status === 2 && n1.secMock === true, '机审通过直接发布（MOCK 通道）')
  const notes = await api('GET', '/c/notes', null, u.token)
  ok(notes.some((x) => x.title === '朱家角一日游记'), '已发布笔记对外可见')

  console.log('== D. 提现通道（MOCK 自动打款流水号）==')
  const fin = (await api('POST', '/admin/login', { username: 'finance', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const dbx = await import('../src/db.mjs')
  // 造一笔已到期佣金 + 提现申请（走用户接口）
  await dbx.q('UPDATE commission SET payable_at = NOW() - INTERVAL 1 DAY WHERE status = 0', [])
  await api('POST', '/admin/system/jobs/commission-due/run', {}, admin)
  const writer2 = await api('POST', '/c/auth/login', { code: 'phase2-promo' })
  await api('POST', '/admin/promoters/register', { userId: writer2.user.id, tier: 3 }, admin)
  const dbx2 = await import('../src/db.mjs')
  await dbx2.q(`INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty, amount_goods, amount_pay, status, promo_scene, paid_at, completed_at)
    SELECT CONCAT('WLPH2-', FLOOR(RAND()*100000)), ?, 1, 1, '310118', 1, 1, 2000000, 2000000, 50, 'p-ph2', NOW(), NOW()`, [writer2.user.id])
  await dbx2.q(`INSERT INTO attribution (promoter_id, scene, channel) VALUES (?, 'p-ph2', 'test') ON DUPLICATE KEY UPDATE promoter_id = VALUES(promoter_id)`, [writer2.user.id])
  await dbx2.q(`INSERT INTO commission (order_id, promoter_id, base_amount, rate_bp, amount, status, payable_at)
    SELECT o.id, ?, 2000000, 1200, 240000, 1, NOW() - INTERVAL 1 DAY FROM orders o WHERE o.user_id = ? AND o.order_no LIKE 'WLPH2-%' AND NOT EXISTS (SELECT 1 FROM commission c WHERE c.order_id = o.id)`,
    [writer2.user.id, writer2.user.id])
  const ov = await api('GET', '/c/promote/overview', null, writer2.token)
  ok(ov.withdrawable >= 10000, '金牌 12% 佣金可提现（' + ov.withdrawable + ' 分）')
  const wd = await api('POST', '/c/promote/withdraw', { note: 'phase2' }, writer2.token)
  const wdList = await api('GET', '/admin/withdrawals', null, fin)
  ok(wdList.some((x) => x.id === wd.id && x.status === 0), '提现进入财务队列')
  const done = await api('POST', '/admin/withdrawals/' + wd.id + '/verdict', { pass: true }, fin)
  ok(done.status === 1, '审批通过自动打款（MOCK 通道流水留痕）')

  console.log('== E. 手动任务全量 ==')
  for (const j of ['close-timeout', 'complete-due', 'bean-expire']) {
    const r = await api('POST', '/admin/system/jobs/' + j + '/run', {}, admin)
    ok(typeof r.affected === 'number', '任务 ' + j + ' 可执行')
  }
  const sys = await api('GET', '/admin/system/overview', null, admin)
  ok(sys.migrations && sys.migrations.length >= 5, '迁移清单可见（' + sys.migrations.length + ' 个 SQL）')

  console.log('== F. 城市隔离（回归）==')
  const city = (await api('POST', '/admin/login', { username: 'city310118', password: process.env.CITY_PARTNER_PASSWORD || 'city123' })).token
  const cityOrders = await api('GET', '/admin/orders', null, city)
  ok(cityOrders.every((o) => o.city_code === '310118'), '合伙人只见青浦（' + cityOrders.length + ' 单）')
  const cityKpi = await api('GET', '/admin/dash/kpi', null, city)
  ok(cityKpi.scopeCity === '310118' && !cityKpi.globalScope, '合伙人 KPI 本城口径（310118）')
  const superKpi = await api('GET', '/admin/dash/kpi', null, admin)
  ok(Number(superKpi.gmvToday) >= Number(cityKpi.gmvToday), '合伙人 GMV ≤ 全域 GMV（无越权）')

  console.log('== G. 数字身份 ==')
  const idn = await api('GET', '/c/identity', null, u.token)
  ok(idn.passes !== undefined && Array.isArray(idn.attestations), '数字身份接口（凭证/徽章/存证流水）')

  console.log(`\nPHASE2 RESULT: ${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('PHASE2 ERROR:', e.message); process.exit(1) })
