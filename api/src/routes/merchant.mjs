import { q, one, count, tx, BizError } from '../db.mjs'
import { cfg, cfgAll, cfgNum, cfgArr, loadConfig } from '../config.mjs'
import { requireUser, jwtSign, code2Session, hashPassword, verifyPassword } from '../auth.mjs'
import * as order from '../domain/order.mjs'
import * as pkg from '../domain/package.mjs'
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
import { merchantRange, merchantPaging } from '../infra/merchant-range.mjs'
import { invalidateStaffRole } from '../infra/staff-role.mjs'
import { orderStatusText } from '../domain/dict.mjs'
import { recordVersion } from '../domain/master-version.mjs'
import * as notifyDomain from '../domain/notify.mjs'
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
  return { lv: cur.lv, name: cur.name, art: apiImg('/badge-art/mlevel/' + cur.lv + '.png?v=merchant-vivid-20261108', req) }
}

// M-07：团期卡「最近改价」——master_data_version（kind=session）里最近一次 price_adult 变更（谁、几点、旧→新）。
// 改价留痕由商户端改价/批量改价写入（snapshot.changedFields 含 price_adult）；PC 侧改的是商品档不写 session 版本。
async function lastPriceChanges(sessionIds, fmt) {
  const ids = [...new Set(sessionIds.map(Number).filter(Boolean))]
  if (!ids.length) return {}
  const rows = await q(`SELECT ref_id, snapshot, changed_by, created_at FROM master_data_version
    WHERE kind = 'session' AND ref_id IN (${ids.map(() => '?').join(',')})
    ORDER BY ref_id, version_no DESC`, ids)
  const hits = new Map()
  for (const r of rows) {
    if (hits.has(r.ref_id)) continue
    let snap = null
    try { snap = typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot } catch { snap = null }
    if (!snap || !(snap.changedFields || []).includes('price_adult')) continue
    hits.set(r.ref_id, { changedBy: r.changed_by, at: r.created_at, from: snap.before ? snap.before.price_adult : null, to: snap.after ? snap.after.price_adult : null })
  }
  if (!hits.size) return {}
  const uids = [...new Set([...hits.values()].map((h) => String(h.changedBy || '').split(':')[1]).filter(Boolean))]
  const names = uids.length ? new Map((await q(`SELECT id, nickname FROM user_account WHERE id IN (${uids.map(() => '?').join(',')})`, uids)).map((r) => [String(r.id), r.nickname])) : new Map()
  const out = {}
  for (const [sid, h] of hits) {
    const uid = String(h.changedBy || '').split(':')[1]
    out[sid] = { by: (uid && names.get(uid)) || '店员', at: fmt(h.at), from: h.from, to: h.to }
  }
  return out
}

