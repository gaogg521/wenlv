import { q, one, count, tx, BizError } from '../db.mjs'
import { cfg, cfgAll, cfgNum, cfgArr, loadConfig, configName } from '../config.mjs'
import { requireUser, jwtSign, code2Session, hashPassword, verifyPassword } from '../auth.mjs'
import * as order from '../domain/order.mjs'
import * as bean from '../domain/bean.mjs'
import * as pass from '../domain/pass.mjs'
import * as promo from '../domain/promo.mjs'
import { maskApplyMobile, publicOrderPhone, sealMobile } from '../infra/mobile.mjs'
import { ADMIN_ACTIONS } from '../domain/admin-capabilities.mjs'
import { MODULES, effectiveModules } from '../domain/modules.mjs'
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

// ---------- 经营驾驶舱：统一统计周期 ----------
// 所有"随周期"的模块（KPI / 趋势 / TOP5 / 漏斗 / 小程序访问）共用这一个周期解析，口径只在这里定义一次。
// 周期按自然日对齐：[from, to] 含首尾；对比周期 = 紧邻其前、天数相同的一段。今日（1 天）按小时出趋势。
const DASH_RANGE = { today: 1, '7d': 7, '30d': 30, '1y': 365 }
const DASH_RANGE_CN = { today: '今日', '7d': '近 7 天', '30d': '近 30 天', '1y': '近一年' }
const ymdAdd = (ymd, n) => { const t = new Date(ymd + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const ymdDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
async function dashPeriod(req) {
  const rq = String(req.query.range || 'today')
  const today = (await one("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') d")).d
  const dateChk = (v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) throw new BizError(1001, '日期格式应为 YYYY-MM-DD')
    return v
  }
  let from, to = today
  if (DASH_RANGE[rq]) from = ymdAdd(today, 1 - DASH_RANGE[rq])
  else if (rq === 'custom') {
    if (!req.query.from || !req.query.to) throw new BizError(1001, '自定义范围需要 from 与 to 日期')
    from = dateChk(String(req.query.from)); to = dateChk(String(req.query.to))
    if (from > to) throw new BizError(1001, 'from 不能晚于 to')
    if (ymdDiff(from, to) > 730) throw new BizError(1001, '自定义范围最长 2 年')
  } else throw new BizError(1001, '统计范围无效（today/7d/30d/1y/custom）')
  const days = ymdDiff(from, to) + 1
  const prevTo = ymdAdd(from, -1), prevFrom = ymdAdd(prevTo, 1 - days)
  const unit = days === 1 ? 'hour' : days > 45 ? 'month' : 'day'
  // 日期均为上面校验/推算出的 YYYY-MM-DD，可安全内联；半开区间便于走索引
  const between = (col, f = from, t = to) => `${col} >= '${f}' AND ${col} < '${ymdAdd(t, 1)}'`
  return { range: rq, label: DASH_RANGE_CN[rq] || (from + ' ~ ' + to), from, to, days, prevFrom, prevTo, unit, between }
}
/** 趋势序列：按周期粒度（小时/天/月）分组并补齐零值，保证横轴完整 */
async function dashTrend(per, from, to, cityWhere) {
  const fmt = per.unit === 'hour' ? 'HOUR(o.paid_at)' : per.unit === 'month' ? "DATE_FORMAT(o.paid_at, '%Y-%m')" : "DATE_FORMAT(o.paid_at, '%Y-%m-%d')"
  const rows = await q(`SELECT ${fmt} k, COUNT(*) c, COALESCE(SUM(o.amount_pay),0) gmv FROM orders o
    WHERE o.status IN (20,30,40,50) AND ${per.between('o.paid_at', from, to)} ${cityWhere} GROUP BY k ORDER BY k`)
  const by = Object.fromEntries(rows.map((r) => [String(r.k), r]))
  const pt = (key, date) => { const h = by[key]; return { date, orders: h ? Number(h.c) : 0, gmv: fen2yuan(h ? h.gmv : 0) } }
  const out = []
  if (per.unit === 'hour') {
    for (let h = 0; h < 24; h++) out.push(pt(String(h), String(h).padStart(2, '0') + ':00'))
  } else if (per.unit === 'month') {
    const [fy, fm] = from.split('-').map(Number), [ty, tm] = to.split('-').map(Number)
    const total = Math.min(24, (ty - fy) * 12 + (tm - fm) + 1)
    for (let i = total - 1; i >= 0; i--) {
      const idx = ty * 12 + (tm - 1) - i
      const key = Math.floor(idx / 12) + '-' + String((idx % 12) + 1).padStart(2, '0')
      out.push(pt(key, key))
    }
  } else {
    for (let i = 0; i < ymdDiff(from, to) + 1; i++) { const d = ymdAdd(from, i); out.push(pt(d, d)) }
  }
  return out
}
const pct1 = (n, d) => (Number(d) ? ((Number(n) / Number(d)) * 100).toFixed(1) + '%' : '—')

// T00：有城市列的实体种类；城市账号读取按城市行级隔离，其余种类对城市账号默认拒绝
const ENTITY_CITY_KINDS = ['product', 'merchant', 'scenic', 'supplier']

/**
 * 商品改价 / 上下架留痕（价格是交易依据，改过就必须可追溯）。
 * 只记"从什么变成什么"，金额明细留在库里，进树的只有哈希。
 * version_no 用该商品的变更序号：第 1 次改价是 v1，第 2 次是 v2 —— 天然形成一条变更史。
 * 代价：并发同刻改同一商品可能撞同一个版本号，靠 INSERT IGNORE 只留一条；
 * 后台改价是低频人工动作，这个取舍可以接受，也避免用时间戳当业务键（铁律：biz_ref 不能随手拼）。
 */
async function attestProductChange(productId, before, after, kind) {
  const pid = Number(productId)
  const bPrice = before && before.price != null ? Number(before.price) : null
  const aPrice = after && after.price != null ? Number(after.price) : null
  const bStatus = before && before.status != null ? Number(before.status) : null
  const aStatus = after && after.status != null ? Number(after.status) : null
  const priceChanged = aPrice != null && aPrice !== bPrice
  const statusChanged = aStatus != null && aStatus !== bStatus
  if (!priceChanged && !statusChanged) return
  try {
    const seq = await one("SELECT COUNT(*) n FROM attest_event WHERE biz_type = 'product_change' AND biz_ref = ?", ['product-' + pid])
    await attestDomain.attest('product_change', 'product-' + pid, {
      productId: pid, kind, priceFrom: bPrice, priceTo: aPrice, statusFrom: bStatus, statusTo: aStatus,
    }, null, Number(seq.n) + 1)
  } catch (e) {
    // 留痕失败不能让后台改价失败：链是审计锚点，业务照常（与本项目一贯口径一致）
    console.error('[attest:product_change]', e.message)
  }
}

// R-01：主数据关键变更版本（只增不改）。历史回退=写一条新版本恢复旧值，绝不 UPDATE 历史
async function recordMasterVersion(kind, refId, snapshot, changedBy, reason) {
  try {
    const seq = await one('SELECT COALESCE(MAX(version_no), 0) v FROM master_data_version WHERE kind = ? AND ref_id = ?', [kind, refId])
    await q('INSERT INTO master_data_version (kind, ref_id, version_no, snapshot, changed_by, reason) VALUES (?,?,?,?,?,?)',
      [kind, refId, Number(seq.v) + 1, JSON.stringify(snapshot), changedBy, reason || null])
  } catch (e) {
    // 并发同刻撞版本号：审计与 attest 已留痕，版本簿少一条不影响交易依据（低频人工操作）
    console.error('[master-version]', kind, refId, e.message)
  }
}

// U-04/R-05 配套：订单筛选条件构建（search 与按筛选导出共用同一套语义；手机号走盲索引不回显）
async function orderFiltersOf(req, a) {
  const date = (v, label) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BizError(1001, label + '格式应为 YYYY-MM-DD'); return v }
  const conds = []
  const addCond = (sql, ...args) => { conds.push({ sql, args }) }
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
  return { conds, filters }
}

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
    // C-04/C-05：模块单一数据源——allModules 是唯一清单，modules 是该账号有效模块集合
    // （角色默认经 V54 矩阵表，可在「后台账号 → 角色默认权限」调整；账号级三态叠加 admin_user_module）。
    // 前端菜单不再写死 access 表；未知角色默认拒绝（空集合），readonly/sre/dev 不再缺省放行全菜单。
    const { accountModules } = await import('../domain/admin-modules.mjs')
    return { role: a.role, scopeCity: a.scopeCity || null, actions, modules: [...(await accountModules(a.uid, a.role))], allModules: MODULES }
  },
  'POST /admin/login': async (req) => {
    const { username, password } = req.body
    const u = await one('SELECT * FROM admin_user WHERE username = ? AND status = 1', [username || ''])
    if (!u || !verifyPassword(password || '', u.password_hash)) throw new BizError(1002, '账号或密码错误')
    // MFA（C-02/C-03）：单账号强制 > 单账号豁免 > 全局策略（admin.mfa.mode: off/optional/required）。
    // 全局策略是敏感参数，变更走参数中心双人复核（安全中心三档卡片提交提案，不由本接口直接改）。
    const mfaMode = String((await cfgAll())['admin.mfa.mode'] || '"optional"')
    const bound = Number(u.mfa_enabled) === 1 && (u.mfa_channel === 'totp' ? u.mfa_secret : (u.mfa_channel === 'sms' ? u.mobile : u.email))
    const need = Number(u.mfa_force) === 1 ? true
      : Number(u.mfa_exempt) === 1 ? false
        : mfaMode.includes('required') ? true : (mfaMode.includes('optional') && !!bound)
    if (need) {
      const ch = bound ? u.mfa_channel : (u.mobile ? 'sms' : u.email ? 'email' : 'totp')
      if (!bound && ch === 'sms' && u.mobile) await import('../infra/mfa.mjs').then((m) => m.sendCode(u.mobile, 'sms'))
      // C-03：需要 MFA 但未绑定时进入绑定引导——challenge 是受限临时凭证（end=mfa，不能调任何后台业务接口），先绑定再验证
      return { mfaRequired: true, challenge: jwtSign({ uid: u.id, end: 'mfa', ch, exp2: Date.now() + 5 * 60_000 }, 300),
        channel: ch, mfaSetupRequired: !bound,
        target: ch === 'sms' ? String(u.mobile || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : (ch === 'email' ? String(u.email || '').replace(/^(.).*(@.*)$/, '$1***$2') : null) }
    }
    await q('UPDATE admin_user SET last_login_at = NOW(3) WHERE id = ?', [u.id])
    return { token: jwtSign({ uid: u.id, ver: Number(u.token_epoch), end: 'admin', role: u.role, name: u.display_name || u.username, scopeCity: u.scope_city || null }, 12 * 3600),
      user: { uid: u.id, username: u.username, role: u.role, displayName: u.display_name, scopeCity: u.scope_city || null, mustChangePassword: Number(u.must_change_pwd) === 1 } }
  },

  // C-03：强制绑定引导——在「登录受限态」（challenge，非通行令牌）下生成 TOTP 密钥；验证通过前拿不到后台会话
  'POST /admin/login/mfa/setup': async (req) => {
    const { challenge } = req.body
    const { jwtVerify } = await import('../auth.mjs')
    const p = jwtVerify(challenge || '')
    if (!p || p.end !== 'mfa' || Date.now() > p.exp2) throw new BizError(1002, '验证会话已过期，请重新登录')
    const mfa = await import('../infra/mfa.mjs')
    const secret = mfa.newTotpSecret()
    await q('UPDATE admin_user SET mfa_secret = ?, mfa_channel = ?, mfa_enabled = 1 WHERE id = ?', [secret, 'totp', p.uid])
    await tx(async (c) => audit(c, 'admin:uid-' + p.uid, 'security', 'mfa-setup', 'user-' + p.uid, null, { channel: 'totp', via: 'login-guided' }))
    const u = await one('SELECT username FROM admin_user WHERE id = ?', [p.uid])
    return { secret, uri: mfa.otpauthUri(secret, u.username), current: mfa.totpNow(secret) }
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
    return await q('SELECT id, username, role, display_name, mfa_enabled, mfa_channel, mobile, email, mfa_exempt, mfa_force, last_login_at, status FROM admin_user ORDER BY id')
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
  // 验证方式的通道状态：TOTP 恒可用；短信/邮箱需在集成中心配凭据，且发送器已接入才会真实送达（否则走 MOCK，验证码只在安全中心可见）
  'GET /admin/security/channels': async (req) => {
    await requireAdmin(req, ['super'])
    const mfa = await import('../infra/mfa.mjs')
    // C-02：全局三档是敏感参数（rule_config.sensitive=1）——变更需第二人复核；这里带出待复核提案供页面展示
    const pending = await one("SELECT id, new_value, proposer, created_at FROM config_history WHERE cfg_key = 'admin.mfa.mode' AND status = 0 ORDER BY id DESC LIMIT 1")
    return { ...(await mfa.channelStatus()),
      mode: String((await cfgAll())['admin.mfa.mode'] || 'optional').replace(/"/g, ''),
      pendingReview: pending ? { id: pending.id, newValue: String(pending.new_value).replace(/"/g, ''), proposer: pending.proposer } : null }
  },
  // C-02 / D-02：全局 MFA 三档走敏感参数双人复核（admin.mfa.mode sensitive=1），此处只提交提案，
  // 由另一位超管在参数中心「参数审批」通过后才生效（approve 内 loadConfig(true) 热刷新）
  'POST /admin/security/mfa-mode': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const mode = String(req.body?.mode || '')
    if (!['off', 'optional', 'required'].includes(mode)) throw new BizError(1001, 'MFA 策略只能是 off / optional / required')
    const old = String((await cfgAll())['admin.mfa.mode'] || 'optional').replace(/"/g, '')
    if (old === mode) throw new BizError(2002, '当前策略已经是「' + ({ off: '关闭', optional: '可选', required: '强制' })[mode] + '」，无需变更')
    const dup = await one("SELECT id FROM config_history WHERE cfg_key = 'admin.mfa.mode' AND status = 0 ORDER BY id DESC LIMIT 1")
    if (dup) throw new BizError(2002, '已有一笔待复核的策略变更提案，请先让另一位超级管理员处理')
    const id = await tx(async (c) => {
      const hid = await c.ins('INSERT INTO config_history (cfg_key, old_value, new_value, proposer, status, reason) VALUES (?,CAST(? AS JSON),CAST(? AS JSON),?,0,?)',
        ['admin.mfa.mode', JSON.stringify(old), JSON.stringify(mode), 'admin:' + a.name, String(req.body?.reason || '').trim() || '安全中心三档卡片提交'])
      await audit(c, 'admin:' + a.name, 'security', 'mfa-mode-proposal', 'admin.mfa.mode', old, mode)
      return hid
    })
    return { submitted: true, historyId: id, pendingReview: true, note: '全局 MFA 策略是敏感参数：需另一位超级管理员在「参数中心 → 参数审批」通过后生效，生效后按新策略处理未绑定账号' }
  },
  'GET /admin/security/recent-codes': async (req) => {
    await requireAdmin(req, ['super'])
    return await q('SELECT target, channel, code, purpose, expires_at, used_at, created_at FROM mfa_code ORDER BY id DESC LIMIT 10')
  },

  // 经营驾驶舱：随周期的经营指标。周期解析见 dashPeriod；城市合伙人严格本城口径（§数据边界）
  // 口径：已支付以上（20/30/40/50）订单按支付时间；对比周期 = 紧邻其前、天数相同的一段
  'GET /admin/dash/kpi': async (req) => {
    const a = await requireAdmin(req)
    const sc = a.scopeCity
    const cityWhere = sc ? 'AND o.city_code = ' + Number(sc) : ''
    const per = await dashPeriod(req)
    const agg = (f, t) => one(`SELECT COUNT(*) c, COALESCE(SUM(amount_pay),0) gmv, COUNT(DISTINCT user_id) payers FROM orders o
      WHERE o.status IN (20,30,40,50) AND ${per.between('o.paid_at', f, t)} ${cityWhere}`)
    const [cur, prev, trend] = await Promise.all([
      agg(per.from, per.to), agg(per.prevFrom, per.prevTo), dashTrend(per, per.from, per.to, cityWhere),
    ])
    // 上一周期同粒度趋势（叠加虚线对比）；按月粒度时周期长度不等，不叠加
    const trendPrev = per.unit === 'month' ? [] : await dashTrend(per, per.prevFrom, per.prevTo, cityWhere)
    // 以下两项是"此刻"的存量，不随周期变化
    const budget = sc ? null : await one('SELECT SUM(total) t, SUM(granted) g FROM bean_budget WHERE status = 1')
    const alerts = sc ? 0 : await count('SELECT COUNT(*) c FROM risk_event WHERE handled = 0')
    return {
      range: per.range, rangeLabel: per.label, from: per.from, to: per.to, days: per.days, unit: per.unit,
      prevFrom: per.prevFrom, prevTo: per.prevTo,
      orders: Number(cur.c), gmv: fen2yuan(cur.gmv), payers: Number(cur.payers),
      prev: { orders: Number(prev.c), gmv: fen2yuan(prev.gmv), payers: Number(prev.payers) },
      trend, trendPrev,
      budgetUsage: budget && budget.t ? ((Number(budget.g) / Number(budget.t)) * 100).toFixed(1) + '%' : '—',
      alerts,
      scopeCity: a.scopeCity || null,
      globalScope: !a.scopeCity,
    }
  },

  // 看板洞察：待办聚合（实时）+ 热门主题游 / 转化漏斗 / 订单构成（随周期，与 dash/kpi 同一周期）
  'GET /admin/dash/insights': async (req) => {
    const a = await requireAdmin(req)
    const per = await dashPeriod(req)
    // 城市合伙人只看本城（与 dash/kpi 同口径）。提现 / 离线冲突 / 笔记 / 约稿是全局队列，城市账号按 0 处理；旅豆预算是全局的，城市账号不展示使用率
    const sc = a.scopeCity
    const oc = sc ? ' AND o.city_code = ' + Number(sc) : ''
    const zero = { c: 0 }
    const pendingWithdrawals = sc ? zero : await one("SELECT COUNT(*) c FROM promoter_withdraw WHERE status = 0")
    const pendingConflicts = sc ? zero : await one("SELECT COUNT(*) c FROM verify_offline_conflict WHERE status = 0")
    const pendingNotes = sc ? zero : await one("SELECT COUNT(*) c FROM content_note WHERE status = 1")
    const pendingMerchants = await one("SELECT COUNT(*) c FROM merchant m WHERE m.status = 0" + (sc ? ' AND m.city_code = ' + Number(sc) : ''))
    const pendingTasks = sc ? zero : await one('SELECT COUNT(*) c FROM content_task_entry WHERE status = 2')
    // 热门主题游：周期内已支付（与 GMV 同口径）
    const topTours = await q(`SELECT p.id, p.title, COUNT(o.id) orders, COALESCE(SUM(o.amount_pay),0) gmv
      FROM orders o JOIN tour_product p ON p.id = o.product_id
      WHERE o.status IN (20,30,40,50) AND ${per.between('o.paid_at')} ${oc}
      GROUP BY p.id, p.title ORDER BY orders DESC, gmv DESC LIMIT 5`)
    // 转化漏斗：周期内下单的这一批订单走到哪一步（下单 → 已支付 → 已核销）。
    // 以订单状态机为准：20 已支付 / 30 已确认 / 40 已核销 / 50 已完成 / 60 退款中 / 70 已退款 / 90 已关闭；
    // 已支付 = 20~70（含后续退款，退款也是付过款的），已核销 = 40/50
    const created = await one(`SELECT COUNT(*) c, COALESCE(SUM(o.status BETWEEN 20 AND 70), 0) paid, COALESCE(SUM(o.status IN (40,50)), 0) verified
      FROM orders o WHERE ${per.between('o.created_at')} ${oc}`)
    // 复购：周期内支付过 ≥2 单的用户 ÷ 周期内支付用户
    const rb = await one(`SELECT COUNT(*) payers, COALESCE(SUM(c > 1), 0) rebuy FROM (
      SELECT o.user_id, COUNT(*) c FROM orders o WHERE o.status IN (20,30,40,50) AND ${per.between('o.paid_at')} ${oc} GROUP BY o.user_id) t`)
    const statusMix = await q(`SELECT o.status s, COUNT(*) c FROM orders o WHERE ${per.between('o.created_at')} ${oc} GROUP BY o.status`)
    // 旅豆使用率是累计存量（累计抵扣 ÷ 累计发放），不随周期；仅总部可见
    const beanFlow = sc ? null : await bean.flow()
    const nCreated = Number(created.c) || 0, nPaid = Number(created.paid) || 0, nVerified = Number(created.verified) || 0
    return {
      period: { range: per.range, label: per.label, from: per.from, to: per.to, days: per.days },
      pending: {
        withdrawals: Number(pendingWithdrawals.c) || 0,
        conflicts: Number(pendingConflicts.c) || 0,
        notes: Number(pendingNotes.c) || 0,
        merchants: Number(pendingMerchants.c) || 0,
        tasks: Number(pendingTasks.c) || 0,
      },
      topTours,
      statusMix: statusMix.map((r) => ({ status: Number(r.s), count: Number(r.c) })),
      funnel: {
        created: nCreated, paid: nPaid, verified: nVerified,
        payRate: pct1(nPaid, nCreated),
        verifyRate: pct1(nVerified, nPaid),
        payers: Number(rb.payers) || 0, rebuyUsers: Number(rb.rebuy) || 0,
        rebuyRate: pct1(rb.rebuy, rb.payers),
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

  // ===== R-02：改期 / 换团（申请 → 审批 → 执行；申请-审批分离，审批人≠申请人）=====
  // 资金边界（如实）：价差随执行调整订单台账金额；旅豆抵扣真实扣减；真实补款/退差走财务线下或
  // 既有退款流程登记，不虚构到账。已核销/退款中/已完成不走普通改期。
  'POST /admin/orders/:id/reschedule': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const { toSessionId, reason, diffBean } = req.body || {}
    const why = String(reason || '').trim()
    if (why.length < 4 || why.length > 300) throw new BizError(1001, '请填写 4–300 字改期原因')
    // N-006：前端传订单号、数字 ID 两种形态都接受（页面按订单号调用）
    const key = String(req.params.id || '')
    const o = /^\d+$/.test(key)
      ? await one('SELECT * FROM orders WHERE id = ?', [Number(key)])
      : await one('SELECT * FROM orders WHERE order_no = ?', [key])
    if (!o) throw new BizError(1004, '订单不存在')
    if (a.scopeCity && String(o.city_code || '') !== String(a.scopeCity)) throw new BizError(1003, '仅可办理本城订单')
    if (![20, 30].includes(Number(o.status))) throw new BizError(2002, '仅「已支付 / 已确认」订单可改期；已核销、退款中或已完成的订单请走对应流程')
    if (await one('SELECT id FROM order_reschedule WHERE order_id = ? AND status IN (0, 1)', [o.id])) throw new BizError(2002, '该订单已有在途改期申请，请先处理')
    const to = await one('SELECT s.*, p.title product_title FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.id = ?', [Number(toSessionId)])
    if (!to || Number(to.product_id) !== Number(o.product_id) || Number(to.status) !== 1) throw new BizError(1001, '目标团期无效或不可报名')
    if (Number(to.id) === Number(o.session_id)) throw new BizError(1001, '目标团期与当前团期相同')
    const from = await one('SELECT * FROM tour_session WHERE id = ?', [o.session_id])
    if (!from) throw new BizError(1004, '原团期不存在')
    if (Number(to.booked) + Number(o.qty) > Number(to.quota)) throw new BizError(2001, '目标团期名额不足（剩 ' + (Number(to.quota) - Number(to.booked)) + '）')
    const priceDiff = (Number(to.price_adult) - Number(from.price_adult)) * Number(o.qty)
    const bean = Number(diffBean) || 0
    if (bean < 0 || (priceDiff > 0 && bean > priceDiff)) throw new BizError(1001, '旅豆抵扣额不能超过需补款价差')
    if (bean > 0) {
      const acct = await one('SELECT a.balance FROM bean_account a WHERE a.user_id = ?', [o.user_id])
      if (!acct || Number(acct.balance) < bean) throw new BizError(1001, '游客旅豆余额不足以抵扣 ' + bean + ' 分差价')
    }
    const reqNo = 'RS' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + String(Date.now() % 100000).padStart(5, '0') + String(Math.floor(Math.random() * 90) + 10)
    const id = await tx(async (c) => {
      const rid = await c.ins(`INSERT INTO order_reschedule (req_no, order_id, order_no, from_session_id, to_session_id, qty, price_diff, diff_bean, reason, applicant, applicant_uid)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [reqNo, o.id, o.order_no, o.session_id, to.id, Number(o.qty), priceDiff, bean, why, 'admin:' + a.name, a.uid ?? null])
      await audit(c, 'admin:' + a.name, 'order', 'reschedule-apply', 'reschedule-' + rid,
        { orderNo: o.order_no, fromSession: o.session_id }, { toSession: to.id, priceDiff, diffBean: bean, reason: why })
      return rid
    })
    return { id, reqNo, priceDiff, note: priceDiff > 0 ? '需游客补款 ' + fen2yuan(priceDiff) + (bean ? '（旅豆抵扣 ' + fen2yuan(bean) + '）' : '') : (priceDiff < 0 ? '应退差 ' + fen2yuan(-priceDiff) : '同价换团') }
  },

  'GET /admin/reschedules': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'finance'])
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const conds = [], args = [], filters = {}
    if (a.scopeCity) { conds.push('o.city_code = ?'); args.push(a.scopeCity) }
    const st = req.query.status == null || req.query.status === '' ? null : Number(req.query.status)
    if (st != null && [0, 1, 2, 3, 4, 5].includes(st)) { conds.push('r.status = ?'); args.push(st); filters.status = st }
    const kw = String(req.query.kw || '').trim()
    if (kw) { conds.push('(r.order_no LIKE ? OR r.req_no LIKE ?)'); args.push('%' + kw + '%', '%' + kw + '%'); filters.kw = kw }
    const W = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
    // N-007：JOIN 写全在 from 里（原先 rows 查询把 p JOIN 追加在 WHERE 之后，SQL 语法错误）
    const from = `FROM order_reschedule r JOIN orders o ON o.id = r.order_id JOIN tour_product p ON p.id = o.product_id ${W}`
    const total = Number((await one(`SELECT COUNT(*) n ${from}`, args)).n)
    const rows = await q(`SELECT r.*, p.title product_title, o.status order_status ${from}
      ORDER BY r.id DESC LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize])
    const RS_ST = { 0: '待审批', 1: '待执行', 2: '已驳回', 3: '已执行', 4: '已撤回', 5: '执行失败' }
    return { rows: rows.map((r) => ({ ...r, statusCn: RS_ST[r.status] })), total, page, pageSize, filters }
  },

  'POST /admin/reschedules/:id/verdict': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const pass = req.body.pass === true
    const note = String(req.body.note || '').trim()
    const r = await one('SELECT * FROM order_reschedule WHERE id = ? FOR UPDATE', [req.params.id])
    if (!r) throw new BizError(1004, '改期申请不存在')
    if (Number(r.status) !== 0) throw new BizError(2002, '该申请已处理，请刷新')
    // QA-01：身份按不可变 UID 比较；申请已记录 UID 而令牌无 uid（仅测试夹具可能）→ fail-closed 拒绝；
    // 存量行（uid NULL）回退名字比较。同一账号改显示名/两个账号同名都不能绕过或误拒。
    const isSelf = r.applicant_uid != null
      ? (a.uid == null || Number(r.applicant_uid) === Number(a.uid))
      : r.applicant === 'admin:' + a.name
    if (isSelf) throw new BizError(1003, '双人复核：审批人不能与申请人相同')
    await tx(async (c) => {
      // 条件更新 + 影响行数校验：并发审批只有一win（与案件结案同语义）
      const n = await c.q('UPDATE order_reschedule SET status = ?, approver = ?, approver_uid = ?, approve_note = ? WHERE id = ? AND status = 0',
        [pass ? 1 : 2, 'admin:' + a.name, a.uid ?? null, note || null, r.id])
      if (n.affectedRows !== 1) throw new BizError(2002, '该申请刚被他人处理，请刷新')
      await audit(c, 'admin:' + a.name, 'order', pass ? 'reschedule-approve' : 'reschedule-reject', 'reschedule-' + r.id,
        { status: 0 }, { status: pass ? 1 : 2, note: note || null })
    })
    return { status: pass ? 1 : 2, note: pass ? '已通过，可执行换团（执行时再校验名额与订单状态）' : '已驳回' }
  },

  'POST /admin/reschedules/:id/execute': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    try {
      let result = null
      await tx(async (c) => {
        // QA-02：事务内锁定申请行并重检状态（申请状态读取不能再在事务外）——
        // 并发执行在此串行化，只有第一个看到 status=1 的事务能通过条件更新独占转移
        const r = await c.one('SELECT * FROM order_reschedule WHERE id = ? FOR UPDATE', [req.params.id])
        if (!r) throw new BizError(1004, '改期申请不存在')
        if (Number(r.status) !== 1) {
          // 已成功的并发重入返回幂等结果（不报错、不重复执行）；其他状态按原语义拒绝
          if (Number(r.status) === 3) { result = { status: 3, idempotent: true }; return }
          throw new BizError(2002, '仅「待执行」申请可执行')
        }
        // 状态转移先独占（条件更新校验影响行数）——后续库存/金额/旅豆/事件只在独占成功后执行
        const claim = await c.q('UPDATE order_reschedule SET status = 3, executed_at = NOW(3), exec_note = ? WHERE id = ? AND status = 1',
          ['执行中', r.id])
        if (claim.affectedRows !== 1) { result = { status: Number(r.status), idempotent: Number(r.status) === 3 }; if (result.idempotent) return; throw new BizError(2002, '仅「待执行」申请可执行') }
        const o = await c.one('SELECT * FROM orders WHERE id = ? FOR UPDATE', [r.order_id])
        if (!o || ![20, 30].includes(Number(o.status))) throw new BizError(2002, '订单状态已变化（已核销/退款中/关闭），不能改期，请驳回或登记失败')
        const to = await c.one('SELECT * FROM tour_session WHERE id = ? FOR UPDATE', [r.to_session_id])
        if (!to || Number(to.status) !== 1) throw new BizError(2001, '目标团期已不可报名，执行失败')
        const moved = await c.upd('UPDATE tour_session SET booked = booked - ? WHERE id = ? AND booked >= ?', [r.qty, r.from_session_id, r.qty])
        if (moved !== 1) throw new BizError(2002, '原团期在途数据异常（在册人数不足），请人工核对后登记失败')
        const add = await c.upd('UPDATE tour_session SET booked = booked + ? WHERE id = ? AND booked + ? <= quota', [r.qty, r.to_session_id, r.qty])
        if (add !== 1) throw new BizError(2001, '目标团期名额已被占满，执行失败')
        const newGoods = Number(o.amount_goods) + Number(r.price_diff)
        const newPay = Number(o.amount_pay) + Number(r.price_diff) - Number(r.diff_bean)
        await c.q('UPDATE orders SET session_id = ?, amount_goods = ?, amount_pay = ?, version = version + 1 WHERE id = ?',
          [r.to_session_id, newGoods, newPay, o.id])
        if (Number(r.diff_bean) > 0) {
          const bean = await import('../domain/bean.mjs')
          await bean.deduct(Number(o.user_id), Number(r.diff_bean), bean.BIZ.DEDUCT, r.req_no, c)
        }
        await c.q(`INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,?,?,?,?)`,
          [o.id, Number(o.status), Number(o.status), 'admin:' + a.name,
            JSON.stringify(`改期换团：${r.from_session_id} → ${r.to_session_id}（${r.req_no}，价差 ${r.price_diff} 分，旅豆抵扣 ${r.diff_bean} 分）`)])
        await audit(c, 'admin:' + a.name, 'order', 'reschedule-execute', 'reschedule-' + r.id,
          { status: 1 }, { status: 3, orderNo: r.order_no, fromSession: r.from_session_id, toSession: r.to_session_id, priceDiff: r.price_diff, diffBean: r.diff_bean })
        // 执行成功后的终态备注（此时状态已被独占为 3，只补备注，不改状态）
        await c.q('UPDATE order_reschedule SET exec_note = ? WHERE id = ?',
          [Number(r.price_diff) > 0 ? '待补款 ' + fen2yuan(r.price_diff) + '（走财务登记，未虚构到账）' : (Number(r.price_diff) < 0 ? '应退差 ' + fen2yuan(-r.price_diff) + '（走既有退款流程）' : '同价换团完成'), r.id])
        result = { status: 3 }
      })
      return result
    } catch (e) {
      // QA-02：失败登记不得覆盖已成功/已终态的状态——只有仍处于「待执行(1)」才登记失败(5)；
      // 竞态里申请已被独占为 3 时，失败登记不落（该申请实际已被并发方成功执行）
      if (e && e.code) {
        await q("UPDATE order_reschedule SET status = 5, exec_note = ? WHERE id = ? AND status = 1", [String(e.message).slice(0, 300), req.params.id])
      }
      throw e
    }
  },

  'POST /admin/reschedules/:id/cancel': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const r = await one('SELECT * FROM order_reschedule WHERE id = ?', [req.params.id])
    if (!r) throw new BizError(1004, '改期申请不存在')
    if (Number(r.status) !== 0) throw new BizError(2002, '仅待审批申请可撤回')
    if (r.applicant !== 'admin:' + a.name && a.role !== 'super') throw new BizError(1003, '仅申请人或超级管理员可撤回')
    await tx(async (c) => {
      await c.q('UPDATE order_reschedule SET status = 4 WHERE id = ? AND status = 0', [r.id])
      await audit(c, 'admin:' + a.name, 'order', 'reschedule-cancel', 'reschedule-' + r.id, { status: 0 }, { status: 4 })
    })
    return { status: 4 }
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
    // filters 收集的是"除 status 外"的条件（状态计数要与主查询共用它们）
    const { conds, filters } = await orderFiltersOf(req, a)
    const baseWhere = conds.map((c) => c.sql).join(' AND ')
    const baseArgs = conds.flatMap((c) => c.args)
    // status 支持逗号多值（如驾驶舱"已支付以上"= 20,30,40,50）；单值行为不变
    const statusList = req.query.status == null || req.query.status === '' ? [] : String(req.query.status).split(',').map(Number)
    if (statusList.some((s) => ![10, 20, 30, 40, 50, 60, 70, 90].includes(s))) throw new BizError(1001, '订单状态无效')
    const mainConds = statusList.length ? [...conds, { sql: `o.status IN (${statusList.map(() => '?').join(',')})`, args: statusList }] : conds
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
    const tickets = await q('SELECT id, ticket_no, category, status, assignee, created_at FROM aftersales_ticket WHERE order_no = ? ORDER BY id DESC LIMIT 10', [o.order_no]).catch(() => [])
    const events = await q('SELECT from_st, to_st, actor, detail, created_at FROM order_event WHERE order_id = ? ORDER BY id', [o.id])
    const passes = await q('SELECT id, name, status FROM travel_pass WHERE order_id = ?', [o.id])
    const pay = await one('SELECT wx_trans_no, status, amount, callback_at FROM payment WHERE order_id = ?', [o.id])
    const refunds = await q('SELECT refund_no, amount, fee_amount, fee_rate, days_to_depart, reason, status, operator, settled_at FROM refunds WHERE order_id = ? ORDER BY id DESC', [o.id])
    // 客服处理前先看"如果按梯度退会扣多少"，再决定按规则还是全额特批
    const quote = [20, 30].includes(Number(o.status)) ? await refund.quoteFor(o) : null
    const serviceRecords = await q("SELECT actor, action, after_val, created_at FROM audit_log WHERE module = 'order' AND biz_ref = ? AND action IN ('contact-update','service-note') ORDER BY id DESC LIMIT 30", [o.order_no])
    return { ...publicOrderPhone(o), events, passes, pay, refunds, refundQuote: quote, serviceRecords, tickets }
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
    const p = await one('SELECT rich_desc, price_from, status, title, bean_gift, supplier_id, scenic_id, updated_version FROM tour_product WHERE id = ?', [req.params.id])
    if (!p) throw new BizError(1004, '商品不存在')
    // R-01：乐观锁——前端带上打开编辑器时的版本号，期间被人改过就拒绝（2002），刷新后基于最新版本再改
    if (req.body.expectedVersion != null && Number(req.body.expectedVersion) !== Number(p.updated_version)) {
      throw new BizError(2002, '该商品刚被他人修改（当前版本 v' + p.updated_version + '），请刷新后基于最新内容再编辑')
    }
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
      rich_desc = ?, meeting_point = ?, safety_note = ?, updated_version = updated_version + 1 WHERE id = ?`,
      [title ?? null, subtitle ?? null, daysDesc ?? null, priceFrom != null ? Number(priceFrom) : null,
        beanGift != null ? Number(beanGift) : null, status ?? null, supplierId ?? null, scenicId ?? null,
        JSON.stringify(rich), meetingPoint ?? null, safetyNote ?? null, req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'product', 'update', 'product-' + req.params.id, JSON.stringify(rich), null))
    // 价格与在售状态是交易依据：改了必须留痕。链上只放指纹，金额明细留在库里
    await attestProductChange(req.params.id, { price: p.price_from, status: p.status }, { price: priceFrom, status }, 'edit')
    // R-01：关键字段（价格/状态/归属/名称/赠豆）变更入版本历史（只增不改）
    const after = { title: title ?? p.title, priceFrom: priceFrom != null ? Number(priceFrom) : p.price_from, beanGift: beanGift != null ? Number(beanGift) : p.bean_gift,
      status: status ?? p.status, supplierId: supplierId ?? p.supplier_id, scenicId: scenicId ?? p.scenic_id }
    const before = { title: p.title, priceFrom: p.price_from, beanGift: p.bean_gift, status: p.status, supplierId: p.supplier_id, scenicId: p.scenic_id }
    const changed = Object.keys(before).filter((k) => String(before[k]) !== String(after[k]))
    if (changed.length) {
      await recordMasterVersion('product', req.params.id, { before, after, changedFields: changed }, 'admin:' + a.name, req.body.versionReason)
    }
    return { updated: r.affectedRows > 0, version: Number(p.updated_version) + 1 }
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
  // R-01：版本历史查询（super/ops/finance 只读）
  'GET /admin/master-versions': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'finance'])
    const kind = String(req.query.kind || '').trim()
    const refId = Number(req.query.refId || 0)
    if (!['product', 'merchant'].includes(kind) || !refId) throw new BizError(1001, '请指定 kind（product/merchant）与 refId')
    const rows = await q('SELECT id, kind, ref_id refId, version_no versionNo, snapshot, changed_by changedBy, reason, created_at createdAt FROM master_data_version WHERE kind = ? AND ref_id = ? ORDER BY version_no DESC LIMIT 100', [kind, refId])
    return { kind, refId, rows }
  },

  // R-01 第二期：恢复历史版本 = 写一条新版本把旧值带回来（绝不 UPDATE 历史）。
  // 仅开放商品（价格/名称/赠豆/状态/归属字段白名单）；商户状态恢复走审核/停用流程，不走快照恢复。
  'POST /admin/master-versions/restore': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { kind, refId, versionNo, reason } = req.body || {}
    if (kind !== 'product') throw new BizError(1001, '当前仅支持商品版本恢复；商户状态请走审核/停用流程')
    const why = String(reason || '').trim()
    if (why.length < 4 || why.length > 200) throw new BizError(1001, '请填写 4–200 字恢复原因（进入审计与版本簿）')
    const v = await one('SELECT * FROM master_data_version WHERE kind = ? AND ref_id = ? AND version_no = ?', [kind, Number(refId), Number(versionNo)])
    if (!v) throw new BizError(1004, '版本不存在')
    const snap = typeof v.snapshot === 'string' ? JSON.parse(v.snapshot) : v.snapshot
    // 目标 = 该版本执行后的值（after）；快照是存储口径（金额=分）
    const after = snap.after || {}
    const FIELD_MAP = { price_from: 'price_from', title: 'title', bean_gift: 'bean_gift', status: 'status', supplier_id: 'supplier_id', scenic_id: 'scenic_id' }
    const sets = [], args = []
    for (const [k, col] of Object.entries(FIELD_MAP)) {
      if (after[k] == null) continue
      const val = /^\d+$/.test(String(after[k])) ? Number(after[k]) : after[k]
      sets.push(`\`${col}\` = ?`); args.push(val)
    }
    if (!sets.length) throw new BizError(1001, '该版本没有可恢复的字段值')
    const cur = await one('SELECT updated_version, price_from, status FROM tour_product WHERE id = ?', [Number(refId)])
    if (!cur) throw new BizError(1004, '商品不存在')
    await tx(async (c) => {
      await c.q(`UPDATE tour_product SET ${sets.join(', ')}, updated_version = updated_version + 1 WHERE id = ?`, [...args, Number(refId)])
      const seq = await c.one('SELECT COALESCE(MAX(version_no), 0) v FROM master_data_version WHERE kind = ? AND ref_id = ?', ['product', Number(refId)])
      await c.q('INSERT INTO master_data_version (kind, ref_id, version_no, snapshot, changed_by, reason) VALUES (?,?,?,?,?,?)',
        ['product', Number(refId), Number(seq.v) + 1,
          JSON.stringify({ before: snap.after, after: Object.fromEntries(Object.entries(snap.after).map(([k, val]) => [k, /^\d+$/.test(String(val)) ? Number(val) : val])), changedFields: Object.keys(snap.after), restoredFrom: Number(versionNo) }),
          'admin:' + a.name, '恢复自 v' + versionNo + '：' + why])
      await audit(c, 'admin:' + a.name, 'product', 'version-restore', 'product-' + refId, null, { restoredFrom: Number(versionNo), reason: why })
    })
    await attestProductChange(Number(refId), { price: cur.price_from, status: cur.status }, { price: after.price_from, status: after.status }, 'restore')
    return { restored: true, fromVersion: Number(versionNo) }
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
    const before = await one('SELECT status, price_from FROM tour_product WHERE id = ?', [req.params.id])
    await q('UPDATE tour_product SET status = ?, updated_version = updated_version + 1 WHERE id = ?', [Number(req.body.status), req.params.id])
    await attestProductChange(req.params.id, { price: before && before.price_from, status: before && before.status }, { status: req.body.status }, 'publish')
    await recordMasterVersion('product', req.params.id,
      { before: { status: before && before.status }, after: { status: Number(req.body.status) }, changedFields: ['status'] },
      'admin:' + a.name, '上下架')
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
    // R-01：乐观锁版本随详情下发，编辑器保存时带回（期间被人改过 → 2002）
    return { id: row[sc.idCol], values, completeness: entities.completeness(req.params.kind, values), version: row.updated_version != null ? Number(row.updated_version) : undefined }
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
      expectedVersion: req.body.expectedVersion, versionReason: req.body.versionReason,
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
    // D-04：本路由已迁移到模块模型（ROUTE_MODULES→risk/view），角色硬编码移除；
    // finance/risk 默认可见，其他角色经「后台账号 → 权限」额外授予后可见（正例），收回后 1003
    await requireAdmin(req)
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
  // R-05：审计日志服务端分页契约（审计表无界增长，不能只取前 100 条装作全部）
  'GET /admin/audit-logs': async (req) => {
    await requireAdmin(req, ['super', 'finance', 'risk'])
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 30)))
    const conds = [], args = [], filters = {}
    const kw = String(req.query.kw || '').trim()
    if (kw) { conds.push('(actor LIKE ? OR module LIKE ? OR action LIKE ? OR biz_ref LIKE ?)'); args.push('%' + kw + '%', '%' + kw + '%', '%' + kw + '%', '%' + kw + '%'); filters.kw = kw }
    const module_ = String(req.query.module || '').trim()
    if (module_) { conds.push('module = ?'); args.push(module_); filters.module = module_ }
    const W = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
    const total = Number((await one(`SELECT COUNT(*) n FROM audit_log ${W}`, args)).n)
    const rows = await q(`SELECT * FROM audit_log ${W} ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize])
    return { rows, total, page, pageSize, filters }
  },
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
      // U-04：导出与 /admin/orders/search 同一套筛选（状态/城市/商品/关键字/日期区间），
      // 口径一致、上限 5000 行照旧
      const of = await orderFiltersOf(req, a)
      const statusList = req.query.status == null || req.query.status === '' ? [] : String(req.query.status).split(',').map(Number)
      if (statusList.some((s) => ![10, 20, 30, 40, 50, 60, 70, 90].includes(s))) throw new BizError(1001, '订单状态无效')
      const conds = statusList.length ? [...of.conds, { sql: `o.status IN (${statusList.map(() => '?').join(',')})`, args: statusList }] : of.conds
      const W = conds.length ? 'WHERE ' + conds.map((c) => c.sql).join(' AND ') : ''
      const args = conds.flatMap((c) => c.args)
      rows = await q(`SELECT o.order_no, o.status, o.qty, o.amount_goods, o.amount_bean_ded, o.insurance_fee, o.amount_pay,
        o.city_code, o.promo_scene, o.created_at, p.title FROM orders o JOIN tour_product p ON p.id = o.product_id JOIN user_account u ON u.id = o.user_id ${W} ORDER BY o.id DESC LIMIT 5000`, args)
      name = 'orders-filtered'
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
  // R-05：约稿任务服务端分页 + 状态/关键字筛选 + 全量统计（KPI/页签用），不再 LIMIT 100 装作全部
  'GET /admin/content-tasks': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'review'])
    const cs = scopeFilter(a, 'p.city_code')
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const conds = ['1=1'], args = [...cs.params]
    if (cs.sql) conds.push(cs.sql.replace(' AND ', ''))
    const st = String(req.query.status || '').trim()
    if (st === 'open') conds.push('t.status = 1 AND (t.max_participants IS NULL OR t.max_participants > (SELECT COUNT(*) FROM content_task_entry e2 WHERE e2.task_id = t.id)) AND (t.deadline IS NULL OR t.deadline >= NOW())')
    else if (st === 'off') conds.push('t.status = 4')
    else if (st === 'review') conds.push('EXISTS (SELECT 1 FROM content_task_entry e3 WHERE e3.task_id = t.id AND e3.status = 2)')
    const kw = String(req.query.kw || '').trim()
    if (kw) { conds.push('t.title LIKE ?'); args.push('%' + kw + '%') }
    const W = 'WHERE ' + conds.join(' AND ')
    const base = `FROM content_task t LEFT JOIN tour_product p ON p.id = t.product_id ${W}`
    const total = Number((await one(`SELECT COUNT(*) n ${base}`, args)).n)
    const rows = await q(`SELECT t.*, p.title product_title, p.city_code,
        COUNT(e.id) taken, SUM(e.status = 1) doing, SUM(e.status = 2) reviewing, SUM(e.status = 3) passed, SUM(e.cash_status = 1) cash_pending,
        (SELECT COUNT(*) FROM content_task_review r WHERE r.task_id = t.id) review_count
      FROM content_task t
      LEFT JOIN content_task_entry e ON e.task_id = t.id
      LEFT JOIN tour_product p ON p.id = t.product_id
      ${W}
      GROUP BY t.id ORDER BY t.id DESC LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize])
    // 统计与合计按城市范围全量口径（不随当前状态/关键字筛选变化），KPI 卡与页签用
    const baseAll = `FROM content_task t LEFT JOIN tour_product p ON p.id = t.product_id WHERE 1=1${cs.sql}`
    const stats = {
      all: Number((await one(`SELECT COUNT(*) n ${baseAll}`, cs.params)).n),
      open: Number((await one(`SELECT COUNT(*) n ${baseAll} AND t.status = 1 AND (t.max_participants IS NULL OR t.max_participants > (SELECT COUNT(*) FROM content_task_entry e2 WHERE e2.task_id = t.id)) AND (t.deadline IS NULL OR t.deadline >= NOW())`, cs.params)).n),
      off: Number((await one(`SELECT COUNT(*) n ${baseAll} AND t.status = 4`, cs.params)).n),
      review: Number((await one(`SELECT COUNT(*) n ${baseAll} AND EXISTS (SELECT 1 FROM content_task_entry e3 WHERE e3.task_id = t.id AND e3.status = 2)`, cs.params)).n),
    }
    const sums = await one(`SELECT COALESCE(SUM(e.status = 1), 0) doing, COALESCE(SUM(e.status = 2), 0) reviewing, COALESCE(SUM(e.status = 3), 0) passed
      FROM content_task t LEFT JOIN content_task_entry e ON e.task_id = t.id LEFT JOIN tour_product p ON p.id = t.product_id WHERE 1=1${cs.sql}`, cs.params)
    return { rows, total, page, pageSize, stats, sums: { doing: Number(sums.doing), reviewing: Number(sums.reviewing), passed: Number(sums.passed) }, filters: { ...(st ? { status: st } : {}), ...(kw ? { kw } : {}) } }
  },

  // R-05 配套：单条任务（页面详情/抽屉不再拉全列表 .find）
  'GET /admin/content-tasks/:id': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'review'])
    const cs = scopeFilter(a, 'p.city_code')
    const row = await one(`SELECT t.*, p.title product_title, p.city_code,
        COUNT(e.id) taken, SUM(e.status = 1) doing, SUM(e.status = 2) reviewing, SUM(e.status = 3) passed, SUM(e.cash_status = 1) cash_pending
      FROM content_task t
      LEFT JOIN content_task_entry e ON e.task_id = t.id
      LEFT JOIN tour_product p ON p.id = t.product_id
      WHERE t.id = ?${cs.sql} GROUP BY t.id`, [req.params.id, ...cs.params])
    if (!row) throw new BizError(1004, '任务不存在或不在权限范围')
    return row
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
      // V-06：判定事务内释放认领（原语句在 return 之后不可达、且误用外层变量 c）——通过/驳回都要释放，
      // 否则作者重投后残留旧认领占坑
      await cc.q("UPDATE review_claim SET released_at = NOW(3) WHERE queue_kind = 'task_entry' AND item_id = ? AND released_at IS NULL", [e.id])
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
