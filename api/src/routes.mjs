// 路由层：/c 游客端 · /m 商户端 · /admin 运营后台 · /callback/wxpay 支付回调
import { q, one, count, tx, BizError } from './db.mjs'
import { cfg, cfgAll, cfgNum, cfgArr, loadConfig } from './config.mjs'
import { requireUser, jwtSign, code2Session, hashPassword, verifyPassword } from './auth.mjs'
import * as order from './domain/order.mjs'
import * as bean from './domain/bean.mjs'
import * as pass from './domain/pass.mjs'
import * as promo from './domain/promo.mjs'
import * as refund from './domain/refund.mjs'
import * as group from './domain/group.mjs'
import * as wxpay from './domain/wxpay.mjs'
import * as attestDomain from './domain/attest.mjs'
import * as merkleLib from './domain/merkle.mjs'
import * as refundPolicy from './domain/refund-policy.mjs'
import { sanitizeRich } from './infra/sanitize.mjs'
import { bizDay } from './infra/bizdate.mjs'
import * as entities from './domain/entity-schema.mjs'
import { buildSvg, svgToPdf, orderReportDoc, beanDayReportDoc, settlementReportDoc } from './domain/report.mjs'
import * as vc from './domain/vc.mjs'
import * as asset from './domain/asset.mjs'
import { capabilityDoc, renderPdf as renderOnepagerPdf, renderPng as renderOnepagerPng } from './domain/onepager.mjs'
import * as chain from './infra/chain.mjs'
import * as wxapi from './domain/wxapi.mjs'
import * as wxsec from './infra/wxsec.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const fen2yuan = (f) => (Number(f) / 100).toFixed(2)
// 相对路径图片补全为对外基址（PUBLIC_BASE 或按请求头推断），真机/外网不能拿到 127.0.0.1
const apiImg = (u, req) => (u && /^https?:/.test(u)) ? u : (u ? publicBase(req) + u : u)
// CSV 序列化：RFC4180 转义 + UTF-8 BOM（Excel 直开不乱码）
function toCsv(rows) {
  if (!rows.length) return '\uFEFF(空)\n'
  const esc = (v) => { const str = v == null ? '' : String(v); return /[",\n]/.test(str) ? '"' + str.replaceAll('"', '""') + '"' : str }
  const head = Object.keys(rows[0]).join(',')
  const body = rows.map((r) => Object.values(r).map(esc).join(',')).join('\n')
  return '\uFEFF' + head + '\n' + body + '\n'
}

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
    return { id, rating: rate, secMock: sec.mock }
  },

  'POST /c/orders': async (req) => {
    const u = requireUser(req)
    const { sessionId, qty = 1, beanDeduct = 0, promoScene, contactName, contactPhone } = req.body
    const r = await order.place({
      userId: u.uid, sessionId, qty, wantedBeans: beanDeduct, promoScene, withInsurance: !!req.body.insurance,
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
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'static', 'uploads')
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

// ---------- /m 商户端 ----------
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
    return { todayOrders: u.role >= 2 ? Number(today.c) : 0, todayGmv: u.role >= 2 ? fen2yuan(today.gmv) : '—', pendingVerify: pending, myVerified: await count('SELECT COUNT(*) c FROM verification_log WHERE merchant_id=? AND staff_id=? AND result=1 AND DATE(created_at)=CURDATE()',[mid,u.uid]) }
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
    const buf = Buffer.from(phoneNumber, 'utf8')
    const u = await one('SELECT * FROM user_account WHERE mobile_enc = ?', [buf])
    if (!u) throw new BizError(1004, '该手机号未注册，请先用微信登录')
    const staff = await one('SELECT merchant_id, role FROM merchant_staff WHERE user_id = ? AND status = 1', [u.id])
    return { linked: phoneNumber.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'),
      bound: !!staff, merchantId: staff ? Number(staff.merchant_id) : null, role: staff ? Number(staff.role) : null }
  },
  // 离线名单（§10）：断网前同步本店有效凭证 + 展示码映射
  'GET /m/verify/offline-list': async (req) => {
    const u = requireUser(req)
    return await pass.offlineListForStore(u.merchantId)
  },

  // 恢复上传（二次校验）：逐条重走 verifyScan；失败条目进人工队列
  'POST /m/verify/offline-batch': async (req) => {
    const u = requireUser(req)
    const { items = [] } = req.body
    const results = []
    for (const it of items.slice(0, 200)) {
      const payload = String(it.payload || '').trim()
      if (!payload) continue
      const r = await pass.verifyScan({ merchantId: u.merchantId, staffId: u.uid, payload, cityCode: '310118' })
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
    return await q(`SELECT o.order_no, o.status, o.amount_pay, o.qty, o.paid_at, p.title, o.contact_name
      FROM orders o JOIN tour_product p ON p.id = o.product_id
      WHERE o.merchant_id = ? AND o.status >= 20 ORDER BY o.id DESC LIMIT 50`, [u.merchantId])
  },

  'GET /m/orders/:no': async (req) => {
    const u = requireUser(req)
    const o = await one(`SELECT o.id,o.order_no,o.status,o.qty,o.amount_pay,o.contact_name,o.contact_phone_enc,o.created_at,o.paid_at,p.title,s.depart_date
      FROM orders o JOIN tour_product p ON p.id=o.product_id JOIN tour_session s ON s.id=o.session_id WHERE o.order_no=? AND o.merchant_id=?`, [req.params.no,u.merchantId])
    if (!o) throw new BizError(2003, '本店无此订单')
    const phone = o.contact_phone_enc ? String(o.contact_phone_enc) : ''
    const passes = await q('SELECT id,status FROM travel_pass WHERE order_id=?', [o.id])
    const { contact_phone_enc, ...safe } = o
    return { ...safe, contactPhone: phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'), passes }
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
    if (action === 'price') { await q('UPDATE tour_session SET price_adult = ? WHERE id = ?', [value, req.params.sid]); return { price: value } }
    if (action === 'early') {
      // 早鸟价（旺季武器 §9 P1）：value={price, days}；price=null 关闭
      const price = value && value.price != null ? Number(value.price) : null
      const days = value && value.days != null ? Math.max(0, Number(value.days)) : 3
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
    // 明细：本单包含的订单（settlement_id 挂钩，对账逐单可查）
    const items = await q(`SELECT o.order_no, o.amount_pay, o.completed_at, p.title FROM orders o
      JOIN tour_product p ON p.id = o.product_id
      WHERE o.settlement_id = ? AND o.merchant_id = ? ORDER BY o.id DESC`, [req.params.id, u.merchantId])
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

// 资源池枚举：供应商类目
const SUP_CATS = ['ticket', 'hotel', 'transport', 'ground', 'catering', 'other']
// 创作者标签
const CREATOR_TAGS = ['none', 'signed', 'star', 'limited']

// 富文本白名单清洗（后台编辑内容入库前统一过一道：去脚本/事件/外域脚本）

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

  // 看板三件套（低垂果实 #6）：待办聚合 / 热门主题游 TOP5 / 活动转化漏斗
  'GET /admin/dash/insights': async (req) => {
    await requireAdmin(req)
    const pendingWithdrawals = await one("SELECT COUNT(*) c FROM promoter_withdraw WHERE status = 0")
    const pendingConflicts = await one("SELECT COUNT(*) c FROM verify_offline_conflict WHERE status = 0")
    const pendingNotes = await one("SELECT COUNT(*) c FROM content_note WHERE status = 1")
    const pendingMerchants = await one("SELECT COUNT(*) c FROM merchant WHERE status = 0")
    const pendingTasks = await one("SELECT COUNT(*) c FROM content_task WHERE status = 2")
    const topTours = await q(`SELECT p.id, p.title, COUNT(o.id) orders, COALESCE(SUM(o.amount_pay),0) gmv
      FROM orders o JOIN tour_product p ON p.id = o.product_id
      WHERE o.status >= 20 GROUP BY p.id, p.title ORDER BY orders DESC LIMIT 5`)
    const allOrders = await one('SELECT COUNT(*) c FROM orders')
    const paidOrders = await one('SELECT COUNT(*) c FROM orders WHERE status >= 20 AND status <> 90')
    const uniqUsers = await one('SELECT COUNT(DISTINCT user_id) c FROM orders WHERE status >= 20 AND status <> 90')
    const rebuyUsers = await one(`SELECT SUM(c > 1) c FROM (SELECT COUNT(*) c FROM orders WHERE status >= 20 AND status <> 90 GROUP BY user_id) t`)
    const beanFlow = await one(`SELECT COALESCE(SUM(direction = 1 AND biz_type IN (1,2,3)),0) granted,
      COALESCE(SUM(direction = 2),0) consumed FROM bean_ledger`)
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
        beanUseRate: Number(beanFlow.granted) ? Math.round(Number(beanFlow.consumed) / Number(beanFlow.granted) * 100) + '%' : '0%',
      },
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
    const refunds = await q('SELECT refund_no, amount, fee_amount, fee_rate, days_to_depart, reason, status, operator, settled_at FROM refunds WHERE order_id = ? ORDER BY id DESC', [o.id])
    // 客服处理前先看"如果按梯度退会扣多少"，再决定按规则还是全额特批
    const quote = [20, 30].includes(Number(o.status)) ? await refund.quoteFor(o) : null
    return { ...o, events, passes, pay, refunds, refundQuote: quote }
  },

  'POST /admin/orders/:no/refund': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'finance'])
    const o = await order.byNo(req.params.no)
    if (!o) throw new BizError(2003, '订单不存在')
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
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'static', 'uploads')
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
    await requireAdmin(req)
    const p = await one('SELECT id, title, price_from FROM tour_product WHERE id = ?', [req.params.id])
    if (!p) throw new BizError(1004, '商品不存在')
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

  'GET /admin/merchants': async (req) => { const a = await requireAdmin(req); const sc=scopeFilter(a); return await q('SELECT * FROM merchant WHERE 1=1 '+sc.sql+' ORDER BY id',sc.params) },
  // ===== 实体表单引擎（字段定义见 domain/entity-schema.mjs）=====
  'GET /admin/entity-schemas/:kind': async (req) => {
    const a = await requireAdmin(req)
    const sch = entities.publicSchema(req.params.kind)
    const fill = async (fs) => { for (const f of fs) { if (f.type === 'ref') f.options = await entities.refOptions(f.ref, a); if (f.of) await fill(f.of) } }
    for (const s of sch.sections) await fill(s.fields)
    return sch
  },
  'GET /admin/entities/:kind/:id': async (req) => {
    await requireAdmin(req)
    const sc = entities.get(req.params.kind)
    const row = await one(`SELECT * FROM ${sc.table} WHERE ${sc.idCol} = ?`, [req.params.id])
    if (!row) throw new BizError(1004, sc.label + '不存在')
    const values = entities.readValues(req.params.kind, row)
    return { id: row[sc.idCol], values, completeness: entities.completeness(req.params.kind, values) }
  },
  // 列表页用：一次取回某类实体全部的扩展资料完整度（不返回资料本身）
  'GET /admin/entities/:kind': async (req) => {
    await requireAdmin(req)
    const sc = entities.get(req.params.kind)
    const rows = await q(`SELECT * FROM ${sc.table}`)
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
    return rows.map(r => ({ ...r, v: typeof r.v === 'string' ? r.v : JSON.stringify(r.v) }))
  },
  'POST /admin/config/proposal': async (req) => {
    const a = await requireAdmin(req)
    const { key, newValue, reason } = req.body
    const cur = await one('SELECT v, `sensitive` FROM rule_config WHERE k = ?', [key])
    if (!cur) throw new BizError(1004, '参数不存在')
    const oldV = typeof cur.v === 'string' ? cur.v : JSON.stringify(cur.v)
    if (key === 'order.refund_policy') {
      try { refundPolicy.parsePolicy(newValue) } catch (e) { throw new BizError(1001, e.message) }
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

  // CSV 报表导出（低垂果实 #4）：orders/products/settlements/merchants
  'GET /admin/export/:what': async (req) => {
    await requireAdmin(req)
    const what = req.params.what
    let rows = [], name = what
    if (what === 'orders') {
      rows = await q(`SELECT o.order_no, o.status, o.qty, o.amount_goods, o.amount_bean_ded, o.insurance_fee, o.amount_pay,
        o.city_code, o.promo_scene, o.created_at, p.title FROM orders o JOIN tour_product p ON p.id = o.product_id ORDER BY o.id DESC LIMIT 5000`)
    } else if (what === 'products') {
      rows = await q(`SELECT p.id, p.title, p.channel, p.city_code, p.cat, p.price_from, p.bean_gift, p.status, m.name merchant_name
        FROM tour_product p JOIN merchant m ON m.id = p.merchant_id ORDER BY p.id`)
    } else if (what === 'settlements') {
      rows = await q(`SELECT s.id, m.name merchant_name, s.period, s.order_count, s.total_amount, s.amt_fulfill, s.amt_service, s.amt_promoter, s.amt_beanbudget, s.amt_retained, s.status
        FROM settlement s JOIN merchant m ON m.id = s.merchant_id ORDER BY s.id DESC LIMIT 2000`)
    } else if (what === 'merchants') {
      rows = await q(`SELECT id, name, kind, merchant_no, city_code, status, score, apply_contact, apply_mobile, approved_at, created_at FROM merchant ORDER BY id`)
    } else if (what === 'scenics') {
      rows = await q(`SELECT id, name, city_code, scenic_level, coop_mode, ticket_interface, contact_name, contact_phone, profit_terms, status, created_at FROM scenic_spot ORDER BY id`)
    } else if (what === 'suppliers') {
      rows = await q(`SELECT id, name, city_code, category, license_no, contact_name, contact_phone, settle_mode, status, note, created_at FROM supplier ORDER BY id`)
    } else if (what === 'creators') {
      rows = await q(`SELECT u.id, u.nickname, u.creator_tag, u.member_level,
        (SELECT COUNT(*) FROM content_note c WHERE c.user_id = u.id AND c.status = 2) published_count,
        (SELECT COUNT(*) FROM review r WHERE r.user_id = u.id) review_count
        FROM user_account u WHERE u.creator_tag <> 'none' ORDER BY u.id`)
    } else throw new BizError(1004, '未知报表类型')
    const csv = toCsv(rows)
    return { name, filename: name + '-' + new Date().toISOString().slice(0, 10) + '.csv', csv }
  },

  // 约稿任务管理（P2 四态机：创建/审核）
  'GET /admin/content-tasks': async (req) => {
    await requireAdmin(req)
    return await q(`SELECT t.*, u.nickname claimer, p.title product_title,
      (t.note_id IS NOT NULL) submitted
      FROM content_task t
      LEFT JOIN user_account u ON u.id = t.claimed_by
      LEFT JOIN tour_product p ON p.id = t.product_id
      ORDER BY t.id DESC LIMIT 100`)
  },
  'POST /admin/content-tasks': async (req) => {
    const a = await requireAdmin(req)
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
    const a = await requireAdmin(req)
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
  'POST /admin/content-tasks/:id/verdict': async (req) => {
    const a = await requireAdmin(req, ['super','ops','review'])
    const passed = req.body.pass === true
    return tx(async cc => {
      const t = await cc.one('SELECT * FROM content_task WHERE id=? FOR UPDATE',[req.params.id])
      if (!t || Number(t.status)!==2) throw new BizError(2002,'仅审核中任务可处理')
      if (passed) {
        const budget = await cc.one('SELECT id FROM bean_budget WHERE status=1 ORDER BY id DESC LIMIT 1')
        if (!budget || !t.claimed_by) throw new BizError(5002,'缺少可用奖励预算或领取人，任务保持审核中')
        await bean.grant(Number(t.claimed_by),Number(t.reward_beans),bean.BIZ.TASK,t.task_no,budget.id,cc)
        await cc.upd('UPDATE content_task SET status=3,finished_at=NOW(3) WHERE id=?',[t.id])
      } else await cc.upd('UPDATE content_task SET status=1 WHERE id=?',[t.id])
      await audit(cc,'admin:'+a.name,'content-task',passed?'approve':'reject','task-'+t.id,{status:2},{status:passed?3:1,reward:passed?Number(t.reward_beans):0})
      return passed?{finished:true,rewarded:Number(t.reward_beans)}:{rejected:true,backTo:'进行中'}
    })
  },
  'POST /admin/content-tasks/:id/delete': async (req) => {
    await requireAdmin(req)
    await q('DELETE FROM content_task WHERE id = ?', [req.params.id])
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
    // 订单完成锚定（version=50 主状态）。canonical 只放白名单字段，不含联系人/手机号
    await pass.attest('order', orderNo, {
      orderNo, amountPay: Number(o.amount_pay), status: 50,
      merchantId: Number(o.merchant_id), qty: Number(o.qty), cityCode: o.city_code,
    }, null, 50)
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
    else if (name === 'attest-pack') { const b = await attestDomain.packBatch(); n = b.leaves }
    else if (name === 'attest-anchor') { const c = await attestDomain.confirmPending(50); const r = await attestDomain.reanchorPending(50); n = [...c, ...r].filter((x) => x.anchored).length }
    else if (name === 'bean-day-close') { const r = await attestDomain.closeBeanDay(req.body && req.body.date); n = r.leaves || 0 }
    else if (name === 'attest-reconcile') { const r = await attestDomain.reconcile(); n = r.checks.filter((x) => x.ok).length }
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
    return await q('SELECT c.*, u.nickname, u.creator_tag FROM content_note c JOIN user_account u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 100')
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
    return tx(async cc => {
      const m = await cc.one('SELECT * FROM merchant WHERE id = ? AND status = 0 FOR UPDATE', [req.params.id])
      if (!m) throw new BizError(2002, '进件已处理或不存在')
      await cc.upd('UPDATE merchant SET status = 1, approved_at = NOW(3) WHERE id = ?', [m.id])
      if (m.applicant_user_id) await cc.q('INSERT INTO merchant_staff (merchant_id,user_id,role) VALUES (?,?,3) ON DUPLICATE KEY UPDATE role=3,status=1', [m.id, m.applicant_user_id])
      await audit(cc, 'admin:' + a.name, 'merchant', 'approve', 'merchant-' + m.id, { status: 0 }, { status: 1, owner: m.applicant_user_id })
      return { approved: true }
    })
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

// ---------- 后台编辑能力（V14 补齐：风控处理/商户编辑/预算停用/推广商调档） ----------
const adminEdit = {
  // 风控事件处理
  'POST /admin/risk/:id/handle': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops', 'risk'])
    await q('UPDATE risk_event SET handled = 1, handled_by = ?, handled_at = NOW(3) WHERE id = ?', [a.uid || 0, req.params.id])
    return { handled: true }
  },

  // 商户编辑（名称/城市/收付通子商户号）
  'POST /admin/merchants/:id': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { name, cityCode, wxpaySubMchid, kind } = req.body
    await q('UPDATE merchant SET name = ?, city_code = ?, wxpay_sub_mchid = ?, kind = ? WHERE id = ?',
      [name, cityCode, wxpaySubMchid || null, kind || 'other', req.params.id])
    return { updated: true }
  },

  // ===== 资源池（景区 / 供应商）：供给侧资源台账，独立于履约商户；城市合伙人行级隔离 =====
  'GET /admin/scenics': async (req) => {
    const a = await requireAdmin(req)
    const sc = scopeFilter(a)
    return await q(`SELECT s.*, (SELECT COUNT(*) FROM tour_product p WHERE p.scenic_id = s.id) product_count
      FROM scenic_spot s WHERE 1=1 ${sc.sql} ORDER BY s.id DESC`, sc.params)
  },
  'POST /admin/scenics': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { name, cityCode, level, coopMode, ticketInterface, contactName, contactPhone, profitTerms } = req.body
    if (!String(name || '').trim()) throw new BizError(1001, '景区名称必填')
    const id = await tx(async (c) => {
      const rid = await c.ins('INSERT INTO scenic_spot (city_code, name, scenic_level, coop_mode, ticket_interface, contact_name, contact_phone, profit_terms, status) VALUES (?,?,?,?,?,?,?,?,1)',
        [cityCode || '310118', String(name).trim(), level || '', coopMode || '', ticketInterface || null, contactName || null, contactPhone || null, profitTerms || null])
      await audit(c, 'admin:' + a.name, 'scenic', 'create', 'scenic-' + rid, null, { name })
      return rid
    })
    return { id }
  },
  'PUT /admin/scenics/:id': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const row = await one('SELECT * FROM scenic_spot WHERE id = ?', [req.params.id])
    if (!row) throw new BizError(1201, '景区不存在')
    const b = req.body
    const next = {
      name: b.name ?? row.name, city_code: b.cityCode ?? row.city_code, scenic_level: b.level ?? row.scenic_level,
      coop_mode: b.coopMode ?? row.coop_mode, ticket_interface: b.ticketInterface ?? row.ticket_interface,
      contact_name: b.contactName ?? row.contact_name, contact_phone: b.contactPhone ?? row.contact_phone,
      profit_terms: b.profitTerms ?? row.profit_terms, status: Number(b.status ?? row.status),
    }
    await tx(async (c) => {
      await c.q('UPDATE scenic_spot SET name=?, city_code=?, scenic_level=?, coop_mode=?, ticket_interface=?, contact_name=?, contact_phone=?, profit_terms=?, status=? WHERE id=?',
        [next.name, next.city_code, next.scenic_level, next.coop_mode, next.ticket_interface, next.contact_name, next.contact_phone, next.profit_terms, next.status, req.params.id])
      await audit(c, 'admin:' + a.name, 'scenic', 'update', 'scenic-' + row.id, { status: row.status }, { status: next.status })
    })
    return { updated: true }
  },

  'GET /admin/suppliers': async (req) => {
    const a = await requireAdmin(req)
    const sc = scopeFilter(a)
    return await q(`SELECT s.*, (SELECT COUNT(*) FROM tour_product p WHERE p.supplier_id = s.id) product_count
      FROM supplier s WHERE 1=1 ${sc.sql} ORDER BY s.id DESC`, sc.params)
  },
  'POST /admin/suppliers': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { name, cityCode, category, licenseNo, contactName, contactPhone, settleMode, note } = req.body
    if (!String(name || '').trim()) throw new BizError(1001, '供应商名称必填')
    const cat = SUP_CATS.includes(category) ? category : 'other'
    const settle = ['monthly', 'per_order', 'prepaid'].includes(settleMode) ? settleMode : 'monthly'
    const id = await tx(async (c) => {
      const sid = await c.ins('INSERT INTO supplier (city_code, name, category, license_no, contact_name, contact_phone, settle_mode, status, note) VALUES (?,?,?,?,?,?,?,1,?)',
        [cityCode || '310118', String(name).trim(), cat, licenseNo || null, contactName || null, contactPhone || null, settle, note || null])
      await audit(c, 'admin:' + a.name, 'supplier', 'create', 'supplier-' + sid, null, { name, category: cat })
      return sid
    })
    return { id }
  },
  'PUT /admin/suppliers/:id': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const row = await one('SELECT * FROM supplier WHERE id = ?', [req.params.id])
    if (!row) throw new BizError(1201, '供应商不存在')
    const b = req.body
    const next = {
      name: b.name ?? row.name, city_code: b.cityCode ?? row.city_code,
      category: SUP_CATS.includes(b.category) ? b.category : row.category,
      license_no: b.licenseNo ?? row.license_no, contact_name: b.contactName ?? row.contact_name,
      contact_phone: b.contactPhone ?? row.contact_phone,
      settle_mode: ['monthly', 'per_order', 'prepaid'].includes(b.settleMode) ? b.settleMode : row.settle_mode,
      status: Number(b.status ?? row.status), note: b.note ?? row.note,
    }
    await tx(async (c) => {
      await c.q('UPDATE supplier SET name=?, city_code=?, category=?, license_no=?, contact_name=?, contact_phone=?, settle_mode=?, status=?, note=? WHERE id=?',
        [next.name, next.city_code, next.category, next.license_no, next.contact_name, next.contact_phone, next.settle_mode, next.status, next.note, req.params.id])
      await audit(c, 'admin:' + a.name, 'supplier', 'update', 'supplier-' + row.id, { status: row.status }, { status: next.status })
    })
    return { updated: true }
  },

  // 创作者池（UGC 运营）：按用户聚合内容产出；标签=资源状态（none/signed/star/limited）
  'GET /admin/creators': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'review'])
    return await q(`SELECT u.id, u.nickname, u.creator_tag, u.member_level, u.status,
      (SELECT COUNT(*) FROM content_note c WHERE c.user_id = u.id) note_count,
      (SELECT COUNT(*) FROM content_note c WHERE c.user_id = u.id AND c.status = 2) published_count,
      (SELECT COUNT(*) FROM review r WHERE r.user_id = u.id) review_count,
      (SELECT COUNT(*) FROM content_task t WHERE t.claimed_by = u.id AND t.status = 3) task_done,
      (SELECT MAX(c.published_at) FROM content_note c WHERE c.user_id = u.id AND c.status = 2) last_published
      FROM user_account u
      WHERE u.creator_tag <> 'none' OR EXISTS (SELECT 1 FROM content_note c WHERE c.user_id = u.id) OR EXISTS (SELECT 1 FROM review r WHERE r.user_id = u.id)
      ORDER BY published_count DESC, note_count DESC, u.id DESC LIMIT 200`)
  },
  'PUT /admin/creators/:id/tag': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const tag = String(req.body.tag || '')
    if (!CREATOR_TAGS.includes(tag)) throw new BizError(1001, '未知创作者标签')
    const u = await one('SELECT id, creator_tag FROM user_account WHERE id = ?', [req.params.id])
    if (!u) throw new BizError(1201, '用户不存在')
    await tx(async (c) => {
      await c.q('UPDATE user_account SET creator_tag = ? WHERE id = ?', [tag, req.params.id])
      await audit(c, 'admin:' + a.name, 'creator', 'tag', 'user-' + u.id, { tag: u.creator_tag }, { tag })
    })
    return { updated: true }
  },

  // 预算批次停用/启用
  'POST /admin/budgets/:id/status': async (req) => {
    await requireAdmin(req, ['super', 'ops', 'finance'])
    const { status } = req.body
    await q('UPDATE bean_budget SET status = ? WHERE id = ?', [Number(status), req.params.id])
    return { status: Number(status) }
  },

  // 推广商冻结/解冻
  'POST /admin/promoters/:userId/status': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { status } = req.body
    await q('UPDATE promoter SET status = ? WHERE user_id = ?', [Number(status), req.params.userId])
    return { status: Number(status) }
  },

  // 推广商调档
  'POST /admin/promoters/:userId/tier': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { tier } = req.body
    const rates = await cfgArr('promoter.rate_bp')
    const rate = rates[Math.max(1, Math.min(Number(tier), rates.length)) - 1]
    await q('UPDATE promoter SET tier = ?, rate_bp = ? WHERE user_id = ?', [Number(tier), rate, req.params.userId])
    return { tier: Number(tier), rateBp: rate }
  },
}

