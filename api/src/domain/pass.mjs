// 凭证与核销域：出票 / 动态码 HMAC / 防重放消费 / 存证
// 存证实现统一在 domain/attest.mjs（同一件事只在同一处实现），本文件只负责在正确的事务里调用
import crypto from 'node:crypto'
import { q, one, tx, BizError } from '../db.mjs'
import { cfgNum } from '../config.mjs'
import { bizDay } from '../infra/bizdate.mjs'
import * as order from './order.mjs'
import { attest as attestCore } from './attest.mjs'

const SECRET = process.env.PASS_SECRET || 'wanderlust-pass-code-secret'

export const windowOf = (epochSec, winSec) => Math.floor(epochSec / winSec)
export function sign(passId, windowNo) {
  return crypto.createHmac('sha256', SECRET).update(passId + ':' + windowNo).digest('hex').slice(0, 16)
}
export function qrPayload(passId, windowNo) { return `wl://v/${passId}/${windowNo}/${sign(passId, windowNo)}` }
export function displayCode(passId, windowNo) {
  const sig = sign(passId, windowNo)
  return String(parseInt(sig.slice(0, 8), 16) % 1000000).padStart(6, '0')
}
function verifySig(passId, windowNo, sig) {
  for (let w = windowNo - 1; w <= windowNo + 1; w++) if (w >= 0 && sign(passId, w) === sig) return w
  return -1
}

export async function issueForOrder(orderNo) {
  const o = await order.byNo(orderNo)
  if (!o) throw new BizError(2003, '订单不存在')
  return await tx(async (c) => {
    const ids = []
    for (let i = 0; i < o.qty; i++) {
      const passId = await c.ins('INSERT INTO travel_pass (user_id, order_id, kind, name, product_id, status) VALUES (?,?,1,?,?,1)',
        [o.user_id, o.id, '主题游通行凭证·' + orderNo, o.product_id])
      ids.push(passId)
      // 凭证签发即锚定（与签发同事务）：外部可验证"这张凭证确实是平台签发的"
      await attestCore('pass_issue', 'pass-' + passId, {
        passId, orderNo, kind: 1, qty: Number(o.qty), productId: Number(o.product_id),
        merchantId: Number(o.merchant_id), cityCode: o.city_code,
      }, c, 1)
    }
    return ids
  })
}

/** 核销日期窗（A-04/A-11，负责人 2026-11-06 决定）：出发日当天 ≤ 今日 ≤ 出发日 + N 天（多日行程覆盖，N 走参数中心）。
 *  @param departDate 团期出发日（DATE / 'YYYY-MM-DD'）
 *  @returns { ok, reason, departDate, endDate } */
export async function verifyWindowOk(departDate) {
  const today = bizDay()
  const dep = String(departDate || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dep)) return { ok: false, reason: '团期缺少出发日，无法核销', departDate: dep || null, endDate: null }
  const endDays = await cfgNum('pass.verify_end_days')
  const end = bizDay(Number(endDays) || 0, new Date(dep + 'T00:00:00'))
  if (today < dep) return { ok: false, reason: '未到出发日（' + dep + '），暂不可核销', departDate: dep, endDate: end }
  if (today > end) return { ok: false, reason: '已超过核销有效期（' + dep + ' 出发，' + end + ' 截止）', departDate: dep, endDate: end }
  return { ok: true, departDate: dep, endDate: end }
}

export async function currentQr(passId) {  const win = windowOf(Math.floor(Date.now() / 1000), await cfgNum('pass.code_window'))
  await q('INSERT IGNORE INTO pass_code (pass_id, window_no, code_hash) VALUES (?,?,?)', [passId, win, sign(passId, win)])
  return { qr: qrPayload(passId, win), display: displayCode(passId, win), window: win, expiresIn: await cfgNum('pass.code_window') }
}

