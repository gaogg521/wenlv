# -*- coding: utf-8 -*-
import io

# ============ 1) routes.mjs：scope 隔离 + 存证中心 + 公开验证 + 用户数字身份 + 任务扩展 ============
s = io.open('src/routes.mjs', encoding='utf-8').read()

# requireAdmin 返回 scope
old_ra = """async function requireAdmin(req, roles) {
  const h = (req.headers.authorization || '').replace(/^Bearer /, '')
  const { jwtVerify } = await import('./auth.mjs')
  const p = jwtVerify(h)
  if (!p || p.end !== 'admin') throw new BizError(1002, '后台未登录')
  if (roles && !roles.includes(p.role)) throw new BizError(1003, '权限不足（' + p.role + '）')
  return p
}"""
new_ra = """async function requireAdmin(req, roles) {
  const h = (req.headers.authorization || '').replace(/^Bearer /, '')
  const { jwtVerify } = await import('./auth.mjs')
  const p = jwtVerify(h)
  if (!p || p.end !== 'admin') throw new BizError(1002, '后台未登录')
  if (roles && !roles.includes(p.role)) throw new BizError(1003, '权限不足（' + p.role + '）')
  return p // 含 scopeCity（城市合伙人行级隔离）：列表查询必须经 scopeFilter 注入
}

/** 行级隔离：城市合伙人只能看自己城市；内部角色全量 */
function scopeFilter(admin, col = 'city_code') {
  const city = admin.scopeCity
  if (!city) return { sql: '', params: [] }
  return { sql: ` AND ${col} = ?`, params: [city] }
}"""
assert old_ra in s
s = s.replace(old_ra, new_ra)

# 订单列表加 scope
old_orders = """  'GET /admin/orders': async (req) => {
    await requireAdmin(req)
    const { status, kw } = req.query
    return await q(`SELECT o.*, p.title, u.nickname FROM orders o
      JOIN tour_product p ON p.id = o.product_id JOIN user_account u ON u.id = o.user_id
      ${status ? 'WHERE o.status = ' + Number(status) : ''} ${kw ? (status ? 'AND' : 'WHERE') + ' o.order_no LIKE ' + JSON.stringify('%' + kw + '%') : ''}
      ORDER BY o.id DESC LIMIT 100`)
  },"""
new_orders = """  'GET /admin/orders': async (req) => {
    const a = await requireAdmin(req)
    const { status, kw } = req.query
    const sc = scopeFilter(a, 'o.city_code')
    const where = []
    if (sc.sql) where.push(sc.sql.replace(' AND ', ''))
    if (status) where.push('o.status = ' + Number(status))
    if (kw) where.push('o.order_no LIKE ' + JSON.stringify('%' + kw + '%'))
    return await q(`SELECT o.*, p.title, u.nickname FROM orders o
      JOIN tour_product p ON p.id = o.product_id JOIN user_account u ON u.id = o.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY o.id DESC LIMIT 100`, sc.params)
  },"""
assert old_orders in s
s = s.replace(old_orders, new_orders)

# 商品列表加 scope
old_prod = """  'GET /admin/products': async (req) => {
    await requireAdmin(req)
    return await q('SELECT p.*, m.name merchant_name FROM tour_product p LEFT JOIN merchant m ON m.id = p.merchant_id ORDER BY p.id DESC')
  },"""
new_prod = """  'GET /admin/products': async (req) => {
    const a = await requireAdmin(req)
    const sc = scopeFilter(a, 'p.city_code')
    return await q(`SELECT p.*, m.name merchant_name FROM tour_product p LEFT JOIN merchant m ON m.id = p.merchant_id WHERE 1=1 ${sc.sql} ORDER BY p.id DESC`, sc.params)
  },"""
assert old_prod in s
s = s.replace(old_prod, new_prod)

