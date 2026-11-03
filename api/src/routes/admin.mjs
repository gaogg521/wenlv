import { q, one, count, tx, BizError } from '../db.mjs'
import { cfg, cfgAll, cfgNum, cfgArr, loadConfig, configName } from '../config.mjs'
import { requireUser, jwtSign, code2Session, hashPassword, verifyPassword } from '../auth.mjs'
import * as order from '../domain/order.mjs'
import * as bean from '../domain/bean.mjs'
import * as pass from '../domain/pass.mjs'
import * as promo from '../domain/promo.mjs'
import { maskApplyMobile, publicOrderPhone, sealMobile } from '../infra/mobile.mjs'
import { ADMIN_ACTIONS } from '../domain/admin-capabilities.mjs'
import * as refund from '../domain/refund.mjs'
import * as group from '../domain/group.mjs'
import * as wxpay from '../domain/wxpay.mjs'
import * as attestDomain from '../domain/attest.mjs'
import * as merkleLib from '../domain/merkle.mjs'
import * as refundPolicy from '../domain/refund-policy.mjs'
import { sanitizeRich } from '../infra/sanitize.mjs'
import { bizDay, settlementPeriod } from '../infra/bizdate.mjs'
import * as entities from '../domain/entity-schema.mjs'
import { buildSvg, svgToPdf, orderReportDoc, beanDayReportDoc, settlementReportDoc } from '../domain/report.mjs'
import * as vc from '../domain/vc.mjs'
import * as asset from '../domain/asset.mjs'
import * as badgeDomain from '../domain/badge.mjs'
import * as member from '../domain/member.mjs'
import * as merchantLevel from '../domain/merchant-level.mjs'
import * as taskReview from '../domain/task-review.mjs'
import { findBanned, SUGGEST } from '../domain/wording.mjs'
import { capabilityDoc, renderPdf as renderOnepagerPdf, renderPng as renderOnepagerPng } from '../domain/onepager.mjs'
import * as chain from '../infra/chain.mjs'
import * as wxapi from '../domain/wxapi.mjs'
import * as wxsec from '../infra/wxsec.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { fen2yuan, apiImg, toCsv, requireAdmin, scopeFilter, SUP_CATS, CREATOR_TAGS, audit, capabilityContext, publicBase, notifyMerchantStaff, handlePayNotify } from './_shared.mjs'

// config_history 的 JSON 列被驱动读成了 JS 值（数组 / 对象 / 数字 / 字符串），写回 rule_config 必须序列化成 JSON 文本；
// 直接 String() 会把数组变成 "[object Object]"（此前审批、回滚任何 JSON 数组类参数都会报错）
const jsonText = (v) => JSON.stringify(v)

// T00：有城市列的实体种类；城市账号读取按城市行级隔离，其余种类对城市账号默认拒绝
const ENTITY_CITY_KINDS = ['product', 'merchant', 'scenic', 'supplier']