/** 商户扫码/输码核销：窗口±1 → 签名 → 唯一约束消费 → 全单核销完推订单 40 */
export async function verifyScan({ merchantId, staffId, payload, cityCode }) {
  // 核销记录与存证里的城市取门店自己的城市。调用方过去把 '310118' 写死传进来，非青浦门店的核销会被记到青浦；传入值只作兜底
  const store = await one('SELECT city_code FROM merchant WHERE id = ?', [merchantId])
  cityCode = (store && store.city_code) || cityCode
  const raw = String(payload || '').trim()
  let passId = null, hit = -1
  if (/^\d{6}$/.test(raw)) {
    // 手动输码兜底：6 位展示码 → 在有效凭证 × 当前窗口±1 内匹配 HMAC 展示码
    const win = windowOf(Math.floor(Date.now() / 1000), await cfgNum('pass.code_window'))
    const actives = await q(`SELECT tp.id FROM travel_pass tp JOIN orders o ON o.id = tp.order_id
      WHERE tp.status = 1 AND o.merchant_id = ? AND o.status = 30`, [merchantId])
    outer: for (const p of actives) {
      for (let w = win - 1; w <= win + 1; w++) {
        if (w >= 0 && displayCode(p.id, w) === raw) { passId = p.id; hit = w; break outer }
      }
    }
    if (!passId) return { ok: false, reason: '无效码（展示码不匹配或已过期）' }
  } else {
    const parts = raw.split('/')
    if (parts.length !== 6 || parts[0] !== 'wl:' || parts[2] !== 'v')
      return { ok: false, reason: '无效码（格式）' }
    passId = Number(parts[3])
    const now = windowOf(Math.floor(Date.now() / 1000), await cfgNum('pass.code_window'))
    const given = Number(parts[4])
    hit = Number.isInteger(given) && Math.abs(now - given) <= 1 && sign(passId, given) === parts[5] ? given : -1
    if (hit < 0) return { ok: false, reason: '无效码（签名/窗口）', passId }
  }

  const pass = await one('SELECT * FROM travel_pass WHERE id = ?', [passId])
  if (!pass) return { ok: false, reason: '凭证不存在', passId }
  const owner = await one('SELECT merchant_id, status FROM orders WHERE id = ?', [pass.order_id])
  if (!owner || Number(owner.merchant_id) !== Number(merchantId)) return { ok: false, reason: '非本店凭证', passId }
  if (Number(owner.status) !== 30 && pass.status === 1) return { ok: false, reason: '订单当前不可核销', passId }
  if (pass.status !== 1) {
    await q('INSERT INTO verification_log (pass_id, merchant_id, staff_id, method, result, city_code) VALUES (?,?,?,1,2,?)',
      [passId, merchantId, staffId, cityCode])
    return { ok: false, reason: pass.status === 2 ? '已核销（重复）' : '凭证状态异常', passId }
  }

  const consumed = await tx(async (c) => {
    const locked = await c.one('SELECT status FROM travel_pass WHERE id = ? FOR UPDATE', [passId])
    if (!locked || locked.status !== 1) return false
    // 手输窗口可能无 pass_code 行（currentQr 只预写扫码窗口）——先补行再消费
    await c.ins('INSERT IGNORE INTO pass_code (pass_id, window_no, code_hash) VALUES (?,?,?)', [passId, hit, sign(passId, hit)])
    const n = await c.upd('UPDATE pass_code SET consumed_at = NOW(3), consumed_by = ? WHERE pass_id = ? AND window_no = ? AND consumed_at IS NULL',
      [staffId, passId, hit])
    if (n !== 1) return false
    await c.upd('UPDATE travel_pass SET status = 2 WHERE id = ?', [passId])
    await c.q('INSERT INTO verification_log (pass_id, merchant_id, staff_id, method, result, city_code) VALUES (?,?,?,1,1,?)',
      [passId, merchantId, staffId, cityCode])
    // 核销即锚定（与核销同事务）。biz_ref 带窗口号：同一凭证的不同窗口是不同事件，不能互相覆盖
    await attestCore('pass_verify', 'pass-' + passId + '-' + hit, {
      passId, merchantId, cityCode, windowNo: Number(hit), method: 1, result: 1,
    }, c, 1)
    return true
  })
  if (!consumed) return { ok: false, reason: '已核销（重复·并发拦截）', passId }

  const remaining = await one('SELECT COUNT(*) c FROM travel_pass WHERE order_id = ? AND status = 1', [pass.order_id])
  if (Number(remaining.c) === 0) {
    const o = await one('SELECT order_no FROM orders WHERE id = ?', [pass.order_id])
    await order.fire(o.order_no, 'VERIFY_ALL', 'merchant:' + merchantId, async () => '全部核销完成')
  }
  return { ok: true, reason: '核销成功', passId }
}

