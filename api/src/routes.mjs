// 路由层：/c 游客端 · /m 商户端 · /admin 运营后台 · /callback/wxpay 支付回调
import { q, one, count, tx, BizError } from './db.mjs'
import { cfgAll, cfgNum, loadConfig } from './config.mjs'
import { requireUser, jwtSign, code2Session, hashPassword, verifyPassword } from './auth.mjs'
import * as order from './domain/order.mjs'
import * as bean from './domain/bean.mjs'
import * as pass from './domain/pass.mjs'
import * as promo from './domain/promo.mjs'
import * as wxpay from './domain/wxpay.mjs'
import * as wxapi from './domain/wxapi.mjs'
import * as wxsec from './infra/wxsec.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const fen2yuan = (f) => (Number(f) / 100).toFixed(2)

// ---------- /c 游客端 ----------
const c = {
  'POST /c/auth/login': async (req) => {
    const { code } = req.body
    const ses = await code2Session(code || 'mock-default')
    if (!ses.openid) throw new BizError(1001, 'code2Session 失败: ' + JSON.stringify(ses))
    let u = await one('SELECT * FROM user_account WHERE mini_a_openid = ? OR (unionid IS NOT NULL AND unionid = ?)', [ses.openid, ses.unionid])
    if (!u) {
      const uid = await tx(async (cc) => {
        const id = await cc.ins('INSERT INTO user_account (unionid, mini_a_openid, nickname) VALUES (?,?,?)',
          [ses.unionid || null, ses.openid, '旅友' + Math.floor(Math.random() * 1e6)])
        await cc.ins('INSERT INTO bean_account (user_id) VALUES (?)', [id])
        return id
      })
      u = await one('SELECT * FROM user_account WHERE id = ?', [uid])
    }
    return { token: jwtSign({ uid: u.id, end: 'c' }, 7 * 24 * 3600), user: { id: u.id, nickname: u.nickname, memberLevel: u.member_level, growth: u.growth_value } }
  },

  'POST /c/auth/phone': async (req) => {
    const u = requireUser(req)
    // 微信官方「手机号快速验证组件」：前端 button open-type=getPhoneNumber → code → 服务端换号
    const { phoneNumber, mock } = await wxapi.getPhoneNumber(req.body.code || '')
    await tx(async (cc) => cc.upd('UPDATE user_account SET mobile_enc = ? WHERE id = ?', [Buffer.from(phoneNumber, 'utf8'), u.uid]))
    return { phone: phoneNumber.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'), mock }
  },

  'GET /c/notify/templates': async (req) => {
    requireUser(req)
    const { getSecrets } = await import('./infra/secrets.mjs')
    const s = await getSecrets(['WX_TMPL_PAY_OK'])
    return { payOk: s.WX_TMPL_PAY_OK || process.env.WX_TMPL_PAY_OK || null }
  },

  'GET /c/home': async () => ({
    banners: [{ title: '朱家角剧本游 · 江南谜案', tag: '实景搜证·多结局' }],
    cats: (await cfgAll())['channel.initial'],
    groups: await q(`SELECT s.id session_id, p.id product_id, p.title, p.days_desc, s.depart_date, s.quota - s.booked AS left_seats
      FROM tour_session s JOIN tour_product p ON p.id = s.product_id
      WHERE s.status = 1 AND s.depart_date >= CURDATE() ORDER BY s.depart_date LIMIT 6`),
    hot: await q(`SELECT p.id, p.title, p.subtitle, p.price_from, p.bean_gift, p.city_code, p.cat, p.days_desc
      FROM tour_product p WHERE p.status = 1 ORDER BY p.id LIMIT 10`),
  }),

  'GET /c/tours': async (req) => {
    const { cat = 'all', kw = '' } = req.query
    const rows = await q(`SELECT p.id, p.title, p.subtitle, p.price_from, p.bean_gift, p.city_code, p.cat, p.days_desc, p.images, p.days_desc days
      FROM tour_product p WHERE p.status = 1 ${cat !== 'all' ? 'AND p.cat = ?' : ''} ${kw ? 'AND p.title LIKE ?' : ''} ORDER BY p.id`,
      [...(cat !== 'all' ? [cat] : []), ...(kw ? ['%' + kw + '%'] : [])])
    return rows.map(r => ({ ...r, price: Number(r.price_from), priceLabel: fen2yuan(r.price_from) }))
  },

  'GET /c/tours/:id': async (req) => {
    const p = await one(`SELECT p.*, m.name merchant_name FROM tour_product p JOIN merchant m ON m.id = p.merchant_id WHERE p.id = ?`, [req.params.id])
    if (!p) throw new BizError(1004, '商品不存在')
    const sessions = await q(`SELECT id, depart_date, quota, quota - booked AS left_seats, price_adult, status
      FROM tour_session WHERE product_id = ? AND depart_date >= CURDATE() ORDER BY depart_date`, [p.id])
    const agg = await one(`SELECT COALESCE(AVG(rating),0) avg_rating, COUNT(*) count FROM review WHERE product_id = ? AND status = 1`, [p.id])
    return { ...p, priceLabel: fen2yuan(p.price_from), sessions: sessions.map(s => ({ ...s, priceLabel: fen2yuan(s.price_adult) })),
      rating: { avg: Math.round(Number(agg.avg_rating) * 10) / 10, count: Number(agg.count) } }
  },

  // 评价列表（公开；仅展示态）
  'GET /c/tours/:id/reviews': async (req) => {
    const rows = await q(`SELECT r.rating, r.content, r.created_at, u.nickname
      FROM review r JOIN user_account u ON u.id = r.user_id
      WHERE r.product_id = ? AND r.status = 1 ORDER BY r.id DESC LIMIT 20`, [req.params.id])
    const agg = await one(`SELECT COALESCE(AVG(rating),0) avg_rating, COUNT(*) count FROM review WHERE product_id = ? AND status = 1`, [req.params.id])
    return { avg: Math.round(Number(agg.avg_rating) * 10) / 10, count: Number(agg.count), list: rows }
  },

  // 写评价：仅核销完成（50）订单 · 一单一评 · 文本机审
  'POST /c/orders/:no/review': async (req) => {
    const u = requireUser(req)
    const o = await order.byNo(req.params.no)
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    if (o.status !== 50) throw new BizError(2002, '核销完成后才能评价')
    if (await one('SELECT id FROM review WHERE order_id = ?', [o.id])) throw new BizError(1001, '该订单已评价')
    const { rating = 5, content } = req.body || {}
    const rate = Math.max(1, Math.min(5, Number(rating) || 5))
    const text = String(content || '').trim()
    if (text.length < 4) throw new BizError(1001, '评价至少 4 个字')
    const sec = await wxsec.msgSecCheck(text.slice(0, 500), (await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [u.uid])).mini_a_openid)
    if (!sec.pass) throw new BizError(1001, '评价含违规内容')
    const id = await tx(async (c) => c.ins('INSERT INTO review (order_id, user_id, product_id, rating, content) VALUES (?,?,?,?,?)',
      [o.id, u.uid, o.product_id, rate, text.slice(0, 500)]))
    return { id, rating: rate, secMock: sec.mock }
  },

  'POST /c/orders': async (req) => {
    const u = requireUser(req)
    const { sessionId, qty = 1, beanDeduct = 0, promoScene, contactName, contactPhone } = req.body
    const r = await order.place({
      userId: u.uid, sessionId, qty, wantedBeans: beanDeduct, promoScene,
      beanHook: { deduct: (uid, beans, orderNo) => bean.deduct(uid, beans, bean.BIZ.DEDUCT, orderNo) },
    })
    await tx(async (cc) => {
      await cc.upd('UPDATE orders SET contact_name = ?, contact_phone_enc = ? WHERE order_no = ?',
        [contactName || null, contactPhone || null, r.orderNo])
    })
    // 归因命中（首触）
    if (promoScene) await promo.hit(promoScene, u.uid)
    // 支付参数（真实 V3 / MOCK）
    const o = await order.byNo(r.orderNo)
    const pay = await wxpay.jsapiOrder({
      orderNo: r.orderNo, amountFen: Number(o.amount_pay),
      openid: (await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [u.uid])).mini_a_openid,
      description: '向往的自由·主题游',
    })
    return { orderNo: r.orderNo, amountPay: r.amountPay, amountPayLabel: fen2yuan(r.amountPay), beanDeducted: r.beanDeducted, payParams: pay }
  },

  'POST /c/orders/:no/pay-params': async (req) => {
    const u = requireUser(req)
    const o = await order.byNo(req.params.no)
    if (!o || o.user_id !== BigInt(u.uid)) throw new BizError(2003, '订单不存在')
    if (o.status !== 10) throw new BizError(2002, '订单不在待支付状态')
    const pay = await wxpay.jsapiOrder({
      orderNo: o.order_no, amountFen: Number(o.amount_pay),
      openid: (await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [u.uid])).mini_a_openid,
      description: '向往的自由·主题游',
    })
    return { payParams: pay }
  },

  'GET /c/orders': async (req) => requireUser(req) && await q(
    `SELECT o.order_no, o.status, o.amount_pay, o.qty, o.created_at, p.title, p.days_desc
     FROM orders o JOIN tour_product p ON p.id = o.product_id WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 50`, [requireUser(req).uid]),

  'GET /c/orders/:no': async (req) => {
    const u = requireUser(req)
    const o = await one(`SELECT o.*, p.title, p.days_desc, p.city_code FROM orders o JOIN tour_product p ON p.id = o.product_id WHERE o.order_no = ?`, [req.params.no])
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    const passes = await q('SELECT id, name, status FROM travel_pass WHERE order_id = ?', [o.id])
    const events = await q('SELECT from_st, to_st, actor, detail, created_at FROM order_event WHERE order_id = ? ORDER BY id', [o.id])
    const reviewed = !!(await one('SELECT id FROM review WHERE order_id = ?', [o.id]))
    return { ...o, amountPayLabel: fen2yuan(o.amount_pay), passes, events, reviewed }
  },

  'GET /c/pass/:id/code': async (req) => {
    requireUser(req)
    const p = await one('SELECT * FROM travel_pass WHERE id = ?', [req.params.id])
    if (!p) throw new BizError(4001, '凭证不存在')
    return await pass.currentQr(Number(req.params.id))
  },

  'GET /c/bean/account': async (req) => {
    requireUser(req)
    const bal = await bean.balance(requireUser(req).uid)
    return { balance: bal, rule: '消费返豆 10% · 100 豆≈10 元 · 单笔抵扣上限 10% · 滚动 12 个月有效 · 不可转账不可购买' }
  },

  'GET /c/bean/ledger': async (req) => {
    const u = requireUser(req)
    const rows = await q(`SELECT l.tx_no, l.direction, l.amount, l.biz_type, l.biz_ref, l.created_at
      FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id = ? ORDER BY l.id DESC LIMIT 50`, [u.uid])
    return rows
  },

  'GET /c/me': async (req) => {
    const u = requireUser(req)
    const acc = await one('SELECT * FROM user_account WHERE id = ?', [u.uid])
    return {
      id: acc.id, nickname: acc.nickname, avatarUrl: acc.avatar_url, memberLevel: acc.member_level, growth: acc.growth_value,
      bean: await bean.balance(u.uid),
      passes: await count('SELECT COUNT(*) c FROM travel_pass WHERE user_id = ?', [u.uid]),
    }
  },

  // 头像昵称填写能力（官方组件）：昵称过机审；头像走 base64 上传
  'POST /c/me/profile': async (req) => {
    const u = requireUser(req)
    const { nickname, avatarUrl } = req.body || {}
    let sec = null
    if (nickname !== undefined) {
      if (String(nickname).trim().length < 2) throw new BizError(1001, '昵称至少 2 个字符')
      sec = await wxsec.msgSecCheck(String(nickname).slice(0, 24), (await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [u.uid])).mini_a_openid)
      if (!sec.pass) throw new BizError(1001, '昵称含违规内容，请修改')
      await tx(async (cc) => cc.upd('UPDATE user_account SET nickname = ? WHERE id = ?', [String(nickname).slice(0, 24), u.uid]))
    }
    if (avatarUrl !== undefined) {
      if (!/^\/uploads\/avatar_[0-9]+\.(png|jpg|jpeg|webp)$/.test(String(avatarUrl))) throw new BizError(1001, '头像地址非法')
      await tx(async (cc) => cc.upd('UPDATE user_account SET avatar_url = ? WHERE id = ?', [avatarUrl, u.uid]))
    }
    const acc = await one('SELECT nickname, avatar_url FROM user_account WHERE id = ?', [u.uid])
    return { nickname: acc.nickname, avatarUrl: acc.avatar_url, secMock: sec ? sec.mock : null }
  },

  // 头像上传（base64 JSON：规避零框架 multipart；2MB 上限 + 白名单扩展名）
  'POST /c/upload/avatar': async (req) => {
    const u = requireUser(req)
    const { data, ext = 'png' } = req.body || {}
    if (!data) throw new BizError(1001, '缺少文件内容')
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new BizError(1001, '仅支持 png/jpg/webp')
    const buf = Buffer.from(String(data), 'base64')
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024) throw new BizError(1001, '文件大小需在 2MB 内')
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'static', 'uploads')
    fs.mkdirSync(dir, { recursive: true })
    const name = 'avatar_' + u.uid + '.' + (ext === 'jpeg' ? 'jpg' : ext)
    fs.writeFileSync(path.join(dir, name), buf)
    return { url: '/uploads/' + name }
  },

  'POST /c/orders/:no/refund': async (req) => {
    const u = requireUser(req)
    const o = await order.byNo(req.params.no)
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    const { reason } = req.body
    if (o.status === 10) { await order.fire(o.order_no, 'CLOSE_TIMEOUT', 'user'); return { closed: true } }
    if (![20, 30, 40].includes(o.status)) throw new BizError(2002, '当前状态不可退款')
    const refundNo = 'RF' + Date.now()
    await q(`INSERT INTO refunds (order_id, refund_no, amount, reason, status, operator) VALUES (?,?,?,?,0,'user')`,
      [o.id, refundNo, o.amount_pay, reason || '用户申请'])
    await order.fire(o.order_no, 'REFUND_APPLY', 'user:' + u.uid)
    const wxr = await wxpay.refund({ orderNo: o.order_no, refundNo, amountFen: Number(o.amount_pay), totalFen: Number(o.amount_pay), reason: reason || '用户退款' })
    await order.fire(o.order_no, 'REFUND_SUCCESS', 'system', async (cc) => {
      // 负向冲正：抵扣豆退回 / 已返豆回收 / 凭证作废 / 佣金无效
      if (Number(o.bean_deducted) > 0) await bean.reverse(u.uid, Number(o.bean_deducted), o.order_no)
      await pass.revokeForOrder(o.order_no)
      await promo.invalidateCommission(o.order_no)
      await cc.upd('UPDATE refunds SET status = 2, settled_at = NOW(3) WHERE refund_no = ?', [refundNo])
      await cc.upd('UPDATE payment SET status = 4 WHERE order_id = ?', [o.id])
      return '退款成功·全量冲正'
    })
    return { refunded: true, wxRefund: wxr.status || 'MOCK' }
  },
}

