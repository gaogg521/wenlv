import { q, one, count, tx, BizError } from '../db.mjs'
import { cfg, cfgAll, cfgNum, cfgArr, loadConfig } from '../config.mjs'
import { requireUser, jwtSign, jwtVerify, code2Session, hashPassword, verifyPassword } from '../auth.mjs'
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
import { bindMobile, sealMobile, maskMobile } from '../infra/mobile.mjs'
import { bookingOpenSql, bookingNow } from '../domain/booking-window.mjs'

// 游客订单详情可见的订单字段（小程序订单页实际用到的 + 本人订单的基本事实）
const ORDER_PUBLIC = ['id', 'order_no', 'channel', 'product_id', 'session_id', 'city_code', 'qty', 'amount_goods', 'amount_bean_ded', 'bean_deducted',
  'amount_pay', 'insurance_fee', 'status', 'contact_name', 'refund_deadline', 'paid_at', 'completed_at', 'created_at', 'title', 'days_desc']
import { bizDay, settlementPeriod } from '../infra/bizdate.mjs'
import * as entities from '../domain/entity-schema.mjs'
import { buildSvg, svgToPdf, orderReportDoc, beanDayReportDoc, settlementReportDoc } from '../domain/report.mjs'
import * as vc from '../domain/vc.mjs'
import * as asset from '../domain/asset.mjs'
import * as badgeDomain from '../domain/badge.mjs'
import * as member from '../domain/member.mjs'
import { cardOf } from '../domain/card-tier.mjs'
import * as badgeArt from '../domain/badge-art.mjs'
import * as merchantLevel from '../domain/merchant-level.mjs'
import { capabilityDoc, renderPdf as renderOnepagerPdf, renderPng as renderOnepagerPng } from '../domain/onepager.mjs'
import * as chain from '../infra/chain.mjs'
import * as wxapi from '../domain/wxapi.mjs'
import * as wxsec from '../infra/wxsec.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { legalVersions, legalDocuments, requireProductionLegal } from '../domain/legal.mjs'
import { annotateSessions, activeRules, scopeMatch, unitPrice } from '../domain/discount.mjs'
import * as pkg from '../domain/package.mjs'
import { fen2yuan, apiImg, toCsv, requireAdmin, scopeFilter, SUP_CATS, CREATOR_TAGS, audit, capabilityContext, publicBase, notifyMerchantStaff, handlePayNotify } from './_shared.mjs'

