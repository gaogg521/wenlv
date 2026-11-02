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

const callback = {
  // 异步链的上链结果回调：对方确认出块后推送 { txRef, root, block }，验签通过并与待确认批次匹配才置为已锚定
  // 支持：gateway（按网关签名规则验签）、chaingen（HMAC-SHA256：METHOD\nPATH\nts\nbody）
  'POST /callback/chain/:provider': async (req) => {
    const id = req.params.provider
    const path = '/callback/chain/' + id
    let ok = false
    if (id === 'gateway') {
      const gw = chain.providerById('gateway'), h = gw.callbackHeaders()
      ok = gw.verifyCallback({ path, ts: req.headers[h.ts], nonce: req.headers[h.nonce], body: req.rawBody || '', signature: String(req.headers[h.sign] || '') })
    } else if (id === 'chaingen') {
      const { E } = await import('../infra/chain/conf.mjs')
      const ts = req.headers['x-timestamp'], sig = String(req.headers['x-signature'] || '')
      const expect = crypto.createHmac('sha256', E.CHAIN_KEY || '').update(['POST', path, ts, req.rawBody || ''].join('\n')).digest('hex')
      ok = !!E.CHAIN_KEY && !!ts && Math.abs(Date.now() - Number(ts)) < 5 * 60_000 && sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))
    } else throw new BizError(1004, '该链不使用回调确认')
    if (!ok) throw new BizError(1003, '回调验签失败')
    const b = req.body || {}
    const txRef = String(b.txRef || b.txId || b.tx_hash || b.transactionHash || '')
    if (!txRef) throw new BizError(1001, '回调缺少交易号')
    if (b.success === false || b.status === 'FAILED') return { accepted: true, matched: false, reason: '对方报告失败，等待重试' }
    const r = await attestDomain.confirmByCallback({ provider: id, txRef, root: b.root || b.hash || null, block: b.blockHeight ?? b.block ?? null })
    return { accepted: true, ...r }
  },
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

export { callback }