# 结算列表加 scope（按商户城市）
old_settle = """  'GET /admin/settlements': async (req) => { await requireAdmin(req); return await q('SELECT s.*, m.name merchant_name FROM settlement s JOIN merchant m ON m.id = s.merchant_id ORDER BY s.id DESC') },"""
new_settle = """  'GET /admin/settlements': async (req) => {
    const a = await requireAdmin(req)
    const sc = scopeFilter(a, 'm.city_code')
    return await q(`SELECT s.*, m.name merchant_name FROM settlement s JOIN merchant m ON m.id = s.merchant_id WHERE 1=1 ${sc.sql} ORDER BY s.id DESC`, sc.params)
  },"""
assert old_settle in s
s = s.replace(old_settle, new_settle)

# 登录携带 scope
old_login = """    return { token: jwtSign({ uid: u.id, end: 'admin', role: u.role, name: u.display_name || u.username }, 12 * 3600),
      user: { username: u.username, role: u.role, displayName: u.display_name } }"""
new_login = """    return { token: jwtSign({ uid: u.id, end: 'admin', role: u.role, name: u.display_name || u.username, scopeCity: u.scope_city || null }, 12 * 3600),
      user: { username: u.username, role: u.role, displayName: u.display_name, scopeCity: u.scope_city || null } }"""
assert old_login in s
s = s.replace(old_login, new_login)

# ============ 存证中心 + 公开验证 + 用户数字身份（新增路由段）============
anchor2 = "// ---------- 微信支付回调 ----------"
add2 = '''// ---------- 存证中心 / 公开验证 / 用户数字身份 ----------
const web3 = {
  // 后台：存证批次与队列总览
  'GET /admin/attest/center': async (req) => {
    await requireAdmin(req)
    const batches = await q('SELECT * FROM attest_batch ORDER BY id DESC LIMIT 20')
    const queue = await q(`SELECT biz_type,
      SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) anchored,
      COUNT(*) total FROM attest_event GROUP BY biz_type`)
    const recent = await q(`SELECT e.biz_type, e.biz_ref, e.status, e.created_at, b.merkle_root, b.chain_tx_ref
      FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id ORDER BY e.id DESC LIMIT 30`)
    return { batches, queue, recent, chainMode: 'NOOP（链数根适配 P1 接入，哈希流水已实时记录）' }
  },

  // 单号验证（后台+开放页共用逻辑）
  async _verify(bizType, bizRef) {
    const e = await one('SELECT e.*, b.merkle_root, b.chain_tx_ref, b.anchored_at FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id WHERE e.biz_type = ? AND e.biz_ref = ?', [bizType, bizRef])
    if (!e) return { found: false }
    return { found: true, bizType, bizRef, payloadHash: e.payload_hash, status: e.status,
      merkleRoot: e.merkle_root, chainRef: e.chain_tx_ref, anchoredAt: e.anchored_at,
      note: e.status === 2 ? '已锚定上链，哈希与本地记录一致' : '已入队待打包（小时级批次）' }
  },
  'GET /admin/attest/verify': async (req) => {
    await requireAdmin(req)
    return await web3._verify(String(req.query.bizType || 'order'), String(req.query.bizRef || ''))
  },
}

// 公开验证（无登录·只读·给景区/政府/投资人：输单号出存证证明）
const open = {
  'GET /open/verify/order/:orderNo': async (req) => {
    const r = await web3._verify('order', req.params.orderNo)
    if (!r.found) throw new BizError(1004, '未找到该单的存证记录')
    return { ...r, platform: '向往的自由 · 向往自由链存证', tip: '本验证不暴露任何用户与金额信息，仅返回哈希锚定证明' }
  },
}

// 用户侧数字身份（小程序 A「我的数字身份」页：Travel ID = 凭证+徽章+存证流水）
const cIdentity = {
  'GET /c/identity': async (req) => {
    const u = requireUser(req)
    const acc = await one('SELECT nickname, member_level, growth_value, created_at FROM user_account WHERE id = ?', [u.uid])
    const passes = await q('SELECT id, name, kind, status, valid_to, created_at FROM travel_pass WHERE user_id = ? ORDER BY id DESC LIMIT 20', [u.uid])
    const badges = await q(`SELECT b.name, b.icon_key, ub.granted_at FROM user_badge ub JOIN badge b ON b.id = ub.badge_id WHERE ub.user_id = ?`, [u.uid])
    const myOrders = await q('SELECT order_no FROM orders WHERE user_id = ?', [u.uid])
    const attestations = []
    for (const o of myOrders.slice(0, 10)) {
      const e = await one("SELECT payload_hash, status, created_at FROM attest_event WHERE biz_type = 'order' AND biz_ref = ?", [o.order_no])
      if (e) attestations.push({ orderNo: o.order_no, hash: e.payload_hash, anchored: e.status === 2, at: e.created_at })
    }
    return { profile: { nickname: acc.nickname, memberLevel: acc.member_level, growth: acc.growth_value, joinedAt: acc.created_at },
      passes, badges, attestations,
      statement: '消费与权益记录的可信存证流水，作为贡献分与数字身份的依据' }
  },
}

'''
assert anchor2 in s
s = s.replace(anchor2, add2 + anchor2, 1)
old_exp2 = "export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...callback }"
new_exp2 = "export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...web3, ...open, ...cIdentity, ...callback }"
assert old_exp2 in s
s = s.replace(old_exp2, new_exp2)

