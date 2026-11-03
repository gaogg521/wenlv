// 主体管理：用户中心（列表 / 画像 / 冻结与风险标记）、商户全景、商品数据。
// 设计见仓库根目录《后台管理体系设计-20261102.md》：每类主体 = 列表（搜索、分群、统计）+ 360 画像（注册信息、关系、行为数据、治理操作、操作留痕）。
// 隐私：手机号、证件号、实名只下发脱敏值；城市合伙人只能看本城商户。
import * as member from '../domain/member.mjs'
import * as merchantLevel from '../domain/merchant-level.mjs'
import { q, one, tx, BizError } from '../db.mjs'
import { requireAdmin, scopeFilter, audit, apiImg } from './_shared.mjs'
import { maskMobile, maskApplyMobile, whereMobile } from '../infra/mobile.mjs'
import { partnerPerformance } from './partner-performance.mjs'
import * as bean from '../domain/bean.mjs'

const N = (v) => Number(v || 0)
const maskName = (s) => (s ? String(s).slice(0, 1) + '*'.repeat(Math.max(1, String(s).length - 1)) : '')
const PAID = '(20,30,40,50)' // 已支付且未退款的订单状态（GMV 口径）
const VALID = '(20,30,40,50,60,70)' // 产生过支付的订单（含退款中/已退款）

// 用户分群：列表筛选与统计共用同一套口径
const SEGMENTS = {
  buyer: 'COALESCE(o.cnt, 0) > 0',
  repeat: 'COALESCE(o.cnt, 0) >= 2',
  sleeping: 'COALESCE(o.cnt, 0) > 0 AND o.last_at < NOW() - INTERVAL 90 DAY',
  creator: "(u.creator_tag <> 'none' OR EXISTS (SELECT 1 FROM content_note n WHERE n.user_id = u.id))",
  promoter: 'EXISTS (SELECT 1 FROM promoter p WHERE p.user_id = u.id)',
  staff: 'EXISTS (SELECT 1 FROM merchant_staff s WHERE s.user_id = u.id AND s.status = 1)',
  kyc: 'EXISTS (SELECT 1 FROM kyc_application k WHERE k.user_id = u.id AND k.status = 1)',
  new7: 'u.created_at >= NOW() - INTERVAL 7 DAY',
  risk: 'u.risk_flag = 1',
  frozen: 'u.status = 0',
}
const ORDER_AGG = `LEFT JOIN (SELECT user_id, COUNT(*) cnt, SUM(CASE WHEN status IN ${PAID} THEN amount_pay ELSE 0 END) gmv, MAX(created_at) last_at
  FROM orders WHERE status IN ${VALID} GROUP BY user_id) o ON o.user_id = u.id`

