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
import { fen2yuan, apiImg, toCsv, requireAdmin, scopeFilter, SUP_CATS, CREATOR_TAGS, audit, capabilityContext, publicBase, notifyMerchantStaff, handlePayNotify } from './_shared.mjs'

import { SMS_KEYS, SMTP_KEYS } from '../infra/mfa.mjs'

// ---------- 集成中心（第三方凭据后台化：.env 仅自举）----------
// 字段中文名：页面上先看中文，环境变量名退到小字
const FIELD_CN = {
  WX_TMPL_GROUP_CANCEL: '未成团取消通知模板', WX_TMPL_VOUCHER_EXPIRE: '凭证到期通知模板（可选）', WX_CALLBACK_TOKEN: '微信消息回调 Token', WX_CALLBACK_AES_KEY: '微信消息加解密 EncodingAESKey',
  WX_APPID: '小程序 AppID', WX_SECRET: '小程序 AppSecret', WX_B_APPID: '商户端 AppID', WX_B_SECRET: '商户端 AppSecret',
  SMS_TENCENT_SECRET_ID: 'SecretId（云 API 访问密钥 ID）', SMS_TENCENT_SECRET_KEY: 'SecretKey（云 API 访问密钥）', SMS_TENCENT_SDKAPPID: '短信应用 SdkAppId',
  SMS_TENCENT_SIGN: '短信签名内容（如：向往的自由）', SMS_TENCENT_TEMPLATE_ID: '验证码模板 ID',
  SMTP_HOST: 'SMTP 服务器地址（如 smtp.exmail.qq.com）', SMTP_PORT: 'SMTP 端口（465=SSL，587=STARTTLS）', SMTP_USER: '发信账号（邮箱地址）', SMTP_PASS: '邮箱密码 / 授权码', SMTP_FROM: '发件人显示名与地址（如：向往的自由 <noreply@xxx.com>）',
}
const integrations = {
  // ===== 链接入中心：联盟链 / 公链接入的配置、自检、探测、切换（只超管）=====
  'GET /admin/chain/hub': async (req) => {
    // P-03：运维/开发提供只读运维视图（本接口只回凭据是否已配置的布尔与提示，不含任何秘密值）；
    // 保存凭据、套用模板、切换链路仍仅超管（下方 POST 各路由不变）
    await requireAdmin(req, ['super', 'sre', 'dev'])
    const { listSecretMeta, secretSync } = await import('../infra/secrets.mjs')
    const stored = Object.fromEntries((await listSecretMeta()).map((r) => [r.k, r]))
    const cur = chain.providerId()
    const counts = (await q(`SELECT chain_provider p, status, COUNT(*) n FROM attest_batch WHERE chain_provider IS NOT NULL GROUP BY chain_provider, status`))
      .reduce((m, r) => { (m[r.p] ||= {})[Number(r.status)] = Number(r.n); return m }, {})
    const pending = await one('SELECT COUNT(*) n FROM attest_batch WHERE status IN (1,3)')
    const waiting = await one('SELECT COUNT(*) n FROM attest_batch WHERE status = 5')
    const base = publicBase(req)
    const providers = Object.values(chain.PROVIDERS).map((p) => {
      const meta = chain.CATALOG[p.id] || { group: 'dev', keys: [], protocol: {} }
      const st = p.status()
      return { id: p.id, label: p.label, docs: p.docs, capabilities: p.capabilities, group: meta.group, vendor: meta.vendor, protocol: meta.protocol,
        mode: st.mode, missing: st.missing || [], note: st.note || '', current: p.id === cur,
        hasProbe: typeof p.probe === 'function', hasSelfTest: typeof p.selfTest === 'function',
        stats: counts[p.id] || {}, callbackUrl: base + '/callback/chain/' + p.id,
        keys: meta.keys.map((k) => ({ ...k, configured: !!(secretSync(k.key) || process.env[k.key]),
          source: stored[k.key] ? 'admin' : (process.env[k.key] ? 'env' : null),
          // 非密钥项回显当前值，密钥项只给尾号提示
          value: k.secret ? null : (secretSync(k.key) || process.env[k.key] || ''), hint: stored[k.key]?.hint || null,
          updatedBy: stored[k.key]?.updated_by || null, updatedAt: stored[k.key]?.updated_at || null })) }
    })
    return { current: cur, mode: chain.chainMode(), pendingBatches: Number(pending.n), waitingConfirm: Number(waiting.n), providers,
      networks: chain.NETWORKS, gatewayPresets: chain.GATEWAY_PRESETS,
      checklist: ['接入主体与资质（是否需要文旅/数据类备案）', '自建节点还是公共网关', '计费口径（按笔/包年）与额度', '能否出具带公章的存证证明或在线证明页',
        '是否提供 DID 签发', '资产发行的资质、内容审核流程与周期', 'SLA 与故障告知机制（最长中断时长）'] }
  },
  'POST /admin/chain/creds/:provider': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const meta = chain.CATALOG[req.params.provider]
    if (!meta) throw new BizError(1004, '未知的链适配器')
    const allowed = new Map(meta.keys.map((k) => [k.key, k]))
    const { setSecret, delSecret } = await import('../infra/secrets.mjs')
    const changed = []
    for (const [k, v] of Object.entries(req.body.values || {})) {
      if (!allowed.has(k)) throw new BizError(1001, `配置项 ${k} 不属于该链`)
      const val = String(v ?? '').trim()
      if (val === '' && req.body.clear?.includes?.(k)) { await delSecret(k); changed.push(k); continue }
      if (val === '') continue // 留空 = 不修改（密钥项不回显，留空即保持原值）
      if (k === 'GW_BODY_TEMPLATE') { try { JSON.parse(val.replace(/\{\w+\}/g, '0')) } catch { throw new BizError(1001, '请求体模板需为合法 JSON（占位符外）') } }
      if (k === 'TBAAS_PARAM_TEMPLATE') { try { const o = JSON.parse(val.replace(/\{\w+\}/g, '0')); if (!o || typeof o !== 'object' || Array.isArray(o)) throw 0 } catch { throw new BizError(1001, '入参模板需为合法 JSON 对象（占位符外）') } }
      if (k === 'EVM_NETWORK' && !chain.NETWORKS[val.toLowerCase()]) throw new BizError(1001, '未知网络：' + val)
      if (/_URL$|ENDPOINT$/.test(k) && !/^https?:\/\//.test(val)) throw new BizError(1001, allowed.get(k).label + ' 需以 http(s):// 开头')
      await setSecret(k, val, 'admin:' + a.name)
      changed.push(k)
    }
    await tx(async (c) => audit(c, 'admin:' + a.name, 'chain', 'creds', req.params.provider, null, { keys: changed }))
    return { saved: changed.length, keys: changed, status: chain.providerById(req.params.provider).status() }
  },
  // 一键套用网关预置模板 / EVM 网络（只写非密钥项）
  'POST /admin/chain/preset/:provider': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { setSecret } = await import('../infra/secrets.mjs')
    let vals
    if (req.params.provider === 'gateway') {
      const p = chain.GATEWAY_PRESETS[req.body.preset]
      if (!p) throw new BizError(1004, '未知预置')
      vals = Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith('GW_')))
    } else if (req.params.provider === 'evm') {
      if (!chain.NETWORKS[req.body.preset]) throw new BizError(1004, '未知网络')
      vals = { EVM_NETWORK: req.body.preset }
    } else throw new BizError(1001, '该链没有预置')
    for (const [k, v] of Object.entries(vals)) await setSecret(k, String(v), 'admin:' + a.name)
    await tx(async (c) => audit(c, 'admin:' + a.name, 'chain', 'preset', req.params.provider, null, { preset: req.body.preset }))
    return { applied: Object.keys(vals) }
  },
  'POST /admin/chain/selftest/:provider': async (req) => {
    // P-03：离线自检/只读探测是无副作用的诊断动作，运维/开发可用；结果不改任何配置
    await requireAdmin(req, ['super', 'sre', 'dev'])
    const p = chain.providerById(req.params.provider)
    if (!p || typeof p.selfTest !== 'function') throw new BizError(1004, '该链无离线自检')
    return p.selfTest()
  },
  'POST /admin/chain/probe/:provider': async (req) => {
    await requireAdmin(req, ['super', 'sre', 'dev'])
    const p = chain.providerById(req.params.provider)
    if (!p || typeof p.probe !== 'function') throw new BizError(1004, '该链无只读探测接口，请用离线自检 + 小额试锚验证')
    try { return { ...(await p.probe()), at: new Date().toISOString() } } catch (e) { return { ok: false, detail: e.message, at: new Date().toISOString() } }
  },
  'POST /admin/chain/activate': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const id = String(req.body.provider || '')
    const p = chain.providerById(id)
    if (!p) throw new BizError(1004, '未知的链适配器')
    if (id === 'mock' && process.env.NODE_ENV === 'production') throw new BizError(1003, '生产环境禁止使用自测链')
    if (id !== 'noop' && p.mode() !== 'real') throw new BizError(1001, '该链凭据不完整，缺少：' + (p.status().missing || []).join(' / '))
    // 待确认批次按原链核验（chain_provider），切换不会误确认；这里只提示数量
    const waiting = await one('SELECT COUNT(*) n FROM attest_batch WHERE status = 5')
    if (String(req.body.confirm || '') !== id) throw new BizError(1001, '请输入目标链标识以确认切换')
    const { setSecret } = await import('../infra/secrets.mjs')
    const before = chain.providerId()
    await setSecret('CHAIN_PROVIDER', id, 'admin:' + a.name)
    await tx(async (c) => audit(c, 'admin:' + a.name, 'chain', 'activate', 'chain', { provider: before }, { provider: id }))
    return { current: chain.providerId(), waitingConfirm: Number(waiting.n), note: Number(waiting.n) ? `仍有 ${waiting.n} 个批次在原链等待确认，将继续在原链核验` : '' }
  },

  'GET /admin/integrations': async (req) => {
    // P-03：集成中心对运维/开发开放只读视图（通道就绪状态与字段提示，不含凭据值）；保存仍仅超管
    await requireAdmin(req, ['super', 'sre', 'dev'])
    const { listSecretMeta } = await import('../infra/secrets.mjs')
    const { getSecrets } = await import('../infra/secrets.mjs')
    const stored = Object.fromEntries((await listSecretMeta()).map((r2) => [r2.k, r2.hint]))
    const s = await getSecrets(['WX_APPID', 'WX_SECRET', 'WX_B_APPID', 'WX_B_SECRET', 'WX_API_V3_KEY', 'WX_PLATFORM_PUBLIC_KEY', 'WX_PLATFORM_SERIAL', 'WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY', 'WX_NOTIFY_URL', 'WX_TMPL_PAY_OK', 'WX_TMPL_GROUP_CANCEL', 'WX_CALLBACK_TOKEN', 'WX_CALLBACK_AES_KEY',
      ...SMS_KEYS, ...SMTP_KEYS])
    const ch = (keys, name, desc) => ({ name, desc, ready: keys.every((k) => !!(s[k] || process.env[k])),
      fields: keys.map((k) => ({ key: k, label: FIELD_CN[k] || '', secret: /SECRET|PASS|KEY|TOKEN/.test(k), envFallback: !!process.env[k], stored: stored[k] || null })) })
    return {
      envNote: '.env 只保留自举：DB 连接、JWT_SECRET、ADMIN_INIT_PASSWORD；其余凭据在本页保存（AES-256-GCM 加密落库）',
      channels: [
        ch(['WX_APPID', 'WX_SECRET'], '微信小程序登录', 'code2Session（未配置=mock openid 联调）'),
        ch(['WX_B_APPID', 'WX_B_SECRET'], '商户小程序登录', '商户端独立 AppID 与 Secret'),
        ch(['WX_API_V3_KEY', 'WX_PLATFORM_PUBLIC_KEY', 'WX_PLATFORM_SERIAL'], '微信支付回调校验', 'APIv3 密钥、微信支付公钥与公钥 ID/证书序列号'),
        ch(['WX_TMPL_PAY_OK', 'WX_TMPL_GROUP_CANCEL'], '订阅消息模板', '出票与未成团取消两类模板；配置不代表已获得用户授权或实际送达'),
        ch(['WX_CALLBACK_TOKEN', 'WX_CALLBACK_AES_KEY'], '微信图片审核回执', '公网HTTPS /callback/wechat；微信消息推送选择安全模式；配置不代表已收过真实回执'),
        ch(['WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY', 'WX_NOTIFY_URL'], '微信支付 V3', '未配置=MOCK 通道（不真实收款）'),
        { ...ch(SMS_KEYS, '短信验证码（腾讯云短信）', '后台登录两步验证、通知短信。腾讯云控制台 → 短信 → 应用管理 / 签名管理 / 正文模板管理 获取以下 5 项'), kind: 'sms' },
        { ...ch(SMTP_KEYS, '邮箱验证码（SMTP）', '后台登录两步验证、通知邮件。填写邮件服务商（企业邮箱 / 腾讯企业邮 / 阿里企业邮等）提供的 SMTP 信息'), kind: 'email' },
      ],
    }
  },
  'POST /admin/integrations/:key': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { value } = req.body
    const minLen = /PORT|SDKAPPID|SIGN/.test(req.params.key) ? 1 : 4 // 端口等短值合法
    if (!value || String(value).trim().length < minLen) throw new BizError(1001, '凭据长度至少 ' + minLen + ' 位')
    const { setSecret } = await import('../infra/secrets.mjs')
    await setSecret(req.params.key, String(value), 'admin:' + a.name)
    wxpay.invalidateConfig()
    await tx(async (c) => audit(c, 'admin:' + a.name, 'integration', 'set', req.params.key, null, { len: String(value).length }))
    return { key: req.params.key, saved: true }
  },
  'DELETE /admin/integrations/:key': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { delSecret } = await import('../infra/secrets.mjs')
    await delSecret(req.params.key)
    wxpay.invalidateConfig()
    await tx(async (c) => audit(c, 'admin:' + a.name, 'integration', 'delete', req.params.key, null, null))
    return { deleted: true }
  },
}

export { integrations }