// ---------- /c 游客端 ----------
const c = {
  'POST /c/auth/login': async (req) => {
    const { code } = req.body
    const ses = await code2Session(code || 'mock-default')
    if (!ses.openid) throw new BizError(1001, 'code2Session 失败: ' + JSON.stringify(ses))
    const matches=await q('SELECT * FROM user_account WHERE mini_a_openid = ? OR (unionid IS NOT NULL AND unionid = ?)', [ses.openid, ses.unionid||null])
    if(matches.length>1 || (matches[0]?.mini_a_openid && matches[0].mini_a_openid!==ses.openid) || (ses.unionid&&matches[0]?.unionid&&matches[0].unionid!==ses.unionid))throw new BizError(1003,'微信身份关联冲突，请联系平台核对，不能自动合并')
    let u=matches[0]||null
    if (!u) {
      const uid = await tx(async (cc) => {
        const id = await cc.ins('INSERT INTO user_account (unionid, mini_a_openid, nickname) VALUES (?,?,?)',
          [ses.unionid || null, ses.openid, '旅友' + Math.floor(Math.random() * 1e6)])
        await cc.ins('INSERT INTO bean_account (user_id) VALUES (?)', [id])
        return id
      })
      u = await one('SELECT * FROM user_account WHERE id = ?', [uid])
    }
    // A-20：同一 unionid 先用了商户端（B）再进游客端（A）时，这里补写 mini_a_openid 和旅豆账户。
    // 此前只按 unionid 归账号、openid 留 NULL —— 真实支付拿不到 openid 会直接失败，订阅消息也发不出。
    if (!u.mini_a_openid || u.mini_a_openid !== ses.openid) {
      const holder = await one('SELECT id FROM user_account WHERE mini_a_openid = ? AND id <> ?', [ses.openid, u.id])
      if (holder) throw new BizError(1003, '该微信已绑定其他账号，请联系客服处理')
      await tx(async (cc) => {
        await cc.upd('UPDATE user_account SET mini_a_openid = ? WHERE id = ?', [ses.openid, u.id])
        await cc.q('INSERT IGNORE INTO bean_account (user_id) VALUES (?)', [u.id])
      })
    }
    if (Number(u.status) === 0) throw new BizError(1003, '账号已被停用，请联系客服')
    return { token: jwtSign({ uid: u.id, end: 'c' }, 7 * 24 * 3600), user: { id: u.id, nickname: u.nickname, memberLevel: u.member_level, growth: u.growth_value } }
  },

  'POST /c/auth/phone': async (req) => {
    const u = requireUser(req)
    // 微信官方「手机号快速验证组件」：前端 button open-type=getPhoneNumber → code → 服务端换号
    const { phoneNumber, mock } = await wxapi.getPhoneNumber(req.body.code || '')
    await tx(async (cc) => bindMobile(cc, u.uid, phoneNumber, BizError))
    // A-08：不下发明文号码，也不再把打码值给前端填表单（打码值过不了 11 位校验、必下单失败）。
    // 下发短期凭证（10 分钟，JWT 签名 + AES 密文封装）：下单时随单提交，服务端解封直接写订单联系电话
    const { sealMobile } = await import('../infra/mobile.mjs')
    const ticket = jwtSign({ uid: u.uid, ph: sealMobile(phoneNumber).enc.toString('base64'), tk: 'phone' }, 600)
    return { ticket, mock, phoneMasked: phoneNumber.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') }
  },

  'GET /c/notify/templates': async (req) => {
    requireUser(req)
    // A-41：补出「未成团取消通知」模板——此前从未请求过订阅授权，取消了也发不出
    const { getSecrets } = await import('../infra/secrets.mjs')
    const s = await getSecrets(['WX_TMPL_PAY_OK', 'WX_TMPL_GROUP_CANCEL'])
    return {
      payOk: s.WX_TMPL_PAY_OK || process.env.WX_TMPL_PAY_OK || null,
      groupCancel: s.WX_TMPL_GROUP_CANCEL || process.env.WX_TMPL_GROUP_CANCEL || null,
    }
  },

  'GET /c/home': async () => ({
    banners: [{ title: '朱家角剧本游 · 江南谜案', tag: '实景搜证·多结局' }],
    cats: (await cfgAll())['channel.initial'],
    // A-39：groups 过滤下架商品（此前只过滤团期，下架商品仍在列）
    groups: await q(`SELECT s.id session_id, p.id product_id, p.title, p.days_desc, s.depart_date, s.quota - s.booked AS left_seats
      FROM tour_session s JOIN tour_product p ON p.id = s.product_id
      WHERE s.status = 1 AND p.status = 1 AND s.depart_date >= CURDATE() AND ${bookingOpenSql('s')} ORDER BY s.depart_date LIMIT 6`, [bookingNow()]),
    hot: await q(`SELECT p.id, p.title, p.subtitle, p.price_from, p.bean_gift, p.city_code, p.cat, p.days_desc
      FROM tour_product p WHERE p.status = 1 ORDER BY p.id LIMIT 10`),
  }),

  'GET /c/tours': async (req) => {
    const { cat = 'all', kw = '', city = '' } = req.query
    // 搜索同时命中标题、副标题，以及后台维护的「搜索关键词」「标签」
    // A-30：主题游"全部"不再混入商城商品（此前 6 条里 3 条是 shop SKU）
    const like = '%' + kw + '%'
    const rows = await q(`SELECT p.id, p.title, p.subtitle, p.price_from, p.bean_gift, p.city_code, p.cat, p.days_desc, p.images, p.days_desc days,
        JSON_EXTRACT(p.profile, '$.tags') tags_json, m.level merchant_lv
      FROM tour_product p JOIN merchant m ON m.id = p.merchant_id WHERE p.status = 1 ${cat !== 'all' ? 'AND p.cat = ?' : 'AND p.cat <> \'shop\''}
      ${kw ? `AND (p.title LIKE ? OR p.subtitle LIKE ? OR JSON_SEARCH(p.profile, 'one', ?, NULL, '$.keywords') IS NOT NULL OR JSON_SEARCH(p.profile, 'one', ?, NULL, '$.tags') IS NOT NULL)` : ''}
      ${city ? 'AND p.city_code = ?' : ''} ORDER BY p.id`,
      [...(cat !== 'all' ? [cat] : []), ...(kw ? [like, like, like, like] : []), ...(city ? [city] : [])])
    const tagCache = {}
    for (const r of rows) if (!(r.merchant_lv in tagCache)) tagCache[r.merchant_lv] = await merchantLevel.listTagFor(r.merchant_lv)
    // D01：列表同源显示原价与折扣后价——对在售团期批量注价，取最低有效单价（作用域按产品城市/渠道判定）
    const ids = rows.map(r => Number(r.id))
    const sessRows = ids.length ? await q(`SELECT s.product_id, s.depart_date, s.price_adult, s.early_price, s.early_days FROM tour_session s WHERE s.product_id IN (?) AND s.status = 1 AND s.depart_date >= CURDATE() AND ${bookingOpenSql('s')}`, [ids, bookingNow()]) : []
    const priceByProd = {}
    if (sessRows.length) {
      const srcById = Object.fromEntries(rows.map(r => [Number(r.id), r]))
      const rules = await activeRules()
      const today = String(bookingNow()).slice(0, 10)
      for (const s of sessRows) {
        const base = srcById[Number(s.product_id)]
        const ctx = { product_id: s.product_id, city_code: base.city_code, channel: base.channel, depart_date: s.depart_date }
        let best = null
        for (const rule of rules) {
          if (!scopeMatch(rule, ctx)) continue
          const pr = unitPrice(s, rule, today)
          if (!best || pr.unitFen < best.unitFen) best = pr
        }
        const unit = best ? best.unitFen : order.priceForSession(s).price
        const pid = Number(s.product_id)
        if (priceByProd[pid] == null || unit < priceByProd[pid]) priceByProd[pid] = unit
      }
    }
    return rows.map(({ tags_json, merchant_lv, ...r }) => {
      const now = priceByProd[Number(r.id)]
      return { ...r, merchantTag: tagCache[merchant_lv] || null, tags: ((typeof tags_json === 'string' ? JSON.parse(tags_json) : tags_json) || []).slice(0, 3), loc: (Object.fromEntries(entities.DICT.city))[r.city_code] || r.city_code, beanGift: Number(r.bean_gift), price: Number(r.price_from), priceLabel: fen2yuan(r.price_from),
        priceNow: now != null ? now : Number(r.price_from), priceNowLabel: fen2yuan(now != null ? now : r.price_from), hasPromo: !!(now != null && now < Number(r.price_from)) }
    })
  },

  'GET /c/tours/:id': async (req) => {
    const p = await one(`SELECT p.*, m.name merchant_name FROM tour_product p JOIN merchant m ON m.id = p.merchant_id WHERE p.id = ?`, [req.params.id])
    if (!p || p.status !== 1) throw new BizError(1004, '商品不存在或已下架')
    const sessions = await q(`SELECT id, depart_date, quota, quota - booked AS left_seats, booked, min_go,
      price_adult, early_price, early_days, status, profile
      FROM tour_session s WHERE product_id = ? AND depart_date >= CURDATE() AND status = 1 AND ${bookingOpenSql('s')} ORDER BY depart_date`, [p.id, bookingNow()])
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
    // D01：早鸟/商品折扣统一注价——priceNow 为最终有效单价（同源建单试算），命中折扣时附 promo 信息
    const annotated = await annotateSessions(sessions, { product_id: p.id, city_code: p.city_code, channel: p.channel })
    const sessPub = sessions.map(({ profile, ...s }, i) => {
      const ep = order.priceForSession(s)
      const hit = annotated[i]
      const unit = hit?.price ? hit.price.unitFen : ep.price
      const rule = hit?.rule
      return { ...s, info: entities.publicProfile('session', { ...s, profile }), priceLabel: fen2yuan(s.price_adult), priceNow: unit, priceNowLabel: fen2yuan(unit),
        isEarly: ep.isEarly, daysToDepart: ep.daysToDepart,
        promo: rule ? { id: Number(rule.id), name: rule.name, zhe: Number(rule.discount_bp) / 1000, stack: Number(rule.stack_early) === 1,
          type: hit.price.type, originalFen: hit.price.originalFen, zheLabel: (Number(rule.discount_bp) / 1000).toFixed(2).replace(/\.?0+$/, '') } : null,
        groupProgress: { booked: Number(s.booked), minGo: Number(s.min_go), reached: Number(s.booked) >= Number(s.min_go) } }
    })
    return { ...pub, hasPhrase: !!p.phrase_user, beanGift: Number(p.bean_gift), priceLabel: fen2yuan(p.price_from),
      insuranceAvailable: process.env.NODE_ENV !== 'production', insuranceMode: process.env.NODE_ENV === 'production' ? 'unavailable' : 'demo',
      merchantCard: entities.publicProfile('merchant', merchantRow, img),
      merchantHonor: await honorOf(p.merchant_id, req),
      scenicCard: scenicRow ? { id: scenicRow.id, ...entities.publicProfile('scenic', scenicRow, img) } : null,
      relatedFaqs,
      sessions: sessPub,
      // B02：套餐组成项公开信息（名称/类型/数量/提供方名称；不含成本、分摊等经营字段）
      packageItems: (await q(`SELECT pi.name, pi.kind, pi.qty_per_unit, m.name merchant_name FROM package_item pi JOIN merchant m ON m.id = pi.merchant_id
        WHERE pi.product_id = ? AND pi.status = 1 ORDER BY pi.sort, pi.id`, [p.id])).map(i => ({ name: i.name, kind: Number(i.kind), qtyPerUnit: Number(i.qty_per_unit), merchantName: i.merchant_name })),
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
      honor: kind === 'merchant' ? await honorOf(row.id, req) : null,
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
    const prod = await one('SELECT merchant_id FROM tour_product WHERE id = ?', [o.product_id])
    if (prod && prod.merchant_id) await badgeDomain.evaluateMerchantSafe(Number(prod.merchant_id)) // 新评价影响商户评分与口碑徽章
    return { id, rating: rate, secMock: sec.mock, badges }
  },

  'POST /c/orders': async (req) => {
    const u = requireUser(req)
    await requireProductionLegal(u.uid)
    // A-44：隐私授权兜底——未同意（或已撤回）隐私政策不得下单（小程序端下单页有勾选，这里是服务端强校验）
    const consent = await one("SELECT granted FROM user_privacy_consent WHERE user_id = ? AND scene = 'privacy'", [u.uid])
    if (!consent || Number(consent.granted) !== 1) throw new BizError(1001, '请先阅读并同意《隐私政策》后再下单')
    const { sessionId, qty = 1, beanDeduct = 0, promoScene, contactName, contactPhone, phoneTicket } = req.body
    // A-23：联系信息在建单前拦截——此前校验缺失，姓名过长时报"系统错误"但订单已建、旅豆已扣、名额已占
    const name = String(contactName || '').trim()
    if (name.length < 2 || name.length > 20) throw new BizError(1001, '请填写联系人姓名（2–20 字）')
    if (!phoneTicket && !/^1[3-9]\d{9}$/.test(String(contactPhone || ''))) throw new BizError(1001, '请填写 11 位有效手机号，或使用一键获取')
    // A-08：一键获取的手机号以短期凭证随单提交，服务端解封后加密落库（明文不过接口、打码值不再进表单）
    let sealedPhone = null
    if (phoneTicket) {
      const p = jwtVerify(String(phoneTicket))
      if (!p || p.tk !== 'phone' || Number(p.uid) !== Number(u.uid)) throw new BizError(1001, '手机号凭证无效或已过期，请重新获取')
      const { openMobile } = await import('../infra/mobile.mjs')
      const plain = openMobile(Buffer.from(String(p.ph), 'base64'))
      if (!plain || !/^1[3-9]\d{9}$/.test(plain)) throw new BizError(1001, '手机号凭证无效，请重新获取')
      sealedPhone = sealMobile(plain).enc
    } else if (contactPhone && /^1[3-9]\d{9}$/.test(String(contactPhone))) {
      sealedPhone = sealMobile(String(contactPhone)).enc
    }
    const r = await order.place({
      userId: u.uid, sessionId, qty, wantedBeans: beanDeduct, promoScene, withInsurance: !!req.body.insurance,
      freedomRightId:req.body.freedomRightId, expectedGoodsFen: req.body.expectedGoodsFen != null ? Number(req.body.expectedGoodsFen) : null,
      beanHook: { deduct: (uid, beans, orderNo) => bean.deduct(uid, beans, bean.BIZ.DEDUCT, orderNo) },
    })
    await tx(async (cc) => {
      // 联系电话加密落库（V38）；旧列 contact_phone_enc 只留历史明文，新单不再写
      await cc.upd('UPDATE orders SET contact_name = ?, contact_phone_sealed = ?, contact_phone_enc = NULL WHERE order_no = ?',
        [contactName || null, sealedPhone, r.orderNo])
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
      freedomDiscount: r.freedomDiscount || 0, goodsFen: r.pricing?.goodsFen ?? null, priceType: r.pricing?.priceType ?? null,
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
    const passes = await q('SELECT id, name, status, order_item_id FROM travel_pass WHERE order_id = ?', [o.id])
    // B02/B04：订单项（游客可见：名称/类型/数量/现金分摊/履约状态；成本与供给来源不下发）
    const orderItems = await q(`SELECT oi.id, oi.name, oi.kind, oi.qty, oi.cash_fen, oi.status, oi.pass_total, oi.pass_done, m.name merchant_name
      FROM order_item oi JOIN merchant m ON m.id = oi.merchant_id WHERE oi.order_id = ? ORDER BY oi.id`, [o.id])
    const itemStatusText = { 0: '待履约', 1: '已完成', 2: '已退款', 3: '赠送' }
    // A-27：时间线下发面向用户的文案——内部事件键（REFUND_APPLY）、actor（user:57）、交易号、内部备注不下发
    const ST_TEXT = { 0: '下单', 10: '待支付', 20: '已支付', 30: '待出行', 40: '已核销', 50: '已完成', 60: '退款处理中', 70: '已退款', 90: '已关闭' }
    const events = (await q('SELECT from_st, to_st, created_at FROM order_event WHERE order_id = ? ORDER BY id', [o.id]))
      .map((e) => ({ text: `${ST_TEXT[Number(e.from_st)] || '订单'} → ${ST_TEXT[Number(e.to_st)] || '处理中'}`, at: String(e.created_at).slice(0, 19) }))
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
    // 红线 2：只下发白名单字段，不能 { ...o } 整行（会带出 user_id / merchant_id / settlement_id / 版本号、电话密文与历史明文列等内部字段）
    const pub = Object.fromEntries(ORDER_PUBLIC.filter((k) => k in o).map((k) => [k, o[k]]))
    return { ...pub, freedom:await (await import('../domain/freedom.mjs')).orderView(o.order_no,u.uid), contactPhone: maskMobile(o.contact_phone_sealed || o.contact_phone_enc), amountPayLabel: fen2yuan(o.amount_pay), passes, events, reviewed, canRebook, rebookOptions, refundInfo, trip, merchantContact,
      orderItems: orderItems.map(i => ({ id: Number(i.id), name: i.name, kind: Number(i.kind), kindText: Number(i.kind) === 1 ? '按人凭证' : '服务项', qty: Number(i.qty), cashYuan: fen2yuan(i.cash_fen), status: Number(i.status), statusText: itemStatusText[Number(i.status)] || '待履约', passTotal: Number(i.pass_total), passDone: Number(i.pass_done), merchantName: i.merchant_name })) }
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
    const p = await one('SELECT * FROM travel_pass WHERE id = ? AND user_id = ?', [req.params.id, u.uid])
    if (!p) throw new BizError(4001, '凭证不存在')
    // A-28：已核销的凭证不再报"凭证加载失败"——返回已核销态与时间，核销码页据此展示
    if (Number(p.status) === 2) {
      const v = await one('SELECT created_at FROM verification_log WHERE pass_id = ? AND result = 1 ORDER BY id DESC LIMIT 1', [p.id])
      return { verified: true, verifiedAt: v ? String(v.created_at).slice(0, 19) : null }
    }
    if (Number(p.status) !== 1) throw new BizError(4001, Number(p.status) === 4 ? '凭证已作废（订单已退款或已取消）' : '凭证状态异常')
    return await pass.currentQr(Number(req.params.id))
  },

  'GET /c/bean/account': async (req) => {
    requireUser(req)
    const bal = await bean.balance(requireUser(req).uid)
    const rate = Math.round(await cfgNum('bean.order_rate') * 100), cap = Math.round(await cfgNum('bean.deduct_max_pct') * 100), months = await cfgNum('bean.expire_months')
    const uid = requireUser(req).uid
    const mo = await one(`SELECT COALESCE(SUM(CASE WHEN l.direction = 1 AND l.biz_type IN (1,2,3,5) THEN l.amount END), 0) inc,
      COALESCE(SUM(CASE WHEN l.direction = 2 AND l.biz_type IN (4,6,7) THEN l.amount END), 0) outc
      FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id = ? AND l.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`, [uid])
    // 30 天内将到期：入账满 (有效期 - 1) 个月的发放量，上限为当前余额（展示估算：按发放批次面额，未逐批扣减 FIFO 消费；过期实扣以过期任务为准）
    const ex = await one(`SELECT COALESCE(SUM(l.amount), 0) s FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id
      WHERE a.user_id = ? AND l.direction = 1 AND l.biz_type IN (1,2,3) AND l.created_at < NOW() - INTERVAL ? MONTH + INTERVAL 30 DAY`, [uid, months])
    return { balance: bal, orderRatePct: rate, deductMaxPct: cap, expireMonths: months,
      monthIn: Number(mo.inc), monthOut: Number(mo.outc), expiringSoon: Math.min(Number(bal), Number(ex.s)), yuan: Math.floor(Number(bal) / 10 * 10) / 10, coinArt: apiImg('/badge-art/bean.png', req),
      rule: `消费返豆 ${rate}% · 100 豆可抵 10 元 · 单笔抵扣上限 ${cap}% · 滚动 ${months} 个月有效 · 不可转让不可购买` }
  },

  'GET /c/bean/ledger': async (req) => {
    const u = requireUser(req)
    const rows = await q(`SELECT l.tx_no, l.direction, l.amount, l.biz_type, l.biz_ref, l.created_at
      FROM bean_ledger l JOIN bean_account a ON a.id = l.account_id WHERE a.user_id = ? ORDER BY l.id DESC LIMIT 50`, [u.uid])
    return rows
  },

  // 隐私授权（逐项可撤回）：签署即入存证 —— 这是"用户知不知道规则"唯一拿得出手的证据
  'GET /c/consent': async (req) => {
    const u = requireUser(req)
    const rows = await q('SELECT scene, granted, granted_at, revoked_at, version FROM user_privacy_consent WHERE user_id = ?', [u.uid])
    // cfg() 对未注册的键会抛错（配置中心要求显式声明），这里用兜底读取，避免因为"没配版本号"整个接口 500
    const cfgOr = async (k, d) => { try { return (await cfg(k)) || d } catch { return d } }
    return {
      versions: await legalVersions(), documentsReady: await legalDocuments(),
      items: rows.map((r) => ({ scene: r.scene, granted: Number(r.granted) === 1, version: r.version, grantedAt: r.granted_at, revokedAt: r.revoked_at })),
    }
  },
  'POST /c/consent': async (req) => {
    const u = requireUser(req)
    const scene = String(req.body.scene || '').trim()
    const granted = req.body.granted === true || req.body.granted === 1 || req.body.granted === '1'
    // scene 是自由字符串的话，"同意过什么"就无从核对 → 只允许白名单
    const ALLOWED = ['privacy', 'terms', 'location', 'marketing']
    if (!ALLOWED.includes(scene)) throw new BizError(1001, '未知的授权项：' + scene + '（可用：' + ALLOWED.join('/') + '）')
    const cfgOr = async (k, d) => { try { return (await cfg(k)) || d } catch { return d } }
    const version = String(req.body.version || await cfgOr('legal.' + scene + '_version', await cfgOr('legal.privacy_version', '2026.11')))
    if (version.length > 64) throw new BizError(1001, '协议版本格式不正确')
    if (granted && ['terms', 'privacy'].includes(scene) && process.env.NODE_ENV === 'production') {
      if (!(await legalDocuments())[scene]) throw new BizError(1001, '协议正文尚未发布，暂不可确认同意')
      if (req.body.version !== (await legalVersions())[scene]) throw new BizError(1001, '协议已更新，请重新打开并阅读')
    }
    await tx(async c => {
      await c.q(`INSERT INTO user_privacy_consent (user_id, scene, granted, granted_at, revoked_at, version)
      VALUES (?,?,?,IF(?=1,NOW(3),NULL),IF(?=0,NOW(3),NULL),?)
      ON DUPLICATE KEY UPDATE granted = VALUES(granted),
        granted_at = IF(VALUES(granted) = 1, NOW(3), granted_at),
        version = VALUES(version), revoked_at = IF(VALUES(granted) = 0, NOW(3), NULL)`, [u.uid, scene, granted ? 1 : 0, granted ? 1 : 0, granted ? 1 : 0, version])
    // 版本进 biz_ref：换一版规则重签就是一片新叶子，不会把旧同意覆盖掉
    // version_no 区分"同意(1)/撤回(2)"：同一版本的同意与撤回各留一片叶子，撤回不会被幂等键吞掉
      const ref = `consent-${u.uid}-${scene}-${version}`
      const latest = await c.one("SELECT MAX(version_no) n FROM attest_event WHERE biz_type='consent' AND biz_ref=?", [ref])
      await attestDomain.attest('consent', ref, { userId: Number(u.uid), scene, granted, version }, c, Number(latest.n || 0) + 1)
    })
    return { scene, granted, version }
  },

  'GET /c/me': async (req) => {
    const u = requireUser(req)
    const acc = await one('SELECT * FROM user_account WHERE id = ?', [u.uid])
    return {
      id: acc.id, nickname: acc.nickname, avatarUrl: acc.avatar_url, memberLevel: acc.member_level, growth: acc.growth_value,
      level: withLevelArt(await member.progress(u.uid), req),
      levelThresholds: (await member.levels()).map((l) => l.min),
      bean: await bean.balance(u.uid),
      passes: await count('SELECT COUNT(*) c FROM travel_pass WHERE user_id = ?', [u.uid]),
    }
  },

  // 会员等级：当前等级 / 距下一级进度 / 全部等级与权益（来自参数中心，三个页面共用）
  'GET /c/member': async (req) => withLevelArt(await member.progress(requireUser(req).uid), req),

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
      if (!/^\/uploads\/avatar_[0-9]+_[0-9]+\.(png|jpg|jpeg|webp)$/.test(String(avatarUrl))) throw new BizError(1001, '头像地址非法')
      await tx(async (cc) => cc.upd('UPDATE user_account SET avatar_url = ? WHERE id = ?', [avatarUrl, u.uid]))
    }
    const acc = await one('SELECT nickname, avatar_url FROM user_account WHERE id = ?', [u.uid])
    return { nickname: acc.nickname, avatarUrl: acc.avatar_url, secMock: sec ? sec.mock : null }
  },

  // 笔记配图上传（A-43）：同头像通道口径（base64 + 文件头校验 + 版本文件名），2MB 内
  'POST /c/upload/note-image': async (req) => {
    const u = requireUser(req)
    const { data, ext = 'jpg' } = req.body || {}
    if (!data) throw new BizError(1001, '缺少文件内容')
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new BizError(1001, '仅支持 png/jpg/webp')
    const buf = Buffer.from(String(data), 'base64')
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024) throw new BizError(1001, '图片大小需在 2MB 内')
    const magics = { png: [[0x89, 0x50, 0x4e, 0x47]], jpg: [[0xff, 0xd8, 0xff]], jpeg: [[0xff, 0xd8, 0xff]], webp: [[0x52, 0x49, 0x46, 0x46]] }
    const okMagic = (magics[ext] || []).some((sig) => sig.every((byte, i) => buf[i] === byte))
    if (!okMagic) throw new BizError(1001, '文件内容与格式不符，请重新选择图片')
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'uploads')
    fs.mkdirSync(dir, { recursive: true })
    const name = `note_${u.uid}_${Date.now()}.` + (ext === 'jpeg' ? 'jpg' : ext)
    fs.writeFileSync(path.join(dir, name), buf)
    return { url: '/uploads/' + name }
  },

  // 旅行笔记广场（A-43）：仅已发布（status=2）笔记，分页，带封面/作者/点赞/关联线路
  'GET /c/notes/feed': async (req) => {
    requireUser(req)
    const u = requireUser(req)
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(req.query.pageSize) || 20)))
    const rows = await q(`SELECT n.id, n.title, n.like_count, n.published_at, u.nickname author, p.title product_title,
        JSON_UNQUOTE(JSON_EXTRACT(n.body, '$.images[0]')) cover
      FROM content_note n JOIN user_account u ON u.id = n.user_id
      LEFT JOIN tour_product p ON p.id = n.related_product_id
      WHERE n.status = 2 ORDER BY n.published_at DESC, n.id DESC LIMIT ? OFFSET ?`, [pageSize, (page - 1) * pageSize])
    const liked = rows.length ? await q(`SELECT note_id FROM content_note_likes WHERE user_id = ? AND note_id IN (${rows.map(() => '?').join(',')})`, [u.uid, ...rows.map((r) => r.id)]) : []
    const likedSet = new Set(liked.map((x) => Number(x.note_id)))
    return {
      page, pageSize,
      items: rows.map((r) => ({
        ...r, cover: r.cover ? apiImg(r.cover, req) : null,
        liked: likedSet.has(Number(r.id)), likeCount: Number(r.like_count),
        productTitle: r.product_title || null,
        when: String(r.published_at || '').slice(0, 10),
      })),
    }
  },

  // 点赞（A-43）：一用户一笔记一赞，重复点赞给业务错误；取消可重赞
  'POST /c/notes/:id/like': async (req) => {
    const u = requireUser(req)
    const n = await one('SELECT id, status FROM content_note WHERE id = ?', [req.params.id])
    if (!n || Number(n.status) !== 2) throw new BizError(1004, '笔记不存在或未发布')
    try {
      await tx(async (c) => {
        await c.ins('INSERT INTO content_note_likes (note_id, user_id) VALUES (?,?)', [n.id, u.uid])
        await c.upd('UPDATE content_note SET like_count = like_count + 1 WHERE id = ?', [n.id])
      })
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') throw new BizError(1001, '已经赞过这篇笔记了')
      throw e
    }
    return { liked: true, likeCount: Number((await one('SELECT like_count FROM content_note WHERE id = ?', [n.id])).like_count) }
  },
  'DELETE /c/notes/:id/like': async (req) => {
    const u = requireUser(req)
    const n = await tx(async (c) => {
      const gone = await c.q('DELETE FROM content_note_likes WHERE note_id = ? AND user_id = ?', [req.params.id, u.uid])
      if (gone.affectedRows > 0) await c.upd('UPDATE content_note SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?', [req.params.id])
      return gone.affectedRows
    })
    return { liked: false, likeCount: Number((await one('SELECT like_count FROM content_note WHERE id = ?', [req.params.id])).like_count), removed: n > 0 }
  },

  // 头像上传（base64 JSON：规避零框架 multipart；2MB 上限 + 白名单扩展名 + 文件头校验）
  'POST /c/upload/avatar': async (req) => {
    const u = requireUser(req)
    const { data, ext = 'png' } = req.body || {}
    if (!data) throw new BizError(1001, '缺少文件内容')
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new BizError(1001, '仅支持 png/jpg/webp')
    const buf = Buffer.from(String(data), 'base64')
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024) throw new BizError(1001, '文件大小需在 2MB 内')
    // A-29：校验文件头（magic bytes）——此前任何内容改名 png 都能上传
    const magics = { png: [[0x89, 0x50, 0x4e, 0x47]], jpg: [[0xff, 0xd8, 0xff]], jpeg: [[0xff, 0xd8, 0xff]], webp: [[0x52, 0x49, 0x46, 0x46]] }
    const okMagic = (magics[ext] || []).some((sig) => sig.every((byte, i) => buf[i] === byte))
    if (!okMagic) throw new BizError(1001, '文件内容与格式不符，请重新选择图片')
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'uploads')
    fs.mkdirSync(dir, { recursive: true })
    // A-29：文件名带版本时间戳——此前固定 avatar_<uid>.x，微信端缓存一天，换头像不更新
    const name = `avatar_${u.uid}_${Date.now()}.` + (ext === 'jpeg' ? 'jpg' : ext)
    fs.writeFileSync(path.join(dir, name), buf)
    return { url: '/uploads/' + name }
  },

  // 退款试算：与真正扣费同一函数，确认弹窗里的金额就是实际退回金额
  'GET /c/orders/:no/refund-quote': async (req) => {
    const u = requireUser(req)
    const o = await order.byNo(req.params.no)
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    // A-01：免费改签单实收 ¥0（成本商户承担），不能走原路退款；取消订单释放名额即可
    if (o.rebook_of) return { allowed: false, reason: '免费改签订单不退款；取消订单将释放名额（不产生退款）', rebook: true }
    const qt = await refund.quoteFor(o)
    return { ...qt, feeLabel: qt.feeFen != null ? fen2yuan(qt.feeFen) : null, refundLabel: qt.refundFen != null ? fen2yuan(qt.refundFen) : null,
      amountPayLabel: fen2yuan(o.amount_pay), rules: refundPolicy.describe(await cfg('order.refund_policy')) }
  },
  'POST /c/orders/:no/refund': async (req) => {
    const u = requireUser(req)
    const o = await order.byNo(req.params.no)
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    const { reason } = req.body
    if (o.status === 10) {
      // A-03：取消未支付单必须退回抵扣旅豆并释放名额（此前只关单，豆和名额都没还）
      await order.closeUnpaid(o.order_no, 'user_cancel', 'user:' + u.uid, '用户取消未支付单·名额释放')
      return { closed: true }
    }
    // A-01：免费改签单取消 = 释放名额关闭订单，不退款（实收 ¥0，无款可退）
    if (o.rebook_of) {
      await order.cancelRebook(o.order_no, 'user:' + u.uid)
      return { closed: true, rebook: true, msg: '免费改签订单已取消，名额已释放（免费改签订单不产生退款）' }
    }
    // 自助退款只覆盖"已支付、未核销"：核销即服务已发生，全额自助退款会让用户玩完再全退。
    // 已核销订单的售后由客服在后台处理（后台退款接口不受此限制，并留审计）
    if (![20, 30].includes(Number(o.status))) throw new BizError(2002, Number(o.status) === 40 ? '凭证已核销，如需售后请联系客服' : '当前状态不可退款')
    // 按退改梯度（order.refund_policy）扣手续费；不在任何档位内（如出发当天）直接拒绝并提示联系客服
    const r = await refund.refundOrder({ orderNo: o.order_no, reason: reason || '用户退款', operator: 'user:' + u.uid, applyPolicy: true })
    await q("UPDATE orders SET close_reason = 'user_refund' WHERE order_no = ? AND status = 70", [o.order_no])
    return r
  },

  // B04 套餐按项部分退款（游客自助）：仅未核销项，按政策扣手续费；套餐订单优先走项级退款
  'POST /c/orders/:no/partial-refund': async (req) => {
    const u = requireUser(req)
    const o = await order.byNo(req.params.no)
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    if (![20, 30].includes(Number(o.status))) throw new BizError(2002, '当前状态不可按项退款')
    const { reason, itemIds } = req.body
    if (!Array.isArray(itemIds) || !itemIds.length) throw new BizError(1001, '请选择要退的订单项')
    const mine = await q('SELECT id FROM order_item WHERE order_id = ? AND id IN (?)', [o.id, itemIds.map(Number)])
    if (mine.length !== new Set(itemIds.map(Number)).size) throw new BizError(2003, '订单项不存在')
    return pkg.partialRefund({ orderNo: o.order_no, itemIds, reason: String(reason || '用户按项退款').slice(0, 300), operator: 'user:' + u.uid, applyPolicy: true })
  },

  // B04 套餐订单可退项试算（游客展示）
  'GET /c/orders/:no/partial-refund-quote': async (req) => {
    const u = requireUser(req)
    const o = await order.byNo(req.params.no)
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    const items = await pkg.refundableItems(o.id)
    return { items, policy: refundPolicy.describe(await cfg('order.refund_policy')) }
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
    const p = await one('SELECT tier, rate_bp, status, valid_gmv_90d,profile FROM promoter WHERE user_id = ?', [u.uid])
    if (!p) return { promoter: false }
    const agg = await one(`SELECT COALESCE(SUM(CASE WHEN status IN (1,2) THEN amount ELSE 0 END),0) earned,
      COALESCE(SUM(CASE WHEN status IN (3,4) THEN amount ELSE 0 END),0) reversed FROM commission WHERE promoter_id = ?`, [u.uid])
    const paid = await one(`SELECT COALESCE(SUM(w.amount),0) paid FROM promoter_withdraw w WHERE w.promoter_id = ? AND w.status = 1`, [u.uid])
    const pending = await count('SELECT COUNT(*) c FROM promoter_withdraw WHERE promoter_id = ? AND status IN (0,3)', [u.uid])
    const recent = await one(`SELECT COALESCE(SUM(c.base_amount),0) gmv FROM commission c JOIN orders o ON o.id=c.order_id WHERE c.promoter_id=? AND c.status IN (0,1,2) AND o.paid_at>=NOW()-INTERVAL 90 DAY AND o.status IN (20,30,40,50)`,[u.uid])
    const pf=typeof p.profile==='string'?JSON.parse(p.profile||'{}'):(p.profile||{})
    return { promoter: true, active: Number(p.status) === 1, tier: p.tier, rateBp: p.rate_bp, earned: Number(agg.earned), withdrawn: Number(paid.paid),payoutTail:pf.payout_account?'***'+String(pf.payout_account).slice(-4):null,payoutMethod:pf.payout_method||null,
      validGmv: Number(recent.gmv), withdrawMin: await cfgNum('promoter.withdraw_min'), settleDelayDays: await cfgNum('commission.settle_delay_days'),
      ...await (await import('./sales.mjs')).withdrawalBalance({one},u.uid),pendingRequests: pending }
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

}

