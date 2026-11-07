import { q, one, count, tx, BizError } from '../db.mjs'
import { cfg, cfgAll, cfgNum, cfgArr, loadConfig } from '../config.mjs'
import { requireUser, jwtSign, code2Session, hashPassword, verifyPassword } from '../auth.mjs'
import * as order from '../domain/order.mjs'
import * as bean from '../domain/bean.mjs'
import * as pass from '../domain/pass.mjs'
import * as promo from '../domain/promo.mjs'
import * as refund from '../domain/refund.mjs'
import * as group from '../domain/group.mjs'
import * as wxpay from '../domain/wxpay.mjs'
import * as attestDomain from '../domain/attest.mjs'
import * as merkleLib from '../domain/merkle.mjs'
import * as refundPolicy from '../domain/refund-policy.mjs'
import { sanitizeRich } from '../infra/sanitize.mjs'
import { whereMobile, sealMobile, openMobile } from '../infra/mobile.mjs'
import { bizDay, settlementPeriod } from '../infra/bizdate.mjs'
import * as entities from '../domain/entity-schema.mjs'
import { buildSvg, svgToPdf, orderReportDoc, beanDayReportDoc, settlementReportDoc } from '../domain/report.mjs'
import * as vc from '../domain/vc.mjs'
import * as asset from '../domain/asset.mjs'
import * as badgeDomain from '../domain/badge.mjs'
import * as merchantLevel from '../domain/merchant-level.mjs'
import { cardOf } from '../domain/card-tier.mjs'
import * as badgeArt from '../domain/badge-art.mjs'
import { capabilityDoc, renderPdf as renderOnepagerPdf, renderPng as renderOnepagerPng } from '../domain/onepager.mjs'
import * as chain from '../infra/chain.mjs'
import * as wxapi from '../domain/wxapi.mjs'
import * as wxsec from '../infra/wxsec.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { fen2yuan, apiImg, toCsv, requireAdmin, scopeFilter, SUP_CATS, CREATOR_TAGS, audit, capabilityContext, publicBase, notifyMerchantStaff, handlePayNotify } from './_shared.mjs'

// ---------- /m 商户端 ----------
// 工作台 / 我的页顶部用的等级简讯（只读库里已评定的等级，不在每次打开工作台时重算）
async function levelBrief(mid, req) {
  const mr = await one("SELECT level FROM merchant WHERE id = ?", [mid]), lvs = await merchantLevel.levels()
  const cur = lvs.find((l) => l.lv === Number(mr && mr.level)) || lvs[0]
  return { lv: cur.lv, name: cur.name, art: apiImg('/badge-art/mlevel/' + cur.lv + '.png', req) }
}