// ---------- 旧后台评估吸收：暗号/逐品佣金/KYC/共创（治理后台专用，词汇走 Web3 口径） ----------
const adminNew = {
  // 暗号管理（产品级一对）：剧本游"入戏"凭证
  'GET /admin/phrases': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    return await q(`SELECT p.id, p.title, p.phrase_user, p.phrase_merchant, p.channel FROM tour_product p
      WHERE p.phrase_user IS NOT NULL ORDER BY p.id DESC`)
  },
  'POST /admin/phrases/:pid': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { userPhrase, merchantPhrase } = req.body
    await q('UPDATE tour_product SET phrase_user = ?, phrase_merchant = ? WHERE id = ?',
      [String(userPhrase || '').trim() || null, String(merchantPhrase || '').trim() || null, req.params.pid])
    return { saved: true }
  },

  // 逐品佣金覆盖（D2 扩展）：单品费率优先于推广商档位，仍受 12% 封顶
  'GET /admin/rate-overrides': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    return await q(`SELECT p.id, p.title, p.promo_rate_bp, p.price_from,
        JSON_UNQUOTE(JSON_EXTRACT(p.profile, '$.rate_start')) rate_start, JSON_UNQUOTE(JSON_EXTRACT(p.profile, '$.rate_end')) rate_end,
        JSON_UNQUOTE(JSON_EXTRACT(p.profile, '$.rate_reason')) rate_reason
      FROM tour_product p WHERE p.promo_rate_bp IS NOT NULL ORDER BY p.id DESC`)
  },
  'POST /admin/rate-overrides/:pid': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { rateBp } = req.body
    const v = rateBp == null ? null : Number(rateBp)
    if (v != null && (v <= 0 || v > 1200)) throw new BizError(1001, '单品费率需在 (0, 12%] 区间（bp ≤ 1200）')
    await q('UPDATE tour_product SET promo_rate_bp = ? WHERE id = ?', [v, req.params.pid])
    return { saved: true, rateBp: v }
  },

  // KYC 实名审核
  'GET /admin/kyc': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const status = req.query.status != null ? Number(req.query.status) : null
    return await q(`SELECT k.id, k.user_id, k.real_name, k.id_no_mask, k.status, k.reject_note, k.created_at,
      k.reviewed_at, u.nickname FROM kyc_application k JOIN user_account u ON u.id = k.user_id
      ${status != null ? 'WHERE k.status = ' + status : ''} ORDER BY k.id DESC LIMIT 200`)
  },
  'POST /admin/kyc/:id/resolve': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const { action, note } = req.body // pass / reject
    const st = action === 'pass' ? 1 : 2
    const n = await q('UPDATE kyc_application SET status = ?, reject_note = ?, reviewed_by = ?, reviewed_at = NOW(3) WHERE id = ? AND status = 0',
      [st, action === 'reject' ? String(note || '').slice(0, 120) : null, a.uid || 0, req.params.id])
    if (!n.affectedRows) throw new BizError(1004, '申请不存在或已处理')
    return { resolved: action }
  },

  // 共创人登记（资金商/商品商）
  'GET /admin/co-creators': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    return await q(`SELECT cc.*, p.title FROM co_creator cc JOIN tour_product p ON p.id = cc.product_id
      ORDER BY cc.id DESC LIMIT 200`)
  },
  'POST /admin/co-creators': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { productId, name, mobile, role, investAmount, sharePct } = req.body
    if (!productId || !name || !mobile || ![1, 2].includes(Number(role))) throw new BizError(1001, '产品/姓名/电话/角色必填')
    const pct = Number(sharePct) || 0
    if (pct < 0 || pct > 5000) throw new BizError(1001, '分润比例 0-50%（bp ≤ 5000）')
    const coNo = 'C' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + String(Date.now() % 1000).padStart(3, '0')
    const id = await tx(async (c) => c.ins(`INSERT INTO co_creator (product_id, co_no, name, mobile, role, invest_amount, share_pct)
      VALUES (?,?,?,?,?,?,?)`, [productId, coNo, name, mobile, Number(role), Number(investAmount) || 0, pct]))
    return { id, coNo }
  },
  'POST /admin/co-creators/:id/status': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    const { status } = req.body
    await q('UPDATE co_creator SET status = ? WHERE id = ?', [Number(status) ? 1 : 0, req.params.id])
    return { status: Number(status) ? 1 : 0 }
  },

  // 共创分润台账（结算期生成）
  'GET /admin/co-profits': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    return await q(`SELECT cp.*, cc.co_no, cc.name, p.title FROM co_profit cp
      JOIN co_creator cc ON cc.id = cp.co_creator_id JOIN tour_product p ON p.id = cp.product_id
      ORDER BY cp.id DESC LIMIT 200`)
  },
  'POST /admin/co-profits/:id/pay': async (req) => {
    await requireAdmin(req, ['super', 'ops'])
    await q('UPDATE co_profit SET status = 1 WHERE id = ? AND status = 0', [req.params.id])
    return { paid: true }
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
    const finalRef = passed ? String(payRef || '').trim() : null
    if (passed && (!finalRef || finalRef.length < 6 || finalRef.length > 64)) throw new BizError(1001, '请先完成实际支付，再填写真实打款流水号')
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
    const s = await getSecrets(['WX_APPID', 'WX_SECRET', 'WX_B_APPID', 'WX_B_SECRET', 'WX_API_V3_KEY', 'WX_PLATFORM_PUBLIC_KEY', 'WX_PLATFORM_SERIAL', 'WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY', 'WX_NOTIFY_URL', 'WX_TMPL_PAY_OK',
      'SMS_TENCENT_SECRET_ID', 'SMS_TENCENT_SECRET_KEY', 'SMS_TENCENT_SDKAPPID', 'SMS_TENCENT_SIGN',
      'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'])
    const ch = (keys, name, desc) => ({ name, desc, ready: keys.every((k) => !!s[k]),
      fields: keys.map((k) => ({ key: k, envFallback: !!process.env[k], stored: stored[k] || null })) })
    return {
      envNote: '.env 只保留自举：DB 连接、JWT_SECRET、ADMIN_INIT_PASSWORD；其余凭据在本页保存（AES-256-GCM 加密落库）',
      channels: [
        ch(['WX_APPID', 'WX_SECRET'], '微信小程序登录', 'code2Session（未配置=mock openid 联调）'),
        ch(['WX_B_APPID', 'WX_B_SECRET'], '商户小程序登录', '商户端独立 AppID 与 Secret'),
        ch(['WX_API_V3_KEY', 'WX_PLATFORM_PUBLIC_KEY', 'WX_PLATFORM_SERIAL'], '微信支付回调校验', 'APIv3 密钥、微信支付公钥与公钥 ID/证书序列号'),
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
    wxpay.invalidateConfig()
    await tx(async (c) => audit(c, 'admin:' + a.name, 'integration', 'set', req.params.key, null, { len: String(value).length }))
    return { key: req.params.key, saved: true }
  },
  'DELETE /admin/integrations/:key': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { delSecret } = await import('./infra/secrets.mjs')
    await delSecret(req.params.key)
    wxpay.invalidateConfig()
    await tx(async (c) => audit(c, 'admin:' + a.name, 'integration', 'delete', req.params.key, null, null))
    return { deleted: true }
  },
}