export const people = {
  ...partnerPerformance,
  'GET /admin/content-dashboard': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'review', 'city_partner', 'readonly'])
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const page = Number(req.query.page || 1), size = 20
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new BizError(1001, '页码无效')
    const ps = scopeFilter(a, 'p.city_code'), os = scopeFilter(a, 'o.city_code')
    const from = `FROM content_note n LEFT JOIN tour_product p ON p.id=n.related_product_id WHERE 1=1${ps.sql}`
    const raw = await one(`SELECT COUNT(*) total, SUM(n.status=2) published, SUM(n.status IN (2,4)) passed,
      SUM(n.status IN (2,3,4)) reviewed, SUM(n.status IN (0,1)) pending, SUM(n.status=3) rejected,
      SUM(n.status=4) offline, COALESCE(SUM(n.like_count),0) likes,
      SUM(p.id IS NULL) unlinked ${from}`, ps.params)
    const stats = Object.fromEntries(Object.entries(raw).map(([k,v]) => [k,N(v)]))
    stats.passRate = stats.reviewed ? stats.passed / stats.reviewed : null
    const daily = await q(`SELECT DATE_FORMAT(n.published_at,'%Y-%m-%d') d, COUNT(*) n ${from}
      AND n.status IN (2,4) AND n.published_at >= CURDATE() - INTERVAL 13 DAY GROUP BY d ORDER BY d`, ps.params)
    // EXISTS 去重线路；这是关联关系下的经营数据，并非笔记点击/购买归因。
    const linked = `EXISTS (SELECT 1 FROM content_note n WHERE n.related_product_id=p.id AND n.status=2)`
    const trade = await one(`SELECT COUNT(*) orders, COALESCE(SUM(o.qty),0) travelers, COALESCE(SUM(o.amount_pay),0) gmv
      FROM orders o JOIN tour_product p ON p.id=o.product_id WHERE ${linked}${ps.sql}${os.sql} AND o.status IN ${PAID}`, [...ps.params,...os.params])
    const total = N((await one(`SELECT COUNT(*) n FROM tour_product p WHERE ${linked}${ps.sql}`,ps.params)).n)
    const products = await q(`SELECT p.id,p.title,p.city_code,p.status,
      (SELECT COUNT(*) FROM content_note n WHERE n.related_product_id=p.id AND n.status=2) notes,
      (SELECT COALESCE(SUM(n.like_count),0) FROM content_note n WHERE n.related_product_id=p.id AND n.status=2) likes,
      (SELECT COUNT(*) FROM orders o WHERE o.product_id=p.id AND o.status IN ${PAID}${os.sql}) orders,
      (SELECT COALESCE(SUM(o.amount_pay),0) FROM orders o WHERE o.product_id=p.id AND o.status IN ${PAID}${os.sql}) gmv
      FROM tour_product p WHERE ${linked}${ps.sql} ORDER BY gmv DESC,p.id DESC LIMIT ? OFFSET ?`, [...os.params,...os.params,...ps.params,size,(page-1)*size])
    const notes = await q(`SELECT n.id,n.title,n.like_count,n.published_at,p.title product_title ${from}
      AND n.status=2 ORDER BY n.like_count DESC,n.id DESC LIMIT 10`,ps.params)
    return { stats, daily, trade, products, notes, total, page, size, scopeCity: a.scopeCity || null }
  },
  'GET /admin/scenics/:id/overview': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'finance', 'city_partner', 'readonly'])
    if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
    const sc = scopeFilter(a, 's.city_code')
    const scenic = await one(`SELECT s.id, s.name, s.city_code, s.scenic_level, s.status FROM scenic_spot s WHERE s.id = ?${sc.sql}`, [req.params.id, ...sc.params])
    if (!scenic) throw new BizError(1004, '景区不存在或不在权限范围')
    const ps = scopeFilter(a, 'p.city_code'), os = scopeFilter(a, 'o.city_code'), vs = scopeFilter(a, 'v.city_code')
    // 每个指标分别聚合，避免订单、凭证、评价相互 JOIN 后产生乘积。
    const products = await q(`SELECT p.id, p.title, p.city_code, p.status,
      (SELECT COALESCE(SUM(o.qty),0) FROM orders o WHERE o.product_id=p.id AND o.status IN ${PAID}${os.sql}) sold,
      (SELECT COALESCE(SUM(o.amount_pay),0) FROM orders o WHERE o.product_id=p.id AND o.status IN ${PAID}${os.sql}) gmv,
      (SELECT COUNT(DISTINCT tp.id) FROM travel_pass tp JOIN orders o ON o.id=tp.order_id
        WHERE o.product_id=p.id AND tp.kind=1 AND EXISTS (SELECT 1 FROM verification_log v WHERE v.pass_id=tp.id AND v.result=1${vs.sql})${os.sql}) verified,
      (SELECT COUNT(*) FROM review r JOIN orders o ON o.id=r.order_id WHERE r.product_id=p.id AND r.status=1${os.sql}) reviews,
      (SELECT AVG(r.rating) FROM review r JOIN orders o ON o.id=r.order_id WHERE r.product_id=p.id AND r.status=1${os.sql}) rating,
      (SELECT COALESCE(SUM(r.rating),0) FROM review r JOIN orders o ON o.id=r.order_id WHERE r.product_id=p.id AND r.status=1${os.sql}) rating_total
      FROM tour_product p WHERE p.scenic_id=?${ps.sql} ORDER BY p.id DESC`, [...os.params, ...os.params, ...vs.params, ...os.params, ...os.params, ...os.params, ...os.params, scenic.id, ...ps.params])
    const kpi = products.reduce((s, p) => ({ sold: s.sold + N(p.sold), gmv: s.gmv + N(p.gmv), verified: s.verified + N(p.verified), reviews: s.reviews + N(p.reviews), score: s.score + N(p.rating_total) }), { sold: 0, gmv: 0, verified: 0, reviews: 0, score: 0 })
    kpi.rating = kpi.reviews ? kpi.score / kpi.reviews : null
    delete kpi.score
    const daily = await q(`SELECT DATE_FORMAT(o.created_at,'%Y-%m-%d') d, SUM(o.qty) n, SUM(o.amount_pay) gmv FROM orders o JOIN tour_product p ON p.id=o.product_id
      WHERE p.scenic_id=?${ps.sql}${os.sql} AND o.status IN ${PAID} AND o.created_at >= CURDATE() - INTERVAL 13 DAY GROUP BY d ORDER BY d`, [scenic.id, ...ps.params, ...os.params])
    return { scenic, products, kpi, daily }
  },
  // 统一主体键为 kind + id；共创人按产品合同登记，不按姓名合并。
  'GET /admin/partners': async (req) => {
    const a = await partnerAccess(req)
    const kind = String(req.query.kind || '')
    if (kind && !['city', 'promoter', 'cocreator'].includes(kind)) throw new BizError(1001, '身份类型无效')
    const kw = String(req.query.kw || '').trim()
    const page = Math.max(1, Math.floor(N(req.query.page) || 1)), size = 30
    const scope = scopeFilter(a, 'x.city_code')
    const where = `WHERE 1=1${scope.sql}${a.role === 'city_partner' ? " AND x.kind = 'city'" : ''}${kind ? ' AND x.kind = ?' : ''}${kw ? ' AND (x.name LIKE ? OR x.ref LIKE ?)' : ''}`
    const args = [...scope.params, ...(kind ? [kind] : []), ...(kw ? ['%' + kw + '%', '%' + kw + '%'] : [])]
    const counts = await q(`SELECT kind, COUNT(*) n FROM (${PARTNER_ROWS}) x ${where} GROUP BY kind`, args)
    const rows = await q(`SELECT * FROM (${PARTNER_ROWS}) x ${where} ORDER BY kind, id DESC LIMIT ? OFFSET ?`, [...args, size, (page - 1) * size])
    return { rows, counts, total: counts.reduce((s, x) => s + N(x.n), 0), page, size }
  },
  'GET /admin/partners/:kind/:id': async (req) => {
    const a = await partnerAccess(req), { kind, id } = req.params
    const scope = scopeFilter(a, 'x.city_code')
    if (a.role === 'city_partner' && kind !== 'city') throw new BizError(1003, '权限不足')
    const partner = await one(`SELECT * FROM (${PARTNER_ROWS}) x WHERE x.kind = ? AND x.id = ?${scope.sql}`, [kind, id, ...scope.params])
    if (!partner) throw new BizError(1004, '合伙人不存在或不在权限范围')
    if (kind === 'city') {
      const city = partner.city_code
      const kpi = await one(`SELECT COUNT(*) orders, COALESCE(SUM(amount_pay),0) gmv FROM orders WHERE city_code = ? AND status IN ${PAID}`, [city])
      const merchants = await one('SELECT COUNT(*) total, SUM(created_at >= NOW() - INTERVAL 30 DAY) new30 FROM merchant WHERE city_code = ?', [city])
      const daily = await q(`SELECT DATE_FORMAT(created_at,'%Y-%m-%d') d, SUM(amount_pay) gmv FROM orders WHERE city_code = ? AND status IN ${PAID} AND created_at >= CURDATE() - INTERVAL 13 DAY GROUP BY d ORDER BY d`, [city])
      return { partner, kpi, merchants, daily }
    }
    if (kind === 'promoter') {
      const p = await one('SELECT tier, rate_bp, status, valid_gmv_90d, service_score FROM promoter WHERE user_id = ?', [id])
      const hits = await one('SELECT COUNT(DISTINCT h.user_id) users FROM attribution_hit h JOIN attribution a ON a.scene = h.scene WHERE a.promoter_id = ?', [id])
      const trade = await one(`SELECT COUNT(DISTINCT o.id) orders, COUNT(DISTINCT o.user_id) buyers, COALESCE(SUM(o.amount_pay),0) gmv FROM orders o JOIN commission c ON c.order_id = o.id WHERE c.promoter_id = ? AND o.status IN ${PAID}`, [id])
      const commissions = await q('SELECT status, COUNT(*) n, SUM(amount) amount FROM commission WHERE promoter_id = ? GROUP BY status ORDER BY status', [id])
      return { partner, promoter: p, hits, trade, commissions }
    }
    const co = await one('SELECT c.role, c.invest_amount, c.share_pct, c.mobile, p.title FROM co_creator c JOIN tour_product p ON p.id = c.product_id WHERE c.id = ?', [id])
    co.mobile = maskMobile(co.mobile)
    // T01：已付以有效打款流水累计（paid_amount，含部分打款）；status=1 表示已结清
    const profits = await q('SELECT period, status, SUM(amount) amount, SUM(paid_amount) paid_amount FROM co_profit WHERE co_creator_id = ? GROUP BY period, status ORDER BY period DESC', [id])
    const paid = profits.reduce((s, x) => s + N(x.paid_amount), 0)
    return { partner, co, profits, paid, returnRate: N(co.invest_amount) > 0 ? paid / N(co.invest_amount) : null }
  },
  // ---------------- 用户中心 ----------------
  // 会员等级配置（后台各页把等级数字显示成等级名；与小程序同源）
  'GET /admin/member/levels': async (req) => { await requireAdmin(req); return await member.levels() },
  // 商户经营等级配置（后台各页把等级数字显示成等级名；与 B 端同源）
  'GET /admin/merchant/levels': async (req) => { await requireAdmin(req); return await merchantLevel.levels() },
  'GET /admin/users/stats': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'risk'])
    const seg = {}
    for (const [k, w] of Object.entries(SEGMENTS)) seg[k] = N((await one(`SELECT COUNT(*) n FROM user_account u ${ORDER_AGG} WHERE ${w}`)).n)
    const total = N((await one('SELECT COUNT(*) n FROM user_account')).n)
    const today = N((await one('SELECT COUNT(*) n FROM user_account WHERE created_at >= CURDATE()')).n)
    const signups = await q(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') d, COUNT(*) n FROM user_account
      WHERE created_at >= CURDATE() - INTERVAL 13 DAY GROUP BY d ORDER BY d`)
    const gmv = await one(`SELECT COALESCE(SUM(amount_pay), 0) gmv, COUNT(DISTINCT user_id) buyers FROM orders WHERE status IN ${PAID}`)
    const levels = await q('SELECT member_level lv, COUNT(*) n FROM user_account GROUP BY member_level ORDER BY member_level')
    return {
      total, today, segments: seg, signups, levels,
      conversion: total ? seg.buyer / total : 0, repeatRate: seg.buyer ? seg.repeat / seg.buyer : 0,
      arpu: N(gmv.buyers) ? Math.round(N(gmv.gmv) / N(gmv.buyers)) : 0,
    }
  },
  'GET /admin/users': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'risk'])
    const kw = String(req.query.kw || '').trim()
    const where = []
    const args = []
    if (req.query.seg && SEGMENTS[req.query.seg]) where.push(SEGMENTS[req.query.seg])
    if (kw) {
      if (/^\d{11}$/.test(kw)) { const w = whereMobile(kw); where.push(w.sql); args.push(...w.args) } // 客服按手机号精确查（走盲索引，不回显完整号码）
      else if (/^\d+$/.test(kw)) { where.push('u.id = ?'); args.push(Number(kw)) }
      else { where.push('u.nickname LIKE ?'); args.push('%' + kw + '%') }
    }
    const sort = { gmv: 'gmv DESC', orders: 'order_cnt DESC', last: 'o.last_at DESC', growth: 'u.growth_value DESC' }[req.query.sort] || 'u.id DESC'
    const page = Math.max(1, N(req.query.page) || 1), size = 30
    const W = where.length ? 'WHERE ' + where.join(' AND ') : ''
    const total = N((await one(`SELECT COUNT(*) n FROM user_account u ${ORDER_AGG} ${W}`, args)).n)
    const rows = await q(`SELECT u.id, u.nickname, u.avatar_url, u.member_level, u.growth_value, u.creator_tag, u.status, u.risk_flag, u.created_at,
        u.mobile_enc IS NOT NULL has_mobile, u.mini_b_openid IS NOT NULL has_b,
        COALESCE(o.cnt, 0) order_cnt, COALESCE(o.gmv, 0) gmv, o.last_at, COALESCE(ba.balance, 0) beans,
        (SELECT k.status FROM kyc_application k WHERE k.user_id = u.id ORDER BY k.id DESC LIMIT 1) kyc_status,
        EXISTS (SELECT 1 FROM promoter p WHERE p.user_id = u.id) is_promoter,
        EXISTS (SELECT 1 FROM merchant_staff s WHERE s.user_id = u.id AND s.status = 1) is_staff,
        (SELECT COUNT(*) FROM content_note n WHERE n.user_id = u.id) note_cnt
      FROM user_account u ${ORDER_AGG} LEFT JOIN bean_account ba ON ba.user_id = u.id
      ${W} ORDER BY ${sort} LIMIT ${size} OFFSET ${(page - 1) * size}`, args)
    return { total, page, size, rows: rows.map((r) => ({ ...r, avatar_url: r.avatar_url ? apiImg(r.avatar_url, req) : null })) }
  },
  'GET /admin/users/:id': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'risk', 'review'])
    const id = Number(req.params.id)
    const u = await one('SELECT * FROM user_account WHERE id = ?', [id])
    if (!u) throw new BizError(1004, '用户不存在')
    const kyc = await one('SELECT real_name, id_no_mask, status, reject_note, reviewed_at, created_at FROM kyc_application WHERE user_id = ? ORDER BY id DESC LIMIT 1', [id])
    const trade = await one(`SELECT COUNT(*) orders, SUM(status IN ${PAID}) paid, COALESCE(SUM(CASE WHEN status IN ${PAID} THEN amount_pay END), 0) gmv,
        SUM(status = 70) refunded, SUM(status = 50) completed, COALESCE(SUM(bean_deducted), 0) beans_used,
        MIN(created_at) first_at, MAX(created_at) last_at
      FROM orders WHERE user_id = ? AND status IN ${VALID}`, [id])
    const refundAmt = await one('SELECT COALESCE(SUM(r.amount), 0) amt, COALESCE(SUM(r.fee_amount), 0) fee FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.user_id = ? AND r.status = 2', [id])
    const orders = await q(`SELECT o.order_no, o.status, o.amount_pay, o.qty, o.created_at, p.title, o.city_code FROM orders o
      JOIN tour_product p ON p.id = o.product_id WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 10`, [id])
    const favCities = await q(`SELECT city_code, COUNT(*) n FROM orders WHERE user_id = ? AND status IN ${VALID} GROUP BY city_code ORDER BY n DESC LIMIT 3`, [id])
    const acct = await one('SELECT id, balance, lifetime FROM bean_account WHERE user_id = ?', [id])
    const ledger = acct ? await q('SELECT direction, amount, after_bal, biz_type, biz_ref, created_at FROM bean_ledger WHERE account_id = ? ORDER BY id DESC LIMIT 10', [acct.id]) : []
    const notes = await one('SELECT COUNT(*) total, SUM(status = 2) published, SUM(status = 3) rejected, COALESCE(SUM(like_count), 0) likes FROM content_note WHERE user_id = ?', [id])
    const recentNotes = await q('SELECT id, title, status, like_count, created_at FROM content_note WHERE user_id = ? ORDER BY id DESC LIMIT 5', [id])
    const tasks = await one(`SELECT COUNT(*) joined, SUM(status = 3) passed, SUM(status = 2) reviewing, COALESCE(SUM(reward_beans), 0) beans,
        COALESCE(SUM(CASE WHEN cash_status = 2 THEN cash_reward END), 0) cash_paid, COALESCE(SUM(CASE WHEN cash_status = 1 THEN cash_reward END), 0) cash_pending
      FROM content_task_entry WHERE user_id = ?`, [id])
    // user_badge 的时间列是 granted_at；之前写成 created_at，SQL 报错被 .catch 吞掉，后台画像从来看不到勋章。这里不再吞错
    const badges = await q('SELECT b.name, ub.granted_at AS created_at FROM user_badge ub JOIN badge b ON b.id = ub.badge_id WHERE ub.user_id = ? ORDER BY ub.granted_at DESC', [id])
    const promoter = await one('SELECT tier, rate_bp, valid_gmv_90d, service_score, status FROM promoter WHERE user_id = ?', [id])
    const commission = promoter ? await one('SELECT COUNT(*) n, COALESCE(SUM(amount), 0) amt FROM commission WHERE promoter_id = ?', [id]) : null
    const staff = await q(`SELECT m.id, m.name, s.role, s.status FROM merchant_staff s JOIN merchant m ON m.id = s.merchant_id WHERE s.user_id = ?`, [id])
    const growth = await q('SELECT delta, biz_type, after_val, created_at FROM user_growth_log WHERE user_id = ? ORDER BY id DESC LIMIT 8', [id])
    const ops = await q(`SELECT actor, action, after_val, created_at FROM audit_log WHERE biz_ref = ? ORDER BY id DESC LIMIT 10`, ['user-' + id])
    return {
      user: {
        id: u.id, nickname: u.nickname, avatar_url: u.avatar_url ? apiImg(u.avatar_url, req) : null, member_level: u.member_level, growth_value: u.growth_value,
        creator_tag: u.creator_tag, status: N(u.status), risk_flag: N(u.risk_flag), created_at: u.created_at, updated_at: u.updated_at,
        mobile: maskMobile(u.mobile_enc), bind: { miniA: !!u.mini_a_openid, miniB: !!u.mini_b_openid, unionid: !!u.unionid }, did: u.did_ref ? String(u.did_ref).slice(0, 24) + '…' : null,
      },
      kyc: kyc ? { ...kyc, real_name: maskName(kyc.real_name) } : null,
      trade: { ...trade, refund_amount: N(refundAmt.amt), refund_fee: N(refundAmt.fee), aov: N(trade.paid) ? Math.round(N(trade.gmv) / N(trade.paid)) : 0 },
      orders, favCities, beans: { balance: N(acct?.balance), lifetime: N(acct?.lifetime), ledger },
      content: { notes, recentNotes, tasks, badges }, promoter: promoter ? { ...promoter, commission } : null, staff, growth, ops,
    }
  },
  // 冻结 / 解冻：冻结后小程序端所有接口拒绝（含已登录的会话），原因必填并记审计
  'POST /admin/users/:id/status': async (req) => {
    const a = await requireAdmin(req, 'user.manage')
    const st = Number(req.body.status)
    const reason = String(req.body.reason || '').trim()
    if (![0, 1].includes(st)) throw new BizError(1001, '状态只能是正常或冻结')
    if (st === 0 && reason.length < 4) throw new BizError(1001, '冻结需要填写原因（至少 4 个字）')
    const id = await tx(async (c) => {
      const u = await c.one('SELECT id, status FROM user_account WHERE id = ? FOR UPDATE', [req.params.id])
      if (!u) throw new BizError(1004, '用户不存在')
      await c.upd('UPDATE user_account SET status = ? WHERE id = ?', [st, u.id])
      await audit(c, 'admin:' + a.name, 'user', st ? 'unfreeze' : 'freeze', 'user-' + u.id, { status: N(u.status) }, { status: st, reason: reason || null })
      return Number(u.id)
    })
    if (!st) return { status: st }
    // 解冻：补发冻结期间待补发的订单返豆。失败不影响解冻本身（订单保留待补发标记，下次解冻再补）
    try { return { status: st, beanRebatesReleased: await bean.releaseDeferredRebates(id) } }
    catch (e) { return { status: st, beanRebatesReleased: 0, beanRebateError: e.message } }
  },
  'POST /admin/users/:id/risk': async (req) => {
    const a = await requireAdmin(req, 'user.manage')
    const flag = req.body.flag ? 1 : 0
    const reason = String(req.body.reason || '').trim()
    if (flag && reason.length < 4) throw new BizError(1001, '标记风险需要填写原因（至少 4 个字）')
    return tx(async (c) => {
      const n = await c.upd('UPDATE user_account SET risk_flag = ? WHERE id = ?', [flag, req.params.id])
      if (!n) throw new BizError(1004, '用户不存在')
      await audit(c, 'admin:' + a.name, 'user', flag ? 'risk-on' : 'risk-off', 'user-' + req.params.id, null, { risk_flag: flag, reason: reason || null })
      return { risk_flag: flag }
    })
  },

  // ---------------- 商户全景 ----------------
  'GET /admin/merchants/:id/overview': async (req) => {
    const a = await requireAdmin(req)
    const m = await one('SELECT * FROM merchant WHERE id = ?', [req.params.id])
    if (!m) throw new BizError(1004, '商户不存在')
    const sc = scopeFilter(a, 'city_code')
    if (sc.params.length && String(m.city_code) !== String(sc.params[0])) throw new BizError(1003, '只能查看本城商户')
    const id = m.id
    const applicant = m.applicant_user_id ? await one('SELECT id, nickname FROM user_account WHERE id = ?', [m.applicant_user_id]) : null
    const staff = await q(`SELECT s.user_id, u.nickname, s.role, s.status FROM merchant_staff s JOIN user_account u ON u.id = s.user_id
      WHERE s.merchant_id = ? ORDER BY s.role DESC, s.id`, [id])
    const kpi = await one(`SELECT COUNT(*) orders, COALESCE(SUM(CASE WHEN status IN ${PAID} THEN amount_pay END), 0) gmv,
        SUM(status IN (40, 50)) verified, SUM(status = 70) refunded, COUNT(DISTINCT user_id) buyers,
        COALESCE(SUM(CASE WHEN status IN ${PAID} AND created_at >= NOW() - INTERVAL 30 DAY THEN amount_pay END), 0) gmv30
      FROM orders WHERE merchant_id = ? AND status IN ${VALID}`, [id])
    const repeat = N((await one(`SELECT COUNT(*) n FROM (SELECT user_id FROM orders WHERE merchant_id = ? AND status IN ${VALID} GROUP BY user_id HAVING COUNT(*) >= 2) x`, [id])).n)
    const daily = await q(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') d, COALESCE(SUM(amount_pay), 0) gmv, COUNT(*) n FROM orders
      WHERE merchant_id = ? AND status IN ${PAID} AND created_at >= CURDATE() - INTERVAL 13 DAY GROUP BY d ORDER BY d`, [id])
    const rating = await one('SELECT COUNT(*) n, AVG(r.rating) avg FROM review r JOIN tour_product p ON p.id = r.product_id WHERE p.merchant_id = ? AND r.status = 1', [id])
    const products = await q(`SELECT p.id, p.title, p.channel, p.status, p.price_from,
        (SELECT COUNT(*) FROM tour_session s WHERE s.product_id = p.id AND s.depart_date >= CURDATE()) upcoming,
        (SELECT COALESCE(SUM(qty), 0) FROM orders o WHERE o.product_id = p.id AND o.status IN ${PAID}) sold,
        (SELECT COALESCE(SUM(amount_pay), 0) FROM orders o WHERE o.product_id = p.id AND o.status IN ${PAID}) gmv,
        (SELECT AVG(rating) FROM review r WHERE r.product_id = p.id AND r.status = 1) rating
      FROM tour_product p WHERE p.merchant_id = ? ORDER BY gmv DESC, p.id DESC`, [id])
    const settle = await one(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status = 0 THEN amt_fulfill + COALESCE(fee_merchant, 0) END), 0) to_confirm,
        COALESCE(SUM(CASE WHEN status IN (1, 2) THEN amt_fulfill + COALESCE(fee_merchant, 0) END), 0) to_pay,
        COALESCE(SUM(CASE WHEN status = 3 THEN amt_fulfill + COALESCE(fee_merchant, 0) END), 0) paid, SUM(status = 4) disputed
      FROM settlement WHERE merchant_id = ?`, [id])
    const settlements = await q('SELECT id, period, status, total_amount, amt_fulfill, fee_merchant FROM settlement WHERE merchant_id = ? ORDER BY id DESC LIMIT 5', [id])
    const reviews = await q(`SELECT r.rating, r.content, r.created_at, u.nickname, p.title FROM review r JOIN tour_product p ON p.id = r.product_id
      JOIN user_account u ON u.id = r.user_id WHERE p.merchant_id = ? AND r.status = 1 ORDER BY r.id DESC LIMIT 5`, [id])
    const ops = await q('SELECT actor, action, created_at FROM audit_log WHERE biz_ref = ? ORDER BY id DESC LIMIT 8', ['merchant-' + id])
    return {
      merchant: { id, name: m.name, kind: m.kind, city_code: m.city_code, merchant_no: m.merchant_no, status: N(m.status), score: m.score,
        biz_license: m.biz_license, sub_mchid: m.wxpay_sub_mchid ? String(m.wxpay_sub_mchid).slice(0, 4) + '****' : null, invite_code: m.invite_code,
        apply_contact: m.apply_contact ? maskName(m.apply_contact) : null, apply_mobile: maskApplyMobile(m), apply_note: m.apply_note,
        approved_at: m.approved_at, created_at: m.created_at, applicant },
      kpi: { ...kpi, repeat_buyers: repeat, aov: N(kpi.orders) - N(kpi.refunded) > 0 ? Math.round(N(kpi.gmv) / (N(kpi.orders) - N(kpi.refunded))) : 0,
        refund_rate: N(kpi.orders) ? N(kpi.refunded) / N(kpi.orders) : 0, rating: rating.avg != null ? Number(rating.avg) : null, reviews: N(rating.n) },
      daily, products, staff, settle, settlements, reviews, ops,
      level: await merchantLevel.progress(id),
      badges: await q('SELECT b.name, b.icon_key, mb.granted_at FROM merchant_badge mb JOIN badge b ON b.id = mb.badge_id WHERE mb.merchant_id = ? ORDER BY mb.granted_at DESC', [id]),
    }
  },

  // ---------------- 商品 / 线路数据 ----------------
  'GET /admin/products/:id/overview': async (req) => {
    const a = await requireAdmin(req)
    const p = await one('SELECT p.id, p.title, p.channel, p.city_code, p.status, p.price_from, m.name merchant_name FROM tour_product p LEFT JOIN merchant m ON m.id = p.merchant_id WHERE p.id = ?', [req.params.id])
    if (!p) throw new BizError(1004, '商品不存在')
    if (a.scopeCity && String(a.scopeCity) !== String(p.city_code)) throw new BizError(1003, '仅可查看本城商品数据')
    const kpi = await one(`SELECT COUNT(*) orders, COALESCE(SUM(CASE WHEN status IN ${PAID} THEN qty END), 0) travelers,
        COALESCE(SUM(CASE WHEN status IN ${PAID} THEN amount_pay END), 0) gmv, SUM(status = 70) refunded, COUNT(DISTINCT user_id) buyers,
        COALESCE(SUM(bean_deducted), 0) beans_used
      FROM orders WHERE product_id = ? AND status IN ${VALID}`, [p.id])
    const sessions = await q(`SELECT id, depart_date, quota, booked, min_go, price_adult, status FROM tour_session WHERE product_id = ? ORDER BY depart_date DESC LIMIT 12`, [p.id])
    const fill = sessions.reduce((s, x) => ({ q: s.q + N(x.quota), b: s.b + N(x.booked) }), { q: 0, b: 0 })
    const rating = await one('SELECT COUNT(*) n, AVG(rating) avg FROM review WHERE product_id = ? AND status = 1', [p.id])
    const dist = await q('SELECT rating, COUNT(*) n FROM review WHERE product_id = ? AND status = 1 GROUP BY rating ORDER BY rating DESC', [p.id])
    const daily = await q(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') d, COUNT(*) n, COALESCE(SUM(amount_pay), 0) gmv FROM orders
      WHERE product_id = ? AND status IN ${PAID} AND created_at >= CURDATE() - INTERVAL 13 DAY GROUP BY d ORDER BY d`, [p.id])
    const notes = N((await one('SELECT COUNT(*) n FROM content_note WHERE related_product_id = ? AND status = 2', [p.id])).n)
    return { product: p, kpi: { ...kpi, refund_rate: N(kpi.orders) ? N(kpi.refunded) / N(kpi.orders) : 0, fill_rate: fill.q ? fill.b / fill.q : 0,
      rating: rating.avg != null ? Number(rating.avg) : null, reviews: N(rating.n), notes }, sessions, dist, daily }
  },
}