io.open('src/routes.mjs', 'w', encoding='utf-8', newline='\n').write(s)
print('routes: scope + web3 + open verify + identity')

# ============ 2) index.mjs：种入城市合伙人演示账号 ============
i = io.open('src/index.mjs', encoding='utf-8').read()
old_seed = """    await q(`INSERT INTO admin_user (username, password_hash, role, display_name) VALUES
      ('admin', ?, 'super', '超级管理员'),
      ('finance', ?, 'finance', '财务'),
      ('ops', ?, 'ops', '运营')`, [hashPassword(pw), hashPassword(pw), hashPassword(pw)])"""
new_seed = """    await q(`INSERT INTO admin_user (username, password_hash, role, display_name) VALUES
      ('admin', ?, 'super', '超级管理员'),
      ('finance', ?, 'finance', '财务'),
      ('ops', ?, 'ops', '运营')`, [hashPassword(pw), hashPassword(pw), hashPassword(pw)])
    const cityPw = process.env.CITY_PARTNER_PASSWORD || 'city123'
    await q(`INSERT INTO admin_user (username, password_hash, role, display_name, scope_city) VALUES
      ('city310118', ?, 'city_partner', '青浦城市合伙人·演示', '310118') ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
      [hashPassword(cityPw)])
    console.log('[boot] 城市合伙人演示账号：city310118（仅可见 310118 青浦数据）')"""
assert old_seed in i
i = i.replace(old_seed, new_seed)
io.open('src/index.mjs', 'w', encoding='utf-8', newline='\n').write(i)
print('bootstrap: city partner demo account')

# ============ 3) admin UI：治理区加「存证中心」页 ============
j = io.open('admin/app.js', encoding='utf-8').read()
old_nav2 = "  ['治理', [['config', '参数中心', 'config'], ['risk', '风控', 'risk'], ['audit', '审计日志', 'audit']]],"
new_nav2 = "  ['治理', [['config', '参数中心', 'config'], ['attest', '存证中心', 'eco'], ['risk', '风控', 'risk'], ['audit', '审计日志', 'audit']]],"
assert old_nav2 in j
j = j.replace(old_nav2, new_nav2)
j = j.replace("system: '运维控制台', features: '功能开关', content: '内容审核', withdrawals: '提现审批', agreements: '协议变更' }[page]",
              "system: '运维控制台', features: '功能开关', content: '内容审核', withdrawals: '提现审批', agreements: '协议变更', attest: '存证中心' }[page]")
j = j.replace("risk, audit, system, features, content, withdrawals, agreements }[page] || dash)()",
              "risk, audit, system, features, content, withdrawals, agreements, attest }[page] || dash)()")