// ---------- 存证中心 / 公开验证 / 用户数字身份 ----------
const web3 = {
  // 后台：存证批次与队列总览
  'GET /admin/attest/center': async (req) => {
    await requireAdmin(req)
    const batches = await q('SELECT * FROM attest_batch ORDER BY seq DESC LIMIT 20')
    const queue = await q(`SELECT biz_type,
      SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) packed,
      SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) anchored,
      COUNT(*) total FROM attest_event GROUP BY biz_type`)
    const recent = await q(`SELECT e.biz_type, e.biz_ref, e.version_no, e.status, e.created_at,
      b.seq, b.merkle_root, b.chain_tx_ref, b.status AS batch_status
      FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id ORDER BY e.id DESC LIMIT 30`)
    const dayRoots = await q('SELECT * FROM bean_day_root ORDER BY biz_date DESC LIMIT 10')
    return {
      batches, queue, recent, dayRoots,
      chain: chain.chainStatus(),
      // 语义分档：NOOP 期一律"已打包·待锚定"，绝不出现"已上链"
      chainMode: chain.chainMode() === 'real' ? '已接入链数根：新批次真实锚定' : 'NOOP：哈希与 Merkle 根实时落库，批次停在「已打包·待锚定」',
    }
  },

  // 单号验证（后台+开放页共用逻辑）：返回可离线重算的 inclusion proof
  async _verify(bizType, bizRef) {
    const e = await one(`SELECT e.*, b.merkle_root, b.prev_root, b.chain_tx_ref, b.chain_block, b.anchored_at,
        b.seq, b.leaf_count, b.is_day_close, b.merkle_version, b.status AS batch_status
      FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id
      WHERE e.biz_type = ? AND e.biz_ref = ? ORDER BY e.id DESC LIMIT 1`, [bizType, bizRef])
    if (!e) return { found: false }
    const path = e.leaf_path || null
    const mv = Number(e.merkle_version || 1)
    const proofValid = path && e.merkle_root ? attestDomain.verifyProof(e.payload_hash, path, e.merkle_root, mv) : null
    // 叶哈希必须能由公开的 canonical 重算出来：否则"平台给的哈希"只是一句话，不是证据
    const canonicalValid = e.canonical ? attestDomain.hashOf(attestDomain.canonicalize(typeof e.canonical === 'string' ? JSON.parse(e.canonical) : e.canonical)) === e.payload_hash : null
    const anchored = Number(e.status) === 2 && e.chain_tx_ref && !String(e.chain_tx_ref).startsWith('NOOP')
    return {
      found: true, bizType, bizRef, versionNo: Number(e.version_no),
      payloadHash: e.payload_hash, status: Number(e.status), canonicalValid,
      merkleRoot: e.merkle_root, merkleVersion: mv, leafIndex: e.leaf_index, leafPath: path,
      prevRoot: e.prev_root, leafCount: e.leaf_count,
      proofValid, batchSeq: e.seq, isDayClose: !!Number(e.is_day_close),
      chainRef: anchored ? e.chain_tx_ref : null, chainBlock: anchored ? e.chain_block : null,
      anchoredAt: anchored ? e.anchored_at : null,
      note: anchored ? '已锚定上链：可用 leafPath 从 payloadHash 独立重算出 Merkle 根，再到链上核对该根'
        : (Number(e.batch_status) === 5 ? '已提交上链·等待确认：确认数达标前不视为已锚定'
        : (Number(e.status) === 1 ? '已打包·待锚定：根已生成，链凭据到位后补锚' : '已入队待打包（小时级批次）')),
      verifyTip: merkleLib.describe(mv),
    }
  },

  // 旅豆账本日终根（给审计/政府：证明"严禁超发"）
  async _verifyBeanDay(date) {
    const d = await one('SELECT * FROM bean_day_root WHERE biz_date = ?', [date])
    if (!d) return { found: false }
    const b = d.batch_id ? await one('SELECT * FROM attest_batch WHERE id = ?', [d.batch_id]) : null
    const anchored = b && Number(b.status) === 2 && b.chain_tx_ref && !String(b.chain_tx_ref).startsWith('NOOP')
    return {
      found: true, bizDate: d.biz_date, leafCount: Number(d.leaf_count),
      debitSum: Number(d.debit_sum), creditSum: Number(d.credit_sum),
      balanced: Number(d.debit_sum) === Number(d.credit_sum),
      merkleRoot: d.merkle_root, prevRoot: d.prev_root,
      chainRef: anchored ? b.chain_tx_ref : null, anchoredAt: anchored ? b.anchored_at : null,
      note: '借贷恒等(Σ借=Σ贷) 成立后才允许封存；prevRoot 指向上一封存日，形成不可回改的账本链',
    }
  },

  'GET /admin/attest/verify': async (req) => {
    await requireAdmin(req)
    return await web3._verify(String(req.query.bizType || 'order'), String(req.query.bizRef || ''))
  },

  // 批次详情（链路视图点区块下钻）：批内全部事件按叶序返回
  'GET /admin/attest/batch/:id': async (req) => {
    await requireAdmin(req)
    const b = await one('SELECT * FROM attest_batch WHERE id = ?', [Number(req.params.id)])
    if (!b) throw new BizError(1201, '批次不存在')
    const events = await q(`SELECT id, biz_type, biz_ref, version_no, leaf_index, payload_hash, status, created_at
      FROM attest_event WHERE batch_id = ? ORDER BY leaf_index, id`, [b.id])
    return { batch: b, events, chain: chain.chainStatus() }
  },

  // 单流程视角（一单六锚）：把一笔订单的存证事件按业务步骤串成链
  'GET /admin/attest/flow/:orderNo': async (req) => {
    await requireAdmin(req)
    const orderNo = String(req.params.orderNo || '').trim()
    const o = await one('SELECT o.*, p.title product_name FROM orders o LEFT JOIN tour_product p ON p.id = o.product_id WHERE o.order_no = ?', [orderNo])
    if (!o) throw new BizError(1201, '订单不存在')
    const COLS = 'e.id, e.biz_type, e.biz_ref, e.version_no, e.status, e.payload_hash, e.created_at, b.seq, b.merkle_root, b.status AS batch_status'
    const ev = (bizType, bizRef) => one(`SELECT ${COLS} FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id
      WHERE e.biz_type = ? AND e.biz_ref = ? ORDER BY e.id DESC LIMIT 1`, [bizType, bizRef])
    const ledger = await q('SELECT DISTINCT tx_no, biz_type FROM bean_ledger WHERE biz_ref = ?', [orderNo])
    const passes = await q('SELECT id, name, serial_no FROM travel_pass WHERE order_id = ? ORDER BY id', [o.id])
    const [deductTx] = ledger.filter((r) => Number(r.biz_type) === 4)
    const [grantTx] = ledger.filter((r) => Number(r.biz_type) === 1)
    const steps = [
      { key: 'deduct', no: '①', label: '旅豆抵扣', hint: o.bean_deducted > 0 ? '下单锁豆' : '未使用旅豆', ev: deductTx ? await ev('bean_deduct', 'bt-' + deductTx.tx_no) : null },
      { key: 'order', no: '②', label: '支付成功', hint: '订单事实入链', ev: await ev('order', orderNo) },
      { key: 'issue', no: '③', label: '出票', hint: passes.length > 1 ? `权益凭证 ×${passes.length}` : '权益凭证', ev: passes.length ? await ev('pass_issue', 'pass-' + passes[0].id) : null },
      { key: 'verify', no: '④', label: '核销', hint: '到店扫码', ev: passes.length ? await one(`SELECT ${COLS} FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id
          WHERE e.biz_type = 'pass_verify' AND e.biz_ref LIKE ? ORDER BY e.id DESC LIMIT 1`, ['pass-' + passes[0].id + '-%']) : null },
      { key: 'grant', no: '⑤', label: '返豆', hint: '消费奖励', ev: grantTx ? await ev('bean_grant', 'bt-' + grantTx.tx_no) : null },
      { key: 'settle', no: '⑥', label: '结算', hint: '五口径分账', ev: o.settlement_id ? await ev('settlement', 'settle-' + o.settlement_id) : null },
    ]
    const refundRows = await q('SELECT refund_no, amount, settled_at FROM refunds WHERE order_id = ? ORDER BY id', [o.id])
    const refunds = []
    for (const r of refundRows) {
      const e = await ev('refund', r.refund_no)
      if (e) refunds.push({ ...e, amount: r.amount })
    }
    return {
      order: { orderNo: o.order_no, status: o.status,
        statusText: { 10: '待支付', 20: '已支付', 30: '已确认', 40: '已核销', 50: '已完成', 60: '退款中', 70: '已退款', 90: '已关闭' }[o.status] || '状态' + o.status,
        productName: o.product_name, qty: o.qty, amountPay: o.amount_pay, beanDeducted: o.bean_deducted,
        createdAt: o.created_at, paidAt: o.paid_at, completedAt: o.completed_at },
      steps, refunds,
      note: '六步=六个链上锚点：事件与业务同事务写入，小时级打包成块，日终另有账本封存块；退款为分支',
    }
  },

  // ---- WEB3 工作区（PC 后台内部；D6：小程序内不出现链上字样，此处为运营/BD 窗口）----

  // 链上总览：看板指标 + 可信路径
  'GET /admin/web3/overview': async (req) => {
    await requireAdmin(req)
    const b = await one(`SELECT COUNT(*) batches, SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) anchored FROM attest_batch`)
    const e = await one(`SELECT COUNT(*) total, SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) anchored,
      SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) pending FROM attest_event`)
    const badges = await one('SELECT COUNT(*) c FROM user_badge')
    const bean = await one(`SELECT COALESCE(SUM(direction = 1 AND biz_type IN (1,2,3)),0) granted,
      COALESCE(SUM(direction = 2),0) consumed FROM bean_ledger`)
    const events = await q(`SELECT biz_type, biz_ref, status, created_at FROM attest_event ORDER BY id DESC LIMIT 12`)
    return {
      batches: Number(b.batches) || 0, anchoredBatches: Number(b.anchored) || 0,
      events: Number(e.total) || 0, anchoredEvents: Number(e.anchored) || 0, pendingEvents: Number(e.pending) || 0,
      badgeGrants: Number(badges.c) || 0,
      beanGranted: Number(bean.granted) || 0, beanConsumed: Number(bean.consumed) || 0,
      chain: chain.chainStatus(),
      chainMode: chain.chainMode() === 'real'
        ? '已接入链数根：批次真实锚定'
        : 'NOOP（哈希与根实时落库；批次停在「已打包·待锚定」，凭据到位后补锚）',
      trustPath: ['订单支付', '权益核销', '勋章发放', '存证报告'],
      recentEvents: events,
    }
  },

  // 积分资产发行台账（旅豆 = 向往自由链积分资产，D6 外层口径）
  'GET /admin/web3/point-assets': async (req) => {
    await requireAdmin(req)
    const budgets = await q('SELECT id, name, total, granted, returned, biz_owner, status, period_start, period_end FROM bean_budget ORDER BY id DESC LIMIT 20')
    const cap = await one('SELECT * FROM bean_global_cap ORDER BY id DESC LIMIT 1')
    const byBiz = await q(`SELECT biz_type, SUM(CASE WHEN direction = 1 THEN amount ELSE 0 END) issued,
      SUM(CASE WHEN direction = 2 THEN amount ELSE 0 END) burned FROM bean_ledger GROUP BY biz_type ORDER BY biz_type`)
    const holders = await one('SELECT COUNT(*) c FROM bean_account')
    return { budgets, globalCap: cap, byBiz, holders: Number(holders.c) || 0,
      note: '积分按预算批次发行，年度总量受 global_cap 哨兵约束（双分录账本，严禁超发）' }
  },

  // 勋章资产发行：定义列表 + 发放
  'GET /admin/web3/badges': async (req) => {
    await requireAdmin(req)
    const defs = await q(`SELECT b.*, (SELECT COUNT(*) FROM user_badge ub WHERE ub.badge_id = b.id) granted
      FROM badge b ORDER BY b.id`)
    const recent = await q(`SELECT ub.user_id, u.nickname, b.name, ub.granted_at FROM user_badge ub
      JOIN user_account u ON u.id = ub.user_id JOIN badge b ON b.id = ub.badge_id ORDER BY ub.granted_at DESC LIMIT 20`)
    return { defs, recent }
  },
  'POST /admin/web3/badges': async (req) => {
    await requireAdmin(req)
    const { name, iconKey, ruleDesc, ruleType, ruleParam } = req.body
    if (!name || !iconKey) throw new BizError(1001, '名称与图标键必填')
    const id = await tx(async (c) => c.ins('INSERT INTO badge (name, icon_key, rule_desc, rule_type, rule_param) VALUES (?,?,?,?,?)',
      [name, iconKey, ruleDesc || '', ruleType || 'manual', JSON.stringify(ruleParam || null)]))
    return { id }
  },
  'POST /admin/web3/badges/:id/grant': async (req) => {
    const a = await requireAdmin(req)
    const { userId, reason } = req.body
    const b = await one('SELECT id, name FROM badge WHERE id = ?', [req.params.id])
    if (!b) throw new BizError(1004, '勋章定义不存在')
    const u = await one('SELECT id FROM user_account WHERE id = ?', [userId])
    if (!u) throw new BizError(1004, '用户不存在')
    const ins = await tx(async (c) => c.q('INSERT IGNORE INTO user_badge (user_id, badge_id) VALUES (?,?)', [Number(userId), b.id]))
    // 勋章发放入存证队列（同一用户同一勋章只锚一次；重复发放由 uk_biz_ver 幂等）
    await pass.attest('badge', 'badge-' + userId + '-' + b.id, {
      userId: Number(userId), badgeId: Number(b.id), badge: b.name, by: a.name, reason: reason || null,
    }, null, 1)
    return { granted: true, badge: b.name, attestQueued: true }
  },

  // 用户数字钱包 / 数字资产（按用户查：旅豆账本 + 勋章 + 存证流水）
  'GET /admin/web3/wallets': async (req) => {
    await requireAdmin(req)
    const kw = String(req.query.kw || '').trim()
    const rows = await q(`SELECT a.id account_id, a.user_id, a.balance, u.nickname, u.member_level, u.growth_value,
      (SELECT COUNT(*) FROM user_badge ub WHERE ub.user_id = a.user_id) badges,
      (SELECT COUNT(*) FROM attest_event e WHERE e.biz_type = 'order' AND e.biz_ref IN (SELECT order_no FROM orders WHERE user_id = a.user_id)) attest_n
      FROM bean_account a JOIN user_account u ON u.id = a.user_id
      ${kw ? 'WHERE u.nickname LIKE ? OR CAST(a.user_id AS CHAR) = ?' : ''}
      ORDER BY a.balance DESC LIMIT 30`, kw ? ['%' + kw + '%', kw] : [])
    return rows
  },
  'GET /admin/web3/wallets/:userId': async (req) => {
    await requireAdmin(req)
    const uid = req.params.userId
    const u = await one('SELECT id, nickname, member_level, growth_value FROM user_account WHERE id = ?', [uid])
    if (!u) throw new BizError(1004, '用户不存在')
    const acc = await one('SELECT id, balance FROM bean_account WHERE user_id = ?', [uid])
    const ledger = await q('SELECT tx_no, direction, biz_type, amount, biz_ref, created_at FROM bean_ledger WHERE account_id = ? ORDER BY id DESC LIMIT 30', [acc ? acc.id : 0])
    const badges = await q(`SELECT b.name, ub.granted_at FROM user_badge ub JOIN badge b ON b.id = ub.badge_id WHERE ub.user_id = ?`, [uid])
    const orders = await q('SELECT order_no, amount_pay, status FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 10', [uid])
    const attestations = []
    for (const o of orders) {
      const e = await one("SELECT status, payload_hash, created_at FROM attest_event WHERE biz_type = 'order' AND biz_ref = ?", [o.order_no])
      if (e) attestations.push({ orderNo: o.order_no, hash: e.payload_hash, anchored: e.status === 2, at: e.created_at })
    }
    return { profile: u, balance: acc ? acc.balance : 0, ledger, badges, attestations,
      statement: '消费与权益记录的可信存证流水，作为贡献分与数字身份的依据（不对应股权或可交易 Token）' }
  },

  // ---- 常见问题 / 轮播管理（小程序内容运营位，V13）----
  'GET /admin/faqs': async (req) => {
    await requireAdmin(req)
    return await q('SELECT * FROM faq ORDER BY sort, id')
  },
  'POST /admin/faqs': async (req) => {
    await requireAdmin(req)
    const { question, answer, sort, category, isHot } = req.body
    if (!question || !answer) throw new BizError(1001, '问题与答案必填')
    const id = await tx(async (c) => c.ins('INSERT INTO faq (question, answer, sort, category, is_hot) VALUES (?,?,?,?,?)',
      [question, answer, Number(sort) || 0, category || '通用', Number(isHot) || 0]))
    return { id }
  },
  'POST /admin/faqs/:id/update': async (req) => {
    await requireAdmin(req)
    const { question, answer, sort, status, category, isHot } = req.body
    await q('UPDATE faq SET question = COALESCE(?, question), answer = COALESCE(?, answer), sort = COALESCE(?, sort), status = COALESCE(?, status), category = COALESCE(?, category), is_hot = COALESCE(?, is_hot) WHERE id = ?',
      [question || null, answer || null, sort != null ? Number(sort) : null, status != null ? Number(status) : null,
        category || null, isHot != null ? Number(isHot) : null, req.params.id])
    return { updated: true }
  },
  'POST /admin/faqs/:id/delete': async (req) => {
    await requireAdmin(req)
    await q('DELETE FROM faq WHERE id = ?', [req.params.id])
    return { deleted: true }
  },
  'GET /admin/banners': async (req) => {
    await requireAdmin(req)
    return await q('SELECT * FROM banner ORDER BY sort, id')
  },
  'POST /admin/banners': async (req) => {
    await requireAdmin(req)
    const { title, subTitle, image, link, sort, startAt, endAt } = req.body
    if (!title || !image) throw new BizError(1001, '标题与图片必填')
    const id = await tx(async (c) => c.ins('INSERT INTO banner (title, sub_title, image, link, sort, start_at, end_at) VALUES (?,?,?,?,?,?,?)',
      [title, subTitle || null, image, link || null, Number(sort) || 0, startAt || null, endAt || null]))
    return { id }
  },
  'POST /admin/banners/:id/update': async (req) => {
    await requireAdmin(req)
    const { title, subTitle, image, link, sort, status, startAt, endAt } = req.body
    await q('UPDATE banner SET title = COALESCE(?, title), sub_title = ?, image = COALESCE(?, image), link = ?, sort = COALESCE(?, sort), status = COALESCE(?, status), start_at = ?, end_at = ? WHERE id = ?',
      [title || null, subTitle !== undefined ? (subTitle || null) : null, image || null,
        link !== undefined ? link : null, sort != null ? Number(sort) : null, status != null ? Number(status) : null,
        startAt !== undefined ? (startAt || null) : null, endAt !== undefined ? (endAt || null) : null, req.params.id])
    return { updated: true }
  },
  'POST /admin/banners/:id/delete': async (req) => {
    await requireAdmin(req)
    await q('DELETE FROM banner WHERE id = ?', [req.params.id])
    return { deleted: true }
  },

  // 链与资产：多链能力矩阵 / 资产发行台账
  'GET /admin/web3/chain': async (req) => {
    await requireAdmin(req)
    const { runPreflight, preflightSummary } = await import('./infra/chain/preflight.mjs')
    const rows = runPreflight()
    return { current: chain.chainStatus(), providers: chain.listProviders(), preflight: rows, summary: preflightSummary(rows) }
  },
  'GET /admin/web3/assets': async (req) => {
    await requireAdmin(req)
    return { ...(await asset.stats()), rows: await asset.list(50) }
  },
  'POST /admin/web3/assets/issue': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const { kind, userId, channel, meta, to, tokenId } = req.body || {}
    const r = await asset.issue({ kind, userId: Number(userId), channel: channel || 'ecosystem', meta: meta || {}, to: to || null, tokenId: tokenId || null })
    await tx(async (c) => audit(c, 'admin:' + a.name, 'asset', 'issue', 'asset-' + r.id, null, { kind, channel, status: r.status }))
    return r
  },
  'POST /admin/web3/assets/:id/retry': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const r = await asset.retry(Number(req.params.id))
    await tx(async (c) => audit(c, 'admin:' + a.name, 'asset', 'retry', 'asset-' + req.params.id, null, r))
    return r
  },

  // 数字身份（VC）：签发统计 / 吊销
  'GET /admin/web3/vc': async (req) => {
    await requireAdmin(req)
    return await vc.stats()
  },
  // 后台代签发（演示/客服场景：给指定用户出一张凭证，便于当场扫码/粘贴验签）
  'POST /admin/web3/vc/issue': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const userId = Number(req.body?.userId)
    if (!Number.isInteger(userId) || userId <= 0) throw new BizError(1001, '请填写用户 id')
    const scope = req.body?.scope === 'basic' ? 'basic' : 'travel'
    const v = await vc.issue(userId, scope)
    await tx(async (c) => audit(c, 'admin:' + a.name, 'vc', 'issue', 'vc-' + v.jti, null, { userId, scope }))
    return v
  },
  'POST /admin/web3/vc/:id/revoke': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const r = await vc.revoke(Number(req.params.id), req.body?.reason, 'admin:' + a.name)
    await tx(async (c) => audit(c, 'admin:' + a.name, 'vc', 'revoke', 'vc-' + req.params.id, null, { reason: req.body?.reason || '' }))
    return r
  },

  // 合约调用账户（链数根适配器接入位）：凭据经集成中心配置，此处只读展示
  'GET /admin/web3/contract-account': async (req) => {
    await requireAdmin(req)
    const { getSecrets } = await import('./infra/secrets.mjs')
    const sec = await getSecrets(['CHAIN_ENDPOINT', 'CHAIN_ACCOUNT', 'CHAIN_KEY'])
    return { mode: sec.CHAIN_ENDPOINT ? '已配置链数根接入（P1 适配器启用后生效）' : 'NOOP（哈希流水实时记录，链接入后补锚）',
      endpoint: sec.CHAIN_ENDPOINT || '', account: sec.CHAIN_ACCOUNT || '', keyConfigured: !!sec.CHAIN_KEY,
      note: '适配器接口 AttestationClient：P0=Noop，P1=ChainShuGenClient；链故障业务照跑、恢复后补锚' }
  },
}