const admin = {
  'GET /admin/capabilities': async (req) => {
    const a = await requireAdmin(req)
    const actions = Object.fromEntries(Object.entries(ADMIN_ACTIONS).map(([key, rule]) => [key, {
      allowed: rule.roles.includes(a.role), reason: '需' + rule.label,
    }]))
    for (const kind of entities.kinds()) {
      const sc = entities.get(kind)
      for (const [op, roles] of [['edit', sc.roles], ['create', sc.createRoles || sc.roles]]) {
        actions[`entity.${kind}.${op}`] = { allowed: (op !== 'create' || !sc.noCreate) && roles.includes(a.role), reason: '当前角色不能' + (op === 'create' ? '新建' : '编辑') + sc.label }
      }
    }
    return { role: a.role, scopeCity: a.scopeCity || null, actions }
  },
  'POST /admin/login': async (req) => {
    const { username, password } = req.body
    const u = await one('SELECT * FROM admin_user WHERE username = ? AND status = 1', [username || ''])
    if (!u || !verifyPassword(password || '', u.password_hash)) throw new BizError(1002, '账号或密码错误')
    // MFA：全局策略（admin.mfa.mode: off/optional（默认，用户绑定即启用）/required）+ 用户绑定
    const mfaMode = String((await cfgAll())['admin.mfa.mode'] || '"optional"')
    const bound = Number(u.mfa_enabled) === 1 && (u.mfa_channel === 'totp' ? u.mfa_secret : (u.mfa_channel === 'sms' ? u.mobile : u.email))
    const need = mfaMode.includes('required') ? true : (mfaMode.includes('optional') && !!bound)
    if (need) {
      const ch = bound ? u.mfa_channel : (u.mobile ? 'sms' : u.email ? 'email' : 'totp')
      if (!bound && ch === 'sms' && u.mobile) await import('../infra/mfa.mjs').then((m) => m.sendCode(u.mobile, 'sms'))
      return { mfaRequired: true, challenge: jwtSign({ uid: u.id, end: 'mfa', ch, exp2: Date.now() + 5 * 60_000 }, 300),
        channel: ch, target: ch === 'sms' ? String(u.mobile || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : (ch === 'email' ? String(u.email || '').replace(/^(.).*(@.*)$/, '$1***$2') : null) }
    }
    await q('UPDATE admin_user SET last_login_at = NOW(3) WHERE id = ?', [u.id])
    return { token: jwtSign({ uid: u.id, ver: Number(u.token_epoch), end: 'admin', role: u.role, name: u.display_name || u.username, scopeCity: u.scope_city || null }, 12 * 3600),
      user: { uid: u.id, username: u.username, role: u.role, displayName: u.display_name, scopeCity: u.scope_city || null, mustChangePassword: Number(u.must_change_pwd) === 1 } }
  },

  // 第二步：TOTP / 短信 / 邮箱验证码（challenge 5 分钟有效）
  'POST /admin/login/mfa': async (req) => {
    const { challenge, code, resend } = req.body
    const { jwtVerify } = await import('../auth.mjs')
    const p = jwtVerify(challenge || '')
    if (!p || p.end !== 'mfa' || Date.now() > p.exp2) throw new BizError(1002, '验证会话已过期，请重新登录')
    const u = await one('SELECT * FROM admin_user WHERE id = ? AND status = 1', [p.uid])
    if (!u) throw new BizError(1002, '账号状态异常')
    const mfa = await import('../infra/mfa.mjs')
    if (resend) {
      if (p.ch !== 'totp') await mfa.sendCode(p.ch === 'sms' ? u.mobile : u.email, p.ch)
      return { resent: true }
    }
    let ok = false
    if (p.ch === 'totp') ok = u.mfa_secret && mfa.totpVerify(u.mfa_secret, code)
    else ok = await mfa.verifyCode(p.ch === 'sms' ? u.mobile : u.email, p.ch, code)
    if (!ok) throw new BizError(1002, '验证码不正确或已过期')
    await q('UPDATE admin_user SET last_login_at = NOW(3) WHERE id = ?', [u.id])
    return { token: jwtSign({ uid: u.id, ver: Number(u.token_epoch), end: 'admin', role: u.role, name: u.display_name || u.username, scopeCity: u.scope_city || null }, 12 * 3600),
      user: { uid: u.id, username: u.username, role: u.role, displayName: u.display_name, scopeCity: u.scope_city || null, mustChangePassword: Number(u.must_change_pwd) === 1 } }
  },

  // ===== 安全中心（系统工作区）：绑定 MFA / 发送测试 / 最近验证码（MOCK 通道演示用）=====
  'GET /admin/security/accounts': async (req) => {
    await requireAdmin(req, ['super'])
    return await q('SELECT id, username, role, display_name, mfa_enabled, mfa_channel, mobile, email, last_login_at, status FROM admin_user ORDER BY id')
  },
  'POST /admin/security/mfa/setup': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { userId } = req.body
    const mfa = await import('../infra/mfa.mjs')
    const secret = mfa.newTotpSecret()
    await q('UPDATE admin_user SET mfa_secret = ?, mfa_channel = ?, mfa_enabled = 1 WHERE id = ?', [secret, 'totp', userId])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'security', 'mfa-setup', 'user-' + userId, null, { channel: 'totp' }))
    const u = await one('SELECT username FROM admin_user WHERE id = ?', [userId])
    return { secret, uri: mfa.otpauthUri(secret, u.username), current: mfa.totpNow(secret),
      tip: '在验证器 App（微软/Google Authenticator 等）中手动录入密钥或 URI；演示阶段可直接使用页面上显示的当前码' }
  },
  'POST /admin/security/bind-contact': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { userId, channel, target } = req.body // channel: sms|email
    if (!target) throw new BizError(1001, '请填写手机号或邮箱')
    const col = channel === 'sms' ? 'mobile' : 'email'
    await q('UPDATE admin_user SET ' + col + ' = ?, mfa_channel = ?, mfa_enabled = 1 WHERE id = ?', [target, channel, userId])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'security', 'bind-' + channel, 'user-' + userId, null, { target }))
    const mfa = await import('../infra/mfa.mjs')
    const r = await mfa.sendCode(target, channel, 'bind-test')
    return { bound: true, testSent: r.sent, mock: r.mock }
  },
  'POST /admin/security/mfa/disable': async (req) => {
    const a = await requireAdmin(req, ['super'])
    await q('UPDATE admin_user SET mfa_enabled = 0 WHERE id = ?', [req.body.userId])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'security', 'mfa-disable', 'user-' + req.body.userId, null, null))
    return { disabled: true }
  },
  'GET /admin/security/recent-codes': async (req) => {
    await requireAdmin(req, ['super'])
    return await q('SELECT target, channel, code, purpose, expires_at, used_at, created_at FROM mfa_code ORDER BY id DESC LIMIT 10')
  },

  'GET /admin/dash/kpi': async (req) => {
    const a = await requireAdmin(req)
    const sc = a.scopeCity // 城市合伙人：严格本城口径（数据边界 §数据边界）
    const cityWhere = sc ? 'AND o.city_code = ' + Number(sc) : ''
    const t = await one(`SELECT COUNT(*) c, COALESCE(SUM(amount_pay),0) gmv FROM orders o
      WHERE o.status IN (20,30,40,50) AND DATE(o.paid_at) = CURDATE() ${cityWhere}`)
    // 核销率 = 已核销凭证 ÷ 已签发且未冲正的凭证（累计，同一批凭证）。旧口径是"今日核销次数 ÷ 今日新签发数"，
    // 昨天出的票今天核销会让比率超过 100%，分子分母也不是同一批凭证
    const verified = await count(`SELECT COUNT(*) c FROM travel_pass tp JOIN orders o ON o.id = tp.order_id
      WHERE tp.status = 2 ${sc ? 'AND o.city_code = ' + Number(sc) : ''}`)
    const issuedPass = await count(`SELECT COUNT(*) c FROM travel_pass tp JOIN orders o ON o.id = tp.order_id
      WHERE tp.status IN (1, 2) ${sc ? 'AND o.city_code = ' + Number(sc) : ''}`)
    const budget = sc ? null : await one('SELECT SUM(total) t, SUM(granted) g FROM bean_budget WHERE status = 1')
    const alerts = sc ? 0 : await count('SELECT COUNT(*) c FROM risk_event WHERE handled = 0')
    const weekRaw = await q(`SELECT DATE(o.paid_at) d, COUNT(*) c, SUM(o.amount_pay) gmv FROM orders o
      WHERE o.status IN (20,30,40,50) AND o.paid_at >= NOW() - INTERVAL 7 DAY ${cityWhere} GROUP BY DATE(o.paid_at) ORDER BY d`)
    // 补齐近 7 天零值（图表完整 X 轴，避免孤点）
    const byDay = Object.fromEntries(weekRaw.map((w) => [String(w.d), w]))
    const week = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
      const hit = byDay[d]
      week.push({ d, c: hit ? Number(hit.c) : 0, gmv: hit ? Number(hit.gmv) : 0 })
    }
    return {
      ordersToday: Number(t.c), gmvToday: fen2yuan(t.gmv),
      verifyRate: issuedPass ? ((verified / issuedPass) * 100).toFixed(1) + '%' : '—',
      budgetUsage: budget && budget.t ? ((Number(budget.g) / Number(budget.t)) * 100).toFixed(1) + '%' : '—',
      alerts, trend: week.map(w => ({ date: w.d, orders: Number(w.c), gmv: fen2yuan(w.gmv) })),
      scopeCity: a.scopeCity || null,
      globalScope: !a.scopeCity,
    }
  },

  // 看板三件套（低垂果实 #6）：待办聚合 / 热门主题游 TOP5 / 活动转化漏斗
  'GET /admin/dash/insights': async (req) => {
    const a = await requireAdmin(req)
    // 城市合伙人只看本城（与 dash/kpi 同口径）。提现 / 离线冲突 / 笔记 / 约稿是全局队列，城市账号按 0 处理；旅豆预算是全局的，城市账号不展示使用率
    const sc = a.scopeCity
    const oc = sc ? ' AND o.city_code = ' + Number(sc) : ''
    const zero = { c: 0 }
    const pendingWithdrawals = sc ? zero : await one("SELECT COUNT(*) c FROM promoter_withdraw WHERE status = 0")
    const pendingConflicts = sc ? zero : await one("SELECT COUNT(*) c FROM verify_offline_conflict WHERE status = 0")
    const pendingNotes = sc ? zero : await one("SELECT COUNT(*) c FROM content_note WHERE status = 1")
    const pendingMerchants = await one("SELECT COUNT(*) c FROM merchant m WHERE m.status = 0" + (sc ? ' AND m.city_code = ' + Number(sc) : ''))
    const pendingTasks = sc ? zero : await one('SELECT COUNT(*) c FROM content_task_entry WHERE status = 2')
    const topTours = await q(`SELECT p.id, p.title, COUNT(o.id) orders, COALESCE(SUM(o.amount_pay),0) gmv
      FROM orders o JOIN tour_product p ON p.id = o.product_id
      WHERE o.status >= 20 ${oc} GROUP BY p.id, p.title ORDER BY orders DESC LIMIT 5`)
    const allOrders = await one(`SELECT COUNT(*) c FROM orders o WHERE 1=1 ${oc}`)
    const paidOrders = await one(`SELECT COUNT(*) c FROM orders o WHERE o.status >= 20 AND o.status <> 90 ${oc}`)
    const uniqUsers = await one(`SELECT COUNT(DISTINCT o.user_id) c FROM orders o WHERE o.status >= 20 AND o.status <> 90 ${oc}`)
    const rebuyUsers = await one(`SELECT SUM(c > 1) c FROM (SELECT COUNT(*) c FROM orders o WHERE o.status >= 20 AND o.status <> 90 ${oc} GROUP BY o.user_id) t`)
    const beanFlow = sc ? null : await bean.flow()
    const total = Number(allOrders.c) || 0
    const paid = Number(paidOrders.c) || 0
    return {
      pending: {
        withdrawals: Number(pendingWithdrawals.c) || 0,
        conflicts: Number(pendingConflicts.c) || 0,
        notes: Number(pendingNotes.c) || 0,
        merchants: Number(pendingMerchants.c) || 0,
        tasks: Number(pendingTasks.c) || 0,
      },
      topTours,
      funnel: {
        payRate: total ? Math.round(paid / total * 100) + '%' : '—',
        verifyRate: '—', // 核销完成率在 dash/kpi 已有，这里保留占位
        rebuyRate: (Number(uniqUsers.c) && Number(rebuyUsers.c)) ? Math.round(Number(rebuyUsers.c) / Number(uniqUsers.c) * 100) + '%' : '0%',
        beanUseRate: !beanFlow ? '—' : (beanFlow.granted ? Math.round(beanFlow.consumed / beanFlow.granted * 100) + '%' : '0%'),
      },
    }
  },

  'GET /admin/orders': async (req) => {
    const a = await requireAdmin(req)
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const { status, kw } = req.query
    const sc = scopeFilter(a, 'o.city_code')
    const where = []
    if (sc.sql) where.push(sc.sql.replace(' AND ', ''))
    if (status) where.push('o.status = ' + Number(status))
    if (kw) where.push('o.order_no LIKE ' + JSON.stringify('%' + kw + '%'))
    return (await q(`SELECT o.*, p.title, u.nickname FROM orders o
      JOIN tour_product p ON p.id = o.product_id JOIN user_account u ON u.id = o.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY o.id DESC LIMIT 100`, sc.params)).map(publicOrderPhone)
  },

  // ===== T03：订单服务端全量检索（老单可查）=====
  // 契约：{ rows, total, page, pageSize, statusCounts, countsScope, filters }。
  // statusCounts 是"其他筛选保持不变、去掉状态筛选"的各状态计数（口径见 countsScope），不是当前页行数。
  // 手机号按完整号码检索走盲索引（红线 11：任何响应不含完整号码，行数据统一过 publicOrderPhone）。
  'GET /admin/orders/search': async (req) => {
    const a = await requireAdmin(req)
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const date = (v, label) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BizError(1001, label + '格式应为 YYYY-MM-DD'); return v }
    // filters 收集的是"除 status 外"的条件（状态计数要与主查询共用它们）
    const conds = [], condArgs = [] // [sql, args[]]
    const addCond = (sql, ...args) => { conds.push({ sql, args }); }
    const sc = scopeFilter(a, 'o.city_code')
    if (sc.sql) addCond(sc.sql.replace(' AND ', ''), ...sc.params)
    const filters = {}
    const cityCode = String(req.query.cityCode || '').trim()
    if (cityCode && !a.scopeCity) { addCond('o.city_code = ?', cityCode); filters.cityCode = cityCode }
    const productId = Number(req.query.productId || 0)
    if (productId) { addCond('o.product_id = ?', productId); filters.productId = productId }
    const kw = String(req.query.kw || '').trim()
    if (kw) {
      // 红线 11：完整手机号检索时不把号码原样回显（filters.kw 脱敏）
      filters.kw = /^1\d{10}$/.test(kw) ? kw.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : kw
      if (/^1\d{10}$/.test(kw)) {
        // 完整手机号：走盲索引查 user_id，不把号码拼进 SQL/响应
        const w = (await import('../infra/mobile.mjs')).whereMobile(kw)
        const users = await q(`SELECT u.id FROM user_account u WHERE ${w.sql}`, w.args)
        if (!users.length) addCond('1 = 0')
        else addCond(`o.user_id IN (${users.map((u) => Number(u.id)).join(',')})`)
      } else addCond('(o.order_no LIKE ? OR u.nickname LIKE ? OR o.contact_name LIKE ?)', '%' + kw + '%', '%' + kw + '%', '%' + kw + '%')
    }
    const range = (col, from, to, label) => {
      if (from) { date(from, label); addCond(`${col} >= ?`, from + ' 00:00:00') }
      if (to) { date(to, label); addCond(`${col} <= ?`, to + ' 23:59:59.999') }
    }
    range('o.created_at', req.query.createdFrom, req.query.createdTo, '创建日期')
    if (req.query.createdFrom) filters.createdFrom = req.query.createdFrom
    if (req.query.createdTo) filters.createdTo = req.query.createdTo
    range('o.paid_at', req.query.paidFrom, req.query.paidTo, '支付日期')
    if (req.query.paidFrom) filters.paidFrom = req.query.paidFrom
    if (req.query.paidTo) filters.paidTo = req.query.paidTo
    const departDate = String(req.query.departDate || '').trim()
    if (departDate) { date(departDate, '出发日期'); addCond('o.session_id IN (SELECT id FROM tour_session WHERE depart_date = ?)', departDate); filters.departDate = departDate }
    const baseWhere = conds.map((c) => c.sql).join(' AND ')
    const baseArgs = conds.flatMap((c) => c.args)
    const status = req.query.status == null || req.query.status === '' ? null : Number(req.query.status)
    if (status != null && ![10, 20, 30, 40, 50, 60, 70, 90].includes(status)) throw new BizError(1001, '订单状态无效')
    const mainConds = status != null ? [...conds, { sql: 'o.status = ?', args: [status] }] : conds
    const W = mainConds.length ? 'WHERE ' + mainConds.map((c) => c.sql).join(' AND ') : ''
    const mainArgs = mainConds.flatMap((c) => c.args)
    const from = `FROM orders o JOIN tour_product p ON p.id = o.product_id JOIN user_account u ON u.id = o.user_id`
    const sort = { id: 'o.id DESC', paid: 'o.paid_at DESC, o.id DESC', amount: 'o.amount_pay DESC, o.id DESC' }[req.query.sort] || 'o.id DESC'
    const total = Number((await one(`SELECT COUNT(*) n ${from} ${W}`, mainArgs)).n)
    const rows = (await q(`SELECT o.*, p.title, u.nickname ${from} ${W} ORDER BY ${sort} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, mainArgs)).map(publicOrderPhone)
    // 状态计数：baseWhere（去掉状态、其余筛选不变）
    const countsRaw = await q(`SELECT o.status, COUNT(*) n ${from} ${baseWhere ? 'WHERE ' + baseWhere : ''} GROUP BY o.status`, baseArgs)
    const statusCounts = Object.fromEntries(countsRaw.map((r) => [Number(r.status), Number(r.n)]))
    statusCounts.all = countsRaw.reduce((s, r) => s + Number(r.n), 0)
    return { rows, total, page, pageSize, statusCounts, countsScope: 'same-filters-except-status', filters, sort: req.query.sort || 'id' }
  },

  'GET /admin/orders/:no': async (req) => {
    const a = await requireAdmin(req)
    const o = await one(`SELECT o.*, p.title, u.nickname FROM orders o
      JOIN tour_product p ON p.id = o.product_id JOIN user_account u ON u.id = o.user_id WHERE o.order_no = ?`, [req.params.no])
    if (!o) throw new BizError(2003, '订单不存在')
    if (a.scopeCity && String(a.scopeCity) !== String(o.city_code)) throw new BizError(1003, '仅可查看本城订单')
    const events = await q('SELECT from_st, to_st, actor, detail, created_at FROM order_event WHERE order_id = ? ORDER BY id', [o.id])
    const passes = await q('SELECT id, name, status FROM travel_pass WHERE order_id = ?', [o.id])
    const pay = await one('SELECT wx_trans_no, status, amount, callback_at FROM payment WHERE order_id = ?', [o.id])
    const refunds = await q('SELECT refund_no, amount, fee_amount, fee_rate, days_to_depart, reason, status, operator, settled_at FROM refunds WHERE order_id = ? ORDER BY id DESC', [o.id])
    // 客服处理前先看"如果按梯度退会扣多少"，再决定按规则还是全额特批
    const quote = [20, 30].includes(Number(o.status)) ? await refund.quoteFor(o) : null
    const serviceRecords = await q("SELECT actor, action, after_val, created_at FROM audit_log WHERE module = 'order' AND biz_ref = ? AND action IN ('contact-update','service-note') ORDER BY id DESC LIMIT 30", [o.order_no])
    return { ...publicOrderPhone(o), events, passes, pay, refunds, refundQuote: quote, serviceRecords }
  },

  // 客服只修正履约联系人，不更改订单归属、交易金额、出行人或团期。
  'POST /admin/orders/:no/contact': async (req) => {
    const a = await requireAdmin(req, 'order.service')
    const name = String(req.body.name || '').trim(), phone = String(req.body.phone || '').trim(), reason = String(req.body.reason || '').trim()
    if (!name || name.length > 64 || (phone && !/^1\d{10}$/.test(phone))) throw new BizError(1001, '请填写 1–64 字联系人；新手机号须为 11 位，不修改号码请留空')
    if (reason.length < 4 || reason.length > 300) throw new BizError(1001, '请填写 4–300 字修改原因')
    return tx(async (c) => {
      const o = await c.one('SELECT * FROM orders WHERE order_no = ? FOR UPDATE', [req.params.no])
      if (!o) throw new BizError(2003, '订单不存在')
      if (a.scopeCity && String(a.scopeCity) !== String(o.city_code)) throw new BizError(1003, '仅可处理本城订单')
      if (![10, 20, 30].includes(Number(o.status))) throw new BizError(2002, '仅待支付、已支付和已确认订单可修正联系人')
      const sealed = phone ? sealMobile(phone).enc : o.contact_phone_sealed
      await c.upd('UPDATE orders SET contact_name = ?, contact_phone_sealed = ?, contact_phone_enc = ? WHERE id = ?', [name, sealed, phone ? null : o.contact_phone_enc, o.id])
      const next = publicOrderPhone({ ...o, contact_name: name, contact_phone_sealed: sealed, contact_phone_enc: phone ? null : o.contact_phone_enc })
      await audit(c, 'admin:' + a.name, 'order', 'contact-update', o.order_no, { name: o.contact_name, phone: publicOrderPhone(o).contactPhone }, { name, phone: next.contactPhone, reason })
      return { updated: true, contactName: name, contactPhone: next.contactPhone }
    })
  },
  'POST /admin/orders/:no/service-notes': async (req) => {
    const a = await requireAdmin(req, 'order.service')
    const note = String(req.body.note || '').trim()
    if (note.length < 4 || note.length > 500) throw new BizError(1001, '请填写 4–500 字客服备注；请勿录入手机号、证件号等敏感信息')
    if (/\d{11,}/.test(note)) throw new BizError(1001, '备注请勿录入完整手机号、证件号等敏感信息')
    return tx(async (c) => {
      const o = await c.one('SELECT id, order_no, city_code FROM orders WHERE order_no = ? FOR UPDATE', [req.params.no])
      if (!o) throw new BizError(2003, '订单不存在')
      if (a.scopeCity && String(a.scopeCity) !== String(o.city_code)) throw new BizError(1003, '仅可处理本城订单')
      await audit(c, 'admin:' + a.name, 'order', 'service-note', o.order_no, null, { note })
      return { saved: true }
    })
  },

  'POST /admin/orders/:no/refund': async (req) => {
    const a = await requireAdmin(req, 'order.refund')
    const o = await order.byNo(req.params.no)
    if (!o) throw new BizError(2003, '订单不存在')
    if (a.scopeCity && String(a.scopeCity) !== String(o.city_code)) throw new BizError(1003, '仅可处理本城订单')
    if (![20, 30, 40].includes(o.status)) throw new BizError(2002, '状态不可退款')
    // mode=policy 按退改梯度扣手续费；默认 full 为客服全额处理（已核销售后、平台原因等），操作人与原因进审计和存证
    const mode = req.body.mode === 'policy' ? 'policy' : 'full'
    const reason = String(req.body.reason || '').trim() || (mode === 'full' ? '客服全额退款' : '后台按规则退款')
    const r = await refund.refundOrder({ orderNo: o.order_no, reason, operator: 'admin:' + a.name, applyPolicy: mode === 'policy' })
    await tx(async (cc) => audit(cc, 'admin:' + a.name, 'order', 'refund-' + mode, o.order_no, { status: Number(o.status) },
      { refundFen: r.refundFen, feeFen: r.feeFen || 0, reason }))
    return r
  },

  // 商品/团期管理（"简单内容填充"的落点）
  'GET /admin/products': async (req) => {
    const a = await requireAdmin(req)
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const sc = scopeFilter(a, 'p.city_code')
    return await q(`SELECT p.*, m.name merchant_name, sup.name supplier_name, sc.name scenic_name
      FROM tour_product p
      LEFT JOIN merchant m ON m.id = p.merchant_id
      LEFT JOIN supplier sup ON sup.id = p.supplier_id
      LEFT JOIN scenic_spot sc ON sc.id = p.scenic_id
      WHERE 1=1 ${sc.sql} ORDER BY p.id DESC`, sc.params)
  },
  'POST /admin/products': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const { title, cat, cityCode, channelId, merchantId, priceFrom, beanGift, daysDesc, subtitle, status,
      intro, includes, highlights, meetingPoint, safetyNote, supplierId, scenicId } = req.body
    if (!String(title || '').trim() || !Number.isInteger(Number(priceFrom)) || Number(priceFrom) <= 0) throw new BizError(1001, '请填写线路标题与有效价格')
    if (!(await one('SELECT id FROM merchant WHERE id=? AND status=1', [merchantId]))) throw new BizError(1001, '请选择已审核的履约商户')
    if (supplierId && !(await one('SELECT id FROM supplier WHERE id=?', [supplierId]))) throw new BizError(1001, '关联供应商不存在')
    if (scenicId && !(await one('SELECT id FROM scenic_spot WHERE id=?', [scenicId]))) throw new BizError(1001, '关联景区不存在')
    const arr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[·、,，;；\n]/).map((s) => s.trim()).filter(Boolean) : [])
    const rich = { intro: sanitizeRich(intro || subtitle || ''), includes: arr(includes), highlights: arr(highlights) }
    const id = await tx(async (c) => {
      const pid = await c.ins(`INSERT INTO tour_product (channel, city_code, cat, title, subtitle, days_desc, price_from, bean_gift, merchant_id, supplier_id, scenic_id, status, rich_desc, meeting_point, safety_note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [channelId || 'main', cityCode || '310118', cat || 'script', title, subtitle || null, daysDesc || null,
          Number(priceFrom) || 0, Number(beanGift) || 0, Number(merchantId), supplierId || null, scenicId || null, Number(status ?? 0), JSON.stringify(rich),
          meetingPoint || null, safetyNote || null])
      await audit(c, 'admin:' + a.name, 'product', 'create', 'product-' + pid, null, { title })
      return pid
    })
    return { id }
  },

  // 编辑商品内容（P0 宣传力：行程/费用包含/亮点/集合点/安全告知）
  'PUT /admin/products/:id': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const p = await one('SELECT rich_desc FROM tour_product WHERE id = ?', [req.params.id])
    if (!p) throw new BizError(1004, '商品不存在')
    const old = typeof p.rich_desc === 'string' ? JSON.parse(p.rich_desc || '{}') : (p.rich_desc || {})
    const { title, subtitle, daysDesc, priceFrom, beanGift, status, intro, includes, excludes, highlights, meetingPoint, safetyNote, supplierId, scenicId } = req.body
    const arr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[·、,，;；\n]/).map((s) => s.trim()).filter(Boolean) : [])
    const rich = { intro: intro !== undefined ? sanitizeRich(intro) : (old.intro || ''), includes: includes !== undefined ? arr(includes) : (old.includes || []),
      highlights: highlights !== undefined ? arr(highlights) : (old.highlights || []),
      excludes: excludes !== undefined ? arr(excludes) : (old.excludes || []) }
    if (supplierId && !(await one('SELECT id FROM supplier WHERE id=?', [supplierId]))) throw new BizError(1001, '关联供应商不存在')
    if (scenicId && !(await one('SELECT id FROM scenic_spot WHERE id=?', [scenicId]))) throw new BizError(1001, '关联景区不存在')
    const r = await q(`UPDATE tour_product SET title = COALESCE(?, title), subtitle = COALESCE(?, subtitle),
      days_desc = COALESCE(?, days_desc), price_from = COALESCE(?, price_from), bean_gift = COALESCE(?, bean_gift),
      status = COALESCE(?, status), supplier_id = COALESCE(?, supplier_id), scenic_id = COALESCE(?, scenic_id),
      rich_desc = ?, meeting_point = ?, safety_note = ? WHERE id = ?`,
      [title ?? null, subtitle ?? null, daysDesc ?? null, priceFrom != null ? Number(priceFrom) : null,
        beanGift != null ? Number(beanGift) : null, status ?? null, supplierId ?? null, scenicId ?? null,
        JSON.stringify(rich), meetingPoint ?? null, safetyNote ?? null, req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'product', 'update', 'product-' + req.params.id, JSON.stringify(rich), null))
    return { updated: r.affectedRows > 0 }
  },

  // 商品图集：base64 上传（≤9 张，白名单扩展名，2MB 内）→ /uploads 静态
  // 通用图片上传（富表单组件用）：base64 → /uploads 静态目录，返回 URL
  'POST /admin/uploads': async (req) => {
    await requireAdmin(req)
    const { data, ext = 'jpg' } = req.body || {}
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new BizError(1001, '仅支持 jpg/png/webp')
    const buf = Buffer.from(String(data || ''), 'base64')
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024) throw new BizError(1001, '图片需在 2MB 内')
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'uploads')
    fs.mkdirSync(dir, { recursive: true })
    const name = `up_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}.${ext === 'jpeg' ? 'jpg' : ext}`
    fs.writeFileSync(path.join(dir, name), buf)
    return { url: '/uploads/' + name }
  },

  'POST /admin/products/:id/images': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const p = await one('SELECT images FROM tour_product WHERE id = ?', [req.params.id])
    if (!p) throw new BizError(1004, '商品不存在')
    const imgs = (typeof p.images === 'string' ? JSON.parse(p.images || '[]') : (p.images || []))
    if (imgs.length >= 9) throw new BizError(1001, '最多 9 张图')
    const { data, ext = 'jpg' } = req.body || {}
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new BizError(1001, '仅支持 jpg/png/webp')
    const buf = Buffer.from(String(data || ''), 'base64')
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024) throw new BizError(1001, '图片需在 2MB 内')
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'uploads')
    fs.mkdirSync(dir, { recursive: true })
    const name = `prod_${req.params.id}_${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`
    fs.writeFileSync(path.join(dir, name), buf)
    imgs.push('/uploads/' + name)
    await q('UPDATE tour_product SET images = ? WHERE id = ?', [JSON.stringify(imgs), req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'product', 'image-add', 'product-' + req.params.id, null, { img: name }))
    return { images: imgs }
  },
  'DELETE /admin/products/:id/images': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const p = await one('SELECT images FROM tour_product WHERE id = ?', [req.params.id])
    const imgs = (typeof p.images === 'string' ? JSON.parse(p.images || '[]') : (p.images || []))
    const idx = Number(req.query.idx)
    if (!(idx >= 0 && idx < imgs.length)) throw new BizError(1001, '序号非法')
    imgs.splice(idx, 1)
    await q('UPDATE tour_product SET images = ? WHERE id = ?', [JSON.stringify(imgs), req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'product', 'image-del', 'product-' + req.params.id, null, { idx }))
    return { images: imgs }
  },
  'POST /admin/products/:id/status': async (req) => {
    const a = await requireAdmin(req, 'product.status')
    if (![0,1].includes(Number(req.body.status))) throw new BizError(1001, '商品状态无效')
    if (Number(req.body.status) === 1) {
      const p = await one('SELECT * FROM tour_product WHERE id=?', [req.params.id])
      if (!p) throw new BizError(1004, '商品不存在')
      const rich = typeof p.rich_desc === 'string' ? JSON.parse(p.rich_desc || '{}') : (p.rich_desc || {})
      const issues=[]
      if (!rich.intro || !p.meeting_point || !p.safety_note) issues.push('行程介绍、集合地点与安全告知')
      if (!(await count('SELECT COUNT(*) c FROM tour_session WHERE product_id=? AND status=1 AND depart_date>=CURDATE() AND quota>booked', [p.id]))) issues.push('可报名的未来团期')
      if (issues.length) throw new BizError(1001, '发布前请补齐：' + issues.join('；'))
    }
    await q('UPDATE tour_product SET status = ? WHERE id = ?', [Number(req.body.status), req.params.id])
    return { ok: true }
  },
  'GET /admin/products/:id/sessions': async (req) => {
    const a = await requireAdmin(req)
    const p = await one('SELECT id, title, price_from, city_code FROM tour_product WHERE id = ?', [req.params.id])
    if (!p) throw new BizError(1004, '商品不存在')
    if (a.scopeCity && String(a.scopeCity) !== String(p.city_code)) throw new BizError(1003, '仅可查看本城商品团期')
    const sessions = await q('SELECT id, depart_date, quota, booked, min_go, price_adult, early_price, status FROM tour_session WHERE product_id = ? ORDER BY depart_date DESC', [p.id])
    return { title: p.title, priceFrom: Number(p.price_from), sessions }
  },
  'POST /admin/sessions': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { productId, departDate, quota, minGo, priceAdult, earlyPrice, earlyDays } = req.body
    if (!/^\d{4}-\d{2}-\d{2}$/.test(departDate || '') || !Number.isInteger(Number(quota)) || Number(quota) < 1 || !Number.isInteger(Number(priceAdult)) || Number(priceAdult) < 1) throw new BizError(1001, '请填写有效日期、正整数名额和价格')
    if (Number.isNaN(Date.parse(departDate)) || departDate < new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })) throw new BizError(1001, '出发日期不可早于今天')
    if (earlyPrice && (Number(earlyPrice) >= Number(priceAdult))) throw new BizError(1001, '早鸟价须低于成人价')
    if (!(await one('SELECT id FROM tour_product WHERE id=?',[productId]))) throw new BizError(1004, '商品不存在')
    const id = await tx(async (c) => c.ins(
      'INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult, early_price, early_days) VALUES (?,?,?,?,?,?,?)',
      [Number(productId), departDate, Number(quota), Number(minGo || 10), Number(priceAdult),
        Number(earlyPrice) || null, earlyPrice ? Number(earlyDays || 7) : null]))
    return { id }
  },

  'GET /admin/merchants': async (req) => {
    const a = await requireAdmin(req); const sc = scopeFilter(a)
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    // 申请电话只给脱敏值（红线 11：任何接口响应不放完整号码）；密文列不下发
    return (await q('SELECT * FROM merchant WHERE 1=1 ' + sc.sql + ' ORDER BY id', sc.params))
      .map(({ apply_mobile, apply_mobile_enc, ...r }) => ({ ...r, apply_mobile: maskApplyMobile({ apply_mobile, apply_mobile_enc }) }))
  },
  // ===== 实体表单引擎（字段定义见 domain/entity-schema.mjs）=====
  'GET /admin/entity-schemas/:kind': async (req) => {
    const a = await requireAdmin(req)
    const sch = entities.publicSchema(req.params.kind)
    const fill = async (fs) => { for (const f of fs) { if (f.type === 'ref') f.options = await entities.refOptions(f.ref, a); if (f.of) await fill(f.of) } }
    for (const s of sch.sections) await fill(s.fields)
    return sch
  },
  'GET /admin/entities/:kind/:id': async (req) => {
    const a = await requireAdmin(req)
    const sc = entities.get(req.params.kind)
    const row = await one(`SELECT * FROM ${sc.table} WHERE ${sc.idCol} = ?`, [req.params.id])
    if (!row) throw new BizError(1004, sc.label + '不存在')
    if (a.scopeCity) {
      if (!ENTITY_CITY_KINDS.includes(req.params.kind)) throw new BizError(1003, '城市账号仅可查看本城主体资料')
      if (String(row.city_code ?? '') !== String(a.scopeCity)) throw new BizError(1003, '仅可查看本城主体资料')
    }
    const values = entities.readValues(req.params.kind, row)
    return { id: row[sc.idCol], values, completeness: entities.completeness(req.params.kind, values) }
  },
  // 列表页用：一次取回某类实体全部的扩展资料完整度（不返回资料本身）
  'GET /admin/entities/:kind': async (req) => {
    const a = await requireAdmin(req)
    const sc = entities.get(req.params.kind)
    if (a.scopeCity && !ENTITY_CITY_KINDS.includes(req.params.kind)) throw new BizError(1003, '城市账号仅可查看本城主体资料')
    const rows = await q(`SELECT * FROM ${sc.table}${a.scopeCity ? ' WHERE city_code = ?' : ''}`, a.scopeCity ? [a.scopeCity] : [])
    return rows.map((r) => { const v = entities.readValues(req.params.kind, r); return { id: r[sc.idCol], completeness: entities.completeness(req.params.kind, v), cover: v.logo || v.cover || v.icon_img || (v.images || [])[0] || v.image || null } })
  },
  'POST /admin/entities/:kind': async (req) => {
    const a = await requireAdmin(req)
    return entities.save(req.params.kind, req.body.values || {}, { admin: a, parentId: Number(req.body.parentId) || null,
      audit: (c, m, act, ref, b, af) => audit(c, 'admin:' + a.name, m, act, ref, b, af) }, tx)
  },
  'PUT /admin/entities/:kind/:id': async (req) => {
    const a = await requireAdmin(req)
    return entities.save(req.params.kind, req.body.values || {}, { admin: a, id: req.params.id,
      audit: (c, m, act, ref, b, af) => audit(c, 'admin:' + a.name, m, act, ref, b, af) }, tx)
  },

  'POST /admin/merchants': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { name, cityCode, wxpaySubMchid, bizLicense, kind } = req.body
    const mno = 'M' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + String(Math.floor(Math.random() * 900) + 100)
    const id = await tx(async (c) => {
      const mid = await c.ins('INSERT INTO merchant (city_code, name, kind, merchant_no, wxpay_sub_mchid, biz_license, status) VALUES (?,?,?,?,?,?,0)',
        [cityCode || '310118', name, SUP_CATS.includes(kind) ? kind : 'other', mno, wxpaySubMchid || null, bizLicense || null])
      await audit(c, 'admin:' + a.name, 'merchant', 'create', 'merchant-' + mid, null, { name })
      return mid
    })
    return { id, merchantNo: mno }
  },

  // ===== 参数中心（§4.2：分组/双人复核/影响预览/版本回滚）=====
  'GET /admin/config': async (req) => {
    await requireAdmin(req)
    const rows = await q('SELECT k, v, group_name, `sensitive`, memo, updated_by, updated_at FROM rule_config ORDER BY group_name, k')
    return rows.map(r => ({ ...r, name: configName(r.k, r.memo), v: typeof r.v === 'string' ? r.v : JSON.stringify(r.v) }))
  },
  'POST /admin/config/proposal': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'finance'])
    const { key, newValue, reason } = req.body
    const cur = await one('SELECT v, `sensitive` FROM rule_config WHERE k = ?', [key])
    if (!cur) throw new BizError(1004, '参数不存在')
    const oldV = typeof cur.v === 'string' ? cur.v : JSON.stringify(cur.v)
    if (key === 'order.refund_policy') {
      try { refundPolicy.parsePolicy(newValue) } catch (e) { throw new BizError(1001, e.message) }
    }
    if (/^settlement\.split_/.test(key)) {
      const nv = Number(newValue)
      if (!(nv >= 0 && nv <= 1)) throw new BizError(1001, '比例需在 0~1 之间（如 0.58 = 58%）')
      const keys = ['settlement.split_fulfill', 'settlement.split_service', 'settlement.split_beanbudget']
      let sum = 0
      for (const k of keys) sum += k === key ? nv : Number(await cfg(k))
      if (sum > 1) throw new BizError(1001, `履约 + 服务费 + 权益预算合计 ${(sum * 100).toFixed(1)}% 超过 100%，留存毛利将为负`)
    }
    if (key === 'member.levels') {
      try { member.parseLevels(newValue) } catch (e) { throw new BizError(1001, e.message) }
    }
    if (key === 'merchant.levels') {
      try { merchantLevel.parseLevels(newValue) } catch (e) { throw new BizError(1001, e.message) }
    }
    if (key === 'settlement.refund_fee_merchant_pct' && !(Number(newValue) >= 0 && Number(newValue) <= 1)) {
      throw new BizError(1001, '商户分成比例需在 0~1 之间（如 0.5 = 50%）')
    }
    // 影响预览：旅豆/佣金类参数回溯近 30 日
    let preview = null
    if (key.startsWith('bean.order_rate')) {
      const s = await one(`SELECT COUNT(*) c, COALESCE(SUM(amount_pay),0) gmv FROM orders WHERE status = 50 AND paid_at >= NOW() - INTERVAL 30 DAY`)
      const oldRate = Number(oldV), newRate = Number(newValue)
      preview = { orders30d: Number(s.c), gmv30d: fen2yuan(s.gmv), beanOld: Math.round(Number(s.gmv) / 10 * oldRate), beanNew: Math.round(Number(s.gmv) / 10 * newRate) }
    }
    const id = await tx(async (c) => {
      const hid = await c.ins('INSERT INTO config_history (cfg_key, old_value, new_value, proposer, status, reason) VALUES (?,CAST(? AS JSON),CAST(? AS JSON),?,0,?)',
        [key, String(oldV), String(newValue), 'admin:' + a.name, reason || ''])
      await audit(c, 'admin:' + a.name, 'config', 'proposal', key, oldV, String(newValue))
      return hid
    })
    return { historyId: id, sensitive: !!cur.sensitive, preview }
  },
  'POST /admin/config/approve': async (req) => {
    const a = await requireAdmin(req, ['super', 'finance'])
    const h = await one('SELECT * FROM config_history WHERE id = ? AND status = 0', [req.body.historyId])
    if (!h) throw new BizError(1004, '提案不存在或已处理')
    if (h.proposer === 'admin:' + a.name) throw new BizError(1003, '双人复核：提案人与审批人不能相同')
    await tx(async (c) => {
      await c.upd('UPDATE rule_config SET v = CAST(? AS JSON), updated_by = ?, updated_version = updated_version + 1 WHERE k = ?', [jsonText(h.new_value), 'admin:' + a.name, h.cfg_key])
      await c.upd("UPDATE config_history SET status = 1, approver = ?, effective_at = NOW(3) WHERE id = ?", ['admin:' + a.name, h.id])
      await audit(c, 'admin:' + a.name, 'config', 'approve', h.cfg_key, h.old_value, h.new_value)
    })
    await loadConfig(true)
    if (h.cfg_key === 'merchant.levels') await merchantLevel.resyncAll() // 新门槛生效后立即重评所有商户
    if (h.cfg_key === 'member.levels') await member.resyncAll() // 新门槛生效后立即重算所有人的等级
    return { ok: true }
  },
  'POST /admin/config/rollback': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const h = await one('SELECT * FROM config_history WHERE cfg_key = ? ORDER BY id DESC LIMIT 1', [req.body.key])
    if (!h) throw new BizError(1004, '无历史版本')
    await tx(async (c) => {
      await c.upd('UPDATE rule_config SET v = CAST(? AS JSON), updated_by = ?, updated_version = updated_version + 1 WHERE k = ?', [jsonText(h.old_value), 'admin:' + a.name, h.cfg_key])
      await c.ins('INSERT INTO config_history (cfg_key, old_value, new_value, proposer, approver, status, reason, effective_at) VALUES (?,CAST(? AS JSON),CAST(? AS JSON),?,?,3,?,NOW(3))',
        [h.cfg_key, jsonText(h.new_value), jsonText(h.old_value), 'admin:' + a.name, 'admin:' + a.name, '回滚'])
      await audit(c, 'admin:' + a.name, 'config', 'rollback', h.cfg_key, h.new_value, h.old_value)
    })
    await loadConfig(true)
    return { ok: true, restored: h.old_value }
  },
  'GET /admin/config/history': async (req) => {
    await requireAdmin(req)
    return await q('SELECT * FROM config_history WHERE cfg_key = ? ORDER BY id DESC LIMIT 20', [req.query.key])
  },

  // 旅豆预算 / 推广 / 结算 / 风控 / 审计
  'GET /admin/budgets': async (req) => { await requireAdmin(req, ['super', 'ops', 'finance']); return await q('SELECT * FROM bean_budget ORDER BY id DESC') },
  'POST /admin/budgets': async (req) => {
    const a = await requireAdmin(req, ['super', 'finance'])
    const { name, total, periodStart, periodEnd, bizOwner, remark } = req.body
    const id = await tx(async (c) => {
      const bid = await c.ins('INSERT INTO bean_budget (name, total, biz_owner, remark, status, period_start, period_end) VALUES (?,?,?,?,1,?,?)',
        [name, Number(total), bizOwner || 'marketing', remark || null, periodStart || null, periodEnd || null])
      await audit(c, 'admin:' + a.name, 'budget', 'create', 'budget-' + bid, null, { name, total })
      return bid
    })
    return { id }
  },
  'GET /admin/promoters': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'finance'])
    return await q(`SELECT p.*, u.nickname FROM promoter p JOIN user_account u ON u.id = p.user_id ORDER BY p.user_id`)
  },
  'POST /admin/promoters/register': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    return { userId: Number(req.body.userId), rateBp: await promo.register(Number(req.body.userId), Number(req.body.tier || 1)) }
  },
  'GET /admin/settlements': async (req) => {
    const a = await requireAdmin(req)
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const sc = scopeFilter(a, 'm.city_code')
    return await q(`SELECT s.*, m.name merchant_name FROM settlement s JOIN merchant m ON m.id = s.merchant_id WHERE 1=1 ${sc.sql} ORDER BY s.id DESC`, sc.params)
  },
  'POST /admin/settlements/generate': async (req) => {
    await requireAdmin(req, ['super', 'finance'])
    const period = String(req.body.period || '') || settlementPeriod() // ISO 周，如 2026-W45
    if (!/^[\w-]{4,12}$/.test(period)) throw new BizError(1001, '结算周期格式不正确（如 2026-W45）')
    const merchants = await q(`SELECT DISTINCT merchant_id mid FROM orders WHERE status = 50 AND settlement_id IS NULL
      UNION SELECT DISTINCT o.merchant_id FROM refunds r JOIN orders o ON o.id = r.order_id
      WHERE r.status = 2 AND r.fee_amount > 0 AND r.settlement_id IS NULL`) // 只有退改手续费、没有完成订单的商户也要出账
    const before = new Set((await q('SELECT id FROM settlement WHERE period = ? OR period LIKE ?', [period, period + '-%'])).map((r) => Number(r.id)))
    const ids = []
    for (const mm of merchants) ids.push(await promo.generateSettlement(Number(mm.mid), period))
    const settlementIds = [...new Set(ids.filter((i) => i > 0))]
    // created：本次新出的单（含同周期的补充单 2026-W45-2…）；其余是已存在、本次没有新增内容的单
    return { period, settlementIds, created: settlementIds.filter((i) => !before.has(i)) }
  },
  'POST /admin/settlements/:id/confirm': async (req) => {
    const a = await requireAdmin(req, ['super', 'finance'])
    return tx(async (cc) => {
      const n = await cc.upd('UPDATE settlement SET status = 2 WHERE id = ? AND status = 1', [req.params.id])
      if (n !== 1) throw new BizError(2002, '仅商户已确认的结算单可复核，请刷新状态')
      await audit(cc, 'admin:' + a.name, 'settlement', 'review', 'settlement-' + req.params.id, { status: 1 }, { status: 2 })
      await promo.attestSettlement(req.params.id, cc, 2)
      return { status: 2, message: '复核通过，待实际支付并登记回单' }
    })
  },
  'POST /admin/settlements/:id/payment': async (req) => {
    const a = await requireAdmin(req, ['super', 'finance'])
    const ref = String(req.body.paymentRef || '').trim()
    const note = String(req.body.note || '').trim()
    if (ref.length < 6 || ref.length > 128 || !note || note.length > 500) throw new BizError(1001, '请填写真实支付流水号及回单核对说明')
    return tx(async (cc) => {
      const s = await cc.one('SELECT * FROM settlement WHERE id = ? FOR UPDATE', [req.params.id])
      if (!s || s.status !== 2) throw new BizError(2002, '仅待支付结算单可登记回单')
      const duplicate = await cc.one('SELECT id FROM settlement WHERE payment_ref = ? AND id <> ?', [ref, s.id])
      if (duplicate) throw new BizError(1001, '该流水号已用于其他结算单')
      await cc.upd('UPDATE settlement SET status = 3, payment_ref = ?, payment_note = ?, paid_by = ?, paid_at = NOW(3) WHERE id = ? AND status = 2', [ref, note, 'admin:' + a.name, s.id])
      await audit(cc, 'admin:' + a.name, 'settlement', 'manual-payment-evidence', 'settlement-' + s.id, { status: 2 }, { status: 3, ref, note })
      await promo.attestSettlement(s.id, cc, 3)
      return { status: 3, paymentRef: ref, mode: 'MANUAL_RECEIPT' }
    })
  },
  'POST /admin/settlements/:id/dispute': async (req) => {
    await requireAdmin(req, ['super', 'finance'])
    const { note } = req.body
    const row = await one('SELECT * FROM settlement WHERE id = ? AND status = 4', [req.params.id])
    if (!row) throw new BizError(1004, '结算单不存在或不在异议中')
    if (!String(note || '').trim()) throw new BizError(1001, '请填写异议处理说明')
    await q('UPDATE settlement SET dispute_note = ?, status = 0, dispute_resolved_at = NOW(3) WHERE id = ? AND status = 4', [String(note||'').slice(0,200), req.params.id])
    // 异议解除回 0，但版本号用 40：否则会与"生成"的 version 0 撞车被幂等吞掉
    await promo.attestSettlement(req.params.id, null, 40)
    return { resolved: true }  },


  'GET /admin/risk': async (req) => {
    await requireAdmin(req, ['super', 'risk'])
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const conds = [], args = [], filters = {}
    const handled = req.query.handled == null || req.query.handled === '' ? null : Number(req.query.handled)
    if (handled != null && [0, 1].includes(handled)) { conds.push('handled = ?'); args.push(handled); filters.handled = handled }
    const kw = String(req.query.kw || '').trim()
    if (kw) { conds.push('(type LIKE ? OR detail LIKE ?)'); args.push('%' + kw + '%', '%' + kw + '%'); filters.kw = kw }
    const W = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
    const total = Number((await one(`SELECT COUNT(*) n FROM risk_event ${W}`, args)).n)
    const rows = await q(`SELECT * FROM risk_event ${W} ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize])
    return { rows, total, page, pageSize, filters }
  },
  'GET /admin/audit-logs': async (req) => { await requireAdmin(req, ['super', 'finance', 'risk']); return await q('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100') },
  'GET /admin/attestations': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { bizRef } = req.query
    return await q(bizRef ? 'SELECT * FROM attest_event WHERE biz_ref = ?' : 'SELECT * FROM attest_event ORDER BY id DESC LIMIT 50', bizRef ? [bizRef] : [])
  },

  // 开发联调：触发支付回调（MOCK 通道）；生产由 /callback/wxpay 真实回调
  'POST /admin/dev/mock-pay': async (req) => {
    await requireAdmin(req)
    const { orderNo } = req.body
    return await handlePayNotify(orderNo, 'MOCK' + Date.now(), true)
  },

  // CSV 报表导出（低垂果实 #4）：orders/products/settlements/merchants/scenics/suppliers/creators
  // T00：导出按报表类型限角色并注入城市行级隔离；城市账号不放任何导出（AC-06：导出不越界）。
  // 能力定义与前端按钮共用 admin-capabilities 的 export.* 规则。
  'GET /admin/export/:what': async (req) => {
    const what = req.params.what
    const a = await requireAdmin(req, 'export.' + what)
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const sc = scopeFilter(a)
    let rows = [], name = what
    if (what === 'orders') {
      rows = await q(`SELECT o.order_no, o.status, o.qty, o.amount_goods, o.amount_bean_ded, o.insurance_fee, o.amount_pay,
        o.city_code, o.promo_scene, o.created_at, p.title FROM orders o JOIN tour_product p ON p.id = o.product_id WHERE 1=1 ${sc.sql.replace(/city_code/g, 'o.city_code')} ORDER BY o.id DESC LIMIT 5000`, sc.params)
    } else if (what === 'products') {
      rows = await q(`SELECT p.id, p.title, p.channel, p.city_code, p.cat, p.price_from, p.bean_gift, p.status, m.name merchant_name
        FROM tour_product p JOIN merchant m ON m.id = p.merchant_id WHERE 1=1 ${sc.sql.replace(/city_code/g, 'p.city_code')} ORDER BY p.id`, sc.params)
    } else if (what === 'settlements') {
      rows = await q(`SELECT s.id, m.name merchant_name, s.period, s.order_count, s.total_amount, s.amt_fulfill, s.amt_service, s.amt_promoter, s.amt_beanbudget, s.amt_retained,
          s.fee_count, s.fee_total, s.fee_merchant, s.fee_platform, s.amt_fulfill + s.fee_merchant AS payable_to_merchant, s.status
        FROM settlement s JOIN merchant m ON m.id = s.merchant_id WHERE 1=1 ${sc.sql.replace(/city_code/g, 'm.city_code')} ORDER BY s.id DESC LIMIT 2000`, sc.params)
    } else if (what === 'merchants') {
      rows = (await q(`SELECT id, name, kind, merchant_no, city_code, status, score, apply_contact, approved_at, created_at FROM merchant WHERE 1=1 ${sc.sql} ORDER BY id`, sc.params))
    } else if (what === 'scenics') {
      rows = await q(`SELECT id, name, city_code, scenic_level, coop_mode, ticket_interface, contact_name, contact_phone, profit_terms, status, created_at FROM scenic_spot WHERE 1=1 ${sc.sql} ORDER BY id`, sc.params)
    } else if (what === 'suppliers') {
      rows = await q(`SELECT id, name, city_code, category, license_no, contact_name, contact_phone, settle_mode, status, note, created_at FROM supplier WHERE 1=1 ${sc.sql} ORDER BY id`, sc.params)
    } else if (what === 'creators') {
      // 创作者池是平台级内容运营台账：仅内部角色（能力 export.creators 已限定 super/ops/review），无城市维度
      rows = await q(`SELECT u.id, u.nickname, u.creator_tag, u.member_level,
        (SELECT COUNT(*) FROM content_note c WHERE c.user_id = u.id AND c.status = 2) published_count,
        (SELECT COUNT(*) FROM review r WHERE r.user_id = u.id) review_count
        FROM user_account u WHERE u.creator_tag <> 'none' ORDER BY u.id`)
    } else throw new BizError(1004, '未知报表类型')
    const csv = toCsv(rows)
    return { name, filename: name + '-' + new Date().toISOString().slice(0, 10) + '.csv', csv }
  },

  // 约稿任务管理（P2 四态机：创建/审核）——T00：仅内部内容角色；城市账号按关联线路城市行级隔离
  'GET /admin/content-tasks': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'review'])
    const cs = scopeFilter(a, 'p.city_code')
    // 进度按参与记录统计：领取人数 / 创作中 / 待审核 / 已通过 / 现金待打款
    return await q(`SELECT t.*, p.title product_title,
        COUNT(e.id) taken, SUM(e.status = 1) doing, SUM(e.status = 2) reviewing, SUM(e.status = 3) passed, SUM(e.cash_status = 1) cash_pending,
        (SELECT COUNT(*) FROM content_task_review r WHERE r.task_id = t.id) review_count
      FROM content_task t
      LEFT JOIN content_task_entry e ON e.task_id = t.id
      LEFT JOIN tour_product p ON p.id = t.product_id
      WHERE 1=1${cs.sql}
      GROUP BY t.id ORDER BY t.id DESC LIMIT 100`, cs.params)
  },
  // 某任务的参与者列表
  'GET /admin/content-tasks/:id/entries': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'review'])
    const t = await one(`SELECT t.id, p.city_code FROM content_task t LEFT JOIN tour_product p ON p.id = t.product_id WHERE t.id = ?`, [req.params.id])
    if (!t) throw new BizError(1004, '任务不存在')
    if (a.scopeCity && String(a.scopeCity) !== String(t.city_code)) throw new BizError(1003, '仅可查看本城任务的参与者')
    return await q(`SELECT e.*, u.nickname, u.creator_tag, n.title note_title,
        (SELECT COUNT(*) FROM content_task_review r WHERE r.entry_id = e.id AND r.verdict = 0) rejected_times
      FROM content_task_entry e JOIN user_account u ON u.id = e.user_id LEFT JOIN content_note n ON n.id = e.note_id
      WHERE e.task_id = ? ORDER BY FIELD(e.status, 2, 1, 3), e.id`, [req.params.id])
  },
  // 下线 / 重新上线（下线后不能再领取，已领取的人仍可投稿与审核）
  'POST /admin/content-tasks/:id/status': async (req) => {
    const a = await requireAdmin(req, 'task.status')
    const st = Number(req.body.status)
    if (![0, 4].includes(st)) throw new BizError(1001, '状态只能是招募中或已下线')
    const n = await tx(async (c) => {
      const r = await c.upd('UPDATE content_task SET status = ? WHERE id = ?', [st, req.params.id])
      await audit(c, 'admin:' + a.name, 'content-task', st ? 'offline' : 'online', 'task-' + req.params.id, null, { status: st })
      return r
    })
    if (!n) throw new BizError(1004, '任务不存在')
    return { status: st }
  },
  'POST /admin/content-tasks': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'review'])
    const { title, brief, rewardBeans, category, coverImg, richBrief, cashReward, minWords, minImages,
      maxParticipants, deadline, productId, tags } = req.body
    if (!title || !brief) throw new BizError(1001, '标题与要求必填')
    if (Number(cashReward) < 0 || Number(rewardBeans) < 0) throw new BizError(1001, '奖励不能为负')
    if (productId && !(await one('SELECT id FROM tour_product WHERE id = ?', [productId]))) throw new BizError(1001, '关联商品不存在')
    const taskNo = 'TK' + Date.now()
    const id = await tx(async (c) => c.ins(
      `INSERT INTO content_task (task_no, title, brief, category, cover_img, rich_brief, reward_beans, cash_reward,
        min_words, min_images, max_participants, deadline, product_id, tags, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [taskNo, title, brief, ['note', 'video', 'strategy', 'review'].includes(category) ? category : 'note',
        coverImg || null, richBrief ? sanitizeRich(richBrief) : null, Number(rewardBeans) || 200, Number(cashReward) || 0,
        Number(minWords) || 0, Number(minImages) || 0, Number(maxParticipants) || 0, deadline || null,
        productId || null, tags || null, a.uid || null]))
    return { id, taskNo }
  },
  'PUT /admin/content-tasks/:id': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'review'])
    const t = await one('SELECT * FROM content_task WHERE id = ?', [req.params.id])
    if (!t) throw new BizError(1201, '任务不存在')
    if (Number(t.status) >= 2) throw new BizError(1001, '任务已进入审核，不能再编辑')
    const b = req.body
    if (b.productId && !(await one('SELECT id FROM tour_product WHERE id = ?', [b.productId]))) throw new BizError(1001, '关联商品不存在')
    const r = await tx(async (c) => {
      const rows = await c.q(`UPDATE content_task SET title = COALESCE(?, title), brief = COALESCE(?, brief),
        category = COALESCE(?, category), cover_img = ?, rich_brief = COALESCE(?, rich_brief),
        reward_beans = COALESCE(?, reward_beans), cash_reward = COALESCE(?, cash_reward),
        min_words = COALESCE(?, min_words), min_images = COALESCE(?, min_images),
        max_participants = COALESCE(?, max_participants), deadline = ?, product_id = ?, tags = COALESCE(?, tags)
        WHERE id = ?`,
        [b.title ?? null, b.brief ?? null, ['note', 'video', 'strategy', 'review'].includes(b.category) ? b.category : null,
          b.coverImg ?? null, b.richBrief ? sanitizeRich(b.richBrief) : null,
          b.rewardBeans != null ? Number(b.rewardBeans) : null, b.cashReward != null ? Number(b.cashReward) : null,
          b.minWords != null ? Number(b.minWords) : null, b.minImages != null ? Number(b.minImages) : null,
          b.maxParticipants != null ? Number(b.maxParticipants) : null, b.deadline ?? null,
          b.productId ?? null, b.tags ?? null, req.params.id])
      await audit(c, 'admin:' + a.name, 'content-task', 'update', 'task-' + t.id, null, { title: b.title })
      return rows
    })
    return { updated: r.affectedRows > 0 }
  },
  // 审核材料：约稿要求 + 投稿全文与图片 + 自动核对 + 历次审核记录（审核员据此判定）
  // 审核材料（按参与记录）：约稿要求 + 投稿全文与图片 + 自动核对 + 该参与者的历次审核
  'GET /admin/task-entries/:id/review': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'review'])
    const pack = await taskReview.entryReviewPack(req.params.id, (u) => apiImg(u, req))
    if (!pack) throw new BizError(1004, '参与记录不存在')
    return pack
  },
  'POST /admin/task-entries/:id/verdict': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'review'])
    const passed = req.body.pass === true
    const reason = String(req.body.reason || '').trim()
    if (!passed && reason.length < 4) throw new BizError(1001, '请填写驳回原因（至少 4 个字），作者会在小程序里看到')
    if (reason.length > 300) throw new BizError(1001, '原因最多 300 字')
    const bad = findBanned(reason)
    if (bad) throw new BizError(1001, `原因会展示在小程序里，不能出现「${bad}」${SUGGEST[bad] ? '，可改为「' + SUGGEST[bad] + '」' : ''}`)
    return tx(async (cc) => {
      const e = await cc.one('SELECT * FROM content_task_entry WHERE id = ? FOR UPDATE', [req.params.id])
      if (!e || Number(e.status) !== 2) throw new BizError(2002, '仅审核中的投稿可处理')
      const t = await cc.one('SELECT * FROM content_task WHERE id = ?', [e.task_id])
      const reqs = taskReview.requirementsOf(t)
      const confirmed = Array.isArray(req.body.rules) ? req.body.rules : []
      if (passed && reqs.review_rules.some((_, i) => confirmed[i] !== true)) throw new BizError(1001, '请逐条确认审核标准后再通过')
      const note = e.note_id ? await cc.one('SELECT * FROM content_note WHERE id = ?', [e.note_id]) : null
      if (passed && (!note || Number(note.status) !== 2)) throw new BizError(1001, '投稿作品已下架或不存在，不能通过')
      const auto = note ? taskReview.autoChecks(reqs, taskReview.noteView(note), e.submitted_at) : []
      const cash = Number(t.cash_reward) || 0
      if (passed) {
        const budget = await cc.one('SELECT id FROM bean_budget WHERE status=1 ORDER BY id DESC LIMIT 1')
        if (!budget) throw new BizError(5002, '缺少可用奖励预算，投稿保持审核中')
        // 红线 12：冻结账号暂停发放旅豆奖励；投稿保持审核中，解冻后再审核
        if (Number(t.reward_beans) > 0 && await promo.isUserFrozen(e.user_id)) throw new BizError(6001, '该用户账号已冻结，暂停发放旅豆奖励。投稿保持审核中，请解冻后再审核')
        await bean.grant(Number(e.user_id), Number(t.reward_beans), bean.BIZ.TASK, t.task_no + '-E' + e.id, budget.id, cc)
        // 奖励按通过时的任务设置快照；有现金加奖的进入"待打款"，由财务登记打款流水
        await cc.upd('UPDATE content_task_entry SET status=3, finished_at=NOW(3), reward_beans=?, cash_reward=?, cash_status=? WHERE id=?',
          [Number(t.reward_beans), cash, cash > 0 ? 1 : 0, e.id])
      } else {
        // 驳回：退回创作中，清掉本次投稿，作者修改后可重新提交（投稿与原因留在审核记录里）
        await cc.upd('UPDATE content_task_entry SET status=1, note_id=NULL, submitted_at=NULL WHERE id=?', [e.id])
      }
      await cc.ins(`INSERT INTO content_task_review (task_id, entry_id, note_id, user_id, verdict, reason, checks, reviewer) VALUES (?,?,?,?,?,?,?,?)`,
        [t.id, e.id, e.note_id || null, e.user_id, passed ? 1 : 0, reason || null,
          JSON.stringify({ auto, rules: reqs.review_rules.map((r, i) => ({ rule: r, ok: confirmed[i] === true })) }), 'admin:' + a.name])
      await audit(cc, 'admin:' + a.name, 'content-task', passed ? 'approve' : 'reject', 'entry-' + e.id, { status: 2 },
        { task: t.id, status: passed ? 3 : 1, reward: passed ? Number(t.reward_beans) : 0, cash: passed ? cash : 0, reason: reason || null })
      return passed ? { finished: true, rewarded: Number(t.reward_beans), cashReward: cash } : { rejected: true, backTo: '创作中' }
    })
  },
  // 现金加奖：待打款列表 / 登记打款（财务；流水号唯一，防重复登记）
  'GET /admin/task-cash': async (req) => {
    await requireAdmin(req, ['super', 'finance', 'ops'])
    return await q(`SELECT e.id, e.task_id, t.title, t.task_no, e.user_id, u.nickname, e.cash_reward, e.cash_status, e.finished_at, e.cash_ref, e.cash_paid_at, e.cash_by
      FROM content_task_entry e JOIN content_task t ON t.id = e.task_id JOIN user_account u ON u.id = e.user_id
      WHERE e.cash_status IN (1, 2) ORDER BY e.cash_status, e.finished_at DESC LIMIT 200`)
  },
  'POST /admin/task-entries/:id/cash-paid': async (req) => {
    const a = await requireAdmin(req, 'task.cashPaid')
    const ref = String(req.body.ref || '').trim()
    if (!/^[\w-]{6,64}$/.test(ref)) throw new BizError(1001, '请填写打款流水号（6–64 位字母、数字、- 或 _）')
    return tx(async (c) => {
      const e = await c.one('SELECT * FROM content_task_entry WHERE id = ? FOR UPDATE', [req.params.id])
      if (!e || Number(e.cash_status) !== 1) throw new BizError(2002, '该笔现金加奖不是待打款状态')
      // 红线 12：打款前看账号状态。冻结期间保持"待打款"，解冻后可继续登记
      if (await promo.isUserFrozen(e.user_id)) throw new BizError(6001, '该用户账号已冻结，暂停打款。请先解冻后再登记打款流水')
      if (await c.one('SELECT id FROM content_task_entry WHERE cash_ref = ?', [ref])) throw new BizError(2002, '该流水号已登记过')
      await c.upd('UPDATE content_task_entry SET cash_status = 2, cash_ref = ?, cash_paid_at = NOW(3), cash_by = ? WHERE id = ?', [ref, 'admin:' + a.name, e.id])
      await audit(c, 'admin:' + a.name, 'content-task', 'cash-paid', 'entry-' + e.id, { cash_status: 1 }, { cash_status: 2, ref, amount: Number(e.cash_reward) })
      return { paid: true }
    })
  },
  'POST /admin/content-tasks/:id/delete': async (req) => {
    const a = await requireAdmin(req, 'task.delete')
    const t = await one('SELECT id, status, title FROM content_task WHERE id = ?', [req.params.id])
    if (!t) throw new BizError(1004, '任务不存在')
    // 有人领取后删除会让作者的投稿和奖励记录失去归属：有参与记录的只能下线
    if (await one('SELECT id FROM content_task_entry WHERE task_id = ? LIMIT 1', [t.id])) throw new BizError(1001, '已有人领取的任务不能删除，可以下线')
    await tx(async (c) => { await c.q('DELETE FROM content_task WHERE id = ?', [t.id]); await audit(c, 'admin:' + a.name, 'content-task', 'delete', 'task-' + t.id, { title: t.title }, null) })
    return { deleted: true }
  },
  // 离线核销冲突人工队列（治理）
  'GET /admin/verify/conflicts': async (req) => {
    await requireAdmin(req)
    const status = req.query.status != null ? Number(req.query.status) : 0
    return await q('SELECT * FROM verify_offline_conflict WHERE status = ? ORDER BY id DESC LIMIT 100', [status])
  },
  'POST /admin/verify/conflicts/:id/resolve': async (req) => {
    const a = await requireAdmin(req)
    const { action } = req.body // confirm=确认核销 reject=驳回
    const row = await one('SELECT * FROM verify_offline_conflict WHERE id = ?', [req.params.id])
    if (!row || row.status !== 0) throw new BizError(1004, '冲突不存在或已处理')
    if (action === 'confirm') {
      if (!row.pass_id) throw new BizError(1001, '无法定位凭证，只能驳回')
      await pass.adminConfirmPass(row.pass_id, a.uid || 0)
    }
    await q('UPDATE verify_offline_conflict SET status = ?, resolved_by = ?, resolved_at = NOW(3) WHERE id = ?',
      [action === 'confirm' ? 1 : 2, a.uid || 0, req.params.id])
    return { resolved: action }
  },

  // 拼团未成团取消（生产=定时任务分钟级；联调/演示=手动触发）
  'POST /admin/dev/group-cancel': async (req) => {
    await requireAdmin(req)
    return { done: await group.cancelDueSessions() }
  },

  // 观察期完成（生产=定时任务；联调=手动触发）
  'POST /admin/dev/complete': async (req) => {
    await requireAdmin(req)
    const { orderNo } = req.body
    const o = await order.byNo(orderNo)
    if (!o || o.status !== 40) throw new BizError(2002, '订单不在已核销状态')
    await order.fire(orderNo, 'OBSERVE_END', 'system', async (c) => {
      await c.upd('UPDATE orders SET completed_at = NOW(3), refund_deadline = NOW(3) WHERE order_no = ?', [orderNo])
      return '观察期结束·触发返豆与佣金'
    })
    // 返豆 + 佣金 + 成长值 + 存证（同一动作位，生产在 beanWorker）
    const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
    if (budget && Number(o.amount_pay) > 0) await bean.rebateOrder({ ...o, order_no: orderNo }) // 冻结账号记为待补发，解冻后补发
    if (Number(o.amount_pay) > 0) await member.addGrowth(o.user_id, Number(o.amount_pay), orderNo) // 成长值与等级不依赖旅豆预算（与 jobs.completeOrder 一致）
    await promo.createCommission(orderNo)
    await badgeDomain.evaluateSafe(Number(o.user_id))
    await badgeDomain.evaluateMerchantSafe(Number(o.merchant_id)) // 商户等级与商户徽章
    // 订单完成锚定（version=50 主状态）。canonical 只放白名单字段，不含联系人/手机号
    await pass.attest('order', orderNo, {
      orderNo, amountPay: Number(o.amount_pay), status: 50,
      merchantId: Number(o.merchant_id), qty: Number(o.qty), cityCode: o.city_code,
    }, null, 50)
    return { completed: true }
  },
}

export { admin }