export async function revokeForOrder(orderNo) {
  const o = await order.byNo(orderNo)
  if (o) await q('UPDATE travel_pass SET status = 4 WHERE order_id = ?', [o.id])
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

/**
 * 兼容包装：老调用方传的是 JSON 字符串，统一转成对象后交给 domain/attest.mjs
 * @deprecated 新代码请直接 import { attest } from './attest.mjs'，并传入事务连接 c
 */
export async function attest(bizType, bizRef, canonical, conn, versionNo = 1) {
  let payload = canonical
  if (typeof canonical === 'string') {
    try { payload = JSON.parse(canonical) } catch { payload = { raw: canonical } }
  }
  return attestCore(bizType, bizRef, payload || {}, conn, versionNo)
}

/** 离线名单（§10）：本店有效凭证 + 未来 30 个窗口的展示码映射（断网期间人工比对用） */
export async function offlineListForStore(merchantId) {
  const passes = await q(`SELECT tp.id pass_id, tp.name, o.order_no, o.contact_name, p.title
    FROM travel_pass tp JOIN orders o ON o.id = tp.order_id JOIN tour_product p ON p.id = o.product_id
    WHERE p.merchant_id = ? AND tp.status = 1 AND o.status IN (20, 30, 40)
    ORDER BY o.paid_at DESC LIMIT 500`, [merchantId])
  const winSec = await cfgNum('pass.code_window')
  const win = windowOf(Math.floor(Date.now() / 1000), winSec)
  const codes = {}
  for (const p of passes) {
    for (let w = win - 2; w <= win + 30; w++) {
      const c = displayCode(p.pass_id, w)
      if (!(c in codes)) codes[c] = p.pass_id
    }
  }
  return { syncedAt: new Date().toISOString(), windowNo: win, passes, codes }
}

/** 人工队列/暗号确认核销：凭证置已核销 + 补流水 + 全单核销完推订单 40。
 *  A-04：流水必须记订单所属门店的 merchant_id（此前写死 0，商户「今日核销」和记录少算），
 *  方式按来源区分（admin=3 人工 / phrase=4 暗号），每张凭证一条流水。 */
export async function adminConfirmPass(passId, adminId, way = 'admin') {
  const p = await one('SELECT * FROM travel_pass WHERE id = ?', [passId])
  if (!p) throw new Error('凭证不存在')
  if (p.status !== 1) return false
  const oc = await one('SELECT city_code, merchant_id FROM orders WHERE id = ?', [p.order_id])
  const method = way === 'phrase' ? 4 : 3
  await tx(async (c) => {
    const n = await c.upd('UPDATE travel_pass SET status = 2 WHERE id = ? AND status = 1', [passId])
    if (n !== 1) throw new Error('并发冲突')
    await c.q('INSERT INTO verification_log (pass_id, merchant_id, staff_id, method, result, city_code) VALUES (?,?,?,?,1,?)',
      [passId, (oc && Number(oc.merchant_id)) || 0, adminId || 0, method, oc && oc.city_code ? oc.city_code : '310118'])
    // 核销即存证（同事务）。扫码路径在 verifyScan 里写；这里覆盖人工确认（way=admin）与暗号核销（way=phrase），
    // 之前人工确认的核销没有存证，订单"六锚"的核销一步在链上是空的。biz_ref 带来源后缀，避免与扫码事件互相覆盖
    await attestCore('pass_verify', 'pass-' + passId + '-' + way, {
      passId: Number(passId), merchantId: Number(oc && oc.merchant_id) || 0, way, cityCode: (oc && oc.city_code) || '310118',
    }, c, 1)
  })
  const remaining = await one('SELECT COUNT(*) c FROM travel_pass WHERE order_id = ? AND status = 1', [p.order_id])
  if (Number(remaining.c) === 0) {
    const o = await one('SELECT order_no FROM orders WHERE id = ?', [p.order_id])
    if (o) await order.fire(o.order_no, 'VERIFY_ALL', 'admin:' + adminId, async () => '人工队列确认核销')
  }
  return true
}