async function partnerAccess(req) {
  const a = await requireAdmin(req, ['super', 'ops', 'finance', 'city_partner'])
  // 无城市绑定的城市账号不能退化成全量权限。
  if (a.role === 'city_partner' && !a.scopeCity) throw new BizError(1003, '城市账号未绑定城市')
  return a
}
// 三个分支的字符串列来源排序规则不同（JSON_UNQUOTE 产 utf8mb4_bin、CAST AS CHAR 产连接排序规则），
// UNION 会报 Illegal mix of collations（MySQL 9 全新库必炸，此前老库是历史默认值侥幸对齐）——显式统一为 utf8mb4_unicode_ci
const PARTNER_ROWS = `SELECT 'city' kind, id, COALESCE(display_name, username) name, username ref, scope_city city_code, status FROM admin_user WHERE role = 'city_partner'
  UNION ALL SELECT 'promoter', p.user_id, (COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.profile,'$.real_name')),''),u.nickname)) COLLATE utf8mb4_unicode_ci, (CAST(p.user_id AS CHAR)) COLLATE utf8mb4_unicode_ci, NULL, p.status FROM promoter p JOIN user_account u ON u.id = p.user_id
  UNION ALL SELECT 'cocreator', c.id, c.name, c.co_no, p.city_code, c.status FROM co_creator c JOIN tour_product p ON p.id = c.product_id`