// 公开验证（无登录·只读·给景区/政府/投资人：输单号出存证证明）
const open = {
  // 给景区/政府/投资人的公开验证：无登录、只读、不暴露用户与金额，返回可离线重算的证明
  'GET /open/verify/order/:orderNo': async (req) => {
    const r = await web3._verify('order', req.params.orderNo)
    if (!r.found) throw new BizError(1004, '未找到该单的存证记录')
    return {
      ...r,
      platform: '向往的自由 · 向往自由链存证',
      tip: '本验证不暴露任何用户与金额信息，仅返回哈希锚定证明；可离线重算复核',
    }
  },

  // 单流程公开复核（一单六锚）：只回步骤/时点/指纹，**不回姓名、金额、商品与联系方式**
  'GET /open/attest/flow/:orderNo': async (req) => {
    const orderNo = String(req.params.orderNo || '').trim()
    if (!/^[A-Za-z]{2,4}[A-Za-z0-9-]{6,40}$/.test(orderNo)) throw new BizError(1004, '订单号格式不正确')
    const o = await one('SELECT id, settlement_id FROM orders WHERE order_no = ?', [orderNo])
    if (!o) throw new BizError(1004, '未找到该订单的记录')
    const COLS = 'e.biz_ref, e.version_no, e.status, e.payload_hash, e.created_at, b.seq'
    const ev = (bizType, bizRef) => one(`SELECT ${COLS} FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id
      WHERE e.biz_type = ? AND e.biz_ref = ? ORDER BY e.id DESC LIMIT 1`, [bizType, bizRef])
    const ledger = await q('SELECT DISTINCT tx_no, biz_type FROM bean_ledger WHERE biz_ref = ?', [orderNo])
    const passes = await q('SELECT id FROM travel_pass WHERE order_id = ? ORDER BY id', [o.id])
    const [deductTx] = ledger.filter((r) => Number(r.biz_type) === 4)
    const [grantTx] = ledger.filter((r) => Number(r.biz_type) === 1)
    const steps = [
      { no: '①', key: 'deduct', label: '旅豆抵扣', hint: '未使用旅豆', ev: deductTx ? await ev('bean_deduct', 'bt-' + deductTx.tx_no) : null },
      { no: '②', key: 'order', label: '支付成功', hint: '待支付', ev: await ev('order', orderNo) },
      { no: '③', key: 'issue', label: '出票', hint: passes.length > 1 ? '待出票 ×' + passes.length : '待出票', ev: passes.length ? await ev('pass_issue', 'pass-' + passes[0].id) : null },
      { no: '④', key: 'verify', label: '核销', hint: '待到店', ev: passes.length ? await one(`SELECT ${COLS} FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id
          WHERE e.biz_type = 'pass_verify' AND e.biz_ref LIKE ? ORDER BY e.id DESC LIMIT 1`, ['pass-' + passes[0].id + '-%']) : null },
      { no: '⑤', key: 'grant', label: '返豆', hint: '待完成', ev: grantTx ? await ev('bean_grant', 'bt-' + grantTx.tx_no) : null },
      { no: '⑥', key: 'settle', label: '结算', hint: '待结算', ev: o.settlement_id ? await ev('settlement', 'settle-' + o.settlement_id) : null },
    ]
    const refundRows = await q('SELECT refund_no FROM refunds WHERE order_id = ? ORDER BY id', [o.id])
    const refunds = []
    for (const r of refundRows) {
      const e = await ev('refund', r.refund_no)
      if (e) refunds.push(e)
    }
    return { orderNo, steps, refunds, tip: '只包含步骤时点与指纹，不含任何个人信息与金额' }
  },

  // 旅豆账本日终根：证明"账本借贷恒等、未超发"（审计/政府口径）
  'GET /open/verify/bean-day/:date': async (req) => {
    const r = await web3._verifyBeanDay(req.params.date)
    if (!r.found) throw new BizError(1004, '该日尚无账本封存记录')
    return { ...r, platform: '向往的自由 · 向往自由链账本封存' }
  },

  // 结算记录的公开复核：只回校验码与封存状态，**绝不回金额、商户名与订单明细**
  'GET /open/verify/settlement/:id': async (req) => {
    const id = Number(req.params.id)
    const s = await one('SELECT id, status FROM settlement WHERE id = ?', [id])
    if (!s) throw new BizError(1004, '未找到该结算记录')
    const r = await web3._verify('settlement', 'settle-' + id)
    return {
      found: r.found, bizType: 'settlement', bizRef: 'settle-' + id, settlementId: id,
      payloadHash: r.payloadHash || null, merkleRoot: r.merkleRoot || null, prevRoot: r.prevRoot || null,
      leafPath: r.leafPath || null, leafIndex: r.leafIndex ?? null, proofValid: r.proofValid ?? null,
      merkleVersion: r.merkleVersion ?? null, canonicalValid: r.canonicalValid ?? null,
      batchSeq: r.batchSeq ?? null, status: Number(s.status),
      chainRef: r.chainRef || null, anchoredAt: r.anchoredAt || null,
      note: r.found ? r.note : '该结算单已生成，但尚未打包封存',
      privacy: '本接口不返回金额、商户名与订单明细',
    }
  },

  // 可信能力一页纸（A4，给政府/景区/投资人）：数据实时，内容与代码同源
  'GET /open/onepager': async (req, res) => {
    const base = publicBase(req)
    const doc = capabilityDoc(await capabilityContext(base))
    if (String(req.query.fmt || '') === 'png') {
      const png = renderOnepagerPng(doc)
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
      res.end(png)
      return { __raw: true }
    }
    const pdf = renderOnepagerPdf(doc)
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="capability-onepager.pdf"', 'Cache-Control': 'no-store' })
    res.end(pdf)
    return { __raw: true }
  },

  // 链能力声明（对外）：支持哪些链、各自能做什么，凭据状态不回显
  'GET /open/chain/capabilities': async () => {
    const cur = chain.chainStatus()
    return {
      current: { provider: cur.provider, label: cur.label, mode: cur.mode, capabilities: cur.capabilities },
      providers: chain.listProviders().map((p) => ({
        id: p.id, label: p.label, docs: p.docs, capabilities: p.capabilities, mode: p.mode,
      })),
      switchRule: '设置环境变量 CHAIN_PROVIDER=chaingen|tbaas|antchain|evm|noop 即可切换；业务与页面代码零改动',
      assets: { channels: Object.entries(asset.CHANNELS).map(([k, v]) => ({ id: k, allowed: v.allowed, label: v.label })) },
    }
  },

  // 数字身份：签发者公钥（JWKS）—— 第三方凭此可离线验签，不必回调我方接口
  'GET /open/vc/issuer': async () => vc.issuerJwks(),

  // 数字身份验签：合作方（景区/城市/境外生态）提交凭证，返回"签名是否有效 + 披露了什么 + 没披露什么"
  'POST /open/vc/verify': async (req) => {
    const jwt = String(req.body?.jwt || req.body?.vc || '').trim()
    if (!jwt) throw new BizError(1001, '请提交凭证（字段 jwt）')
    return await vc.verify(jwt)
  },

  // 存证报告 PDF（一页 A4 证书，含二维码；给景区/政府/投资人存档用）
  'GET /open/report/order/:orderNo': async (req, res) => {
    const v = await web3._verify('order', req.params.orderNo)
    if (!v.found) throw new BizError(1004, '未找到该单的存证记录')
    const pdf = svgToPdf(buildSvg(orderReportDoc(v, publicBase(req))))
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="attest-${String(req.params.orderNo).replace(/[^A-Za-z0-9-]/g, '')}.pdf"`,
      'Cache-Control': 'no-store',
    })
    res.end(pdf)
    return { __raw: true }
  },
  'GET /open/report/bean-day/:date': async (req, res) => {
    const v = await web3._verifyBeanDay(req.params.date)
    if (!v.found) throw new BizError(1004, '该日尚无账本封存记录')
    const pdf = svgToPdf(buildSvg(beanDayReportDoc(v, publicBase(req))))
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="ledger-${String(req.params.date).replace(/[^0-9-]/g, '')}.pdf"`,
      'Cache-Control': 'no-store',
    })
    res.end(pdf)
    return { __raw: true }
  },
}