attest_page = '''/* ============ 存证中心（Web3 对外窗口）============ */
async function attest() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/attest/center')
  const STMAP = ['<span class="pill warn">待打包</span>', '<span class="pill s20">已打包</span>', '<span class="pill ok">已上链</span>', '<span class="pill s70">重试</span>']
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>存证中心</h2><span class="muted">${esc(d.chainMode)}</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      ${(d.queue || []).map((qq) => `<div class="kpi"><div class="ico" style="background:var(--brand-soft)">⛓</div>
        <div><div class="l">${esc(qq.biz_type)}</div><div class="v" style="font-size:18px">${Number(qq.pending)} 待锚</div>
        <div class="s">累计 ${Number(qq.total)} · 已锚 ${Number(qq.anchored)}</div></div></div>`).join('') || '<div class="kpi"><div class="s">暂无事件</div></div>'}
    </div>
    <div class="row" style="margin-top:6px"><input id="vref" placeholder="输入订单号验证（如 WL20261024…）" style="width:320px">
      <button class="btn primary sm" onclick="verifyAttest()">验证</button>
      <span class="muted">公开验证口（无登录只读）：/open/verify/order/{单号} —— 给景区 / 政府 / 投资人的「一网可信」窗口</span></div>
    <div id="vout"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>锚定批次（Merkle 根）</h3></div>
    ${(d.batches || []).length ? `<table><thead><tr><th>批次</th><th>业务日</th><th>Merkle 根</th><th>链上编号</th><th>状态</th></tr></thead><tbody>
      ${d.batches.map((b) => `<tr><td>#${b.id}</td><td>${esc(String(b.biz_date).slice(0, 10))}</td>
        <td><code>${esc(String(b.merkle_root).slice(0, 24))}…</code></td><td class="td-sub">${esc(b.chain_tx_ref || '—')}</td>
        <td>${STMAP[b.status]}</td></tr>`).join('')}</tbody></table>` : emptyBox('尚无锚定批次（Noop 阶段队列实时记哈希，接链数根后按小时出批次）')}
  </div>
  <div class="card">
    <div class="card-head"><h3>最近事件</h3></div>
    <table><thead><tr><th>类型</th><th>业务单号</th><th>状态</th><th>Merkle 根</th><th>时间</th></tr></thead><tbody>
    ${(d.recent || []).map((e) => `<tr><td><span class="pill off">${esc(e.biz_type)}</span></td><td class="num">${esc(e.biz_ref)}</td>
      <td>${STMAP[e.status]}</td><td class="td-sub">${e.merkle_root ? '<code>' + esc(String(e.merkle_root).slice(0, 16)) + '…</code>' : '—'}</td>
      <td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td></tr>`).join('')}
    </tbody></table>
  </div>`
}
async function verifyAttest() {
  const ref = document.getElementById('vref').value.trim()
  if (!ref) return
  const r = await api('GET', '/admin/attest/verify?bizType=order&bizRef=' + encodeURIComponent(ref))
  document.getElementById('vout').innerHTML = r.found
    ? `<div class="card" style="margin-top:14px;background:#f0faf7"><div class="row" style="margin:0">
        <span class="pill ok">✓ 已找到存证记录</span><span>${r.note}</span></div>
       <table style="margin-top:8px"><tr><td class="td-sub">业务单号</td><td class="num">${esc(r.bizRef)}</td></tr>
       <tr><td class="td-sub">载荷哈希</td><td><code>${esc(r.payloadHash)}</code></td></tr>
       ${r.merkleRoot ? `<tr><td class="td-sub">Merkle 根</td><td><code>${esc(r.merkleRoot)}</code></td></tr>` : ''}
       ${r.chainRef ? `<tr><td class="td-sub">链上编号</td><td><code>${esc(r.chainRef)}</code></td></tr>` : ''}</table></div>`
    : `<div class="card" style="margin-top:14px"><span class="pill s70">未找到该单存证记录</span></div>`
}

'''
assert "\nboot()" in j
j = j.replace("\nboot()", "\n" + attest_page + "boot()", 1)
io.open('admin/app.js', 'w', encoding='utf-8', newline='\n').write(j)
print('admin UI: attest center page')
