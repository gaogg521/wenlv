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
import { web3 } from './web3.mjs'
import { fen2yuan, apiImg, toCsv, requireAdmin, scopeFilter, SUP_CATS, CREATOR_TAGS, audit, capabilityContext, publicBase, notifyMerchantStaff, handlePayNotify } from './_shared.mjs'

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
      switchRule: '设置环境变量 CHAIN_PROVIDER=chaingen|tbaas|antchain|antchainopen|evm|noop 即可切换；业务与页面代码零改动',
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

export { open }