/** 一页纸所需的实时上下文（数字全部来自库，不手写） */
async function capabilityContext(baseUrl) {
  const c = async (sql) => Number((await one(sql))?.n || 0)
  return {
    baseUrl,
    chain: chain.chainStatus(),
    providers: chain.listProviders().filter((p) => p.id !== 'mock'),
    counts: {
      events: await c('SELECT COUNT(*) n FROM attest_event'),
      batches: await c('SELECT COUNT(*) n FROM attest_batch'),
      dayRoots: await c('SELECT COUNT(*) n FROM bean_day_root'),
      vc: await c('SELECT COUNT(*) n FROM vc_issue'),
      assets: await c('SELECT COUNT(*) n FROM asset_issue WHERE status = 1'),
    },
  }
}

/** 对外可访问的基址：优先 PUBLIC_BASE，其次按请求头推断（Nginx/CDN 后需带 x-forwarded-*） */
function publicBase(req) {
  if (process.env.PUBLIC_BASE) return String(process.env.PUBLIC_BASE).replace(/\/+$/, '')
  const h = (req && req.headers) || {}
  const host = h['x-forwarded-host'] || h.host || ('127.0.0.1:' + (process.env.PORT || 8080))
  const proto = h['x-forwarded-proto'] || 'http'
  return proto + '://' + host
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
  'GET /c/notes': async (req) => {
    const u = requireUser(req)
    return await q(`SELECT c.id, c.title, c.status, c.like_count, c.published_at FROM content_note c
      WHERE c.user_id = ? ORDER BY c.id DESC LIMIT 30`, [u.uid])
  },
  'POST /c/notes': async (req) => {
    const u = requireUser(req)
    const { title, body, images, relatedProductId } = req.body
    if (!body) throw new BizError(1001, '内容不能为空')
    const { msgSecCheck } = await import('./infra/wxsec.mjs')
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
      'INSERT INTO content_note (user_id, title, body, status, sec_check_id, related_product_id) VALUES (?,?,?,?,?,?)',
      [u.uid, title || null, JSON.stringify({ text: body, images: imgUrls, imgSec }), status, sec.mock ? 'mock' : 'wx-sec', relatedProductId || null]))
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
    const raw = await q("SELECT * FROM content_task WHERE status = 0 AND (deadline IS NULL OR deadline >= NOW()) ORDER BY id DESC LIMIT 20")
    const CAT = { note: '图文笔记', video: '短视频', strategy: '攻略长文', review: '体验点评' }
    const open = raw.map((t) => {
      const pp = entities.publicProfile('task', t, (x) => apiImg(x, req))
      return { id: t.id, task_no: t.task_no, title: t.title, brief: t.brief, reward_beans: t.reward_beans, cover: pp.cover_img || null,
        categoryLabel: CAT[t.category] || '图文笔记', tags: pp.tags || [], platforms: pp.platforms_labels || [],
        cashLabel: Number(t.cash_reward) ? fen2yuan(t.cash_reward) : null, deadline: t.deadline ? String(t.deadline).slice(0, 16) : null,
        minWords: Number(t.min_words) || 0, minImages: Number(t.min_images) || 0 }
    })
    const mine = await q("SELECT id, task_no, title, status, reward_beans, submitted_at FROM content_task WHERE claimed_by = ? ORDER BY id DESC LIMIT 20", [u.uid])
    return { open, mine }
  },
  'GET /c/tasks/:id': async (req) => {
    const u = requireUser(req)
    const t = await one('SELECT * FROM content_task WHERE id = ?', [req.params.id])
    if (!t || (Number(t.status) !== 0 && Number(t.claimed_by) !== Number(u.uid))) throw new BizError(1004, '任务不存在或已被领取')
    const pp = entities.publicProfile('task', t, (x) => apiImg(x, req))
    const prod = t.product_id ? await one('SELECT id, title FROM tour_product WHERE id = ? AND status = 1', [t.product_id]) : null
    return { id: t.id, status: Number(t.status), mine: Number(t.claimed_by) === Number(u.uid), product: prod,
      ...pp, cash_reward_label: Number(t.cash_reward) ? fen2yuan(t.cash_reward) : null }
  },
  'POST /c/tasks/:id/claim': async (req) => {
    const u = requireUser(req)
    const n = await tx(async (c) => c.upd("UPDATE content_task SET status = 1, claimed_by = ?, claimed_at = NOW(3) WHERE id = ? AND status = 0", [u.uid, req.params.id]))
    if (n !== 1) throw new BizError(2002, '任务已被领取或不可领取')
    return { claimed: true }
  },
  'POST /c/tasks/:id/submit': async (req) => {
    const u = requireUser(req)
    const { noteId } = req.body
    const note = await one('SELECT id, user_id, status FROM content_note WHERE id = ?', [noteId])
    if (!note || Number(note.user_id) !== Number(u.uid)) throw new BizError(1004, '笔记不存在')
    if (Number(note.status) !== 2) throw new BizError(1001, '仅已发布的笔记可提交审核')
    const n = await tx(async (c) => c.upd("UPDATE content_task SET status = 2, note_id = ?, submitted_at = NOW(3) WHERE id = ? AND status = 1 AND claimed_by = ?", [noteId, req.params.id, u.uid]))
    if (n !== 1) throw new BizError(2002, '仅进行中任务可提交')
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
    const NAMES = { '310118': '上海·青浦朱家角', '320508': '苏州·姑苏' }
    return rows.map((r) => ({ ...r, cityName: NAMES[r.city_code] || r.city_code,
      priceFromLabel: (Number(r.price_from) / 100).toFixed(0) }))
  },
}