const m = {
  'POST /m/auth/login': async (req) => {
    const { code, merchantId } = req.body
    const ses = await code2Session(code || 'mock-m-default', 'b')
    if (!ses.openid) throw new BizError(1002, '微信登录失败，请重试')
    const identityRows = await q('SELECT * FROM user_account WHERE mini_b_openid = ? OR (unionid IS NOT NULL AND unionid = ?) LIMIT 2', [ses.openid, ses.unionid || null])
    if (identityRows.length > 1) throw new BizError(1003, '微信身份关联冲突，请联系平台核对')
    let u = identityRows[0] || null
    if (!u) {
      await q('INSERT INTO user_account (unionid, mini_b_openid, nickname) VALUES (?,?,?)',
        [ses.unionid || null, ses.openid, '商户员工'])
      u = await one('SELECT * FROM user_account WHERE mini_b_openid = ?', [ses.openid])
    }
    if (!ses.openid) throw new BizError(1002, '微信登录失败，请重试')
    if (Number(u.status) === 0) throw new BizError(1003, '账号已被停用，请联系平台')
    if (!u.mini_b_openid) {
      // Only the provider-verified unionid may connect the two AppIDs; never trust a client UID/mobile.
      await q('UPDATE user_account SET mini_b_openid=? WHERE id=? AND mini_b_openid IS NULL', [ses.openid, u.id])
    } else if (u.mini_b_openid !== ses.openid) throw new BizError(1003, '微信身份关联冲突，请联系平台核对')
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
    const period = merchantRange(req.query, 1, 31)
    const today = await one(`SELECT COUNT(*) c, COALESCE(SUM(amount_pay),0) gmv FROM orders
      WHERE merchant_id = ? AND status IN (20,30,40,50) AND paid_at >= ? AND paid_at < DATE_ADD(?,INTERVAL 1 DAY)`, [mid,period.from,period.to])
    const pending = await count(`SELECT COUNT(*) c FROM travel_pass tp JOIN orders o ON o.id = tp.order_id
      WHERE o.merchant_id = ? AND tp.status = 1`, [mid])
    // 今日待办（B2）：口径与下钻列表一致——待接待=今日出发且待服务订单；待核销=在店凭证；
    // 临近截止=7 日内出发仍在售团期（报名窗口临近关闭）；异常待处理=退款申请中订单（status=60）
    const arrivals = u.role >= 2 ? await count(`SELECT COUNT(*) c FROM orders o JOIN tour_session s ON s.id = o.session_id
      WHERE o.merchant_id = ? AND o.status IN (20,30) AND s.depart_date = CURDATE()`, [mid]) : 0
    const closing = u.role >= 2 ? await count(`SELECT COUNT(*) c FROM tour_session s JOIN tour_product p ON p.id = s.product_id
      WHERE p.merchant_id = ? AND s.status = 1 AND s.quota > s.booked AND s.depart_date >= CURDATE() AND s.depart_date < CURDATE() + INTERVAL 7 DAY`, [mid]) : 0
    const abnormal = u.role >= 2 ? await count(`SELECT COUNT(*) c FROM orders o WHERE o.merchant_id = ? AND o.status = 60`, [mid]) : 0
    return { period, demo: process.env.NODE_ENV !== 'production' && !wxpay.isLive(), todayOrders: u.role >= 2 ? Number(today.c) : 0, todayGmv: u.role >= 2 ? fen2yuan(today.gmv) : '—', pendingVerify: pending, myVerified: await count('SELECT COUNT(*) c FROM verification_log WHERE merchant_id=? AND staff_id=? AND result=1 AND created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY)',[mid,u.uid,period.from,period.to]),
      todos: { arrivals: Number(arrivals), verify: pending, closing: Number(closing), abnormal: Number(abnormal) },
      level: await levelBrief(mid, req) }
  },

  // 经营等级与荣誉：当前等级 + 距下一级的逐项差距 + 全部等级权益 + 商户徽章墙（已获得点亮、未获得带进度）
  'GET /m/honor': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm' || !u.merchantId) throw new BizError(1003, '商户端凭证')
    const mid = u.merchantId
    const fresh = await badgeDomain.evaluateMerchantSafe(mid)
    const lvl = await merchantLevel.progress(mid)
    const art = (n, on) => apiImg('/badge-art/mlevel/' + n + '.png?v=merchant-vivid-20261108' + (on ? '' : '&state=off'), req)
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
      return { id: b.id, name: b.name, iconImg: pp.icon_img || null, art: apiImg('/badge-art/' + b.id + '.png?state=' + (got ? 'on' : 'off') + '&v=merchant-vivid-20261108', req), category: cat, categoryLabel: badgeArt.CATEGORIES[cat].label,
        series: pp.series || '', tier: Number(pp.tier) || 0, rarity: pp.rarity || 'common', rarityLabel: pp.rarity_label || '普通', color: pp.color || null,
        description: pp.description || '', ruleDesc: pp.rule_desc || '', order: Number(pp.display_order) || 0, owned: !!got, granted_at: got ? got.granted_at : null,
        progress: got ? null : badgeDomain.merchantProgressOf(b, lvl.metrics, lvl.lv), proof: ev ? { code: String(ev.payload_hash).slice(0, 8).toUpperCase(), sealed: Number(ev.status) >= 1, status: Number(ev.status), confirmed: Number(ev.status) === 2 } : null }
    }).sort((a, b) => (b.owned - a.owned) || (a.order - b.order))
    return { level: lvl, card: cardOf('merchant', lvl.lv, (lvl.levels || []).length), badges, fresh, groups: badgeArt.MERCHANT_CATEGORY_ORDER.map((k) => ({ key: k, label: badgeArt.CATEGORIES[k].label })) }
  },

  'GET /m/qrcode': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm' || !u.merchantId) throw new BizError(1003, '商户端凭证')
    if (Number(u.role) < 2) throw new BizError(1003, '需要店长及以上权限') // M-03：门店码与邀请码同为店长及以上，说明文案与此同源
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
    const range = merchantRange(req.query), paging = merchantPaging(req.query)
    // A-46：核销流水时间去毫秒
    return await q(`SELECT v.id, v.pass_id, v.result, DATE_FORMAT(v.created_at, '%Y-%m-%d %H:%i') created_at, o.order_no, p.name pass_name
      FROM verification_log v JOIN travel_pass p ON p.id = v.pass_id LEFT JOIN orders o ON o.id = p.order_id
      WHERE v.merchant_id = ? AND (? >= 2 OR v.staff_id = ?) ${range ? 'AND v.created_at >= ? AND v.created_at < DATE_ADD(?,INTERVAL 1 DAY)' : ''}
      ORDER BY v.id DESC LIMIT ? OFFSET ?`, [u.merchantId, u.role, u.uid,...(range?[range.from,range.to]:[]),paging.size,paging.offset])
  },

  'GET /m/orders': async (req) => {
    const u = requireUser(req)
    const range = merchantRange(req.query), paging = merchantPaging(req.query)
    const kw = String(req.query.kw || '').trim().slice(0,100), state = String(req.query.state || 'all')
    const states = { all:'', waiting:'AND o.status IN (20,30)', done:'AND o.status IN (40,50)', refund:'AND o.status IN (60,70)', refund_pending:'AND o.status=60' }
    if (!Object.prototype.hasOwnProperty.call(states,state)) throw new BizError(1001,'订单状态筛选无效')
    // B2 今日待办下钻：depart=出发日（YYYY-MM-DD），与工作台「待接待」口径一致
    const depart = String(req.query.depart || '').trim()
    if (depart && !/^\d{4}-\d{2}-\d{2}$/.test(depart)) throw new BizError(1001, '出发日期格式无效')
    // A-01：rebook 标记 = 免费改签单（实收 ¥0，改签成本商户承担），商户端要能一眼认出
    const rows = await q(`SELECT o.order_no, o.status, o.amount_pay, o.qty, o.paid_at, p.title, o.contact_name, s.depart_date, (o.rebook_of IS NOT NULL) AS rebook
      FROM orders o JOIN tour_product p ON p.id = o.product_id
      LEFT JOIN tour_session s ON s.id=o.session_id
      WHERE o.merchant_id = ? AND o.status >= 20 ${states[state]}
      ${range ? 'AND o.paid_at >= ? AND o.paid_at < DATE_ADD(?,INTERVAL 1 DAY)' : ''}
      ${depart ? 'AND s.depart_date = ?' : ''}
      ${kw ? 'AND (p.title LIKE ? OR o.order_no LIKE ? OR o.contact_name LIKE ?)' : ''}
      ORDER BY o.id DESC LIMIT ? OFFSET ?`, [u.merchantId,...(range?[range.from,range.to]:[]),...(depart?[depart]:[]),...(kw?['%'+kw+'%','%'+kw+'%','%'+kw+'%']:[]),paging.size,paging.offset])
    // X-01：statusText 统一由服务端字典下发（商户视角）
    return rows.map((r) => ({ ...r, rebook: !!Number(r.rebook), statusText: orderStatusText(r.status, 'm') }))
  },

  'GET /m/orders/:no': async (req) => {
    const u = requireUser(req)
    // A-46：时间列 DATE_FORMAT 去毫秒（此前 datetime(3) 直出 '2026-11-06 23:37:56.497'）
    const o = await one(`SELECT o.id,o.order_no,o.status,o.qty,o.amount_pay,o.contact_name,o.contact_phone_enc,o.contact_phone_sealed,
      DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i') created_at, DATE_FORMAT(o.paid_at, '%Y-%m-%d %H:%i') paid_at,o.rebook_of,p.title,
      DATE_FORMAT(s.depart_date, '%Y-%m-%d') depart_date, p.cat,
      COALESCE(f.discount, 0) freedom_subsidy, f.status freedom_status
      FROM orders o JOIN tour_product p ON p.id=o.product_id JOIN tour_session s ON s.id=o.session_id
      LEFT JOIN freedom_order f ON f.order_no=o.order_no AND f.merchant_id=o.merchant_id
      WHERE o.order_no=? AND o.merchant_id=?`, [req.params.no,u.merchantId])
    if (!o) throw new BizError(2003, '本店无此订单')
    // 密文优先（V38）；历史明文在旧列，加密脚本跑完后清空
    const phone = o.contact_phone_sealed ? (openMobile(o.contact_phone_sealed) || '') : (o.contact_phone_enc ? String(o.contact_phone_enc) : '')
    const passes = await q('SELECT id,status FROM travel_pass WHERE order_id=?', [o.id])
    const { contact_phone_enc, contact_phone_sealed, rebook_of, ...safe } = o
    return { ...safe, rebook: !!rebook_of, rebookOf: rebook_of || null, statusText: orderStatusText(o.status, 'm'),
      contactPhone: phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'), passes }
  },

  // ===== X-04 评价闭环：本店评价列表（按商品/评分/回复状态筛选）+ 回复（机审，平台审核后游客可见）=====
  'GET /m/reviews': async (req) => {
    const u = requireUser(req)
    const paging = merchantPaging(req.query, 20)
    const where = ['p.merchant_id = ?'], args = [u.merchantId]
    const productId = Number(req.query.productId || 0)
    if (productId) { where.push('r.product_id = ?'); args.push(productId) }
    const rating = Number(req.query.rating || 0)
    if (rating >= 1 && rating <= 5) { where.push('r.rating = ?'); args.push(rating) }
    const rs = String(req.query.replyStatus || 'all')
    if (rs === 'pending') where.push('(r.reply IS NULL OR r.reply_status = 2)')
    else if (rs === 'replied') where.push('(r.reply IS NOT NULL AND r.reply_status = 1)')
    const from = `FROM review r JOIN tour_product p ON p.id = r.product_id JOIN user_account u ON u.id = r.user_id JOIN orders o ON o.id = r.order_id`
    const W = where.join(' AND ')
    const rows = await q(`SELECT r.id, r.product_id, r.rating, r.content, r.reply, r.reply_at, r.reply_status, r.status review_status,
      DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') created_at, u.nickname, p.title product_title, o.order_no
      ${from} WHERE ${W} ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...args, paging.size, paging.offset])
    const total = await count(`SELECT COUNT(*) c ${from} WHERE ${W}`, args)
    return { items: rows, total, page: Math.floor(paging.offset / paging.size) + 1, pageSize: paging.size }
  },

  'POST /m/reviews/:id/reply': async (req) => {
    const u = requireUser(req)
    if (u.role < 2) throw new BizError(1003, '回复评价需店长及以上')
    const content = String((req.body || {}).content || '').trim()
    if (content.length < 2 || content.length > 200) throw new BizError(1001, '回复请填 2–200 字')
    const r = await one('SELECT r.id FROM review r JOIN tour_product p ON p.id = r.product_id WHERE r.id = ? AND p.merchant_id = ?', [req.params.id, u.merchantId])
    if (!r) throw new BizError(1004, '评价不存在或不属于本店')
    const sec = await wxsec.msgSecCheck(content, (await one('SELECT mini_b_openid FROM user_account WHERE id = ?', [u.uid])).mini_b_openid)
    if (!sec.pass) throw new BizError(1001, '回复含违规内容，请修改后重新提交')
    await tx(async (c) => {
      // 回复提交后进入平台审核（reply_status=0），审核通过才对游客展示
      await c.upd('UPDATE review SET reply = ?, reply_at = NOW(3), reply_status = 0 WHERE id = ?', [content.slice(0, 500), r.id])
      await audit(c, 'merchant:' + u.merchantId, 'review', 'reply', 'review-' + r.id, null, { reply: content.slice(0, 200) })
    })
    return { id: Number(r.id), replyStatus: 0, secMock: sec.mock }
  },

  'GET /m/supply': async (req) => {
    const u = requireUser(req)
    // C-02 服务端分页：paged=1 时按 page/pageSize/from/to/status/kw 返回分页对象；
    // 不带 paged 旧调用（回归测试）保持原数组形态。status: open 可售 / tight 余量紧张 / closed 截止取消
    const paged = req.query.paged === '1'
    const where = ['p.merchant_id = ?', 's.depart_date IS NOT NULL']
    const args = [u.merchantId]
    if (req.query.history !== '1' && !paged) where.push('s.depart_date >= CURDATE() - INTERVAL 7 DAY')
    if (req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)) { where.push('s.depart_date >= ?'); args.push(req.query.from) }
    if (req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) { where.push('s.depart_date <= ?'); args.push(req.query.to) }
    if (req.query.status === 'open') where.push('s.status = 1 AND s.quota > s.booked AND s.depart_date >= CURDATE()')
    else if (req.query.status === 'closed') where.push('(s.status >= 3 OR s.depart_date < CURDATE())')
    else if (req.query.status === 'tight') where.push('s.status = 1 AND s.depart_date >= CURDATE() AND (s.quota - s.booked) BETWEEN 1 AND 2')
    const kw = String(req.query.kw || '').trim().slice(0, 60)
    if (kw) { where.push('(p.title LIKE ? OR DATE_FORMAT(s.depart_date, \'%Y-%m-%d\') LIKE ?)'); args.push('%' + kw + '%', '%' + kw + '%') }
    const sql = `SELECT s.id, s.depart_date, s.quota, s.booked, s.quota - s.booked AS left_seats, s.price_adult,
      s.early_price, s.early_days, s.min_go, s.status, s.version, p.id AS product_id, p.title
      FROM tour_session s JOIN tour_product p ON p.id = s.product_id
      WHERE ${where.join(' AND ')}
      ORDER BY (s.depart_date >= CURDATE()) DESC, s.depart_date, p.id, s.id`
    if (!paged) {
      const rows = await q(sql, args)
      // M-07：非分页旧形态（回归测试）同样带最近改价
      const changes = await lastPriceChanges(rows.map((r) => r.id), (d) => String(d).slice(5, 16).replace('T', ' '))
      return rows.map((r) => ({ ...r, priceChange: changes[r.id] || null }))
    }
    const paging = merchantPaging(req.query, 60)
    const total = await count(`SELECT COUNT(*) c FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE ${where.join(' AND ')}`, args)
    const items = await q(sql + ' LIMIT ? OFFSET ?', [...args, paging.size, paging.offset])
    const changes = await lastPriceChanges(items.map((r) => r.id), (d) => String(d).slice(5, 16).replace('T', ' '))
    return { items: items.map((r) => ({ ...r, priceChange: changes[r.id] || null })), total, page: Math.floor(paging.offset / paging.size) + 1, pageSize: paging.size, hasMore: paging.offset + items.length < total }
  },

  // C-02 批量操作：ids 内逐条校验归属门店，返回实际生效条数（前端先展示影响范围再提交）
  'POST /m/supply/batch': async (req) => {
    const u = requireUser(req)
    if (u.role < 2) throw new BizError(1003, '批量调整需店长及以上')
    const { ids, action, value } = req.body || {}
    if (!Array.isArray(ids) || !ids.length || ids.length > 200) throw new BizError(1001, '请选择 1-200 个团期')
    if (!['adjust_quota', 'price', 'stop_sell'].includes(action)) throw new BizError(1001, '不支持的批量操作')
    // M-12：批量>5 条属 A+，前端强制填原因，这里留痕入审计
    const batchReason = String((req.body || {}).reason || '').trim().slice(0, 200)
    const rows = await q(`SELECT s.id, s.quota, s.booked, s.price_adult, s.early_price, s.status, s.version FROM tour_session s
      JOIN tour_product p ON p.id = s.product_id WHERE p.merchant_id = ? AND s.id IN (${ids.map(() => '?').join(',')})`, [u.merchantId, ...ids.map(Number)])
    const allowed = rows.filter((s) => Number(s.status) !== 4)
    let applied = 0
    const conflicts = []
    for (const s of allowed) {
      if (action === 'stop_sell') { await q('UPDATE tour_session SET status = 3 WHERE id = ? AND status <> 4', [s.id]); applied++ }
      else if (action === 'adjust_quota') {
        const quota = Math.floor(Number(value))
        if (!(quota >= Number(s.booked))) continue
        // X-03：批量调名额同样走乐观锁 + 版本簿，被并发改过的团期记入 conflicts
        const done = await tx(async (c) => {
          const n = await c.upd('UPDATE tour_session SET quota = ?, version = version + 1 WHERE id = ? AND version = ? AND booked <= ?', [quota, s.id, Number(s.version), quota])
          if (n !== 1) return false
          await recordVersion(c, { kind: 'session', refId: s.id,
            snapshot: { source: 'merchant', operator: 'staff:' + u.uid, changedFields: ['quota'], before: { quota: Number(s.quota) }, after: { quota } },
            changedBy: 'merchant-staff:' + u.uid, reason: batchReason ? '商户端批量调名额 · ' + batchReason : '商户端批量调名额' })
          await audit(c, 'merchant:' + u.merchantId, 'supply', 'adjust_quota', 'session-' + s.id, { quota: Number(s.quota) }, { quota })
          return true
        })
        if (done) applied++; else conflicts.push(s.id)
      } else if (action === 'price') {
        const price = Math.floor(Number(value))
        if (!(price > 0) || (Number(s.early_price) > 0 && price <= Number(s.early_price))) continue
        // X-03：批量改价同样走乐观锁 + 版本簿——并发被改过的团期记入 conflicts，不静默覆盖
        const done = await tx(async (c) => {
          const n = await c.upd('UPDATE tour_session SET price_adult = ?, version = version + 1 WHERE id = ? AND version = ?', [price, s.id, Number(s.version)])
          if (n !== 1) return false
          await recordVersion(c, { kind: 'session', refId: s.id,
            snapshot: { source: 'merchant', operator: 'staff:' + u.uid, changedFields: ['price_adult'], before: { price_adult: Number(s.price_adult) }, after: { price_adult: price } },
            changedBy: 'merchant-staff:' + u.uid, reason: batchReason ? '商户端批量改价 · ' + batchReason : '商户端批量改价' })
          await audit(c, 'merchant:' + u.merchantId, 'supply', 'price', 'session-' + s.id, { price_adult: Number(s.price_adult) }, { price_adult: price })
          return true
        })
        if (done) applied++; else conflicts.push(s.id)
      }
    }
    return { requested: ids.length, matched: allowed.length, applied, skipped: ids.length - applied, conflicts }
  },

  'POST /m/supply/:sid': async (req) => {
    const u = requireUser(req)
    if (u.role < 2) throw new BizError(1003, '需要店长及以上权限')
    const { action, value } = req.body
    // M-12：价差超 ±30% 等 A+ 情形前端强制填原因，这里留痕进版本簿与审计
    const changeReason = String((req.body || {}).reason || '').trim().slice(0, 200)
    const owned = await one('SELECT s.id, s.booked, s.quota, s.price_adult, s.early_price, s.early_days, s.version FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.id = ? AND p.merchant_id = ?', [req.params.sid, u.merchantId])
    if (!owned) throw new BizError(1004, '团期不存在或不属于本店')
    if (action === 'adjust_quota' && (!Number.isInteger(value) || value < owned.booked)) throw new BizError(1001, '名额必须为整数且不少于已报名人数')
    if (action === 'price' && (!Number.isInteger(value) || value <= 0)) throw new BizError(1001, '价格必须为正整数分')
    if (action === 'stop_sell') {
      await tx(async (c) => {
        await c.upd('UPDATE tour_session SET status = 3 WHERE id = ?', [req.params.sid])
        await audit(c, 'merchant:' + u.merchantId, 'supply', 'stop_sell', 'session-' + req.params.sid, { status: 1 }, { status: 3 })
      })
      return { stopped: true }
    }
    // A-35：停售可恢复（此前没有恢复通道，停售后永远不可卖）
    if (action === 'resume_sell') {
      await tx(async (c) => {
        await c.upd('UPDATE tour_session SET status = 1 WHERE id = ? AND status = 3', [req.params.sid])
        await audit(c, 'merchant:' + u.merchantId, 'supply', 'resume_sell', 'session-' + req.params.sid, { status: 3 }, { status: 1 })
      })
      return { resumed: true }
    }
    if (action === 'adjust_quota') {
      // X-03：调名额同样走乐观锁 + 版本簿；报名人数在调整瞬间超过新名额也按冲突处理
      const expected = req.body.expectedVersion != null ? Number(req.body.expectedVersion) : Number(owned.version)
      await tx(async (c) => {
        const n = await c.upd('UPDATE tour_session SET quota = ?, version = version + 1 WHERE id = ? AND version = ? AND booked <= ?', [value, req.params.sid, expected, value])
        if (n !== 1) throw new BizError(2002, '该团期刚被其他端修改或报名人数已变化，请刷新团期后重试')
        await recordVersion(c, { kind: 'session', refId: req.params.sid,
          snapshot: { source: 'merchant', operator: 'staff:' + u.uid, changedFields: ['quota'], before: { quota: Number(owned.quota) }, after: { quota: value } },
          changedBy: 'merchant-staff:' + u.uid, reason: changeReason ? '商户端调名额 · ' + changeReason : '商户端调名额' })
        await audit(c, 'merchant:' + u.merchantId, 'supply', 'adjust_quota', 'session-' + req.params.sid, { quota: Number(owned.quota) }, { quota: value })
      })
      return { quota: value, version: expected + 1 }
    }
    if (action === 'price') {
      // A-07：改现价同步校验——不得低于已设早鸟价，否则早鸟窗口内游客按更高价成交还显示"早鸟价"
      const s = await one('SELECT early_price, price_adult, version FROM tour_session WHERE id = ?', [req.params.sid])
      if (s && s.early_price != null && value <= Number(s.early_price))
        throw new BizError(1001, '现价需高于已设置的早鸟价 ' + fen2yuan(s.early_price) + ' 元（请先关闭早鸟或调低早鸟价）')
      // X-03：改价并发防护（乐观锁）+ 与 PC 共用同一份变更历史（master_data_version kind=session）
      const expected = req.body.expectedVersion != null ? Number(req.body.expectedVersion) : Number(s.version)
      await tx(async (c) => {
        const n = await c.upd('UPDATE tour_session SET price_adult = ?, version = version + 1 WHERE id = ? AND version = ?', [value, req.params.sid, expected])
        if (n !== 1) throw new BizError(2002, '该团期价格刚被其他端修改，请刷新团期后重试')
        await recordVersion(c, { kind: 'session', refId: req.params.sid,
          snapshot: { source: 'merchant', operator: 'staff:' + u.uid, changedFields: ['price_adult'], before: { price_adult: Number(s.price_adult) }, after: { price_adult: value } },
          changedBy: 'merchant-staff:' + u.uid, reason: changeReason ? '商户端改价 · ' + changeReason : '商户端改价' })
        await audit(c, 'merchant:' + u.merchantId, 'supply', 'price', 'session-' + req.params.sid, { price_adult: Number(s.price_adult) }, { price_adult: value })
      })
      return { price: value, version: expected + 1 }
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
      // X-03：早鸟价同样走乐观锁 + 版本簿（与改现价共用同一份变更历史）
      const expected = req.body.expectedVersion != null ? Number(req.body.expectedVersion) : Number(owned.version)
      const nextDays = price == null ? null : days
      await tx(async (c) => {
        const n = await c.upd('UPDATE tour_session SET early_price = ?, early_days = ?, version = version + 1 WHERE id = ? AND version = ?', [price, nextDays, req.params.sid, expected])
        if (n !== 1) throw new BizError(2002, '该团期刚被其他端修改，请刷新团期后重试')
        await recordVersion(c, { kind: 'session', refId: req.params.sid,
          snapshot: { source: 'merchant', operator: 'staff:' + u.uid, changedFields: ['early_price', 'early_days'],
            before: { early_price: owned.early_price == null ? null : Number(owned.early_price), early_days: owned.early_days == null ? null : Number(owned.early_days) },
            after: { early_price: price, early_days: nextDays } },
          changedBy: 'merchant-staff:' + u.uid, reason: changeReason ? '商户端设置早鸟价 · ' + changeReason : '商户端设置早鸟价' })
        await audit(c, 'merchant:' + u.merchantId, 'supply', 'set_early', 'session-' + req.params.sid, null, { earlyPrice: price, earlyDays: nextDays })
      })
      return { earlyPrice: price, earlyDays: nextDays, version: expected + 1 }
    }
    throw new BizError(1001, '未知操作')
  },

  // 商户经营数据（7 日订单/核销趋势 + 本店评分 + 最新评价）
  // A-34：全部按业务时区（bizdate）切日——此前 toISOString 取 UTC 日期，00:00–08:00 丢当天；
  //       核销数按"核销日"（verification_log.created_at）统计，此前错按支付日
  // ===== B-05：游客笔记——本店商品关联的已发布公开稿（只读）=====
  // 五种夹具口径（对齐 PR#213）：已发布公开稿可见；私密（visibility=private）、机审中(0)、人工审核(1)、驳回(3)、下架(4) 一律不出现。
  'GET /m/notes': async (req) => {
    const u = requireUser(req)
    const paging = merchantPaging(req.query, 20)
    const rows = await q(`SELECT n.id, n.title, n.like_count, n.comment_count,
      DATE_FORMAT(n.published_at, '%Y-%m-%d') published_at, u.nickname author, p.title product_title,
      COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(n.body, '$.cover')), 'null'),
        JSON_UNQUOTE(JSON_EXTRACT(n.body, CONCAT('$.images[', IFNULL(JSON_EXTRACT(n.body, '$.coverIndex'), 0), ']')))) cover,
      SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(n.body, '$.text')), 1, 90) excerpt
      FROM content_note n
      JOIN user_account u ON u.id = n.user_id
      JOIN tour_product p ON p.id = n.related_product_id
      WHERE n.status = 2 AND n.visibility = 'public' AND p.merchant_id = ?
      ORDER BY n.published_at DESC, n.id DESC LIMIT ? OFFSET ?`,
      [u.merchantId, paging.size, paging.offset])
    const total = Number((await one(`SELECT COUNT(*) c FROM content_note n JOIN tour_product p ON p.id = n.related_product_id
      WHERE n.status = 2 AND n.visibility = 'public' AND p.merchant_id = ?`, [u.merchantId])).c)
    return { items: rows.map((r) => ({ ...r, excerpt: r.excerpt || (r.title || '').slice(0, 40) })),
      total, page: Math.floor(paging.offset / paging.size) + 1, pageSize: paging.size }
  },

  // A-34：全部按业务时区（bizdate）切日——此前 toISOString 取 UTC 日期，00:00–08:00 丢当天；
  //       核销数按"核销日"（verification_log.created_at）统计，此前错按支付日
  'GET /m/stats': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '商户端凭证')
    const period = merchantRange(req.query,7,31)
    const weekRaw = await q(`SELECT DATE(paid_at) d,COUNT(*) orders FROM orders
      WHERE merchant_id=? AND paid_at>=? AND paid_at<DATE_ADD(?,INTERVAL 1 DAY) AND status IN (20,30,40,50)
      GROUP BY DATE(paid_at) ORDER BY d`,[u.merchantId,period.from,period.to])
    const verified = await q(`SELECT DATE(created_at) d,COUNT(*) n FROM verification_log
      WHERE merchant_id=? AND result=1 AND created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY)
      GROUP BY DATE(created_at)`,[u.merchantId,period.from,period.to])
    const byDay = Object.fromEntries(weekRaw.map((w) => [String(w.d), w]))
    const byVerified = Object.fromEntries(verified.map(v=>[String(v.d),Number(v.n)]))
    const week = []
    for (let i = 0; i < period.days; i++) {
      const d = new Date(Date.parse(period.from+'T00:00:00Z')+i*86400000).toISOString().slice(0,10)
      const hit = byDay[d]
      week.push({ d, orders: hit ? Number(hit.orders) : 0, verifies: byVerified[d] || 0 })
    }
    const agg = await one(`SELECT COALESCE(AVG(r.rating),0) avg, COUNT(*) count FROM review r
      JOIN orders o ON o.id = r.order_id WHERE o.merchant_id = ? AND r.status = 1`, [u.merchantId])
    const latest = await one(`SELECT r.rating, r.content, DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i') created_at, u.nickname, p.title FROM review r
      JOIN orders o ON o.id = r.order_id JOIN user_account u ON u.id = r.user_id JOIN tour_product p ON p.id = r.product_id
      WHERE o.merchant_id = ? AND r.status = 1 ORDER BY r.id DESC LIMIT 1`, [u.merchantId])
    return { period, week, rating: { avg: Math.round(Number(agg.avg) * 10) / 10, count: Number(agg.count) }, latestReview: latest || null }
  },

  'GET /m/settlements': async (req) => {    const u = requireUser(req)
    // 修复4：附调整合计（负数=应付减少）——已出账/已付款后的按项退款调整对商户可见可对账
    return await q(`SELECT s.*,
        (SELECT COALESCE(SUM(x.amount_fen),0) FROM settlement_adjustment x WHERE x.settlement_id = s.id AND x.type = 1) AS adjust_pending
      FROM settlement s WHERE s.merchant_id = ? ORDER BY s.id DESC LIMIT 12`, [u.merchantId])
  },
  'GET /m/settlements/:id': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '商户端凭证')
    const s = await one('SELECT * FROM settlement WHERE id = ? AND merchant_id = ?', [req.params.id, u.merchantId])
    if (!s) throw new BizError(1004, '结算单不存在')
    // 明细：本单包含的订单——主单挂钩（settlement_id）+ 修复4结算行挂钩（跨店提供方按订单项归属）；
    // 免费改签单不进结算，历史单如混入也带出标记
    const items = (await q(`SELECT o.order_no, o.amount_pay, o.completed_at, p.title, (o.rebook_of IS NOT NULL) AS rebook FROM orders o
      JOIN tour_product p ON p.id = o.product_id
      WHERE o.merchant_id = ? AND (o.settlement_id = ? OR EXISTS (SELECT 1 FROM settlement_line sl WHERE sl.settlement_id = ? AND sl.order_id = o.id AND sl.merchant_id = ?))
      ORDER BY o.id DESC`, [u.merchantId, req.params.id, req.params.id, u.merchantId]))
      .map((r) => ({ ...r, rebook: !!Number(r.rebook) }))
    // 修复4：本单的调整明细（已出账/已付款后的退款冲减）
    const adjustments = await q(`SELECT a.type, a.amount_fen, a.cost_fen, a.refund_no, a.reason, a.operator, a.applied_settlement_id, a.created_at, o.order_no
      FROM settlement_adjustment a LEFT JOIN orders o ON o.id = a.order_id
      WHERE a.settlement_id = ? ORDER BY a.id DESC LIMIT 50`, [req.params.id])
    return { ...s, items, adjustments }
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
    // R-04：游客端 AppID 随站点配置下发（未配置为 null，商户端「打开游客端」入口隐藏）
    const { getSecrets } = await import('../infra/secrets.mjs')
    const sec = await getSecrets(['WX_A_APPID']).catch(() => ({}))
    return { notice: v.merchant_notice || '', joinTip: v.merchant_join_tip || '', servicePhone: v.service_phone || '', serviceHours: v.service_hours || '',
      miniAAppId: sec.WX_A_APPID || process.env.WX_A_APPID || null,
      // M-03：岗位说明与真实权限同源（/m/qrcode、/m/invite 门槛都是 role>=2；/m/staff 是 role>=3）——
      // test/merchant-role-guide.mjs 按此断言，改门槛必须同步改这里，反之亦然。
      roleGuide: { 1: '核销员：到店扫码/暗号核销、查看核销记录、服务项履约。订单、库存、改价与结算不可见。',
        2: '店长：核销员全部 + 订单查看、团期改价/名额/停售、对账单查看与确认、评价回复、门店码、店员邀请码（邀请进来的默认是核销员）。',
        3: '老板：店长全部 + 店员角色管理（改岗位、停用/启用）。' } }
  },

  // X-05：商户侧订阅模板 ID（新订单/退款申请/结算待确认；未配置返回 null，前端跳过且不报错）
  'GET /m/notify/templates': async (req) => {
    requireUser(req)
    const { getSecrets } = await import('../infra/secrets.mjs')
    const s = await getSecrets(['WX_TMPL_NEW_ORDER', 'WX_TMPL_REFUND_APPLY', 'WX_TMPL_SETTLE_PENDING'])
    return { newOrder: s.WX_TMPL_NEW_ORDER || process.env.WX_TMPL_NEW_ORDER || null,
      refundApply: s.WX_TMPL_REFUND_APPLY || process.env.WX_TMPL_REFUND_APPLY || null,
      settlementPending: s.WX_TMPL_SETTLE_PENDING || process.env.WX_TMPL_SETTLE_PENDING || null }
  },

  // M-02：员工级提醒偏好（新订单/退款申请/结算待确认）。本人可改（核销员也能自行打开）；
  // 老板/店长默认开、核销员默认关由 V93 回填，notifyMerchant 发送前按此过滤。
  'GET /m/notify/prefs': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm' || !u.merchantId) throw new BizError(1003, '商户端凭证')
    const row = await one(`SELECT role, notify_new_order, notify_refund_apply, notify_settlement_pending, notify_onboarded
      FROM merchant_staff WHERE user_id = ? AND merchant_id = ?`, [u.uid, u.merchantId])
    if (!row) throw new BizError(1003, '尚未加入门店')
    // 偏好三态解析：NULL=按岗位默认（老板/店长开、核销员关）
    const eff = (v) => (v == null ? Number(row.role) >= 2 : !!Number(v))
    return { newOrder: eff(row.notify_new_order), refundApply: eff(row.notify_refund_apply),
      settlementPending: eff(row.notify_settlement_pending), onboarded: !!Number(row.notify_onboarded) }
  },

  'POST /m/notify/prefs': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm' || !u.merchantId) throw new BizError(1003, '商户端凭证')
    const b = req.body || {}
    const sets = [], args = []
    for (const [key, col] of [['newOrder', 'notify_new_order'], ['refundApply', 'notify_refund_apply'], ['settlementPending', 'notify_settlement_pending']]) {
      if (b[key] != null) { sets.push(col + ' = ?'); args.push(b[key] ? 1 : 0) }
    }
    if (b.onboarded != null) { sets.push('notify_onboarded = ?'); args.push(b.onboarded ? 1 : 0) }
    if (!sets.length) throw new BizError(1001, '没有要保存的提醒偏好')
    const n = await q(`UPDATE merchant_staff SET ${sets.join(', ')} WHERE user_id = ? AND merchant_id = ?`, [...args, u.uid, u.merchantId])
    if (n.affectedRows !== 1) throw new BizError(1004, '尚未加入门店，无法保存提醒偏好')
    return { saved: true }
  },

  // M-02/M-09：工作台 30 秒轮询的轻量接口——新支付订单（按 lastSeen 之后计）+ 待核销凭证数。
  // 不依赖微信授权，是订阅消息之外的应用内兜底提醒数据源。
  'GET /m/notify/poll': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm' || !u.merchantId) throw new BizError(1003, '商户端凭证')
    const after = Number(req.query.after || 0)
    const pendingVerify = await count(`SELECT COUNT(*) c FROM travel_pass tp JOIN orders o ON o.id = tp.order_id
      WHERE o.merchant_id = ? AND tp.status = 1`, [u.merchantId])
    const out = { pendingVerify }
    if (Number(u.role) >= 2 && after >= 0) {
      const r = await one(`SELECT COALESCE(MAX(id),0) latest, COUNT(*) n FROM orders
        WHERE merchant_id = ? AND status >= 20 AND status <= 40 AND paid_at IS NOT NULL AND id > ?`, [u.merchantId, after])
      out.latestId = Number(r.latest); out.newPaid = Number(r.n)
    }
    return out
  },

  // R-05：商户端岗位说明（mini-b「我的」角色说明卡按本人岗位高亮）
  // roleGuide 放 /m/site 响应（随站点配置下发）
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
      if (o.depart_date) {
        const vw = await pass.verifyWindowOk(o.depart_date)
        if (!vw.ok) return { ok: false, reason: vw.reason, orderNo: o.order_no }
      }
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
      if (o.depart_date && !(await pass.verifyWindowOk(o.depart_date)).ok) continue
      dated.push(o)
    }
    if (!dated.length) return { ok: false, reason: '未找到对应该暗号的在途订单（仅限出发日至结束日内的订单；请让游客出示核销码扫码核销）' }
    if (dated.length > 1) {
      return { ok: false, needConfirm: true, reason: '该暗号对应多张在途订单，请与游客核对后选择',
        candidates: dated.slice(0, 6).map((o) => ({ orderNo: o.order_no, contactName: o.contact_name || null,
          departDate: o.depart_date && String(o.depart_date).slice(0, 10), qty: Number(o.qty) })) }
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
    // A-36：带出驳回原因，小程序端"我的申请"展示驳回态
    return q('SELECT id,name,status,merchant_no,created_at,approved_at,apply_reject_note reject_note FROM merchant WHERE applicant_user_id = ? ORDER BY id DESC', [u.uid])
  },
  'GET /m/staff': async req => {
    const u = requireUser(req)
    if (u.role < 3) throw new BizError(1003, '仅老板可管理店员')
    // M-06：补加入时间（V93 回填自账号创建时间，新员工为真实加入时刻）
    return q('SELECT s.id,s.user_id,s.role,s.status,u.nickname,DATE_FORMAT(s.created_at, \'%Y-%m-%d\') joined_at FROM merchant_staff s JOIN user_account u ON u.id=s.user_id WHERE s.merchant_id=? ORDER BY s.id', [u.merchantId])
  },
  'POST /m/staff/:id': async req => {
    const u = requireUser(req)
    if (u.role < 3) throw new BizError(1003, '仅老板可管理店员')
    const role = Number(req.body.role), status = Number(req.body.status)
    if (![1,2].includes(role) || ![0,1].includes(status)) throw new BizError(1001, '店员角色或状态无效')
    const result = await q('UPDATE merchant_staff SET role=?,status=? WHERE id=? AND merchant_id=? AND role<>3 AND user_id<>?', [role,status,req.params.id,u.merchantId,u.uid])
    if (result.affectedRows !== 1) throw new BizError(1003, '不可修改老板或其他门店员工')
    // M-01：改岗/停用立即生效——失效该员工的角色缓存，同一 token 下一个请求即按新角色行事
    const target = await one('SELECT user_id FROM merchant_staff WHERE id = ? AND merchant_id = ?', [req.params.id, u.merchantId])
    if (target) invalidateStaffRole(target.user_id, u.merchantId)
    // M-06：停用员工（A+）必填原因入审计
    const reason = String((req.body || {}).reason || '').trim().slice(0, 200)
    await tx(async (c) => audit(c, 'merchant:' + u.merchantId, 'staff', 'update', 'staff-' + req.params.id, null, { role, status, by: 'staff:' + u.uid, reason: reason || null }))
    return { saved: true, roleText: ['', '核销员', '店长'][role] || '', statusText: status === 1 ? '在职' : '已停用' }
  },
  'POST /m/apply': async (req) => {
    const u = requireUser(req)
    const { name, cityCode = '310118', contact, mobile, note } = req.body
    if (!name || !contact || !/^1[3-9]\d{9}$/.test(mobile || '')) throw new BizError(1001, '请填写门店名、联系人和有效手机号')
    // A-24：字段长度统一拦截（此前超长直接触发数据库报"系统错误"）
    if (String(name).trim().length > 30) throw new BizError(1001, '门店名称最多 30 字')
    if (String(contact).trim().length > 20) throw new BizError(1001, '联系人最多 20 字')
    if (note && String(note).length > 200) throw new BizError(1001, '备注最多 200 字')
    const pending = await one('SELECT id FROM merchant WHERE applicant_user_id = ? AND status = 0', [u.uid])
    if (pending) throw new BizError(2002, '已有待审核申请，请勿重复提交')
    const mno = 'MAPPLY' + String(Date.now()).slice(-10)
    const id = await tx(async cc => cc.ins(`INSERT INTO merchant (city_code,name,merchant_no,status,apply_contact,apply_mobile_enc,apply_note,applicant_user_id)
      VALUES (?,?,?,0,?,?,?,?)`, [cityCode,name,mno,contact,sealMobile(mobile).enc,note || null,u.uid]))
    return { id, merchantNo: mno, msg: '已提交，审核通过后重新登录即可进入门店' }
  },
}

// B03 套餐分项履约：本店待办清单 + 服务项幂等核销（跨店隔离在域层校验）
export const mPkg = {
  'GET /m/items/pending': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '商户端凭证')
    return pkg.pendingItemsForStore(u.merchantId, req.query)
  },
  'POST /m/items/:id/redeem': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '商户端凭证')
    return pkg.redeemServiceItem({ itemId: req.params.id, merchantId: u.merchantId, staffId: u.uid, idemKey: req.body.idemKey, note: req.body.note })
  },
}

export { m, mSite, mPhrase, mApply }