// ---------- /m 商户端 ----------
const m = {
  'POST /m/auth/login': async (req) => {
    const { code, merchantId } = req.body
    const ses = await code2Session(code || 'mock-m-default')
    let u = await one('SELECT * FROM user_account WHERE mini_b_openid = ?', [ses.openid])
    if (!u) {
      await q('INSERT INTO user_account (unionid, mini_b_openid, nickname) VALUES (?,?,?) ON DUPLICATE KEY UPDATE mini_b_openid = VALUES(mini_b_openid)',
        [ses.unionid || null, ses.openid, '商户员工'])
      u = await one('SELECT * FROM user_account WHERE mini_b_openid = ?', [ses.openid])
    }
    if (merchantId) {
      await q('INSERT IGNORE INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,1)', [merchantId, u.id])
    }
    const staff = await one('SELECT merchant_id, role FROM merchant_staff WHERE user_id = ? AND status = 1', [u.id])
    if (!staff) throw new BizError(6001, '未绑定门店（先由老板在后台添加店员）')
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
    return { todayOrders: Number(today.c), todayGmv: fen2yuan(today.gmv), pendingVerify: pending }
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
    if (r.ok) await pass.attest('pass_verify', 'pass-' + r.passId, JSON.stringify({ by: u.merchantId }))
    return r
  },

  'GET /m/verify/records': async (req) => {
    const u = requireUser(req)
    return await q(`SELECT v.id, v.pass_id, v.result, v.created_at, o.order_no, p.name pass_name
      FROM verification_log v JOIN travel_pass p ON p.id = v.pass_id LEFT JOIN orders o ON o.id = p.order_id
      WHERE v.merchant_id = ? ORDER BY v.id DESC LIMIT 50`, [u.merchantId])
  },

  'GET /m/orders': async (req) => {
    const u = requireUser(req)
    return await q(`SELECT o.order_no, o.status, o.amount_pay, o.qty, o.paid_at, p.title, o.contact_name
      FROM orders o JOIN tour_product p ON p.id = o.product_id
      WHERE o.merchant_id = ? AND o.status >= 20 ORDER BY o.id DESC LIMIT 50`, [u.merchantId])
  },

  'GET /m/supply': async (req) => {
    const u = requireUser(req)
    return await q(`SELECT s.id, s.depart_date, s.quota, s.booked, s.quota - s.booked AS left_seats, s.price_adult, s.status, p.title
      FROM tour_session s JOIN tour_product p ON p.id = s.product_id
      WHERE p.merchant_id = ? AND s.depart_date >= CURDATE() - INTERVAL 7 DAY ORDER BY s.depart_date`, [u.merchantId])
  },

  'POST /m/supply/:sid': async (req) => {
    const u = requireUser(req)
    if (u.role < 2) throw new BizError(1003, '需要店长及以上权限')
    const { action, value } = req.body
    if (action === 'stop_sell') { await q('UPDATE tour_session SET status = 3 WHERE id = ?', [req.params.sid]); return { stopped: true } }
    if (action === 'adjust_quota') { await q('UPDATE tour_session SET quota = ? WHERE id = ? AND quota >= booked', [value, req.params.sid]); return { quota: value } }
    if (action === 'price') { await q('UPDATE tour_session SET price_adult = ? WHERE id = ?', [value, req.params.sid]); return { price: value } }
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
    // 明细：本单包含的订单（settlement_id 挂钩，对账逐单可查）
    const items = await q(`SELECT o.order_no, o.amount_pay, o.completed_at, p.title FROM orders o
      JOIN tour_product p ON p.id = o.product_id
      WHERE o.settlement_id = ? AND o.merchant_id = ? ORDER BY o.id DESC`, [req.params.id, u.merchantId])
    return { ...s, items }
  },

  // 商户确认结算（0 待确认 → 1 商户已确认；财务侧复核后走 2/3）
  'POST /m/settlements/:id/confirm': async (req) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '商户端凭证')
    const r = await q('UPDATE settlement SET status = 1 WHERE id = ? AND merchant_id = ? AND status = 0', [req.params.id, u.merchantId])
    if (!r.affectedRows) throw new BizError(1001, '结算单不在待确认状态')
    await tx(async (c) => audit(c, 'merchant:' + u.merchantId, 'settlement', 'merchant-confirm', 'settlement-' + req.params.id, null, { note: req.body.note || '' }))
    return { confirmed: true }
  },
}