// 商户进件自助化（P2）：无 token 提交申请 → 后台审核
// ---------- 商户端：暗号核销（§4 剧本游玩法） ----------
const mPhrase = {
  // 核销员输入游客说出的暗号 → 与本店已出票订单的产品用户暗号比对；命中即核销该订单全部有效凭证
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
    let o = null
    if (orderNo) {
      o = await one(`SELECT o.id, o.order_no, o.city_code, p.phrase_user, p.phrase_merchant, p.profile FROM orders o
        JOIN tour_product p ON p.id = o.product_id WHERE o.order_no = ? AND o.merchant_id = ?`,
        [orderNo, u.merchantId])
    } else {
      const cands = await q(`SELECT o.id, o.order_no, o.city_code, p.phrase_user, p.phrase_merchant, p.profile FROM orders o
        JOIN tour_product p ON p.id = o.product_id
        WHERE o.merchant_id = ? AND p.phrase_user IS NOT NULL AND o.status IN (20,30) ORDER BY o.id DESC LIMIT 200`,
        [u.merchantId])
      o = cands.find(accepts) || null
    }
    if (!o || !o.phrase_user) return { ok: false, reason: '未找到对应该暗号的在途订单' }
    if (!accepts(o)) return { ok: false, reason: '暗号不对（再核对一下游客说的口令）', orderNo: o.order_no }
    const werr = windowErr(o)
    if (werr) return { ok: false, reason: werr, orderNo: o.order_no }
    const ids = (await q('SELECT id FROM travel_pass WHERE order_id = ? AND status = 1', [o.id])).map((r) => r.id)
    for (const pid of ids) {
      await pass.adminConfirmPass(pid, u.uid)
      // 暗号核销不是窗口码，用 -phrase 后缀区分事件来源，避免与扫码事件互相覆盖
      await pass.attest('pass_verify', 'pass-' + pid + '-phrase', {
        passId: Number(pid), merchantId: Number(u.merchantId), way: 'phrase', cityCode: o.city_code || '310118',
      }, null, 1)
    }
    if (ids.length) await q('INSERT INTO verification_log (pass_id, merchant_id, staff_id, method, result, city_code) VALUES (?,?,?,?,1,?)',
      [ids[0], u.merchantId, u.uid, 4, o.city_code || '310118'])
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
    const id = await tx(async cc => cc.ins(`INSERT INTO merchant (city_code,name,merchant_no,status,apply_contact,apply_mobile,apply_note,applicant_user_id)
      VALUES (?,?,?,0,?,?,?,?)`, [cityCode,name,mno,contact,mobile,note || null,u.uid]))
    return { id, merchantNo: mno, msg: '已提交，审核通过后重新登录即可进入门店' }
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
      if (e) attestations.push({ orderNo: o.order_no, hash: e.payload_hash, anchored: e.status === 2, at: e.created_at })
    }
    return { profile: { nickname: acc.nickname, memberLevel: acc.member_level, growth: acc.growth_value, joinedAt: acc.created_at },
      passes, badges, attestations,
      statement: '消费与权益记录的可信存证流水，作为贡献分与数字身份的依据' }
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