// 术语字典：一处定义、三处分发（T1 用户端 / T2 后台 / T3 对外）
// 小程序不得硬写"存证/链/Web3/NFT/Token/钱包"等词，一律从这里取
const LEXICON = {
  T1: {
    attestation: '可信记录', attest_list: '可信记录流水', attest_empty: '暂无记录',
    did: '文旅数字身份', pass: '权益凭证', badge: '勋章', bean: '旅豆', level: '会员等级', growth: '成长值',
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
  // 后台「术语映射」页的唯一数据源：[小程序合规词, 后台/存证口径, 使用边界]
  TERMS: [
    ['旅豆', '积分账本（双边记账 + 发行总量哨兵）', '小程序端一律叫「旅豆」；后台台账语境可称积分'],
    ['入园凭证 / 权益凭证', '权益凭证（凭证编号即存证业务单号）', '小程序不出现 NFT / 资产类用语'],
    ['可信记录', '存证事件（attest_event）', '对外讲「可信记录」；后台展示事件、批次与 Merkle 根'],
    ['校验码 / 今日账本已封存', 'Merkle 根 / 日终封存（bean_day_root）', '小程序只展示校验码与「已封存」，不出现根哈希词汇'],
    ['积分发行台账', '按预算批次发行', '发行受总量上限哨兵约束，严禁超发'],
    ['勋章', '数字勋章（不可转让）', '小程序端统一叫「勋章」；勋章墙显示已点亮 / 总数；不可转让、不可交易'],
    ['会员等级 / 成长值', '等级体系参数（参数中心 member.levels：等级名 / 门槛 / 返豆加成 / 权益）', '等级名、门槛、返豆加成均由后台配置，小程序只读展示'],
    ['权益账户', '用户旅豆账户 + 权益视图', '仅后台可见；小程序端无「钱包 / 资产」概念'],
    ['共创分润', '分润台账（每期封存）', '小程序端只显示分润金额与状态'],
    ['推广服务商', '推广节点', '禁止层级计酬；仅内部运营语境'],
    ['文旅数字身份', '可携出旅行凭证（VC-JWT）', '小程序端叫「数字身份」，不出现 DID / 凭证签发等词'],
  ],
  updatedAt: '2026-11-03',
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
    const names = {10:'待支付',20:'已支付',30:'待使用',40:'已核销',50:'已完成',60:'退款中',70:'已退款',90:'已关闭'}
    return rows.map((r) => ({ when: String(r.hit_at).slice(0, 10), orderNo: r.order_no || null,
      amount: r.order_no ? Number(r.amount_pay) : null, status: r.order_no ? r.status : null, statusText: r.order_no ? names[r.status] || '状态待核对' : '仅到访' }))
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
    // A-24：标题长度在建库前拦截（此前 70 字标题直接触发数据库报"系统错误"）
    if (title != null && String(title).trim().length > 30) throw new BizError(1001, '标题最多 30 字，请精简后发布')
    const { msgSecCheck } = await import('../infra/wxsec.mjs')
    const account = await one('SELECT mini_a_openid FROM user_account WHERE id=?', [u.uid])
    const sec = await msgSecCheck((title || '') + ' ' + body, account?.mini_a_openid)
    // 图片机审（P2 启用 mediaCheckAsync）：MOCK 通道直通；真实通道为异步回执，先挂机审中
    const imgUrls = Array.isArray(images) ? images.slice(0, 9) : []
    const imgSec = []
    let status = sec.pass ? 2 : 1
    for (const url of imgUrls) {
      const r = await wxapi.mediaCheckAsync(apiImg(String(url).slice(0, 500), req), account?.mini_a_openid)
      imgSec.push({ url: String(url).slice(0, 500), traceId: r.traceId, mock: r.mock })
      if (!r.mock && sec.pass) status = 0 // 真实异步机审 → 全图回执通过后才能发布
    }
    const id = await tx(async c => {
      const id = await c.ins('INSERT INTO content_note (user_id, title, body, status, sec_check_id, related_product_id,published_at) VALUES (?,?,?,?,?,?,IF(?=2,NOW(3),NULL))',
        [u.uid, title || null, JSON.stringify({ text: sanitizeRich(String(body)), images: imgUrls, imgSec, textCheck: { pass: sec.pass, mock: sec.mock } }), status, sec.mock ? 'mock' : 'wx-sec', relatedProductId || null, status])
      for (const check of imgSec.filter(x => !x.mock)) await c.ins('INSERT INTO content_media_check (trace_id,note_id) VALUES (?,?)', [check.traceId, id])
      return id
    })
    return { id, status, secMock: sec.mock, imgChecked: imgSec.length,
      msg: status === 2 ? '已发布' : status === 0 ? '图片机审中' : '进入人工审核' }
  },
  // 笔记详情独立页（P2）：仅已发布可见
  'GET /c/notes/:id': async (req) => {
    const user = requireUser(req)
    const n = await one(`SELECT c.id, c.title, c.body, c.like_count, c.published_at, c.related_product_id,
      u.nickname author, p.title product_title
      FROM content_note c JOIN user_account u ON u.id = c.user_id
      LEFT JOIN tour_product p ON p.id = c.related_product_id
      WHERE c.id = ? AND c.status = 2`, [req.params.id])
    if (!n) throw new BizError(1004, '笔记不存在或未发布')
    let body = n.body
    try { body = typeof body === 'string' ? JSON.parse(body) : body } catch { body = { text: String(body) } }
    const liked = await one('SELECT note_id FROM content_note_likes WHERE note_id = ? AND user_id = ?', [n.id, user.uid])
    return { ...n, liked: !!liked, likeCount: Number(n.like_count), body, text: (body && body.text) || '', images: (body && body.images) || [] }
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
    const note = await one('SELECT id, user_id, status, body FROM content_note WHERE id = ?', [noteId])
    if (!note || Number(note.user_id) !== Number(u.uid)) throw new BizError(1004, '笔记不存在')
    if (Number(note.status) !== 2) throw new BizError(1001, '仅已发布的笔记可提交审核')
    // A-16：任务状态与截止时间在提交时复检（此前只在领取时校验，截止后仍能提交）
    const task = await one('SELECT id, status, deadline, min_words, min_images FROM content_task WHERE id = ?', [req.params.id])
    if (!task || Number(task.status) !== 0) throw new BizError(2002, '任务已下线')
    if (task.deadline && new Date(task.deadline) < new Date()) throw new BizError(2002, '任务已截止')
    // A-16：作品要求在提交侧拦截（字数/图片按笔记正文实算；图片兼容 images 数组与富文本 <img> 两种形态）
    let body = note.body
    try { body = typeof body === 'string' ? JSON.parse(body) : body } catch { body = {} }
    const textHtml = String((body && body.text) || '')
    const textLen = textHtml.replace(/\s/g, '').length
    const imgCount = Math.max(Array.isArray(body && body.images) ? body.images.length : 0, (textHtml.match(/<img\b/gi) || []).length)
    if (Number(task.min_words) > 0 && textLen < Number(task.min_words)) throw new BizError(1001, `笔记正文至少 ${task.min_words} 字（当前 ${textLen} 字）`)
    if (Number(task.min_images) > 0 && imgCount < Number(task.min_images)) throw new BizError(1001, `笔记需配至少 ${task.min_images} 张图片（当前 ${imgCount} 张）`)
    // A-16：一篇笔记只能用于一个任务（其他进行中/审核中/已通过的条目占用了同一篇即拒绝）
    const used = await one('SELECT e.id, t.title FROM content_task_entry e JOIN content_task t ON t.id = e.task_id WHERE e.note_id = ? AND e.task_id <> ? AND e.status > 0 LIMIT 1', [noteId, req.params.id])
    if (used) throw new BizError(1001, '这篇笔记已用于任务「' + used.title + '」，一篇笔记只能参与一个约稿')
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

  // KYC 实名（A-06 定稿：实名结果目前没有任何业务使用 → 入口下线，存量数据已加密保留）。
  // 负责人明确业务用途恢复时：走 infra/idcard.mjs（AES-256-GCM + 18 位校验码校验）重新开入口。
  'POST /c/kyc/submit': async (req) => {
    requireUser(req)
    throw new BizError(1001, '实名认证功能升级中，已暂停提交；如有出行保险需求请联系客服')
  },
  'GET /c/kyc/mine': async (req) => {
    const u = requireUser(req)
    // 只下发掩码与状态，不下发密文列（完整号码任何接口都不出现）
    const r = await one('SELECT real_name, id_no_mask, status, reject_note FROM kyc_application WHERE user_id = ?', [u.uid])
    return r || { status: -1 }
  },
}

// 用户侧数字身份（小程序 A「我的数字身份」页：Travel ID = 凭证+徽章+存证流水）
/** 游客可见的商户荣誉 + 图形地址（白名单见 merchant-level.publicHonor） */
const honorOf = async (mid, req) => {
  const h = await merchantLevel.publicHonor(mid)
  if (!h) return null
  return { lv: h.lv, name: h.name, art: apiImg('/badge-art/mlevel/' + h.lv + '.png', req),
    badges: h.badges.map((b) => ({ name: b.name, rarity: b.rarity, rarityLabel: badgeArt.RARITIES[b.rarity] || '普通', art: apiImg('/badge-art/' + b.id + '.png', req) })) }
}
const withLevelArt = (lvl, req) => {
  lvl.art = apiImg('/badge-art/level/' + lvl.lv + '.png', req)
  lvl.levels = lvl.levels.map((l) => ({ ...l, art: apiImg('/badge-art/level/' + l.lv + '.png' + (l.lv <= lvl.lv ? '' : '?state=off'), req) }))
  return lvl
}
const cIdentity = {
  'GET /c/identity': async (req) => {
    const u = requireUser(req)
    const acc = await one('SELECT nickname, member_level, growth_value, created_at FROM user_account WHERE id = ?', [u.uid])
    const passes = await q('SELECT id, name, kind, status, valid_to, created_at FROM travel_pass WHERE user_id = ? ORDER BY id DESC LIMIT 20', [u.uid])
    // 勋章墙：全部勋章（已获得点亮、未获得置灰并给出获得条件与进度），有效期从授予日起算
    // 先按自动规则补一次评估：笔记发布、等级变化等没有单独触发点的规则，在打开勋章墙时也能及时点亮
    const fresh = await badgeDomain.evaluateSafe(u.uid)
    const mtr = await badgeDomain.metrics(u.uid)
    const defs = (await q('SELECT * FROM badge')).filter((b) => !badgeDomain.isMerchantBadge(b)) // 商户徽章不出现在游客勋章墙
    const owned = await q('SELECT badge_id, MAX(granted_at) granted_at FROM user_badge WHERE user_id = ? GROUP BY badge_id', [u.uid])
    // 城市 / 国家徽章只显示"开放中"的：城市有在售线路、国家下有已映射的城市（未开放的不在勋章墙露出，除非已获得）
    const openCities = new Set((await q('SELECT DISTINCT city_code FROM tour_product')).map((r) => String(r.city_code)))
    const openCountries = new Set(['CN', ...Object.values(await badgeDomain.cityCountryMap()).map((x) => String(x).toUpperCase())])
    // 封存编号：每次发放都会进可信记录，打包后即"已封存"；编号取该条记录的校验码前 8 位
    const refs = owned.map((o) => 'badge-' + u.uid + '-' + o.badge_id)
    const evs = refs.length ? await q(`SELECT biz_ref, payload_hash, status FROM attest_event WHERE biz_type = 'badge' AND biz_ref IN (${refs.map(() => '?').join(',')})`, refs) : []
    const badges = (await Promise.all(defs.map(async (b) => {
      const pp = entities.publicProfile('badge', b, (x) => apiImg(x, req))
      const got = owned.find((o) => Number(o.badge_id) === Number(b.id))
      const days = Number(pp.valid_days) || 0
      const expireAt = got && days ? new Date(new Date(String(got.granted_at).replace(' ', 'T') + '+08:00').getTime() + days * 86400000).toISOString().slice(0, 10) : null
      const cat0 = pp.category === 'growth' ? 'level' : pp.category
      const cat = badgeArt.CATEGORIES[cat0] ? cat0 : 'special'
      if (!got && ((cat === 'city' && !openCities.has(String(pp.city_code))) || (cat === 'country' && !openCountries.has(String(pp.country_code || '').toUpperCase())))) return null
      const ev = got ? evs.find((e) => e.biz_ref === 'badge-' + u.uid + '-' + b.id) : null
      const art = apiImg('/badge-art/' + b.id + '.png?state=' + (got ? 'on' : 'off'), req)
      return { id: b.id, name: b.name, icon_key: b.icon_key, iconImg: pp.icon_img || null, art, category: cat, categoryLabel: badgeArt.CATEGORIES[cat].label, series: pp.series || '', tier: Number(pp.tier) || 0,
        progress: got ? null : await badgeDomain.progressOf(u.uid, b, mtr), proof: ev ? { code: String(ev.payload_hash).slice(0, 8).toUpperCase(), sealed: Number(ev.status) >= 1 } : null, cityCode: pp.city_code || null, countryCode: pp.country_code || null, rarity: pp.rarity || 'common', rarityLabel: pp.rarity_label || '普通',
        color: pp.color || null, description: pp.description || '', ruleDesc: pp.rule_desc || '', order: Number(pp.display_order) || 0,
        owned: !!got, granted_at: got ? got.granted_at : null, expireAt, expired: !!(expireAt && expireAt < bizDay()) }
    }))).filter(Boolean).sort((a, b) => (b.owned - a.owned) || (a.order - b.order))
    const myOrders = await q('SELECT order_no FROM orders WHERE user_id = ?', [u.uid])
    const attestations = []
    for (const o of myOrders.slice(0, 10)) {
      const e = await one("SELECT payload_hash, status, created_at FROM attest_event WHERE biz_type = 'order' AND biz_ref = ? ORDER BY version_no DESC, id DESC LIMIT 1", [o.order_no]) // 同一订单有支付(30)与完成(50)两个版本，取最新
      if (e) attestations.push({ orderNo: o.order_no, code: String(e.payload_hash).slice(0, 8).toUpperCase(), sealed: e.status >= 1, at: e.created_at })
    }
    const lvl = withLevelArt(await member.progress(u.uid), req)
    return { profile: { nickname: acc.nickname, memberLevel: acc.member_level, levelName: lvl.name, growth: lvl.points, joinedAt: acc.created_at, level: lvl, card: cardOf('traveler', acc.member_level, (await member.levels()).length) },
      passes, badges, fresh, attestations, groups: badgeArt.CATEGORY_ORDER.map((k) => ({ key: k, label: badgeArt.CATEGORIES[k].label })),
      statement: '消费与权益的可信记录，作为贡献分与会员成长的依据' }
  },
  // 数字身份凭证（VC-JWT）：用户可取走、可出示、他方可验。微信内不展示字样（D6），由 B/G 端与生态 H5 使用
  'GET /c/vc': async (req) => {
    const u = requireUser(req)
    const scope = vc.ALL_SCOPES.includes(req.query.scope) ? req.query.scope : 'travel'
    let v
    try { v = await vc.issue(u.uid, scope) } catch (e) { if (/身份/.test(e.message)) throw new BizError(1001, e.message); throw e }
    return {
      did: v.did, jwt: v.jwt, scope, expiresAt: v.expiresAt,
      claims: v.claims, issuer: v.issuer,
      ...vc.disclosure(scope),
    }
  },
}

export { c, cWithdraw, lexicon, cPromo, cNotes, cPhraseKyc, cIdentity }
