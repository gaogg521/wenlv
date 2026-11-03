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
import { bindMobile, sealMobile } from '../infra/mobile.mjs'
import { bizDay, settlementPeriod } from '../infra/bizdate.mjs'
import * as entities from '../domain/entity-schema.mjs'
import { buildSvg, svgToPdf, orderReportDoc, beanDayReportDoc, settlementReportDoc } from '../domain/report.mjs'
import * as vc from '../domain/vc.mjs'
import * as asset from '../domain/asset.mjs'
import * as badgeDomain from '../domain/badge.mjs'
import { capabilityDoc, renderPdf as renderOnepagerPdf, renderPng as renderOnepagerPng } from '../domain/onepager.mjs'
import * as chain from '../infra/chain.mjs'
import * as wxapi from '../domain/wxapi.mjs'
import * as wxsec from '../infra/wxsec.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { fen2yuan, apiImg, toCsv, requireAdmin, scopeFilter, SUP_CATS, CREATOR_TAGS, audit, capabilityContext, publicBase, notifyMerchantStaff, handlePayNotify } from './_shared.mjs'

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
    if (Number(u.status) === 0) throw new BizError(1003, '账号已被停用，请联系客服')
    return { token: jwtSign({ uid: u.id, end: 'c' }, 7 * 24 * 3600), user: { id: u.id, nickname: u.nickname, memberLevel: u.member_level, growth: u.growth_value } }
  },

  'POST /c/auth/phone': async (req) => {
    const u = requireUser(req)
    // 微信官方「手机号快速验证组件」：前端 button open-type=getPhoneNumber → code → 服务端换号
    const { phoneNumber, mock } = await wxapi.getPhoneNumber(req.body.code || '')
    await tx(async (cc) => bindMobile(cc, u.uid, phoneNumber, BizError))
    return { phone: phoneNumber.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'), mock }
  },

  'GET /c/notify/templates': async (req) => {
    requireUser(req)
    const { getSecrets } = await import('../infra/secrets.mjs')
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
    const { cat = 'all', kw = '', city = '' } = req.query
    // 搜索同时命中标题、副标题，以及后台维护的「搜索关键词」「标签」
    const like = '%' + kw + '%'
    const rows = await q(`SELECT p.id, p.title, p.subtitle, p.price_from, p.bean_gift, p.city_code, p.cat, p.days_desc, p.images, p.days_desc days,
        JSON_EXTRACT(p.profile, '$.tags') tags_json
      FROM tour_product p WHERE p.status = 1 ${cat !== 'all' ? 'AND p.cat = ?' : ''}
      ${kw ? `AND (p.title LIKE ? OR p.subtitle LIKE ? OR JSON_SEARCH(p.profile, 'one', ?, NULL, '$.keywords') IS NOT NULL OR JSON_SEARCH(p.profile, 'one', ?, NULL, '$.tags') IS NOT NULL)` : ''}
      ${city ? 'AND p.city_code = ?' : ''} ORDER BY p.id`,
      [...(cat !== 'all' ? [cat] : []), ...(kw ? [like, like, like, like] : []), ...(city ? [city] : [])])
    return rows.map(({ tags_json, ...r }) => ({ ...r, tags: ((typeof tags_json === 'string' ? JSON.parse(tags_json) : tags_json) || []).slice(0, 3), loc: ({310118:'上海 · 青浦',320508:'苏州 · 姑苏',330523:'湖州 · 安吉'})[r.city_code] || r.city_code, beanGift: Number(r.bean_gift), price: Number(r.price_from), priceLabel: fen2yuan(r.price_from) }))
  },

  'GET /c/tours/:id': async (req) => {
    const p = await one(`SELECT p.*, m.name merchant_name FROM tour_product p JOIN merchant m ON m.id = p.merchant_id WHERE p.id = ?`, [req.params.id])
    if (!p || p.status !== 1) throw new BizError(1004, '商品不存在或已下架')
    const sessions = await q(`SELECT id, depart_date, quota, quota - booked AS left_seats, booked, min_go,
      price_adult, early_price, early_days, status, profile
      FROM tour_session WHERE product_id = ? AND depart_date >= CURDATE() AND status = 1 ORDER BY depart_date`, [p.id])
    const img = (u) => apiImg(u, req)
    const merchantRow = await one('SELECT * FROM merchant WHERE id = ?', [p.merchant_id])
    const scenicRow = p.scenic_id ? await one('SELECT * FROM scenic_spot WHERE id = ? AND status = 1', [p.scenic_id]) : null
    const relatedFaqs = await q(`SELECT id, question, answer FROM faq WHERE status = 1 AND JSON_CONTAINS(COALESCE(JSON_EXTRACT(profile, '$.related_products'), JSON_ARRAY()), CAST(? AS JSON)) ORDER BY is_hot DESC, sort, id LIMIT 5`, [String(p.id)])
    const agg = await one(`SELECT COALESCE(AVG(rating),0) avg_rating, COUNT(*) count FROM review WHERE product_id = ? AND status = 1`, [p.id])
    // 只下发白名单字段：此前 p.* 会把商家暗号下半句、未支付可见的上半句、单品佣金、合同编号等内部字段带给游客
    const PUB_COLS = ['id', 'channel', 'city_code', 'cat', 'title', 'subtitle', 'days_desc', 'price_from', 'bean_gift', 'merchant_id', 'scenic_id',
      'status', 'rich_desc', 'images', 'meeting_point', 'safety_note', 'insurance_note', 'insurance_fee', 'merchant_name']
    const PUB_PROFILE = ['tags', 'suitable', 'age_range', 'group_size', 'itinerary', 'transport', 'meeting_geo', 'notice', 'share_title', 'share_image', 'keywords']
    const pf = (typeof p.profile === 'string' ? JSON.parse(p.profile || '{}') : p.profile) || {}
    const pub = Object.fromEntries(PUB_COLS.map((k) => [k, p[k]]))
    pub.profile = Object.fromEntries(PUB_PROFILE.filter((k) => pf[k] != null).map((k) => [k, pf[k]]))
    return { ...pub, hasPhrase: !!p.phrase_user, beanGift: Number(p.bean_gift), priceLabel: fen2yuan(p.price_from),
      merchantCard: entities.publicProfile('merchant', merchantRow, img),
      scenicCard: scenicRow ? { id: scenicRow.id, ...entities.publicProfile('scenic', scenicRow, img) } : null,
      relatedFaqs,
      sessions: sessions.map(({ profile, ...s }) => {
      const ep = order.priceForSession(s)
      return { ...s, info: entities.publicProfile('session', { ...s, profile }), priceLabel: fen2yuan(s.price_adult), priceNow: ep.price, priceNowLabel: fen2yuan(ep.price),
        isEarly: ep.isEarly, daysToDepart: ep.daysToDepart,
        groupProgress: { booked: Number(s.booked), minGo: Number(s.min_go), reached: Number(s.booked) >= Number(s.min_go) } }
    }),
      rating: { avg: Math.round(Number(agg.avg_rating) * 10) / 10, count: Number(agg.count) },
      // 预订须知用的实时规则：页面不写死参数中心可调的数值
      bookingRules: { payTimeoutMin: await cfgNum('order.pay_timeout'), beanDeductMaxPct: await cfgNum('bean.deduct_max_pct'), beanPerYuan: 10,
        refundRules: refundPolicy.describe(await cfg('order.refund_policy')) } }
  },

  // 小程序装修（公开，首屏可用）：文案与配置来自后台「小程序装修」；旅豆数值来自参数中心，页面不写死
  'GET /c/site': async (req) => {
    const row = await one('SELECT * FROM site_config WHERE id = 1')
    const v = row ? entities.readValues('site', row) : {}
    const img = (u) => (u ? apiImg(u, req) : u)
    const { merchant_notice, merchant_join_tip, ...pub } = v // 商户端内容不给游客端
    for (const k of ['share_image', 'service_qr']) pub[k] = img(pub[k])
    pub.destinations = (pub.destinations || []).map((d) => ({ ...d, cover: img(d.cover) }))
    return { ...pub, beanRules: { orderRatePct: Math.round(await cfgNum('bean.order_rate') * 100), deductMaxPct: Math.round(await cfgNum('bean.deduct_max_pct') * 100),
      expireMonths: await cfgNum('bean.expire_months'), beanPerYuan: 10 } }
  },
  // 履约商户 / 景区 公开资料页（白名单字段）
  'GET /c/places/:kind/:id': async (req) => {
    const kind = req.params.kind
    if (!['merchant', 'scenic'].includes(kind)) throw new BizError(1004, '不支持的类型')
    const row = kind === 'merchant'
      ? await one('SELECT * FROM merchant WHERE id = ? AND status = 1', [req.params.id])
      : await one('SELECT * FROM scenic_spot WHERE id = ? AND status = 1', [req.params.id])
    if (!row) throw new BizError(1004, '未找到或已停止合作')
    const col = kind === 'merchant' ? 'merchant_id' : 'scenic_id'
    const tours = await q(`SELECT id, title, price_from, images, city_code, cat, days_desc FROM tour_product WHERE ${col} = ? AND status = 1 ORDER BY id DESC LIMIT 10`, [row.id])
    return { kind, id: row.id, ...entities.publicProfile(kind, row, (u) => apiImg(u, req)),
      tours: tours.map((t) => ({ ...t, priceLabel: fen2yuan(t.price_from) })) }
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
    const badges = await badgeDomain.evaluateSafe(u.uid)
    return { id, rating: rate, secMock: sec.mock, badges }
  },

  'POST /c/orders': async (req) => {
    const u = requireUser(req)
    const { sessionId, qty = 1, beanDeduct = 0, promoScene, contactName, contactPhone } = req.body
    const r = await order.place({
      userId: u.uid, sessionId, qty, wantedBeans: beanDeduct, promoScene, withInsurance: !!req.body.insurance,
      beanHook: { deduct: (uid, beans, orderNo) => bean.deduct(uid, beans, bean.BIZ.DEDUCT, orderNo) },
    })
    await tx(async (cc) => {
      // 联系电话加密落库（V38）；旧列 contact_phone_enc 只留历史明文，新单不再写
      await cc.upd('UPDATE orders SET contact_name = ?, contact_phone_sealed = ?, contact_phone_enc = NULL WHERE order_no = ?',
        [contactName || null, contactPhone ? sealMobile(String(contactPhone)).enc : null, r.orderNo])
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
    return { orderNo: r.orderNo, amountPay: r.amountPay, amountPayLabel: fen2yuan(r.amountPay), beanDeducted: r.beanDeducted,
      insuranceFee: r.insuranceFee || 0, insuranceNote: r.insuranceNote || null, payParams: pay }
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
    let o = await one(`SELECT o.*, p.title, p.days_desc, p.city_code FROM orders o JOIN tour_product p ON p.id = o.product_id WHERE o.order_no = ?`, [req.params.no])
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    if (Number(o.status) === 60) {
      await refund.refresh(o.order_no).catch(e => console.error('[refund:query]', e.message))
      o = { ...o, ...(await order.byNo(o.order_no)) }
    }
    const passes = await q('SELECT id, name, status FROM travel_pass WHERE order_id = ?', [o.id])
    const events = await q('SELECT from_st, to_st, actor, detail, created_at FROM order_event WHERE order_id = ? ORDER BY id', [o.id])
    const reviewed = !!(await one('SELECT id FROM review WHERE order_id = ?', [o.id]))
    const canRebook = Number(o.status) === 70 && o.close_reason === 'group_cancel' &&
      !(await one('SELECT id FROM orders WHERE rebook_of = ?', [o.order_no]))
    // 改签候选：同频道、同价（单价×数量=原 goods）、报名中、余量足够
    const rebookOptions = canRebook ? await q(
      `SELECT s.id, s.depart_date, s.price_adult, s.quota - s.booked AS left_seats, p.title
       FROM tour_session s JOIN tour_product p ON p.id = s.product_id
       WHERE p.channel = (SELECT p2.channel FROM tour_product p2 WHERE p2.id = ?)
         AND s.price_adult * ? = ? AND s.status = 1 AND s.depart_date >= CURDATE()
         AND s.quota - s.booked >= ? AND s.id <> ?
       ORDER BY s.depart_date LIMIT 10`,
      [o.product_id, Number(o.qty), Number(o.amount_goods), Number(o.qty), o.session_id]) : []
    const lastRefund = await one('SELECT refund_no, amount, fee_amount, fee_rate, days_to_depart, status, settled_at FROM refunds WHERE order_id = ? ORDER BY id DESC LIMIT 1', [o.id])
    const refundInfo = lastRefund ? { refundNo: lastRefund.refund_no, refundLabel: fen2yuan(lastRefund.amount), feeLabel: fen2yuan(lastRefund.fee_amount),
      feeRate: lastRefund.fee_rate != null ? Number(lastRefund.fee_rate) : null, status: Number(lastRefund.status) } : null
    // 已支付后才给领队联系方式；商户只给公开营业信息
    const paid = [20, 30, 40, 50].includes(Number(o.status))
    const sRow = await one('SELECT * FROM tour_session WHERE id = ?', [o.session_id])
    const trip = sRow ? { departDate: String(sRow.depart_date).slice(0, 10), ...(paid ? entities.sessionForOrder(sRow) : entities.publicProfile('session', sRow)) } : null
    const mRow = await one('SELECT * FROM merchant WHERE id = ?', [o.merchant_id])
    const mp = entities.publicProfile('merchant', mRow, (u) => apiImg(u, req)) || {}
    const merchantContact = { id: o.merchant_id, name: mp.short_name || mp.name, phone: mp.service_phone || null, address: mp.address || null, geo: mp.geo || null, logo: mp.logo || null }
    return { ...o, amountPayLabel: fen2yuan(o.amount_pay), passes, events, reviewed, canRebook, rebookOptions, refundInfo, trip, merchantContact }
  },

  'POST /c/orders/:no/pay': async (req) => {
    const u = requireUser(req), o = await order.byNo(req.params.no)
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    if (Number(o.status) !== 10) throw new BizError(2002, '当前订单无需支付，请刷新状态')
    const a = await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [u.uid])
    return { payParams: await wxpay.jsapiOrder({ orderNo: o.order_no, amountFen: Number(o.amount_pay), openid: a.mini_a_openid, description: '文旅订单 ' + o.order_no }) }
  },
  'GET /c/pass/:id/code': async (req) => {
    const u = requireUser(req)
    const p = await one('SELECT * FROM travel_pass WHERE id = ? AND user_id = ? AND status = 1', [req.params.id, u.uid])
    if (!p) throw new BizError(4001, '凭证不存在')
    return await pass.currentQr(Number(req.params.id))
  },

  'GET /c/bean/account': async (req) => {
    requireUser(req)
    const bal = await bean.balance(requireUser(req).uid)
    const rate = Math.round(await cfgNum('bean.order_rate') * 100), cap = Math.round(await cfgNum('bean.deduct_max_pct') * 100), months = await cfgNum('bean.expire_months')
    return { balance: bal, orderRatePct: rate, deductMaxPct: cap, expireMonths: months,
      rule: `消费返豆 ${rate}% · 100 豆可抵 10 元 · 单笔抵扣上限 ${cap}% · 滚动 ${months} 个月有效 · 不可转让不可购买` }
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
      levelThresholds: await cfgArr('member.level.thresholds'),
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
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'uploads')
    fs.mkdirSync(dir, { recursive: true })
    const name = 'avatar_' + u.uid + '.' + (ext === 'jpeg' ? 'jpg' : ext)
    fs.writeFileSync(path.join(dir, name), buf)
    return { url: '/uploads/' + name }
  },

  // 退款试算：与真正扣费同一函数，确认弹窗里的金额就是实际退回金额
  'GET /c/orders/:no/refund-quote': async (req) => {
    const u = requireUser(req)
    const o = await order.byNo(req.params.no)
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    const qt = await refund.quoteFor(o)
    return { ...qt, feeLabel: qt.feeFen != null ? fen2yuan(qt.feeFen) : null, refundLabel: qt.refundFen != null ? fen2yuan(qt.refundFen) : null,
      amountPayLabel: fen2yuan(o.amount_pay), rules: refundPolicy.describe(await cfg('order.refund_policy')) }
  },
  'POST /c/orders/:no/refund': async (req) => {
    const u = requireUser(req)
    const o = await order.byNo(req.params.no)
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    const { reason } = req.body
    if (o.status === 10) { await order.fire(o.order_no, 'CLOSE_TIMEOUT', 'user'); return { closed: true } }
    // 自助退款只覆盖"已支付、未核销"：核销即服务已发生，全额自助退款会让用户玩完再全退。
    // 已核销订单的售后由客服在后台处理（后台退款接口不受此限制，并留审计）
    if (![20, 30].includes(Number(o.status))) throw new BizError(2002, Number(o.status) === 40 ? '凭证已核销，如需售后请联系客服' : '当前状态不可退款')
    // 按退改梯度（order.refund_policy）扣手续费；不在任何档位内（如出发当天）直接拒绝并提示联系客服
    const r = await refund.refundOrder({ orderNo: o.order_no, reason: reason || '用户退款', operator: 'user:' + u.uid, applyPolicy: true })
    await q("UPDATE orders SET close_reason = 'user_refund' WHERE order_no = ? AND status = 70", [o.order_no])
    return r
  },

  // 免费改签（§4 拼团定稿）：未成团退款单 → 同频道同价团期，免支付出票
  'POST /c/orders/:no/rebook': async (req) => {
    const u = requireUser(req)
    const { sessionId } = req.body
    return await group.rebook({ userId: u.uid, orderNo: req.params.no, sessionId })
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
    if (await promo.isUserFrozen(u.uid)) throw new BizError(1003, '账号已被停用，提现暂停')
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

// 术语字典：一处定义、三处分发（T1 用户端 / T2 后台 / T3 对外）
// 小程序不得硬写"存证/链/Web3/NFT/Token/钱包"等词，一律从这里取
const LEXICON = {
  T1: {
    attestation: '可信记录', attest_list: '可信记录流水', attest_empty: '暂无记录',
    did: '文旅数字身份', pass: '权益凭证', badge: '数字徽章', bean: '旅豆',
    note: '记录仅用于权益与贡献核算',
    ledger_sealed: '今日账本已封存',
  },
  T2: {
    attestation: '存证', attest_batch: '存证批次', merkle_root: 'Merkle 根',
    anchor: '锚定', pending_anchor: '已打包·待锚定', anchored: '已锚定',
  },
  T3: {
    chain: '向往自由链', pass: '链上权益凭证', attest: '联盟链存证',
  },
  updatedAt: '2026-10-26',
}

const lexicon = {
  'GET /c/lexicon': async () => LEXICON.T1,           // 小程序端只拿得到 T1
  'GET /admin/lexicon': async (req) => { await requireAdmin(req); return LEXICON },
}

// 推广中心补全：自助取码 + 客户脱敏列表
const cPromo = {
  'GET /c/promote/scene': async (req) => {
    const u = requireUser(req)
    const p = await one('SELECT status FROM promoter WHERE user_id = ? AND status = 1', [u.uid])
    if (!p) return { promoter: false }
    const { createScene } = await import('../domain/promo.mjs')
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
  'GET /c/notes': async (req) => {
    const u = requireUser(req)
    if(u.end!=='c')throw new BizError(1003,'仅游客账号可查看作品')
    return await q(`SELECT c.id,c.title,c.status,c.like_count,c.published_at,c.reject_reason,
      m.reason offline_reason,a.status appeal_status,a.resolution appeal_resolution,
      (c.status=4 AND c.moderation_id IS NOT NULL AND a.id IS NULL) can_appeal
      FROM content_note c LEFT JOIN content_moderation m ON m.id=(SELECT x.id FROM content_moderation x WHERE x.note_id=c.id ORDER BY x.id DESC LIMIT 1)
      LEFT JOIN content_appeal a ON a.moderation_id=m.id WHERE c.user_id=? ORDER BY c.id DESC LIMIT 30`,[u.uid])
  },
  'POST /c/notes': async (req) => {
    const u = requireUser(req)
    const { title, body, images, relatedProductId } = req.body
    if (!body) throw new BizError(1001, '内容不能为空')
    const { msgSecCheck } = await import('../infra/wxsec.mjs')
    const sec = await msgSecCheck((title || '') + ' ' + body, 'mock-openid-' + u.uid)
    // 图片机审（P2 启用 mediaCheckAsync）：MOCK 通道直通；真实通道为异步回执，先挂机审中
    const imgUrls = Array.isArray(images) ? images.slice(0, 9) : []
    const imgSec = []
    let status = sec.pass ? 2 : 1
    for (const url of imgUrls) {
      const r = await wxapi.mediaCheckAsync(String(url).slice(0, 500), 'mock-openid-' + u.uid)
      imgSec.push({ url: String(url).slice(0, 500), traceId: r.traceId, mock: r.mock })
      if (!r.mock) status = 0 // 真实异步机审 → 机审中，等回执
    }
    const id = await tx(async (c) => c.ins(
      'INSERT INTO content_note (user_id, title, body, status, sec_check_id, related_product_id,published_at) VALUES (?,?,?,?,?,?,IF(?=2,NOW(3),NULL))',
      [u.uid, title || null, JSON.stringify({ text: sanitizeRich(String(body)), images: imgUrls, imgSec }), status, sec.mock ? 'mock' : 'wx-sec', relatedProductId || null,status]))
    return { id, status, secMock: sec.mock, imgChecked: imgSec.length,
      msg: status === 2 ? '已发布' : status === 0 ? '图片机审中' : '进入人工审核' }
  },
  // 笔记详情独立页（P2）：仅已发布可见
  'GET /c/notes/:id': async (req) => {
    requireUser(req)
    const n = await one(`SELECT c.id, c.title, c.body, c.like_count, c.published_at, c.related_product_id,
      u.nickname author, p.title product_title
      FROM content_note c JOIN user_account u ON u.id = c.user_id
      LEFT JOIN tour_product p ON p.id = c.related_product_id
      WHERE c.id = ? AND c.status = 2`, [req.params.id])
    if (!n) throw new BizError(1004, '笔记不存在或未发布')
    let body = n.body
    try { body = typeof body === 'string' ? JSON.parse(body) : body } catch { body = { text: String(body) } }
    return { ...n, body, text: (body && body.text) || '', images: (body && body.images) || [] }
  },
  // 约稿任务四态机（P2）：0待领取 1进行中 2审核中 3已完成
  'GET /c/tasks': async (req) => {
    const u = requireUser(req)
    // 可领取：招募中、未截止、还有名额（0 = 不限）、我还没领过
    const raw = await q(`SELECT t.*, (SELECT COUNT(*) FROM content_task_entry e WHERE e.task_id = t.id) taken FROM content_task t
      WHERE t.status = 0 AND (t.deadline IS NULL OR t.deadline >= NOW())
        AND NOT EXISTS (SELECT 1 FROM content_task_entry m WHERE m.task_id = t.id AND m.user_id = ?)
      HAVING t.max_participants = 0 OR taken < t.max_participants ORDER BY t.id DESC LIMIT 20`, [u.uid])
    const CAT = { note: '图文笔记', video: '短视频', strategy: '攻略长文', review: '体验点评' }
    const open = raw.map((t) => {
      const pp = entities.publicProfile('task', t, (x) => apiImg(x, req))
      return { id: t.id, task_no: t.task_no, title: t.title, brief: t.brief, reward_beans: t.reward_beans, cover: pp.cover_img || null,
        categoryLabel: CAT[t.category] || '图文笔记', tags: pp.tags || [], platforms: pp.platforms_labels || [],
        cashLabel: Number(t.cash_reward) ? fen2yuan(t.cash_reward) : null, deadline: t.deadline ? String(t.deadline).slice(0, 16) : null,
        minWords: Number(t.min_words) || 0, minImages: Number(t.min_images) || 0,
        slotsLeft: Number(t.max_participants) ? Number(t.max_participants) - Number(t.taken) : null }
    })
    // 我参与的：被驳回退回创作中的，带上最近一次驳回原因，作者据此修改后重新提交
    const mine = (await q(`SELECT t.id, t.task_no, t.title, e.id entry_id, e.status, t.reward_beans, e.submitted_at,
        (SELECT CONCAT(r.verdict, '|', COALESCE(r.reason, '')) FROM content_task_review r WHERE r.entry_id = e.id ORDER BY r.id DESC LIMIT 1) last_review
      FROM content_task_entry e JOIN content_task t ON t.id = e.task_id WHERE e.user_id = ? ORDER BY e.id DESC LIMIT 20`, [u.uid]))
      .map(({ last_review, ...t }) => ({ ...t, rejectReason: Number(t.status) === 1 && String(last_review || '').startsWith('0|') ? String(last_review).slice(2) : null }))
    return { open, mine }
  },
  'GET /c/tasks/:id': async (req) => {
    const u = requireUser(req)
    const t = await one('SELECT * FROM content_task WHERE id = ?', [req.params.id])
    const e = t ? await one('SELECT * FROM content_task_entry WHERE task_id = ? AND user_id = ?', [t.id, u.uid]) : null
    if (!t || (Number(t.status) !== 0 && !e)) throw new BizError(1004, '任务不存在或已下线')
    const taken = Number((await one('SELECT COUNT(*) n FROM content_task_entry WHERE task_id = ?', [t.id])).n)
    const pp = entities.publicProfile('task', t, (x) => apiImg(x, req))
    const prod = t.product_id ? await one('SELECT id, title FROM tour_product WHERE id = ? AND status = 1', [t.product_id]) : null
    const last = e ? await one('SELECT verdict, reason FROM content_task_review WHERE entry_id = ? ORDER BY id DESC LIMIT 1', [e.id]) : null
    return { id: t.id, mine: !!e, product: prod,
      // status：已参与时是我的进度（1 创作中 2 审核中 3 已通过），未参与时 0 = 可领取
      status: e ? Number(e.status) : 0,
      full: !e && Number(t.max_participants) > 0 && taken >= Number(t.max_participants),
      slotsLeft: Number(t.max_participants) ? Math.max(0, Number(t.max_participants) - taken) : null,
      ...pp, cash_reward_label: Number(t.cash_reward) ? fen2yuan(t.cash_reward) : null,
      rejectReason: e && Number(e.status) === 1 && last && Number(last.verdict) === 0 ? last.reason : null }
  },
  'POST /c/tasks/:id/claim': async (req) => {
    const u = requireUser(req)
    return tx(async (c) => {
      const t = await c.one('SELECT * FROM content_task WHERE id = ? FOR UPDATE', [req.params.id]) // 锁任务行，名额判断与写入串行
      if (!t || Number(t.status) !== 0) throw new BizError(2002, '任务已下线')
      if (t.deadline && new Date(t.deadline) < new Date()) throw new BizError(2002, '任务已截止')
      if (await c.one('SELECT id FROM content_task_entry WHERE task_id = ? AND user_id = ?', [t.id, u.uid])) throw new BizError(2002, '你已领取过这个任务')
      const taken = Number((await c.one('SELECT COUNT(*) n FROM content_task_entry WHERE task_id = ?', [t.id])).n)
      if (Number(t.max_participants) > 0 && taken >= Number(t.max_participants)) throw new BizError(2002, '名额已满')
      const id = await c.ins('INSERT INTO content_task_entry (task_id, user_id, status) VALUES (?,?,1)', [t.id, u.uid])
      return { claimed: true, entryId: id }
    })
  },
  'POST /c/tasks/:id/submit': async (req) => {
    const u = requireUser(req)
    const { noteId } = req.body
    const note = await one('SELECT id, user_id, status FROM content_note WHERE id = ?', [noteId])
    if (!note || Number(note.user_id) !== Number(u.uid)) throw new BizError(1004, '笔记不存在')
    if (Number(note.status) !== 2) throw new BizError(1001, '仅已发布的笔记可提交审核')
    const n = await tx(async (c) => c.upd('UPDATE content_task_entry SET status = 2, note_id = ?, submitted_at = NOW(3) WHERE task_id = ? AND user_id = ? AND status = 1',
      [noteId, req.params.id, u.uid]))
    if (n !== 1) throw new BizError(2002, '仅创作中的任务可提交')
    return { submitted: true }
  },
  // 常见问题（小程序「我的-常见问题」）
  'GET /c/faqs': async (req) => {
    requireUser(req)
    const rows = await q('SELECT id, question, answer, category, is_hot, profile FROM faq WHERE status = 1 ORDER BY is_hot DESC, sort, id')
    // 同义问法只用于搜索命中，随条目下发
    return rows.map(({ profile, ...f }) => ({ ...f, keywords: ((typeof profile === 'string' ? JSON.parse(profile || '{}') : profile) || {}).keywords || [] }))
  },
  // 首页轮播
  'GET /c/banners': async (req) => {
    requireUser(req)
    const rows = await q(`SELECT id, title, sub_title, image, link, profile FROM banner WHERE status = 1
      AND (start_at IS NULL OR start_at <= NOW(3)) AND (end_at IS NULL OR end_at >= NOW(3))
      ORDER BY sort, id LIMIT 12`)
    // 投放城市：传了 city 时只给面向该城市（或未限定城市）的轮播；未传时给全部
    const city = String(req.query.city || '')
    return rows.map(({ profile, ...b }) => {
      const pf = (typeof profile === 'string' ? JSON.parse(profile || '{}') : profile) || {}
      return { ...b, image: apiImg(b.image, req), bgColor: pf.bg_color || null, cities: pf.cities || [] }
    }).filter((b) => !city || !b.cities.length || b.cities.includes(city)).slice(0, 6)
  },
  // 目的地城市聚合（P2）
  'GET /c/destinations': async (req) => {
    requireUser(req)
    const rows = await q(`SELECT p.city_code, COUNT(*) products, MIN(p.price_from) price_from
      FROM tour_product p WHERE p.status = 1 GROUP BY p.city_code ORDER BY products DESC`)
    // 目的地名称、介绍、封面来自后台「小程序装修 · 目的地」；未配置的城市回退为城市名
    const site = await one('SELECT * FROM site_config WHERE id = 1')
    const dests = site ? (entities.readValues('site', site).destinations || []) : []
    const CITY = Object.fromEntries(entities.DICT.city)
    const order = dests.map((d) => d.city)
    return rows.map((r) => {
      const d = dests.find((x) => x.city === r.city_code) || {}
      return { ...r, cityName: d.name || CITY[r.city_code] || r.city_code, intro: d.intro || '', cover: d.cover ? apiImg(d.cover, req) : null,
        priceFromLabel: (Number(r.price_from) / 100).toFixed(0) }
    }).sort((a, b) => (order.indexOf(a.city_code) + 1 || 99) - (order.indexOf(b.city_code) + 1 || 99))
  },
}

// ---------- 暗号玩法 + KYC 实名（游客端） ----------
const cPhraseKyc = {
  // 游客凭证暗号：出票后可见（剧本游"入戏"开场白）
  'GET /c/orders/:no/phrase': async (req) => {
    const u = requireUser(req)
    const o = await order.byNo(req.params.no)
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    if (!o.paid_at) throw new BizError(2002, '支付后可见暗号')
    const p = await one('SELECT phrase_user, phrase_merchant, profile FROM tour_product WHERE id = ?', [o.product_id])
    if (!p || !p.phrase_user) return { enabled: false }
    const pf = (typeof p.profile === 'string' ? JSON.parse(p.profile || '{}') : p.profile) || {}
    // 只下发游客需要的：上半句、提示、角色与地点；下半句与剧情说明只给核销员
    return { enabled: true, userPhrase: p.phrase_user, hint: pf.phrase_hint || '到达剧情点位后，向 NPC 说出你的暗号',
      role: pf.phrase_role || null, location: pf.phrase_location || null }
  },

  // KYC 实名提交（一户一档：重复提交=更新待审资料）
  'POST /c/kyc/submit': async (req) => {
    const u = requireUser(req)
    const { realName, idNo } = req.body
    const name = String(realName || '').trim()
    const id = String(idNo || '').trim().toUpperCase()
    if (!/^[\u4e00-\u9fa5]{2,20}$/.test(name)) throw new BizError(1001, '请输入真实中文姓名')
    if (!/^[0-9X]{17}[0-9X]$|^[0-9X]{15}$/.test(id)) throw new BizError(1001, '身份证号格式不正确')
    const mask = id.length === 18 ? id.slice(0, 3) + '***********' + id.slice(-4) : id.slice(0, 3) + '******' + id.slice(-4)
    const enc = Buffer.from(id + '|' + name, 'utf8') // 与 contact_phone_enc 同口径（生产换 KMS 信封）
    await q(`INSERT INTO kyc_application (user_id, real_name, id_no_enc, id_no_mask, status)
      VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE real_name = VALUES(real_name),
      id_no_enc = VALUES(id_no_enc), id_no_mask = VALUES(id_no_mask), status = 0, reject_note = NULL, reviewed_at = NULL`,
      [u.uid, name, enc, mask])
    return { submitted: true, masked: mask }
  },
  'GET /c/kyc/mine': async (req) => {
    const u = requireUser(req)
    const r = await one('SELECT real_name, id_no_mask, status, reject_note FROM kyc_application WHERE user_id = ?', [u.uid])
    return r || { status: -1 }
  },
}

// 用户侧数字身份（小程序 A「我的数字身份」页：Travel ID = 凭证+徽章+存证流水）
const cIdentity = {
  'GET /c/identity': async (req) => {
    const u = requireUser(req)
    const acc = await one('SELECT nickname, member_level, growth_value, created_at FROM user_account WHERE id = ?', [u.uid])
    const passes = await q('SELECT id, name, kind, status, valid_to, created_at FROM travel_pass WHERE user_id = ? ORDER BY id DESC LIMIT 20', [u.uid])
    // 勋章墙：全部勋章（已获得点亮、未获得置灰并给出获得条件），有效期从授予日起算
    const defs = await q('SELECT * FROM badge')
    const owned = await q('SELECT badge_id, MAX(granted_at) granted_at FROM user_badge WHERE user_id = ? GROUP BY badge_id', [u.uid])
    const badges = defs.map((b) => {
      const pp = entities.publicProfile('badge', b, (x) => apiImg(x, req))
      const got = owned.find((o) => Number(o.badge_id) === Number(b.id))
      const days = Number(pp.valid_days) || 0
      const expireAt = got && days ? new Date(new Date(String(got.granted_at).replace(' ', 'T') + '+08:00').getTime() + days * 86400000).toISOString().slice(0, 10) : null
      return { id: b.id, name: b.name, icon_key: b.icon_key, iconImg: pp.icon_img || null, rarity: pp.rarity || 'common', rarityLabel: pp.rarity_label || '普通',
        color: pp.color || null, description: pp.description || '', ruleDesc: pp.rule_desc || '', order: Number(pp.display_order) || 0,
        owned: !!got, granted_at: got ? got.granted_at : null, expireAt, expired: !!(expireAt && expireAt < bizDay()) }
    }).sort((a, b) => (b.owned - a.owned) || (a.order - b.order))
    const myOrders = await q('SELECT order_no FROM orders WHERE user_id = ?', [u.uid])
    const attestations = []
    for (const o of myOrders.slice(0, 10)) {
      const e = await one("SELECT payload_hash, status, created_at FROM attest_event WHERE biz_type = 'order' AND biz_ref = ?", [o.order_no])
      if (e) attestations.push({ orderNo: o.order_no, code: String(e.payload_hash).slice(0, 8).toUpperCase(), sealed: e.status >= 1, at: e.created_at })
    }
    return { profile: { nickname: acc.nickname, memberLevel: acc.member_level, growth: acc.growth_value, joinedAt: acc.created_at },
      passes, badges, attestations,
      statement: '消费与权益的可信记录，作为贡献分与会员成长的依据' }
  },
  // 数字身份凭证（VC-JWT）：用户可取走、可出示、他方可验。微信内不展示字样（D6），由 B/G 端与生态 H5 使用
  'GET /c/vc': async (req) => {
    const u = requireUser(req)
    const scope = req.query.scope === 'basic' ? 'basic' : 'travel'
    const v = await vc.issue(u.uid, scope)
    return {
      did: v.did, jwt: v.jwt, scope, expiresAt: v.expiresAt,
      claims: v.claims, issuer: v.issuer,
      disclose: ['会员等级', '成长区间', '入会年月', '行程数', '城市数', '徽章名'],
      withheld: ['姓名', '手机号', '身份证号', '订单号', '金额'],
    }
  },
}

export { c, cWithdraw, lexicon, cPromo, cNotes, cPhraseKyc, cIdentity }