// ---------- 微信支付回调 ----------
async function notifyMerchantStaff(merchantId, orderNo) {
  const { getSecrets } = await import('./infra/secrets.mjs')
  const tpl = (await getSecrets(['WX_TMPL_NEW_ORDER'])).WX_TMPL_NEW_ORDER
  if (!tpl) return { skipped: true }
  const staff = await q(`SELECT DISTINCT u.mini_b_openid openid FROM merchant_staff s
    JOIN user_account u ON u.id = s.user_id WHERE s.merchant_id = ? AND s.status = 1`, [merchantId])
  for (const st of staff) {
    await wxapi.sendSubscribeMessage(st.openid, tpl,
      { thing1: { value: '您有新的已支付订单' }, character_string2: { value: String(orderNo).slice(0, 32) } },
      'pages/orders/index')
  }
  return { sent: staff.length }
}

async function handlePayNotify(orderNo, transNo, mock = false) {
  const o = await order.acceptPayment(orderNo, transNo, mock)
  if (o.duplicated) return { code: 0, duplicated: true }
  {
    // 商户端订阅消息（P2）：新订单通知门店（WX_TMPL_NEW_ORDER 未配置则 skipped，不阻断）
    notifyMerchantStaff(o.merchant_id, orderNo).catch((e) => console.error('[notify:merchant]', e.message))
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
    const v = await wxpay.verifyCallback(req.headers, req.rawBody || '')
    if (!v.ok) throw new BizError(1003, v.reason)
    const body = v.transaction
    const orderNo = body.out_trade_no
    const transNo = body.transaction_id
    const o = await order.byNo(orderNo)
    if (!o || !transNo || body.amount?.currency !== 'CNY' || Number(body.amount.total) !== Number(o.amount_pay)) throw new BizError(1001, '支付金额或订单不匹配')
    await handlePayNotify(orderNo, transNo, false)
    return { code: 'SUCCESS', message: '成功' }
  },
}

