// 路由层公共工具：后台鉴权与审计、导出、对外基址、支付回调处理
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
import { actionRoles } from '../domain/admin-capabilities.mjs'

export const fen2yuan = (f) => (Number(f) / 100).toFixed(2)
// 相对路径图片补全为对外基址（PUBLIC_BASE 或按请求头推断），真机/外网不能拿到 127.0.0.1
export const apiImg = (u, req) => (u && /^https?:/.test(u)) ? u : (u ? publicBase(req) + u : u)
// CSV 序列化：RFC4180 转义 + UTF-8 BOM（Excel 直开不乱码）
export function toCsv(rows) {
  if (!rows.length) return '\uFEFF(空)\n'
  const esc = (v) => { const str = v == null ? '' : String(v); return /[",\n]/.test(str) ? '"' + str.replaceAll('"', '""') + '"' : str }
  const head = Object.keys(rows[0]).join(',')
  const body = rows.map((r) => Object.values(r).map(esc).join(',')).join('\n')
  return '\uFEFF' + head + '\n' + body + '\n'
}
// ---------- /admin 运营后台 ----------
export async function requireAdmin(req, roles) {
  if (typeof roles === 'string') roles = actionRoles(roles)
  const h = (req.headers.authorization || '').replace(/^Bearer /, '')
  const { jwtVerify } = await import('../auth.mjs')
  const p = jwtVerify(h)
  if (!p || p.end !== 'admin') throw new BizError(1002, '后台未登录')
  // T02 会话生命周期：登录令牌带 ver=token_epoch。停用 / 改角色 / 改城市 / 重置密码后 epoch+1，
  // 已登录会话在下一个请求即失效（不能只禁止下次登录）。
  // 不带 ver 的令牌只可能出自掌握 JWT_SECRET 的一方（测试夹具），不参与本校验。
  if (p.ver != null) {
    const row = await one('SELECT status, token_epoch, must_change_pwd FROM admin_user WHERE id = ?', [p.uid])
    if (!row || Number(row.status) !== 1 || Number(row.token_epoch) !== Number(p.ver)) throw new BizError(1002, '登录已失效（账号被停用或权限已变更），请重新登录')
    // U-02：must_change_pwd 不只是登录后弹窗——接口层强制：未改密前只允许本人改密接口，
    // 防止绕过弹窗直接用会话令牌调后台接口办业务（改密成功后旧会话已 +epoch 失效，需重新登录）。
    if (Number(row.must_change_pwd) === 1) {
      const path = String(req.url || '').split('?')[0]
      if (!(req.method === 'POST' && path === '/admin/account/password')) {
        throw new BizError(1002, '请先修改临时密码后再操作后台')
      }
    }
  }
  if (roles && !roles.includes(p.role)) throw new BizError(1003, '权限不足（' + p.role + '）')
  return p // 含 scopeCity（城市合伙人行级隔离）：列表查询必须经 scopeFilter 注入
}

/**
 * C-05：模块级强制校验（后端唯一授权来源的前置闸）。D-06：由 ROUTE_MODULES 显式映射驱动，
 * 在 index.mjs 对命中路由统一调用；与路由内既有角色/能力校验取交集（不放松）。
 * 城市合伙人叠加不可授予名单（D-01）；无 uid 的测试夹具令牌按角色默认集合校验。
 */
export async function requireModule(req, moduleKey) {
  const p = await requireAdmin(req)
  const { CITY_DENY_MODULES } = await import('../domain/modules.mjs')
  const { accountModules } = await import('../domain/admin-modules.mjs')
  if (p.role === 'city_partner' && CITY_DENY_MODULES.includes(moduleKey)) {
    throw new BizError(1003, '城市账号不可使用该模块（' + moduleKey + '）')
  }
  const set = await accountModules(p.uid, p.role)
  if (!set.has(moduleKey)) throw new BizError(1003, '模块未授权（' + moduleKey + '），请联系超级管理员在「后台账号 → 权限」调整')
  return p
}

/** 行级隔离：城市合伙人只能看自己城市；内部角色全量 */
export function scopeFilter(admin, col = 'city_code') {
  const city = admin.scopeCity
  if (!city) return { sql: '', params: [] }
  return { sql: ` AND ${col} = ?`, params: [city] }
}

// 资源池枚举：供应商类目
export const SUP_CATS = ['ticket', 'hotel', 'transport', 'ground', 'catering', 'other']
// 创作者标签
export const CREATOR_TAGS = ['none', 'signed', 'star', 'limited']

// 富文本白名单清洗（后台编辑内容入库前统一过一道：去脚本/事件/外域脚本）

export async function audit(c, actor, module_, action, bizRef, before, after) {
  await c.q('INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val) VALUES (?,?,?,?,?,?)',
    [actor, module_, action, bizRef || null, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null])
}
/** 一页纸所需的实时上下文（数字全部来自库，不手写） */
export async function capabilityContext(baseUrl) {
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
export function publicBase(req) {
  if (process.env.PUBLIC_BASE) return String(process.env.PUBLIC_BASE).replace(/\/+$/, '')
  const h = (req && req.headers) || {}
  const host = h['x-forwarded-host'] || h.host || ('127.0.0.1:' + (process.env.PORT || 8080))
  const proto = h['x-forwarded-proto'] || 'http'
  return proto + '://' + host
}
// ---------- 微信支付回调 ----------
export async function notifyMerchantStaff(merchantId, orderNo) {
  const { getSecrets } = await import('../infra/secrets.mjs')
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

export async function handlePayNotify(orderNo, transNo, mock = false) {
  const o = await order.acceptPayment(orderNo, transNo, mock)
  if (o.duplicated) return { code: 0, duplicated: true }
  {
    // 商户端订阅消息（P2）：新订单通知门店（WX_TMPL_NEW_ORDER 未配置则 skipped，不阻断）
    notifyMerchantStaff(o.merchant_id, orderNo).catch((e) => console.error('[notify:merchant]', e.message))
    // 订阅消息：支付成功通知（官方 subscribe/send；未订阅/未配置静默失败，不阻断主链）
    wxapi.sendSubscribeMessage(
      (await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [o.user_id])).mini_a_openid,
      (await (async () => { const { getSecrets } = await import('../infra/secrets.mjs'); return (await getSecrets(['WX_TMPL_PAY_OK'])).WX_TMPL_PAY_OK })()) || '',
      { thing1: { value: '出票成功' }, character_string2: { value: orderNo } },
      'package-order/pages/orders/index',
    ).catch((e) => console.error('[notify] payOk send failed:', e.message))
  }
  return { code: 0, ok: true }
}