const m = {
  'POST /m/auth/login': async (req) => {
    const { code, merchantId } = req.body
    const ses = await code2Session(code || 'mock-m-default', 'b')
    if (!ses.openid) throw new BizError(1002, '微信登录失败，请重试')
    let u = await one('SELECT * FROM user_account WHERE mini_b_openid = ?', [ses.openid])
    if (!u) {
      await q('INSERT INTO user_account (unionid, mini_b_openid, nickname) VALUES (?,?,?) ON DUPLICATE KEY UPDATE mini_b_openid = VALUES(mini_b_openid)',
        [ses.unionid || null, ses.openid, '商户员工'])
      u = await one('SELECT * FROM user_account WHERE mini_b_openid = ?', [ses.openid])
    }
    if (!ses.openid) throw new BizError(1002, '微信登录失败，请重试')
    if (Number(u.status) === 0) throw new BizError(1003, '账号已被停用，请联系平台')
    const staff = await one(`SELECT s.merchant_id, s.role FROM merchant_staff s JOIN merchant m ON m.id = s.merchant_id
      WHERE s.user_id = ? AND s.status = 1 AND m.status = 1 AND (? IS NULL OR s.merchant_id = ?) ORDER BY s.id LIMIT 1`, [u.id, merchantId || null, merchantId || null])
    if (!staff) {
      if (merchantId) throw new BizError(6001, '未绑定门店（先由老板在后台添加店员）')
      // P2：无参登录未绑定时发“未绑定会话”，仅供 /m/auth/join 凭邀请码加入
      return { token: jwtSign({ uid: u.id, end: 'm', merchantId: 0, role: 0 }, 2 * 3600), unbound: true }
    }
    return { token: jwtSign({ uid: u.id, end: 'm', merchantId: Number(staff.merchant_id), role: staff.role }, 7 * 24 * 3600),
      merchant: await one('SELECT id, name, merchant_no FROM merchant WHERE id = ?', [staff.merchant_id]), role: staff.role }
  },

  'GET /m/workbench': async (req) => {
    const u = requireUser(req)
    const mid = u.merchantId
    const today = await one(`SELECT COUNT(*) c, COALESCE(SUM(amount_pay),0) gmv FROM orders
      WHERE merchant_id = ? AND status IN (20,30,40,50) AND DATE(paid_at) = CURDATE()`, [mid])
    const pending = await count(`SELECT COUNT(*) c FROM travel_pass tp JOIN orders o ON o.id = tp.order_id
      WHERE o.merchant_id = ? AND tp.status = 1`, [mid])
    return { todayOrders: u.role >= 2 ? Number(today.c) : 0, todayGmv: u.role >= 2 ? fen2yuan(today.gmv) : '—', pendingVerify: pending, myVerified: await count('SELECT COUNT(*) c FROM verification_log WHERE merchant_id=? AND staff_id=? AND result=1 AND DATE(created_at)=CURDATE()',[mid,u.uid]),
      level: await levelBrief(mid, req) }
  },

  // 经营等级与荣誉：当前等级 + 距下一级的逐项差距 + 全部等级权益 + 商户徽章墙（已获得点亮、未获得带进度）
  'GET /m/honor': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm' || !u.merchantId) throw new BizError(1003, '商户端凭证')
    const mid = u.merchantId
    const fresh = await badgeDomain.evaluateMerchantSafe(mid)
    const lvl = await merchantLevel.progress(mid)
    const art = (n, on) => apiImg('/badge-art/mlevel/' + n + '.png' + (on ? '' : '?state=off'), req)
    lvl.art = art(lvl.lv, true)
    lvl.levels = lvl.levels.map((l) => ({ ...l, art: art(l.lv, l.lv <= lvl.lv) }))
    const defs = (await q('SELECT * FROM badge')).filter(badgeDomain.isMerchantBadge)
    const owned = await q('SELECT badge_id, granted_at FROM merchant_badge WHERE merchant_id = ?', [mid])
    const refs = owned.map((o) => 'mbadge-' + mid + '-' + o.badge_id)
    const evs = refs.length ? await q(`SELECT biz_ref, payload_hash, status FROM attest_event WHERE biz_type = 'badge' AND biz_ref IN (${refs.map(() => '?').join(',')})`, refs) : []
    const badges = defs.map((b) => {
      const pp = entities.publicProfile('badge', b, (x) => apiImg(x, req))
      const got = owned.find((o) => Number(o.badge_id) === Number(b.id))
      const cat = badgeArt.CATEGORIES[pp.category] ? pp.category : 'mhonor'
      const ev = got ? evs.find((e) => e.biz_ref === 'mbadge-' + mid + '-' + b.id) : null
      return { id: b.id, name: b.name, iconImg: pp.icon_img || null, art: apiImg('/badge-art/' + b.id + '.png?state=' + (got ? 'on' : 'off'), req), category: cat, categoryLabel: badgeArt.CATEGORIES[cat].label,
        series: pp.series || '', tier: Number(pp.tier) || 0, rarity: pp.rarity || 'common', rarityLabel: pp.rarity_label || '普通', color: pp.color || null,
        description: pp.description || '', ruleDesc: pp.rule_desc || '', order: Number(pp.display_order) || 0, owned: !!got, granted_at: got ? got.granted_at : null,
        progress: got ? null : badgeDomain.merchantProgressOf(b, lvl.metrics, lvl.lv), proof: ev ? { code: String(ev.payload_hash).slice(0, 8).toUpperCase(), sealed: Number(ev.status) >= 1 } : null }
    }).sort((a, b) => (b.owned - a.owned) || (a.order - b.order))
    return { level: lvl, card: cardOf('merchant', lvl.lv, (lvl.levels || []).length), badges, fresh, groups: badgeArt.MERCHANT_CATEGORY_ORDER.map((k) => ({ key: k, label: badgeArt.CATEGORIES[k].label })) }
  },

  'GET /m/qrcode': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '商户端凭证')
    const scene = 'm' + Number(u.merchantId).toString(36) // 门店码：扫码进入首页带商户归因
    const { buffer, mock } = await wxapi.getUnlimitedQRCode(scene, 'pages/home/index')
    return { scene, mock, image: buffer ? buffer.toString('base64') : null }
  },

  'POST /m/verify/scan': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '商户端凭证')
    const { payload } = req.body
    const r = await pass.verifyScan({ merchantId: u.merchantId, staffId: u.uid, payload, cityCode: '310118' })
    // 存证由 pass.verifyScan 在核销事务内完成，路由层不再重复写（避免同一事件两片叶子）
    return r
  },

  // 店员邀请码（P2）：老板/店长获取（无则生成 INV+8位）
  'GET /m/invite': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm' || u.role < 2) throw new BizError(1003, '需要店长及以上权限')
    let m = await one('SELECT invite_code FROM merchant WHERE id = ?', [u.merchantId])
    if (!m.invite_code) {
      const code = 'INV' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
      await q('UPDATE merchant SET invite_code = ? WHERE id = ? AND invite_code IS NULL', [code, u.merchantId])
      m = await one('SELECT invite_code FROM merchant WHERE id = ?', [u.merchantId])
    }
    const staff = await q(`SELECT s.role, u.nickname FROM merchant_staff s JOIN user_account u ON u.id = s.user_id
      WHERE s.merchant_id = ? AND s.status = 1`, [u.merchantId])
    return { inviteCode: m.invite_code, staff }
  },
  // 凭邀请码加入门店（P2）：先 /m/auth/login（不带 merchantId）拿到会话，再 join
  'POST /m/auth/join': async (req) => {
    const u = requireUser(req)
    const { inviteCode } = req.body
    const m = await one('SELECT id, name FROM merchant WHERE invite_code = ? AND status = 1', [String(inviteCode || '').trim()])
    if (!m) throw new BizError(1004, '邀请码无效或门店未生效')
    const exist = await one('SELECT id, role FROM merchant_staff WHERE merchant_id = ? AND user_id = ?', [m.id, u.uid])
    if (exist) {
      const active = await one('SELECT status FROM merchant_staff WHERE id = ?', [exist.id])
      if (active.status !== 1) throw new BizError(1003, '该店员已停用，请联系门店管理员')
      return { joined: true, merchantId: Number(m.id), role: Number(exist.role), alreadyBound: true }
    }
    await q('INSERT INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,1)', [m.id, u.uid])
    return { joined: true, merchantId: Number(m.id), role: 1, merchantName: m.name }
  },
  'POST /m/settlements/:id/dispute': async (req) => {
    const u = requireUser(req), note = String(req.body.note || '').trim()
    if (note.length < 4 || note.length > 200) throw new BizError(1001, '请填写 4–200 字异议说明')
    const n = await q('UPDATE settlement SET status = 4, dispute_note = ? WHERE id = ? AND merchant_id = ? AND status = 0', [note, req.params.id, u.merchantId])
    if (n.affectedRows !== 1) throw new BizError(2002, '仅待确认结算单可发起异议')
    await promo.attestSettlement(req.params.id, null, 4)
    return { status: 4 }
  },
  // 商户手机号登录（P2）：微信手机号快速验证组件 code → 手机号找用户 → 回报绑定状态
  'POST /m/auth/phone-login': async (req) => {
    const { phoneCode } = req.body
    const { phoneNumber } = await wxapi.getPhoneNumber(phoneCode || '')
    const w = whereMobile(phoneNumber)
    const u = await one(`SELECT * FROM user_account u WHERE ${w.sql}`, w.args)
    if (!u) throw new BizError(1004, '该手机号未注册，请先用微信登录')
    const staff = await one('SELECT merchant_id, role FROM merchant_staff WHERE user_id = ? AND status = 1', [u.id])
    return { linked: phoneNumber.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'),
      bound: !!staff, merchantId: staff ? Number(staff.merchant_id) : null, role: staff ? Number(staff.role) : null }
  },
  // 离线名单（§10）：断网前同步本店有效凭证 + 展示码映射；每次下发记录签发时间（A-10 防伪造 offlineAt）
  'GET /m/verify/offline-list': async (req) => {
    const u = requireUser(req)
    const list = await pass.offlineListForStore(u.merchantId)
    await q(`INSERT INTO verify_offline_sync (merchant_id, issued_at) VALUES (?, NOW(3))
      ON DUPLICATE KEY UPDATE issued_at = NOW(3)`, [u.merchantId])
    return list
  },

  // 恢复上传（二次校验）：逐条重走 verifyScan（带 offlineAt，按扫码时刻的窗口校验）；失败条目进人工队列
  'POST /m/verify/offline-batch': async (req) => {
    const u = requireUser(req)
    const { items = [] } = req.body
    const sync = await one('SELECT issued_at FROM verify_offline_sync WHERE merchant_id = ?', [u.merchantId])
    const results = []
    for (const it of items.slice(0, 200)) {
      const payload = String(it.payload || '').trim()
      if (!payload) continue
      const r = await pass.verifyScan({ merchantId: u.merchantId, staffId: u.uid, payload, cityCode: '310118', offlineAt: it.offlineAt, issuedAt: sync && sync.issued_at })
      if (!r.ok) {
        await q(`INSERT INTO verify_offline_conflict (merchant_id, pass_id, payload, offline_at, reason)
          VALUES (?,?,?,?,?)`, [u.merchantId, r.passId || null, payload.slice(0, 120), it.offlineAt ? new Date(it.offlineAt) : new Date(), r.reason])
        results.push({ payload, ok: false, reason: r.reason, conflict: true })
      } else {
        results.push({ payload, ok: true, passId: r.passId })
      }
    }
    return { uploaded: results.filter((r) => r.ok).length, conflicts: results.filter((r) => r.conflict).length, results }
  },

  'GET /m/verify/records': async (req) => {
    const u = requireUser(req)
    return await q(`SELECT v.id, v.pass_id, v.result, v.created_at, o.order_no, p.name pass_name
      FROM verification_log v JOIN travel_pass p ON p.id = v.pass_id LEFT JOIN orders o ON o.id = p.order_id
      WHERE v.merchant_id = ? AND (? >= 2 OR v.staff_id = ?) ORDER BY v.id DESC LIMIT 50`, [u.merchantId, u.role, u.uid])
  },

  'GET /m/orders': async (req) => {
    const u = requireUser(req)
    // A-01：rebook 标记 = 免费改签单（实收 ¥0，改签成本商户承担），商户端要能一眼认出
    const rows = await q(`SELECT o.order_no, o.status, o.amount_pay, o.qty, o.paid_at, p.title, o.contact_name, (o.rebook_of IS NOT NULL) AS rebook
      FROM orders o JOIN tour_product p ON p.id = o.product_id
      WHERE o.merchant_id = ? AND o.status >= 20 ORDER BY o.id DESC LIMIT 50`, [u.merchantId])
    return rows.map((r) => ({ ...r, rebook: !!Number(r.rebook) }))
  },

  'GET /m/orders/:no': async (req) => {
    const u = requireUser(req)
    const o = await one(`SELECT o.id,o.order_no,o.status,o.qty,o.amount_pay,o.contact_name,o.contact_phone_enc,o.contact_phone_sealed,o.created_at,o.paid_at,o.rebook_of,p.title,s.depart_date
      FROM orders o JOIN tour_product p ON p.id=o.product_id JOIN tour_session s ON s.id=o.session_id WHERE o.order_no=? AND o.merchant_id=?`, [req.params.no,u.merchantId])
    if (!o) throw new BizError(2003, '本店无此订单')
    // 密文优先（V38）；历史明文在旧列，加密脚本跑完后清空
    const phone = o.contact_phone_sealed ? (openMobile(o.contact_phone_sealed) || '') : (o.contact_phone_enc ? String(o.contact_phone_enc) : '')
    const passes = await q('SELECT id,status FROM travel_pass WHERE order_id=?', [o.id])
    const { contact_phone_enc, contact_phone_sealed, rebook_of, ...safe } = o
    return { ...safe, rebook: !!rebook_of, rebookOf: rebook_of || null,
      contactPhone: phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'), passes }
  },
  'GET /m/supply': async (req) => {
    const u = requireUser(req)
    return await q(`SELECT s.id, s.depart_date, s.quota, s.booked, s.quota - s.booked AS left_seats, s.price_adult,
      s.early_price, s.early_days, s.min_go, s.status, p.title
      FROM tour_session s JOIN tour_product p ON p.id = s.product_id
      WHERE p.merchant_id = ? AND s.depart_date >= CURDATE() - INTERVAL 7 DAY ORDER BY s.depart_date`, [u.merchantId])
  },

  'POST /m/supply/:sid': async (req) => {
    const u = requireUser(req)
    if (u.role < 2) throw new BizError(1003, '需要店长及以上权限')
    const { action, value } = req.body
    const owned = await one('SELECT s.id, s.booked FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.id = ? AND p.merchant_id = ?', [req.params.sid, u.merchantId])
    if (!owned) throw new BizError(1004, '团期不存在或不属于本店')
    if (action === 'adjust_quota' && (!Number.isInteger(value) || value < owned.booked)) throw new BizError(1001, '名额必须为整数且不少于已报名人数')
    if (action === 'price' && (!Number.isInteger(value) || value <= 0)) throw new BizError(1001, '价格必须为正整数分')
    if (action === 'stop_sell') { await q('UPDATE tour_session SET status = 3 WHERE id = ?', [req.params.sid]); return { stopped: true } }
    if (action === 'adjust_quota') { await q('UPDATE tour_session SET quota = ? WHERE id = ? AND quota >= booked', [value, req.params.sid]); return { quota: value } }
    if (action === 'price') {
      // A-07：改现价同步校验——不得低于已设早鸟价，否则早鸟窗口内游客按更高价成交还显示"早鸟价"
      const s = await one('SELECT early_price FROM tour_session WHERE id = ?', [req.params.sid])
      if (s && s.early_price != null && value <= Number(s.early_price))
        throw new BizError(1001, '现价需高于已设置的早鸟价 ' + fen2yuan(s.early_price) + ' 元（请先关闭早鸟或调低早鸟价）')
      await q('UPDATE tour_session SET price_adult = ? WHERE id = ?', [value, req.params.sid])
      return { price: value }
    }
    if (action === 'early') {
      // 早鸟价（旺季武器 §9 P1）：value={price, days}；price=null 关闭
      // A-07：早鸟价必须为正整数且严格低于现价（负数早鸟会造出负金额订单）；early_days 必须为非负整数
      const price = value && value.price != null ? Number(value.price) : null
      const days = value && value.days != null ? Number(value.days) : 3
      if (price != null && (!Number.isInteger(price) || price <= 0)) throw new BizError(1001, '早鸟价必须为正整数分')
      if (value && value.days != null && (!Number.isInteger(days) || days < 0)) throw new BizError(1001, '提前天数必须为非负整数')
      if (price != null && price >= (await one('SELECT price_adult FROM tour_session WHERE id = ?', [req.params.sid])).price_adult)
        throw new BizError(1001, '早鸟价需低于原价')
      await q('UPDATE tour_session SET early_price = ?, early_days = ? WHERE id = ?', [price, price == null ? null : days, req.params.sid])
      return { earlyPrice: price, earlyDays: price == null ? null : days }
    }
    throw new BizError(1001, '未知操作')
  },

  // 商户经营数据（7 日订单/核销趋势 + 本店评分 + 最新评价）
  'GET /m/stats': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '商户端凭证')
    const weekRaw = await q(`SELECT DATE(o.paid_at) d, COUNT(*) orders, COALESCE(SUM(CASE WHEN EXISTS (
      SELECT 1 FROM verification_log v JOIN travel_pass tp2 ON tp2.id = v.pass_id WHERE tp2.order_id = o.id AND v.result = 1) THEN 1 ELSE 0 END), 0) verifies
      FROM orders o WHERE o.merchant_id = ? AND o.paid_at >= NOW() - INTERVAL 7 DAY
      AND o.status IN (20,30,40,50) GROUP BY DATE(o.paid_at) ORDER BY d`, [u.merchantId])
    const byDay = Object.fromEntries(weekRaw.map((w) => [String(w.d), w]))
    const week = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
      const hit = byDay[d]
      week.push({ d, orders: hit ? Number(hit.orders) : 0, verifies: hit ? Number(hit.verifies) : 0 })
    }
    const agg = await one(`SELECT COALESCE(AVG(r.rating),0) avg, COUNT(*) count FROM review r
      JOIN orders o ON o.id = r.order_id WHERE o.merchant_id = ? AND r.status = 1`, [u.merchantId])
    const latest = await one(`SELECT r.rating, r.content, r.created_at, u.nickname, p.title FROM review r
      JOIN orders o ON o.id = r.order_id JOIN user_account u ON u.id = r.user_id JOIN tour_product p ON p.id = r.product_id
      WHERE o.merchant_id = ? AND r.status = 1 ORDER BY r.id DESC LIMIT 1`, [u.merchantId])
    return { week, rating: { avg: Math.round(Number(agg.avg) * 10) / 10, count: Number(agg.count) }, latestReview: latest || null }
  },

  'GET /m/settlements': async (req) => {    const u = requireUser(req)
    return await q('SELECT * FROM settlement WHERE merchant_id = ? ORDER BY id DESC LIMIT 12', [u.merchantId])
  },
  'GET /m/settlements/:id': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '商户端凭证')
    const s = await one('SELECT * FROM settlement WHERE id = ? AND merchant_id = ?', [req.params.id, u.merchantId])
    if (!s) throw new BizError(1004, '结算单不存在')
    // 明细：本单包含的订单（settlement_id 挂钩，对账逐单可查）；免费改签单不进结算，历史单如混入也带出标记
    const items = (await q(`SELECT o.order_no, o.amount_pay, o.completed_at, p.title, (o.rebook_of IS NOT NULL) AS rebook FROM orders o
      JOIN tour_product p ON p.id = o.product_id
      WHERE o.settlement_id = ? AND o.merchant_id = ? ORDER BY o.id DESC`, [req.params.id, u.merchantId]))
      .map((r) => ({ ...r, rebook: !!Number(r.rebook) }))
    return { ...s, items }
  },

  // 商户确认结算（0 待确认 → 1 商户已确认；财务侧复核后走 2/3）
  // 结算可信记录 PDF（T1 口径：只给「可信记录 / 校验码」，不出现存证/链字样）
  'GET /m/report/settlement/:id': async (req, res) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '商户端凭证')
    if (Number(u.role) < 2) throw new BizError(1003, '需要店长及以上权限')
    const s = await one('SELECT * FROM settlement WHERE id = ? AND merchant_id = ?', [Number(req.params.id), u.merchantId])
    if (!s) throw new BizError(1004, '结算单不存在')
    const e = await one(`SELECT e.payload_hash, e.status, e.version_no, e.leaf_path, b.merkle_root, b.seq, b.chain_tx_ref
      FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id
      WHERE e.biz_type = 'settlement' AND e.biz_ref = ? ORDER BY e.id DESC LIMIT 1`, ['settle-' + s.id])
    const doc = settlementReportDoc({
      settlementId: s.id, period: s.period, orderCount: s.order_count, totalAmount: s.total_amount,
      amtFulfill: s.amt_fulfill, amtService: s.amt_service, amtPromoter: s.amt_promoter,
      amtBeanbudget: s.amt_beanbudget, amtRetained: s.amt_retained, status: Number(s.status),
      feeCount: Number(s.fee_count || 0), feeTotal: Number(s.fee_total || 0), feeMerchant: Number(s.fee_merchant || 0), feePlatform: Number(s.fee_platform || 0),
      payloadHash: e ? e.payload_hash : null,
      merkleRoot: e ? e.merkle_root : null,
    }, publicBase(req))
    const pdf = svgToPdf(buildSvg(doc))
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="settlement-${s.id}.pdf"`,
      'Cache-Control': 'no-store',
    })
    res.end(pdf)
    return { __raw: true }
  },

  'POST /m/settlements/:id/confirm': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '商户端凭证')
    const r = await q('UPDATE settlement SET status = 1 WHERE id = ? AND merchant_id = ? AND status = 0', [req.params.id, u.merchantId])
    if (!r.affectedRows) throw new BizError(1001, '结算单不在待确认状态')
    // 商户确认即锚定（version=1）：商户事后无法否认"我没确认过这张单"
    await promo.attestSettlement(req.params.id, null, 1)
    await tx(async (c) => audit(c, 'merchant:' + u.merchantId, 'settlement', 'merchant-confirm', 'settlement-' + req.params.id, null, { note: req.body.note || '' }))
    return { confirmed: true }
  },
}

// 商户进件自助化（P2）：无 token 提交申请 → 后台审核
// ---------- 商户端：装修公告 ----------
const mSite = {
  'GET /m/site': async (req) => {
    const row = await one('SELECT * FROM site_config WHERE id = 1')
    const v = row ? entities.readValues('site', row) : {}
    return { notice: v.merchant_notice || '', joinTip: v.merchant_join_tip || '', servicePhone: v.service_phone || '', serviceHours: v.service_hours || '' }
  },
}

// ---------- 商户端：暗号核销（§4 剧本游玩法） ----------
const mPhrase = {
  // 核销员输入游客说出的暗号 → 与本店已出票订单的产品用户暗号比对；命中即核销该订单全部有效凭证。
  // A-04（全量检查 20261106）：
  //  1) 暗号是商品级的，多张在途订单同码时不再"默认核最新一单"——返回 needConfirm + 候选订单（单号/联系人/出发日），
  //     由店员与游客当面确认后带 orderNo 重提；确认前绝不下发商户对答句；
  //  2) 只匹配"当日可核销团期"（出发日 ≤ 今天 ≤ 出发日 + N，与扫码日期窗同一套 pass.verifyWindowOk）；
  //  3) 已退款/已核销/无凭证的订单一律失败，不下发对答句；
  //  4) 流水按凭证逐条记本店 merchant_id 与暗号方式（adminConfirmPass 内实现）。
  'POST /m/verify/phrase': async (req) => {
    const u = requireUser(req)
    const { phrase, orderNo } = req.body
    const said = String(phrase || '').trim()
    if (!said) throw new BizError(1001, '请输入游客说出的暗号')
    // 暗号配置来自后台「暗号管理」编辑器：上半句 + 可接受变体 + 启停日期
    const norm = (x) => String(x || '').replace(/[\s，,。.！!？?、；;：:"'“”‘’]/g, '')
    const accepts = (row) => {
      const pf = (typeof row.profile === 'string' ? JSON.parse(row.profile || '{}') : row.profile) || {}
      return [row.phrase_user, ...(pf.phrase_alts || [])].map(norm).filter(Boolean).includes(norm(said))
    }
    const windowErr = (row) => {
      const pf = (typeof row.profile === 'string' ? JSON.parse(row.profile || '{}') : row.profile) || {}
      const today = bizDay()
      if (pf.phrase_start && today < pf.phrase_start) return '该线路暗号 ' + pf.phrase_start + ' 起启用'
      if (pf.phrase_end && today > pf.phrase_end) return '该线路暗号已于 ' + pf.phrase_end + ' 停用，请改用扫码核销'
      return null
    }
    if (orderNo) {
      const o = await one(`SELECT o.id, o.order_no, o.status, o.city_code, o.rebook_of, s.depart_date,
          p.phrase_user, p.phrase_merchant, p.profile
        FROM orders o JOIN tour_product p ON p.id = o.product_id JOIN tour_session s ON s.id = o.session_id
        WHERE o.order_no = ? AND o.merchant_id = ?`, [orderNo, u.merchantId])
      if (!o || !o.phrase_user) return { ok: false, reason: '未找到对应该暗号的在途订单' }
      if (!accepts(o)) return { ok: false, reason: '暗号不对（再核对一下游客说的口令）', orderNo: o.order_no }
      const werr = windowErr(o)
      if (werr) return { ok: false, reason: werr, orderNo: o.order_no }
      if (![20, 30].includes(Number(o.status)))
        return { ok: false, reason: Number(o.status) === 40 || Number(o.status) === 50 ? '该订单已核销过（重复核销）' : '该订单已退款或已关闭，不可核销', orderNo: o.order_no }
      const vw = await pass.verifyWindowOk(o.depart_date)
      if (!vw.ok) return { ok: false, reason: vw.reason, orderNo: o.order_no }
      const ids = (await q('SELECT id FROM travel_pass WHERE order_id = ? AND status = 1', [o.id])).map((r) => r.id)
      if (!ids.length) return { ok: false, reason: '该订单没有可核销的凭证（可能已核销或已退款）', orderNo: o.order_no }
      for (const pid of ids) {
        // 暗号核销不是窗口码：way=phrase 作后缀区分事件来源，流水+存证由 adminConfirmPass 在同一事务里写
        await pass.adminConfirmPass(pid, u.uid, 'phrase')
      }
      return { ok: true, reason: '暗号对上了 · 已核销 ' + ids.length + ' 张凭证', orderNo: o.order_no, verified: ids.length,
        counterPhrase: o.phrase_merchant || null }
    }
    // 未带订单号：在本店"当日可核销"的已出票订单里找暗号命中者
    const cands = (await q(`SELECT o.id, o.order_no, o.contact_name, o.qty, o.city_code, s.depart_date,
        p.phrase_user, p.phrase_merchant, p.profile
      FROM orders o JOIN tour_product p ON p.id = o.product_id JOIN tour_session s ON s.id = o.session_id
      WHERE o.merchant_id = ? AND p.phrase_user IS NOT NULL AND o.status IN (20,30) ORDER BY o.id DESC LIMIT 200`,
      [u.merchantId])).filter((o) => accepts(o))
    const dated = []
    for (const o of cands) {
      if (!(await pass.verifyWindowOk(o.depart_date)).ok) continue
      dated.push(o)
    }
    if (!dated.length) return { ok: false, reason: '未找到对应该暗号的在途订单（仅限出发日至结束日内的订单；请让游客出示核销码扫码核销）' }
    if (dated.length > 1) {
      return { ok: false, needConfirm: true, reason: '该暗号对应多张在途订单，请与游客核对后选择',
        candidates: dated.slice(0, 6).map((o) => ({ orderNo: o.order_no, contactName: o.contact_name || null,
          departDate: String(o.depart_date).slice(0, 10), qty: Number(o.qty) })) }
    }
    const o = dated[0]
    const werr = windowErr(o)
    if (werr) return { ok: false, reason: werr, orderNo: o.order_no }
    const ids = (await q('SELECT id FROM travel_pass WHERE order_id = ? AND status = 1', [o.id])).map((r) => r.id)
    if (!ids.length) return { ok: false, reason: '该订单没有可核销的凭证（可能已核销或已退款）', orderNo: o.order_no }
    for (const pid of ids) await pass.adminConfirmPass(pid, u.uid, 'phrase')
    return { ok: true, reason: '暗号对上了 · 已核销 ' + ids.length + ' 张凭证', orderNo: o.order_no, verified: ids.length,
      counterPhrase: o.phrase_merchant || null }
  },
}

const mApply = {
  'GET /m/applications': async req => {
    const u = requireUser(req)
    return q('SELECT id,name,status,merchant_no,created_at,approved_at FROM merchant WHERE applicant_user_id = ? ORDER BY id DESC', [u.uid])
  },
  'GET /m/staff': async req => {
    const u = requireUser(req)
    if (u.role < 3) throw new BizError(1003, '仅老板可管理店员')
    return q('SELECT s.id,s.user_id,s.role,s.status,u.nickname FROM merchant_staff s JOIN user_account u ON u.id=s.user_id WHERE s.merchant_id=? ORDER BY s.id', [u.merchantId])
  },
  'POST /m/staff/:id': async req => {
    const u = requireUser(req)
    if (u.role < 3) throw new BizError(1003, '仅老板可管理店员')
    const role = Number(req.body.role), status = Number(req.body.status)
    if (![1,2].includes(role) || ![0,1].includes(status)) throw new BizError(1001, '店员角色或状态无效')
    const result = await q('UPDATE merchant_staff SET role=?,status=? WHERE id=? AND merchant_id=? AND role<>3 AND user_id<>?', [role,status,req.params.id,u.merchantId,u.uid])
    if (result.affectedRows !== 1) throw new BizError(1003, '不可修改老板或其他门店员工')
    return { saved: true }
  },
  'POST /m/apply': async (req) => {
    const u = requireUser(req)
    const { name, cityCode = '310118', contact, mobile, note } = req.body
    if (!name || !contact || !/^1[3-9]\d{9}$/.test(mobile || '')) throw new BizError(1001, '请填写门店名、联系人和有效手机号')
    const pending = await one('SELECT id FROM merchant WHERE applicant_user_id = ? AND status = 0', [u.uid])
    if (pending) throw new BizError(2002, '已有待审核申请，请勿重复提交')
    const mno = 'MAPPLY' + String(Date.now()).slice(-10)
    const id = await tx(async cc => cc.ins(`INSERT INTO merchant (city_code,name,merchant_no,status,apply_contact,apply_mobile_enc,apply_note,applicant_user_id)
      VALUES (?,?,?,0,?,?,?,?)`, [cityCode,name,mno,contact,sealMobile(mobile).enc,note || null,u.uid]))
    return { id, merchantNo: mno, msg: '已提交，审核通过后重新登录即可进入门店' }
  },
}

export { m, mSite, mPhrase, mApply }