// ---------- /admin 运营后台 ----------
async function requireAdmin(req, roles) {
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
}

async function audit(c, actor, module_, action, bizRef, before, after) {
  await c.q('INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val) VALUES (?,?,?,?,?,?)',
    [actor, module_, action, bizRef || null, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null])
}

const admin = {
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
      if (!bound && ch === 'sms' && u.mobile) await import('./infra/mfa.mjs').then((m) => m.sendCode(u.mobile, 'sms'))
      return { mfaRequired: true, challenge: jwtSign({ uid: u.id, end: 'mfa', ch, exp2: Date.now() + 5 * 60_000 }, 300),
        channel: ch, target: ch === 'sms' ? String(u.mobile || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : (ch === 'email' ? String(u.email || '').replace(/^(.).*(@.*)$/, '$1***$2') : null) }
    }
    await q('UPDATE admin_user SET last_login_at = NOW(3) WHERE id = ?', [u.id])
    return { token: jwtSign({ uid: u.id, end: 'admin', role: u.role, name: u.display_name || u.username, scopeCity: u.scope_city || null }, 12 * 3600),
      user: { username: u.username, role: u.role, displayName: u.display_name, scopeCity: u.scope_city || null } }
  },

  // 第二步：TOTP / 短信 / 邮箱验证码（challenge 5 分钟有效）
  'POST /admin/login/mfa': async (req) => {
    const { challenge, code, resend } = req.body
    const { jwtVerify } = await import('./auth.mjs')
    const p = jwtVerify(challenge || '')
    if (!p || p.end !== 'mfa' || Date.now() > p.exp2) throw new BizError(1002, '验证会话已过期，请重新登录')
    const u = await one('SELECT * FROM admin_user WHERE id = ? AND status = 1', [p.uid])
    if (!u) throw new BizError(1002, '账号状态异常')
    const mfa = await import('./infra/mfa.mjs')
    if (resend) {
      if (p.ch !== 'totp') await mfa.sendCode(p.ch === 'sms' ? u.mobile : u.email, p.ch)
      return { resent: true }
    }
    let ok = false
    if (p.ch === 'totp') ok = u.mfa_secret && mfa.totpVerify(u.mfa_secret, code)
    else ok = await mfa.verifyCode(p.ch === 'sms' ? u.mobile : u.email, p.ch, code)
    if (!ok) throw new BizError(1002, '验证码不正确或已过期')
    await q('UPDATE admin_user SET last_login_at = NOW(3) WHERE id = ?', [u.id])
    return { token: jwtSign({ uid: u.id, end: 'admin', role: u.role, name: u.display_name || u.username, scopeCity: u.scope_city || null }, 12 * 3600),
      user: { username: u.username, role: u.role, displayName: u.display_name, scopeCity: u.scope_city || null } }
  },

  // ===== 安全中心（系统工作区）：绑定 MFA / 发送测试 / 最近验证码（MOCK 通道演示用）=====
  'GET /admin/security/accounts': async (req) => {
    await requireAdmin(req, ['super'])
    return await q('SELECT id, username, role, display_name, mfa_enabled, mfa_channel, mobile, email, last_login_at, status FROM admin_user ORDER BY id')
  },
  'POST /admin/security/mfa/setup': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { userId } = req.body
    const mfa = await import('./infra/mfa.mjs')
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
    const mfa = await import('./infra/mfa.mjs')
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
    const sc = a.scope_city // 城市合伙人：严格本城口径（数据边界 §数据边界）
    const cityWhere = sc ? 'AND o.city_code = ' + Number(sc) : ''
    const t = await one(`SELECT COUNT(*) c, COALESCE(SUM(amount_pay),0) gmv FROM orders o
      WHERE o.status IN (20,30,40,50) AND DATE(o.paid_at) = CURDATE() ${cityWhere}`)
    const verified = await count(`SELECT COUNT(*) c FROM verification_log v
      JOIN travel_pass tp ON tp.id = v.pass_id JOIN orders o ON o.id = tp.order_id
      WHERE v.result = 1 AND DATE(v.created_at) = CURDATE() ${sc ? 'AND o.city_code = ' + Number(sc) : ''}`)
    const issuedPass = await count(`SELECT COUNT(*) c FROM travel_pass tp JOIN orders o ON o.id = tp.order_id
      WHERE DATE(tp.created_at) = CURDATE() ${sc ? 'AND o.city_code = ' + Number(sc) : ''}`)
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

  'GET /admin/orders': async (req) => {
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
  },

  'GET /admin/orders/:no': async (req) => {
    await requireAdmin(req)
    const o = await one(`SELECT o.*, p.title, u.nickname FROM orders o
      JOIN tour_product p ON p.id = o.product_id JOIN user_account u ON u.id = o.user_id WHERE o.order_no = ?`, [req.params.no])
    if (!o) throw new BizError(2003, '订单不存在')
    const events = await q('SELECT from_st, to_st, actor, detail, created_at FROM order_event WHERE order_id = ? ORDER BY id', [o.id])
    const passes = await q('SELECT id, name, status FROM travel_pass WHERE order_id = ?', [o.id])
    const pay = await one('SELECT wx_trans_no, status, amount, callback_at FROM payment WHERE order_id = ?', [o.id])
    return { ...o, events, passes, pay }
  },

  'POST /admin/orders/:no/refund': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'finance'])
    const o = await order.byNo(req.params.no)
    if (!o) throw new BizError(2003, '订单不存在')
    if (![20, 30, 40].includes(o.status)) throw new BizError(2002, '状态不可退款')
    const refundNo = 'RF' + Date.now()
    await q(`INSERT INTO refunds (order_id, refund_no, amount, reason, status, operator) VALUES (?,?,?,?,0,?)`,
      [o.id, refundNo, o.amount_pay, req.body.reason || '后台退款', 'admin:' + a.name])
    await order.fire(o.order_no, 'REFUND_APPLY', 'admin:' + a.name)
    await wxpay.refund({ orderNo: o.order_no, refundNo, amountFen: Number(o.amount_pay), totalFen: Number(o.amount_pay), reason: '后台退款' })
    await order.fire(o.order_no, 'REFUND_SUCCESS', 'system', async (cc) => {
      if (Number(o.bean_deducted) > 0) await bean.reverse(Number(o.user_id), Number(o.bean_deducted), o.order_no)
      await pass.revokeForOrder(o.order_no)
      await promo.invalidateCommission(o.order_no)
      await cc.upd('UPDATE refunds SET status = 2, settled_at = NOW(3) WHERE refund_no = ?', [refundNo])
      await cc.upd('UPDATE payment SET status = 4 WHERE order_id = ?', [o.id])
      return '后台退款·冲正完成'
    })
    return { refunded: true }
  },

  // 商品/团期管理（"简单内容填充"的落点）
  'GET /admin/products': async (req) => {
    const a = await requireAdmin(req)
    const sc = scopeFilter(a, 'p.city_code')
    return await q(`SELECT p.*, m.name merchant_name FROM tour_product p LEFT JOIN merchant m ON m.id = p.merchant_id WHERE 1=1 ${sc.sql} ORDER BY p.id DESC`, sc.params)
  },
  'POST /admin/products': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const { title, cat, cityCode, channelId, merchantId, priceFrom, beanGift, daysDesc, subtitle, status,
      intro, includes, highlights, meetingPoint, safetyNote } = req.body
    const arr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[·、,，;；\n]/).map((s) => s.trim()).filter(Boolean) : [])
    const rich = { intro: intro || subtitle || '', includes: arr(includes), highlights: arr(highlights) }
    const id = await tx(async (c) => {
      const pid = await c.ins(`INSERT INTO tour_product (channel, city_code, cat, title, subtitle, days_desc, price_from, bean_gift, merchant_id, status, rich_desc, meeting_point, safety_note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [channelId || 'main', cityCode || '310118', cat || 'script', title, subtitle || null, daysDesc || null,
          Number(priceFrom) || 0, Number(beanGift) || 0, Number(merchantId), Number(status ?? 0), JSON.stringify(rich),
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
    const { title, subtitle, daysDesc, priceFrom, beanGift, status, intro, includes, highlights, meetingPoint, safetyNote } = req.body
    const arr = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[·、,，;；\n]/).map((s) => s.trim()).filter(Boolean) : [])
    const rich = { intro: intro ?? old.intro ?? '', includes: includes !== undefined ? arr(includes) : (old.includes || []),
      highlights: highlights !== undefined ? arr(highlights) : (old.highlights || []) }
    const r = await q(`UPDATE tour_product SET title = COALESCE(?, title), subtitle = COALESCE(?, subtitle),
      days_desc = COALESCE(?, days_desc), price_from = COALESCE(?, price_from), bean_gift = COALESCE(?, bean_gift),
      status = COALESCE(?, status), rich_desc = ?, meeting_point = ?, safety_note = ? WHERE id = ?`,
      [title ?? null, subtitle ?? null, daysDesc ?? null, priceFrom != null ? Number(priceFrom) : null,
        beanGift != null ? Number(beanGift) : null, status ?? null,
        JSON.stringify(rich), meetingPoint ?? null, safetyNote ?? null, req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'product', 'update', 'product-' + req.params.id, JSON.stringify(rich), null))
    return { updated: r.affectedRows > 0 }
  },

  // 商品图集：base64 上传（≤9 张，白名单扩展名，2MB 内）→ /uploads 静态
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
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'static', 'uploads')
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
    const a = await requireAdmin(req, ['super', 'ops'])
    await q('UPDATE tour_product SET status = ? WHERE id = ?', [Number(req.body.status), req.params.id])
    return { ok: true }
  },
  'POST /admin/sessions': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { productId, departDate, quota, minGo, priceAdult } = req.body
    const id = await tx(async (c) => c.ins(
      'INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult) VALUES (?,?,?,?,?)',
      [Number(productId), departDate, Number(quota), Number(minGo || 10), Number(priceAdult)]))
    return { id }
  },

  'GET /admin/merchants': async (req) => { await requireAdmin(req); return await q('SELECT * FROM merchant ORDER BY id') },
  'POST /admin/merchants': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { name, cityCode, wxpaySubMchid, bizLicense } = req.body
    const mno = 'M' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + String(Math.floor(Math.random() * 900) + 100)
    const id = await tx(async (c) => {
      const mid = await c.ins('INSERT INTO merchant (city_code, name, merchant_no, wxpay_sub_mchid, biz_license, status) VALUES (?,?,?,?,?,0)',
        [cityCode || '310118', name, mno, wxpaySubMchid || null, bizLicense || null])
      await audit(c, 'admin:' + a.name, 'merchant', 'create', 'merchant-' + mid, null, { name })
      return mid
    })
    return { id, merchantNo: mno }
  },

  // ===== 参数中心（§4.2：分组/双人复核/影响预览/版本回滚）=====
  'GET /admin/config': async (req) => {
    await requireAdmin(req)
    const rows = await q('SELECT k, v, group_name, `sensitive`, memo, updated_by, updated_at FROM rule_config ORDER BY group_name, k')
    return rows.map(r => ({ ...r, v: typeof r.v === 'string' ? r.v : JSON.stringify(r.v) }))
  },
  'POST /admin/config/proposal': async (req) => {
    const a = await requireAdmin(req)
    const { key, newValue, reason } = req.body
    const cur = await one('SELECT v, `sensitive` FROM rule_config WHERE k = ?', [key])
    if (!cur) throw new BizError(1004, '参数不存在')
    const oldV = typeof cur.v === 'string' ? cur.v : JSON.stringify(cur.v)
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
      await c.upd('UPDATE rule_config SET v = CAST(? AS JSON), updated_by = ?, updated_version = updated_version + 1 WHERE k = ?', [String(h.new_value), 'admin:' + a.name, h.cfg_key])
      await c.upd("UPDATE config_history SET status = 1, approver = ?, effective_at = NOW(3) WHERE id = ?", ['admin:' + a.name, h.id])
      await audit(c, 'admin:' + a.name, 'config', 'approve', h.cfg_key, h.old_value, h.new_value)
    })
    await loadConfig(true)
    return { ok: true }
  },
  'POST /admin/config/rollback': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const h = await one('SELECT * FROM config_history WHERE cfg_key = ? ORDER BY id DESC LIMIT 1', [req.body.key])
    if (!h) throw new BizError(1004, '无历史版本')
    await tx(async (c) => {
      await c.upd('UPDATE rule_config SET v = CAST(? AS JSON), updated_by = ?, updated_version = updated_version + 1 WHERE k = ?', [String(h.old_value), 'admin:' + a.name, h.cfg_key])
      await c.ins('INSERT INTO config_history (cfg_key, old_value, new_value, proposer, approver, status, reason, effective_at) VALUES (?,CAST(? AS JSON),CAST(? AS JSON),?,?,3,?,NOW(3))',
        [h.cfg_key, String(h.new_value), String(h.old_value), 'admin:' + a.name, 'admin:' + a.name, '回滚'])
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
  'GET /admin/budgets': async (req) => { await requireAdmin(req); return await q('SELECT * FROM bean_budget ORDER BY id DESC') },
  'POST /admin/budgets': async (req) => {
    const a = await requireAdmin(req, ['super', 'finance'])
    const { name, total, periodStart, periodEnd } = req.body
    const id = await tx(async (c) => {
      const bid = await c.ins('INSERT INTO bean_budget (name, total, biz_owner, status, period_start, period_end) VALUES (?,?,?,1,?,?)',
        [name, Number(total), 'marketing', periodStart || null, periodEnd || null])
      await audit(c, 'admin:' + a.name, 'budget', 'create', 'budget-' + bid, null, { name, total })
      return bid
    })
    return { id }
  },
  'GET /admin/promoters': async (req) => {
    await requireAdmin(req)
    return await q(`SELECT p.*, u.nickname FROM promoter p JOIN user_account u ON u.id = p.user_id ORDER BY p.user_id`)
  },
  'POST /admin/promoters/register': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    return { userId: Number(req.body.userId), rateBp: await promo.register(Number(req.body.userId), Number(req.body.tier || 1)) }
  },
  'GET /admin/settlements': async (req) => {
    const a = await requireAdmin(req)
    const sc = scopeFilter(a, 'm.city_code')
    return await q(`SELECT s.*, m.name merchant_name FROM settlement s JOIN merchant m ON m.id = s.merchant_id WHERE 1=1 ${sc.sql} ORDER BY s.id DESC`, sc.params)
  },
  'POST /admin/settlements/generate': async (req) => {
    await requireAdmin(req, ['super', 'finance'])
    const period = req.body.period || new Date().toISOString().slice(0, 7) + '-W' + Math.ceil(new Date().getDate() / 7)
    const merchants = await q('SELECT DISTINCT merchant_id mid FROM orders WHERE status = 50')
    const ids = []
    for (const mm of merchants) ids.push(await promo.generateSettlement(Number(mm.mid), period))
    return { period, settlementIds: ids.filter(i => i > 0) }
  },
  'POST /admin/settlements/:id/confirm': async (req) => {
    await requireAdmin(req, ['super', 'finance'])
    await q('UPDATE settlement SET status = 1 WHERE id = ? AND status = 0', [req.params.id])
    await q('UPDATE settlement SET status = 2 WHERE id = ?', [req.params.id])
    await q('UPDATE settlement SET status = 3 WHERE id = ? AND status = 2', [req.params.id])
    return { status: 3 }
  },
  'GET /admin/risk': async (req) => { await requireAdmin(req); return await q('SELECT * FROM risk_event ORDER BY id DESC LIMIT 50') },
  'GET /admin/audit-logs': async (req) => { await requireAdmin(req); return await q('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100') },
  'GET /admin/attestations': async (req) => {
    await requireAdmin(req)
    const { bizRef } = req.query
    return await q(bizRef ? 'SELECT * FROM attest_event WHERE biz_ref = ?' : 'SELECT * FROM attest_event ORDER BY id DESC LIMIT 50', bizRef ? [bizRef] : [])
  },

  // 开发联调：触发支付回调（MOCK 通道）；生产由 /callback/wxpay 真实回调
  'POST /admin/dev/mock-pay': async (req) => {
    await requireAdmin(req)
    const { orderNo } = req.body
    return await handlePayNotify(orderNo, 'MOCK' + Date.now(), true)
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
    if (budget && Number(o.amount_pay) > 0) {
      const rebate = await bean.rebateOf(Number(o.amount_pay))
      if (rebate > 0) await bean.grant(Number(o.user_id), rebate, bean.BIZ.REBATE, orderNo, budget.id)
      const amt = Number(o.amount_pay)
      await q('UPDATE user_account SET growth_value = growth_value + ? WHERE id = ?', [amt, o.user_id])
      const th = [0, 2000, 10000, 50000]
      const ua = await one('SELECT growth_value FROM user_account WHERE id = ?', [o.user_id])
      const lv = th.filter((t) => Number(ua.growth_value) >= t).length
      await q('UPDATE user_account SET member_level = ? WHERE id = ?', [lv, o.user_id])
      await q('INSERT INTO user_growth_log (user_id, delta, biz_type, biz_ref, after_val) VALUES (?,?,1,?,?)',
        [o.user_id, amt, orderNo, Number(ua.growth_value)])
    }
    await promo.createCommission(orderNo)
    await pass.attest('order', orderNo, JSON.stringify({ amount: Number(o.amount_pay), status: 50 }))
    return { completed: true }
  },
}

// ---------- /admin 系统工作区（SRE）与生态/财务审批 ----------
const adminSys = {
  // 小程序数据分析（官方 getDailyVisitTrend；未配置凭据=MOCK 曲线）
  'GET /admin/wxdata/visit-trend': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'city_partner'])
    return await wxapi.getDailyVisitTrend(7)
  },
  'GET /admin/system/overview': async (req) => {
    await requireAdmin(req, ['super', 'sre', 'dev'])
    const t0 = Date.now()
    await q('SELECT 1')
    const dbLatency = Date.now() - t0
    const jobs = await q('SELECT * FROM sys_job')
    const mainLoop = jobs.find((j) => j.name === 'main-loop')
    const jobsAlive = mainLoop && Date.now() - new Date(mainLoop.last_run_at).getTime() < 180_000
    const attest = await one(`SELECT
      SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) anchored,
      SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) failed FROM attest_event`)
    const pay = await one(`SELECT COUNT(*) total,
      SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) ok FROM payment`)
    const orders = await one(`SELECT COUNT(*) total,
      SUM(CASE WHEN status = 10 AND created_at < NOW() - INTERVAL 30 MINUTE THEN 1 ELSE 0 END) stuck10 FROM orders`)
    const idem = await count('SELECT COUNT(*) c FROM idempotency_key')
    const { trialBalance } = await import('./domain/bean.mjs')
    const tb = await trialBalance()
    const tables = await count("SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = 'wanderlust'")
    const fs = await import('node:fs')
    const path = await import('node:path')
    const migDir = path.join(import.meta.dirname, '..', 'db', 'migration')
    const migrations = fs.existsSync(migDir) ? fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort() : []
    return {
      db: { ok: true, latencyMs: dbLatency },
      service: { uptimeSec: Math.round(process.uptime()), node: process.version, payMode: wxpay.isLive() ? 'WECHAT-PAY-V3' : 'MOCK' },
      jobs: { alive: !!jobsAlive, lastRunAt: mainLoop?.last_run_at || null, runCount: mainLoop?.run_count || 0, detail: jobs },
      attestQueue: { pending: Number(attest?.pending || 0), anchored: Number(attest?.anchored || 0), failed: Number(attest?.failed || 0) },
      payment: { total: Number(pay?.total || 0), ok: Number(pay?.ok || 0) },
      ordersHealth: { total: Number(orders?.total || 0), stuckWaitPay30m: Number(orders?.stuck10 || 0) },
      ledger: tb, idempotencyKeys: idem, tables, migrations,
    }
  },

  'GET /admin/system/logs': async (req) => {
    await requireAdmin(req, ['super', 'sre', 'dev'])
    const { q: kw } = req.query
    if (!kw) return { orderEvents: [], audits: [], verifies: [] }
    const orderEvents = await q(`SELECT o.order_no, e.from_st, e.to_st, e.actor, e.detail, e.created_at
      FROM order_event e JOIN orders o ON o.id = e.order_id WHERE o.order_no LIKE ? ORDER BY e.id DESC LIMIT 50`, ['%' + kw + '%'])
    const audits = await q(`SELECT * FROM audit_log WHERE actor LIKE ? OR biz_ref LIKE ? ORDER BY id DESC LIMIT 50`, ['%' + kw + '%', '%' + kw + '%'])
    const verifies = await q(`SELECT v.*, p.name pass_name FROM verification_log v JOIN travel_pass p ON p.id = v.pass_id
      WHERE CAST(v.pass_id AS CHAR) LIKE ? ORDER BY v.id DESC LIMIT 20`, ['%' + kw + '%'])
    return { orderEvents, audits, verifies }
  },

  'POST /admin/system/jobs/:name/run': async (req) => {
    await requireAdmin(req, ['super', 'sre'])
    const { name } = req.params
    const { closeTimeout } = await import('./domain/order.mjs')
    const { settleDue } = await import('./domain/promo.mjs')
    let n = -1
    if (name === 'close-timeout') n = await closeTimeout()
    else if (name === 'commission-due') n = await settleDue()
    else if (name === 'attest-pack') { const { packBatch } = await import('./domain/attest.mjs'); const b = await packBatch(); n = b.leaves }
    else if (name === 'complete-due') { const { completeOrder } = await import('./jobs.mjs'); const rows = await q("SELECT order_no FROM orders WHERE status = 40 AND refund_deadline <= NOW(3) LIMIT 50"); for (const x of rows) await completeOrder(x.order_no); n = rows.length }
    else if (name === 'bean-expire') { const jobsMod = await import('./jobs.mjs'); await jobsMod.tickExpire(); n = -1 }
    else throw new BizError(1001, '未知任务: ' + name)
    await q(`INSERT INTO sys_job (name, last_run_at, last_status, run_count) VALUES (?, NOW(3), 'ok', 1)
             ON DUPLICATE KEY UPDATE last_run_at = NOW(3), last_status = 'ok'`, [name])
    return { affected: n }
  },

  'GET /admin/features': async (req) => {
    await requireAdmin(req)
    const rows = await q("SELECT k, v, memo FROM rule_config WHERE group_name = 'feature' ORDER BY k")
    return rows.map((r) => ({ key: r.k, on: String(r.v).includes('on'), memo: r.memo }))
  },
  'POST /admin/features/:key/toggle': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const cur = await one("SELECT v FROM rule_config WHERE k = ? AND group_name = 'feature'", [req.params.key])
    if (!cur) throw new BizError(1004, '开关不存在')
    const next = String(cur.v).includes('on') ? '"off"' : '"on"'
    await tx(async (c) => {
      await c.upd('UPDATE rule_config SET v = CAST(? AS JSON), updated_by = ? WHERE k = ?', [next, 'admin:' + a.name, req.params.key])
      await audit(c, 'admin:' + a.name, 'feature', 'toggle', req.params.key, String(cur.v), next)
    })
    await loadConfig(true)
    return { key: req.params.key, on: next.includes('on') }
  },
}

const adminEco = {
  'GET /admin/content': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'review'])
    return await q('SELECT c.*, u.nickname FROM content_note c JOIN user_account u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 100')
  },

  // 评价管理（内容审核工作区）
  'GET /admin/reviews': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'review'])
    return await q(`SELECT r.*, u.nickname, p.title FROM review r
      JOIN user_account u ON u.id = r.user_id JOIN tour_product p ON p.id = r.product_id
      ORDER BY r.id DESC LIMIT 100`)
  },
  'POST /admin/reviews/:id/hide': async (req) => {
    const a = await requireAdmin(req, ['super', 'review'])
    const st = req.body.show ? 1 : 0
    await q('UPDATE review SET status = ? WHERE id = ?', [st, req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'review', st ? 'show' : 'hide', 'review-' + req.params.id, null, null))
    return { status: st }
  },

  'POST /admin/content/:id/verdict': async (req) => {
    const a = await requireAdmin(req, ['super', 'review'])
    const passed = req.body.pass
    const st = passed ? 2 : 3
    const n = await q('UPDATE content_note SET status = ? WHERE id = ? AND status IN (0,1)', [st, req.params.id])
    if (n.affectedRows === 1 && passed) await q('UPDATE content_note SET published_at = NOW(3) WHERE id = ? AND status = 2', [req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'content', passed ? 'approve' : 'reject', 'note-' + req.params.id, null, { status: st }))
    return { status: st }
  },
  'POST /admin/merchants/:id/approve': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    await q('UPDATE merchant SET status = 1 WHERE id = ? AND status = 0', [req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'merchant', 'approve', 'merchant-' + req.params.id, { status: 0 }, { status: 1 }))
    return { approved: true }
  },
  'GET /admin/agreements': async (req) => {
    await requireAdmin(req)
    return await q('SELECT ac.*, m.name merchant_name FROM agreement_change ac JOIN merchant m ON m.id = ac.merchant_id ORDER BY ac.id DESC')
  },
  'POST /admin/agreements/:id/verdict': async (req) => {
    const a = await requireAdmin(req, ['super', 'finance'])
    const passed = req.body.pass
    const st = passed ? 1 : 2
    await q('UPDATE agreement_change SET status = ?, approved_by = ?, approved_at = NOW(3) WHERE id = ? AND status = 0', [st, 'admin:' + a.name, req.params.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'agreement', passed ? 'approve' : 'reject', 'agreement-' + req.params.id, { status: 0 }, { status: st }))
    return { status: st }
  },
}

const adminFin = {
  'GET /admin/withdrawals': async (req) => {
    await requireAdmin(req, ['super', 'finance'])
    return await q('SELECT w.*, u.nickname FROM promoter_withdraw w JOIN user_account u ON u.id = w.promoter_id ORDER BY w.id DESC LIMIT 100')
  },
  'POST /admin/withdrawals/:id/verdict': async (req) => {
    const a = await requireAdmin(req, ['super', 'finance'])
    const { pass: passed, payRef } = req.body
    const w = await one('SELECT * FROM promoter_withdraw WHERE id = ? AND status = 0', [req.params.id])
    if (!w) throw new BizError(1004, '申请不存在或已处理')
    const st = passed ? 1 : 2
    let finalRef = passed ? (payRef || 'MANUAL-' + Date.now()) : null
    if (passed && !payRef && wxpay.isLive()) {
      // 生产：自动商家转账（V3），流水号以转账批次号留痕
      const t = await wxpay.merchantTransfer({ outBatchNo: 'WD' + w.id + '-' + Date.now(), totalFen: Number(w.amount), remark: '推广服务费提现' })
      finalRef = 'WXBATCH-' + t.batchNo
    }
    await q('UPDATE promoter_withdraw SET status = ?, reviewed_by = ?, reviewed_at = NOW(3), pay_ref = ? WHERE id = ?',
      [st, 'admin:' + a.name, finalRef, w.id])
    await tx(async (c) => audit(c, 'admin:' + a.name, 'withdraw', passed ? 'pay' : 'reject', 'wd-' + w.id, { status: 0 }, { status: st, amount: w.amount }))
    return { status: st }
  },
}

const cWithdraw = {
  'GET /c/promote/overview': async (req) => {
    const u = requireUser(req)
    const p = await one('SELECT tier, rate_bp, status FROM promoter WHERE user_id = ?', [u.uid])
    if (!p) return { promoter: false }
    const agg = await one(`SELECT COALESCE(SUM(CASE WHEN status IN (1,2) THEN amount ELSE 0 END),0) earned,
      COALESCE(SUM(CASE WHEN status IN (3,4) THEN amount ELSE 0 END),0) reversed FROM commission WHERE promoter_id = ?`, [u.uid])
    const paid = await one(`SELECT COALESCE(SUM(w.amount),0) paid FROM promoter_withdraw w WHERE w.promoter_id = ? AND w.status = 1`, [u.uid])
    const pending = await count('SELECT COUNT(*) c FROM promoter_withdraw WHERE promoter_id = ? AND status = 0', [u.uid])
    return { promoter: true, tier: p.tier, rateBp: p.rate_bp, earned: Number(agg.earned), withdrawn: Number(paid.paid),
      withdrawable: Number(agg.earned) - Number(paid.paid), pendingRequests: pending }
  },
  'GET /c/promote/qrcode': async (req) => {
    const u = requireUser(req)
    const p = await one('SELECT user_id, status FROM promoter WHERE user_id = ? AND status = 1', [u.uid])
    if (!p) throw new BizError(6001, '非生效推广服务商')
    const scene = await promo.createScene(p.user_id, 'mini')
    const { buffer, mock } = await wxapi.getUnlimitedQRCode(scene, 'pages/home/index')
    return { scene, mock, image: buffer ? buffer.toString('base64') : null,
      note: mock ? '未配置 WX_APPID/WX_SECRET：MOCK 模式，配置后返回真实小程序码（scene=' + scene + '）' : null }
  },
  'POST /c/promote/withdraw': async (req) => {
    const u = requireUser(req)
    const p = await one('SELECT status FROM promoter WHERE user_id = ? AND status = 1', [u.uid])
    if (!p) throw new BizError(6001, '非生效推广服务商')
    const cfgs = await cfgAll()
    if (String(cfgs['feature.withdraw'] || '"on"').includes('off')) throw new BizError(1003, '提现入口维护中')
    const ov = await cWithdraw['GET /c/promote/overview'](req)
    if (ov.withdrawable < 10000) throw new BizError(6001, '可提现余额不足 ¥100')
    const id = await tx(async (c) => c.ins(
      'INSERT INTO promoter_withdraw (promoter_id, amount, proposer_note) VALUES (?,?,?)',
      [u.uid, ov.withdrawable, req.body.note || '']))
    return { id, amount: ov.withdrawable }
  },
}

// ---------- 集成中心（第三方凭据后台化：.env 仅自举）----------
const integrations = {
  'GET /admin/integrations': async (req) => {
    await requireAdmin(req, ['super'])
    const { listSecretMeta } = await import('./infra/secrets.mjs')
    const { getSecrets } = await import('./infra/secrets.mjs')
    const stored = Object.fromEntries((await listSecretMeta()).map((r2) => [r2.k, r2.hint]))
    const s = await getSecrets(['WX_APPID', 'WX_SECRET', 'WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY', 'WX_NOTIFY_URL', 'WX_TMPL_PAY_OK',
      'SMS_TENCENT_SECRET_ID', 'SMS_TENCENT_SECRET_KEY', 'SMS_TENCENT_SDKAPPID', 'SMS_TENCENT_SIGN',
      'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'])
    const ch = (keys, name, desc) => ({ name, desc, ready: keys.every((k) => !!s[k]),
      fields: keys.map((k) => ({ key: k, envFallback: !!process.env[k], stored: stored[k] || null })) })
    return {
      envNote: '.env 只保留自举：DB 连接、JWT_SECRET、ADMIN_INIT_PASSWORD；其余凭据在本页保存（AES-256-GCM 加密落库）',
      channels: [
        ch(['WX_APPID', 'WX_SECRET'], '微信小程序登录', 'code2Session（未配置=mock openid 联调）'),
        ch(['WX_TMPL_PAY_OK'], '订阅消息模板', '支付成功通知模板 ID（公众平台→订阅消息→我的模板）'),
        ch(['WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY', 'WX_NOTIFY_URL'], '微信支付 V3', '未配置=MOCK 通道（不真实收款）'),
        ch(['SMS_TENCENT_SECRET_ID', 'SMS_TENCENT_SECRET_KEY'], '腾讯云短信', 'MFA/通知短信（未配置=MOCK 后台可见）'),
        ch(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'], '邮箱 SMTP', 'MFA/通知邮件（未配置=MOCK）'),
      ],
    }
  },
  'POST /admin/integrations/:key': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { value } = req.body
    if (!value || String(value).length < 4) throw new BizError(1001, '凭据长度至少 4 位')
    const { setSecret } = await import('./infra/secrets.mjs')
    await setSecret(req.params.key, String(value), 'admin:' + a.name)
    await tx(async (c) => audit(c, 'admin:' + a.name, 'integration', 'set', req.params.key, null, { len: String(value).length }))
    return { key: req.params.key, saved: true }
  },
  'DELETE /admin/integrations/:key': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { delSecret } = await import('./infra/secrets.mjs')
    await delSecret(req.params.key)
    await tx(async (c) => audit(c, 'admin:' + a.name, 'integration', 'delete', req.params.key, null, null))
    return { deleted: true }
  },
}

// ---------- 存证中心 / 公开验证 / 用户数字身份 ----------
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

// 推广中心补全：自助取码 + 客户脱敏列表
const cPromo = {
  'GET /c/promote/scene': async (req) => {
    const u = requireUser(req)
    const p = await one('SELECT status FROM promoter WHERE user_id = ? AND status = 1', [u.uid])
    if (!p) return { promoter: false }
    const { createScene } = await import('./domain/promo.mjs')
    return { promoter: true, scene: await createScene(u.uid, 'mini') }
  },
  'GET /c/promote/customers': async (req) => {
    const u = requireUser(req)
    const rows = await q(`SELECT h.hit_at, o.order_no, o.amount_pay, o.status
      FROM attribution a JOIN attribution_hit h ON h.scene = a.scene
      LEFT JOIN orders o ON o.promo_scene = a.scene AND o.user_id = h.user_id
      WHERE a.promoter_id = ? ORDER BY h.id DESC LIMIT 50`, [u.uid])
    return rows.map((r) => ({ when: String(r.hit_at).slice(0, 10), orderNo: r.order_no || null,
      amount: r.order_no ? Number(r.amount_pay) : null, status: r.order_no ? r.status : null }))
  },
}

// 用户发布笔记（msgSecCheck 机审前置 → 过=发布 / 可疑=人工队列）
const cNotes = {
  'GET /c/notes': async (req) => {    requireUser(req)
    return await q(`SELECT c.id, c.title, c.status, c.like_count, c.published_at FROM content_note c
      WHERE c.status = 2 ORDER BY c.published_at DESC LIMIT 20`)
  },
  'POST /c/notes': async (req) => {
    const u = requireUser(req)
    const { title, body } = req.body
    if (!body) throw new BizError(1001, '内容不能为空')
    const { msgSecCheck } = await import('./infra/wxsec.mjs')
    const sec = await msgSecCheck((title || '') + ' ' + body, 'mock-openid-' + u.uid)
    const status = sec.pass ? 2 : 1 // 机审过→已发布；可疑→人工审核队列
    const id = await tx(async (c) => c.ins(
      'INSERT INTO content_note (user_id, title, body, status, sec_check_id) VALUES (?,?,?,?,?)',
      [u.uid, title || null, JSON.stringify({ text: body }), status, sec.mock ? 'mock' : 'wx-sec']))
    return { id, status, secMock: sec.mock, msg: status === 2 ? '已发布' : '进入人工审核' }
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

// ---------- 微信支付回调 ----------
async function handlePayNotify(orderNo, transNo, mock = false) {
  const o = await order.byNo(orderNo)
  if (!o) return { code: 0, ignored: true }
  const exist = await one('SELECT id FROM payment WHERE wx_trans_no = ?', [transNo])
  if (exist) return { code: 0, duplicated: true } // 幂等（同交易号）
  const existOrder = await one('SELECT id FROM payment WHERE order_id = ?', [o.id])
  if (existOrder) return { code: 0, duplicated: true } // 幂等（同订单已支付，换交易号重放也拒绝）
  if (Number(o.amount_pay) === 0) {
    // 全豆抵扣：无需支付回调，直接走确认链（由 place 后路由触发）；此处兜底
  }
  await q('INSERT INTO payment (order_id, wx_trans_no, amount, status, callback_at, raw_notify) VALUES (?,?,?,1,NOW(3),?)',
    [o.id, transNo, o.amount_pay, JSON.stringify({ mock, orderNo, transNo })])
  if (o.status === 10) {
    await order.fire(orderNo, 'PAY_SUCCESS', 'system', async (c) => {
      await c.upd('UPDATE orders SET paid_at = NOW(3), refund_deadline = NOW(3) + INTERVAL ? DAY WHERE order_no = ?', [await cfgNum('order.observe_days'), orderNo])
      return '支付回调 ' + transNo
    })
    const passIds = await pass.issueForOrder(orderNo)
    await order.fire(orderNo, 'CONFIRM', 'system', async () => '确认出票·' + passIds.length + '张凭证')
    // 订阅消息：支付成功通知（官方 subscribe/send；未订阅/未配置静默失败，不阻断主链）
    wxapi.sendSubscribeMessage(
      (await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [o.user_id])).mini_a_openid,
      (await (async () => { const { getSecrets } = await import('./infra/secrets.mjs'); return (await getSecrets(['WX_TMPL_PAY_OK'])).WX_TMPL_PAY_OK })()) || '',
      { thing1: { value: '出票成功' }, character_string2: { value: orderNo } },
      'package-order/pages/orders/index',
    ).catch((e) => console.error('[notify] payOk send failed:', e.message))
  }
  return { code: 0, ok: true }
}

const callback = {
  'POST /callback/wxpay': async (req) => {
    const v = wxpay.verifyCallback(req.headers, req.rawBody || '')
    if (!v.ok) return { code: 'FAIL', msg: v.reason }
    const body = req.body || {}
    // 真实回调为加密 resource；生产解密后取 out_trade_no/transaction_id。此处兼容明文与 mock。
    const orderNo = body.out_trade_no || body.orderNo
    const transNo = body.transaction_id || body.transNo
    if (!orderNo) return { code: 'FAIL', msg: 'no out_trade_no' }
    await handlePayNotify(orderNo, transNo, false)
    return { code: 'SUCCESS', message: '成功' }
  },
}

export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...cPromo, ...integrations, ...web3, ...open, ...cIdentity, ...cNotes, ...callback }
export { handlePayNotify }