export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...cPromo, ...integrations, ...web3, ...open, ...lexicon, ...cIdentity, ...cNotes, ...mApply, ...cPhraseKyc, ...mPhrase, ...adminNew, ...adminEdit, ...callback }
for (const [key, handler] of Object.entries(routes)) {
  if (key.includes('/admin/dev/')) routes[key] = (req, res) => {
    if (process.env.NODE_ENV === 'production') throw new BizError(1003, '生产环境禁用联调操作')
    return handler(req, res)
  }
}
// 商户权限在每次请求重新校验，停用员工及变更角色立即生效，禁止跨端 JWT 复用。
for (const [key, handler] of Object.entries(routes)) {
  if (!key.split(' ')[1]?.startsWith('/m/') || key === 'POST /m/auth/login') continue
  // 注意：必须把 res 透传给原 handler —— 否则 /m/ 下的 PDF/文件类响应拿不到 res（曾踩坑：500 writeHead）
  routes[key] = async (req, res) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '请使用商户账号登录')
    if (!['POST /m/auth/join', 'POST /m/apply', 'POST /m/auth/phone-login', 'GET /m/applications'].includes(key)) {
      const staff = await one(`SELECT s.role FROM merchant_staff s JOIN merchant m ON m.id = s.merchant_id
        WHERE s.user_id = ? AND s.merchant_id = ? AND s.status = 1 AND m.status = 1`, [u.uid, u.merchantId])
      if (!staff) throw new BizError(1003, '尚未加入门店或账号已停用')
      if (Number(staff.role) !== Number(u.role)) throw new BizError(1002, '角色已变更，请重新登录')
      const manager = /\/settlements|\/supply|\/invite|\/stats|\/orders/.test(key)
      if (manager && staff.role < 2) throw new BizError(1003, '需要店长及以上权限')
      if (key === 'POST /m/supply/:sid' && req.body.action === 'price' && staff.role < 3) throw new BizError(1003, '仅老板可调整价格')
    }
    return handler(req, res)
  }
}
export { handlePayNotify }
