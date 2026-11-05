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

// 链上锚定信息的"人话版"：把上链原文拆成四要素，并当场验签。
// 没有原文（v1 早期批次）就如实说没有，不编造主体与签名。
async function describeChainOf(e, anchored) {
  if (!anchored) return null
  const m = await import('../infra/chain/antchain-open.mjs')
  const desc = m.describeContent(e.chain_content)
  const base = {
    provider: e.chain_provider || null,
    txRef: e.chain_tx_ref, block: e.chain_block,
    anchoredAt: e.anchored_at || null,
    tsMs: e.chain_ts_ms || desc.tsMs || null,
    tsIso: e.chain_ts_ms ? new Date(Number(e.chain_ts_ms)).toISOString() : (desc.tsIso || null),
  }
  if (desc.version === 2) {
    const v = m.verifyContentV2(e.chain_content)
    return { ...base, ...desc, signatureVerified: v.ok, signatureNote: v.ok ? '签名可被平台公钥验证' : v.reason }
  }
  return { ...base, ...desc, signatureVerified: null,
    signatureNote: desc.version === 1 ? '早期批次未含签名（v1）' : '没有留存上链原文，无法验签' }
}

// ---------- 存证中心 / 公开验证 / 用户数字身份 ----------
const web3 = {
  // 后台：存证批次与队列总览
  'GET /admin/attest/center': async (req) => {
    await requireAdmin(req)
    const batches = await q('SELECT * FROM attest_batch ORDER BY seq DESC LIMIT 20')
    // 每个区块里装的是哪些业务环节（订单/出票/核销/返豆/结算…）：链路视图直接画在区块上，不用悬停或点开才知道
    if (batches.length) {
      const mixRows = await q(`SELECT batch_id, biz_type, COUNT(*) n FROM attest_event
        WHERE batch_id IN (${batches.map(() => '?').join(',')}) GROUP BY batch_id, biz_type`, batches.map((b) => b.id))
      const mix = new Map()
      for (const r of mixRows) {
        const m = mix.get(Number(r.batch_id)) || {}
        m[r.biz_type] = Number(r.n)
        mix.set(Number(r.batch_id), m)
      }
      for (const b of batches) b.mix = mix.get(Number(b.id)) || {}
    }
    const queue = await q(`SELECT biz_type,
      SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) packed,
      SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) anchored,
      COUNT(*) total FROM attest_event GROUP BY biz_type`)
    const recent = await q(`SELECT e.biz_type, e.biz_ref, e.version_no, e.status, e.created_at, e.batch_id,
      b.seq, b.merkle_root, b.chain_tx_ref, b.status AS batch_status
      FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id ORDER BY e.id DESC LIMIT 30`)
    const dayRoots = await q('SELECT * FROM bean_day_root ORDER BY biz_date DESC LIMIT 10')
    // 「看一条真实单的六步」用：优先走完全程（已完成 + 已结算）的单子，最近事件里没有订单也能找到
    const latest = await one(`SELECT e.biz_ref FROM attest_event e JOIN orders o ON o.order_no = e.biz_ref
      WHERE e.biz_type = 'order' ORDER BY (o.status = 50) DESC, (o.settlement_id IS NOT NULL) DESC, e.id DESC LIMIT 1`)
    return {
      batches, queue, recent, dayRoots, latestOrder: latest ? latest.biz_ref : null,
      chain: chain.chainStatus(),
      // 语义分档：NOOP 期一律"已打包·待锚定"，绝不出现"已上链"
      chainMode: chain.chainMode() === 'real' ? `已接入${chain.chainStatus().label}：新批次真实锚定` : 'NOOP：哈希与 Merkle 根实时落库，批次停在「已打包·待锚定」' // 文案跟着当前链走，不能写死某一家,
    }
  },

  // 单号验证（后台+开放页共用逻辑）：返回可离线重算的 inclusion proof
  async _verify(bizType, bizRef) {
    const e = await one(`SELECT e.*, b.merkle_root, b.prev_root, b.chain_tx_ref, b.chain_block, b.anchored_at,
        b.seq, b.leaf_count, b.is_day_close, b.merkle_version, b.status AS batch_status,
        b.chain_provider, b.chain_content, b.chain_ts_ms
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
      // 链上锚定信息（方案 §7.6 四要素）：交易哈希 + 块高 + 时间戳 + 主体标识 + 签名
      // 不给齐这四项，"输入订单号→链上锚定信息+本地哈希比对"就只是半个验证
      chain: await describeChainOf(e, anchored),
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

  // 存证统一检索：一个入口吃多种标识，不用先知道"这是什么"再找对应页面
  // 支持：订单号 / 批次（#12、batch:12、12）/ 交易哈希 / Merkle 根 / 载荷哈希 / 凭证号 / 旅豆流水 / 结算单 / 手机号 / 用户ID / DID
  // 说明：本方案走链上内置存证（DEPOSIT），链上标识就是交易哈希与根，没有合约地址可查；上了合约才有合约地址与合约方法查询
  'GET /admin/attest/search': async (req) => {
    await requireAdmin(req)
    const raw = String(req.query.q || '').trim()
    if (!raw) throw new BizError(1001, '请输入要查的内容：订单号 / 批次 #N / 交易哈希 / Merkle 根 / 凭证号 / 手机号 / 用户 ID / DID')
    const s = raw.replace(/^#/, '').trim()
    const HEX64 = /^[0-9a-f]{64}$/i
    const BCOLS = 'b.id, b.seq, b.biz_date, b.merkle_root, b.prev_root, b.leaf_count, b.status, b.chain_provider, b.chain_tx_ref, b.chain_block, b.anchored_at, b.is_day_close'
    const ECOL = `e.id, e.biz_type, e.biz_ref, e.version_no, e.status, e.payload_hash, e.created_at, e.batch_id,
      b.seq, b.merkle_root, b.status AS batch_status, b.chain_tx_ref, b.chain_block`

    const kinds = []
    const batches = new Map()
    const events = []
    const pushBatch = (b) => { if (b && !batches.has(b.id)) batches.set(b.id, b) }
    const pushEvents = (rows) => { for (const r of rows) { events.push(r); if (r.batch_id) pushBatch({ id: r.batch_id, seq: r.seq, merkle_root: r.merkle_root, status: r.batch_status, chain_tx_ref: r.chain_tx_ref, chain_block: r.chain_block }) } }

    let order = null, user = null, pass1 = null

    // 1) 64 位十六进制：交易哈希 / Merkle 根 / 前根 / 载荷指纹
    if (HEX64.test(s)) {
      const h = s.toLowerCase()
      for (const b of await q(`SELECT ${BCOLS} FROM attest_batch b WHERE b.chain_tx_ref = ? OR b.merkle_root = ? OR b.prev_root = ?`, [h, h, h])) {
        pushBatch(b); kinds.push(b.chain_tx_ref === h ? '交易哈希' : b.merkle_root === h ? 'Merkle 根' : '前根')
      }
      const byHash = await q(`SELECT ${ECOL} FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id WHERE e.payload_hash = ? LIMIT 50`, [h])
      if (byHash.length) { pushEvents(byHash); kinds.push('载荷哈希') }
    }

    // 2) 订单号（WL 开头或库里真存在）
    const o = await one('SELECT o.*, p.title product_name FROM orders o LEFT JOIN tour_product p ON p.id = o.product_id WHERE o.order_no = ?', [s])
    if (o) {
      kinds.push('订单号')
      order = { orderNo: o.order_no, status: Number(o.status), productName: o.product_name, amountPay: o.amount_pay, userId: Number(o.user_id), createdAt: o.created_at }
      pushEvents(await q(`SELECT ${ECOL} FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id
        WHERE e.biz_ref = ? OR e.biz_ref LIKE ? ORDER BY e.id`, [s, s + '-%']))
    }

    // 3) 用户：手机号 / user:123 / 纯数字 / DID
    const uidMatch = s.match(/^(?:user|uid|u)[:#]?(\d+)$/i) || (/^\d{1,9}$/.test(s) ? [s, s] : null)
    const draw = s.match(/^did:cn:wl:/i) ? s : null
    let u
    if (/^1\d{10}$/.test(s)) {
      const { whereMobile } = await import('../infra/mobile.mjs')
      const m = whereMobile(s, 'u')
      u = await one(`SELECT u.id, u.nickname, u.did_ref, u.member_level, u.status FROM user_account u WHERE ${m.sql}`, m.args)
      if (u) kinds.push('手机号')
    } else if (draw) {
      u = await one('SELECT id, nickname, did_ref, member_level, status FROM user_account WHERE did_ref = ?', [draw])
      if (u) kinds.push('DID')
    } else if (uidMatch) {
      const id = Number(uidMatch[1])
      u = await one('SELECT id, nickname, did_ref, member_level, status FROM user_account WHERE id = ?', [id])
      // 纯数字既可能是用户 ID 也可能是批次序号/ID，两边都查，都命中就都返回
      if (u && /^(user|uid|u)/i.test(s)) kinds.push('用户 ID')
      else if (u) kinds.push('用户 ID（按数字匹配）')
    }
    if (u) {
      user = { id: Number(u.id), nickname: u.nickname, did: u.did_ref || null, memberLevel: u.member_level, status: Number(u.status) }
      // 该用户名下的订单事件，以及旅豆/凭证类事件
      // 一个人的完整生命周期：订单 / 凭证 / 旅豆 / 徽章 / 实名 / DID 签发 / 提现，全部按主体归集
      pushEvents(await q(`SELECT ${ECOL} FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id
        WHERE e.biz_ref IN (SELECT order_no FROM orders WHERE user_id = ?)
           OR e.biz_ref IN (SELECT CONCAT('pass-', id) FROM travel_pass WHERE user_id = ?)
           OR CAST(JSON_UNQUOTE(JSON_EXTRACT(e.canonical, '$.userId')) AS UNSIGNED) = ?
           OR CAST(JSON_UNQUOTE(JSON_EXTRACT(e.canonical, '$.promoterUserId')) AS UNSIGNED) = ?
        ORDER BY e.id DESC LIMIT 200`, [u.id, u.id, u.id, u.id]))
    }

    // 4) 批次：#12 / batch:12 / 数字
    const bm = s.match(/^(?:batch|b)[:#]?(\d+)$/i) || (/^\d{1,9}$/.test(s) ? [s, s] : null)
    if (bm) {
      const n = Number(bm[1])
      for (const b of await q(`SELECT ${BCOLS} FROM attest_batch b WHERE b.id = ? OR b.seq = ?`, [n, n])) {
        pushBatch(b); kinds.push('批次')
        for (const e of await q(`SELECT ${ECOL} FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id WHERE e.batch_id = ? ORDER BY e.leaf_index, e.id`, [b.id])) events.push(e)
      }
    }

    // 5) 业务单号直查（凭证 / 旅豆流水 / 结算单 / 退款单 / 其它）
    if (!HEX64.test(s) && s.length >= 3) {
      const direct = await q(`SELECT ${ECOL} FROM attest_event e LEFT JOIN attest_batch b ON b.id = e.batch_id
        WHERE e.biz_ref = ? OR e.biz_ref LIKE ? ORDER BY e.id DESC LIMIT 100`, [s, s + '-%'])
      if (direct.length) { pushEvents(direct); kinds.push('业务单号') }
      const p = await one('SELECT p.id, p.serial_no, p.status, p.order_id FROM travel_pass p WHERE CONCAT("pass-", p.id) = ? OR p.serial_no = ?', [s, s])
      if (p) { kinds.push('凭证'); pass1 = { id: Number(p.id), serialNo: p.serial_no, status: Number(p.status), orderId: Number(p.order_id) } }
    }

    const chainInfo = chain.chainStatus()
    return {
      q: raw,
      matched: [...new Set(kinds)],
      order, user, pass: pass1,
      batches: [...batches.values()].map((b) => ({
        ...b,
        chain: b.chain_tx_ref ? { provider: b.chain_provider || null, txRef: b.chain_tx_ref, block: b.chain_block || null } : null,
      })),
      events,
      chain: { provider: chainInfo.provider, label: chainInfo.label, mode: chainInfo.mode },
      // 让前端能直接说清"能查什么、不能查什么"
      capability: {
        canSearch: ['订单号', '批次 #N', '交易哈希', 'Merkle 根', '载荷哈希', '凭证号', '旅豆流水号', '结算单号', '手机号', '用户 ID', 'DID'],
        noContract: chainInfo.capabilities?.assets === false || chainInfo.provider === 'antchainopen'
          ? '当前链走内置存证（DEPOSIT），没有合约地址可查；链上标识就是交易哈希与 Merkle 根。若后续部署自有合约，才有合约地址与合约方法查询'
          : '',
      },
    }
  },

  // 单流程视角（一单六锚）：把一笔订单的存证事件按业务步骤串成链
  'GET /admin/attest/flow/:orderNo': async (req) => {
    await requireAdmin(req)
    const orderNo = String(req.params.orderNo || '').trim()
    const o = await one('SELECT o.*, p.title product_name FROM orders o LEFT JOIN tour_product p ON p.id = o.product_id WHERE o.order_no = ?', [orderNo])
    if (!o) throw new BizError(1201, '订单不存在')
    const COLS = 'e.id, e.biz_type, e.biz_ref, e.version_no, e.status, e.payload_hash, e.created_at, e.batch_id, b.seq, b.merkle_root, b.status AS batch_status'
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
    const beanFlow = await bean.flow()
    const events = await q(`SELECT biz_type, biz_ref, status, created_at, batch_id FROM attest_event ORDER BY id DESC LIMIT 12`)
    return {
      batches: Number(b.batches) || 0, anchoredBatches: Number(b.anchored) || 0,
      events: Number(e.total) || 0, anchoredEvents: Number(e.anchored) || 0, pendingEvents: Number(e.pending) || 0,
      badgeGrants: Number(badges.c) || 0,
      beanGranted: beanFlow.granted, beanConsumed: beanFlow.consumed,
      chain: chain.chainStatus(),
      chainMode: chain.chainMode() === 'real'
        ? `已接入${chain.chainStatus().label}：批次真实锚定`
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
    const holders = await one('SELECT COUNT(*) c FROM bean_account WHERE user_id < 999999000000')   // 只数真实用户户：排除预算 / 平台哨兵户
    return { budgets, globalCap: cap, byBiz, holders: Number(holders.c) || 0,
      note: '积分按预算批次发行，年度总量受 global_cap 哨兵约束（双分录账本，严禁超发）' }
  },

  // 勋章资产发行：定义列表 + 发放
  'GET /admin/web3/badges': async (req) => {
    await requireAdmin(req)
    const defs = await q(`SELECT b.*, (SELECT COUNT(*) FROM user_badge ub WHERE ub.badge_id = b.id) + (SELECT COUNT(*) FROM merchant_badge mb WHERE mb.badge_id = b.id) granted,
      (SELECT COUNT(*) FROM attest_event e WHERE e.biz_type = 'badge' AND (e.biz_ref LIKE CONCAT('badge-%-', b.id) OR e.biz_ref LIKE CONCAT('mbadge-%-', b.id)) AND e.status = 2) anchored
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
  // 按规则补发：对存量用户评估自动规则（改了阈值或新建规则后使用）
  'POST /admin/web3/badges/:id/backfill': async (req) => {
    const a = await requireAdmin(req, ['super', 'ops'])
    const bd = await one('SELECT * FROM badge WHERE id = ?', [req.params.id])
    if (!bd) throw new BizError(1004, '勋章不存在')
    const r = badgeDomain.isMerchantBadge(bd) ? await badgeDomain.backfillMerchant(bd) : await badgeDomain.backfill(Number(req.params.id))
    await tx(async (c) => audit(c, 'admin:' + a.name, 'badge', 'backfill', 'badge-' + req.params.id, null, r))
    return r
  },
  'POST /admin/web3/badges/:id/grant': async (req) => {
    const a = await requireAdmin(req)
    const { userId, merchantId, reason } = req.body
    const b = await one('SELECT id, name FROM badge WHERE id = ?', [req.params.id])
    if (!b) throw new BizError(1004, '勋章定义不存在')
    const fullB = await one('SELECT * FROM badge WHERE id = ?', [b.id])
    if (badgeDomain.isMerchantBadge(fullB)) { // 商户徽章发给商户，不发给用户
      if (!merchantId) throw new BizError(1001, '这是商户徽章，请填写商户 ID')
      if (!(await one('SELECT id FROM merchant WHERE id = ?', [merchantId]))) throw new BizError(1004, '商户不存在')
      const g = await badgeDomain.grantMerchant(Number(merchantId), fullB, { by: 'admin:' + a.name, reason, strict: true })
      if (!g.granted && g.reason === 'owned') throw new BizError(1001, '该商户已拥有此徽章')
      return { granted: true, badge: b.name, attestQueued: true }
    }
    const u = await one('SELECT id FROM user_account WHERE id = ?', [userId])
    if (!u) throw new BizError(1004, '用户不存在')
    // 与自动发放同一入口：校验发行上限、幂等、入存证队列
    const full = await one('SELECT * FROM badge WHERE id = ?', [b.id])
    const r = await badgeDomain.grant(Number(userId), full, { by: 'admin:' + a.name, reason, strict: true })
    if (!r.granted && r.reason === 'owned') throw new BizError(1001, '该用户已拥有此勋章')
    return { granted: true, badge: b.name, attestQueued: true }
  },

  // 用户数字钱包 / 数字资产（按用户查：旅豆账本 + 勋章 + 存证流水）
  'GET /admin/web3/wallets': async (req) => {
    await requireAdmin(req)
    const kw = String(req.query.kw || '').trim()
    const rows = await q(`SELECT a.id account_id, a.user_id, a.balance, u.nickname, u.member_level, u.growth_value,
      (SELECT COUNT(*) FROM user_badge ub WHERE ub.user_id = a.user_id) badges,
      (SELECT COUNT(DISTINCT e.biz_ref) FROM attest_event e WHERE e.biz_type = 'order' AND e.biz_ref IN (SELECT order_no FROM orders WHERE user_id = a.user_id)) attest_n
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
      const e = await one("SELECT status, payload_hash, created_at FROM attest_event WHERE biz_type = 'order' AND biz_ref = ? ORDER BY version_no DESC, id DESC LIMIT 1", [o.order_no])
      if (e) attestations.push({ orderNo: o.order_no, code: String(e.payload_hash).slice(0, 8).toUpperCase(), sealed: e.status >= 1, at: e.created_at })
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
    const { runPreflight, preflightSummary } = await import('../infra/chain/preflight.mjs')
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
  // 身份档案：数字身份(DID) ↔ 旅豆账户 ↔ 徽章 / 行程 / 凭证，按 user_id 一一关联
  'GET /admin/web3/identities': async (req) => {
    await requireAdmin(req)
    return await vc.identities({ q: req.query?.q, page: req.query?.page, size: req.query?.size })
  },
  'GET /admin/web3/identity/:userId': async (req) => {
    await requireAdmin(req)
    const id = Number(req.params.userId)
    if (!Number.isInteger(id) || id <= 0) throw new BizError(1001, '用户 id 不合法')
    try { return await vc.identityDetail(id) } catch (e) { if (/用户不存在/.test(e.message)) throw new BizError(1004, '用户不存在'); throw e }
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
    const { getSecrets } = await import('../infra/secrets.mjs')
    const sec = await getSecrets(['CHAIN_ENDPOINT', 'CHAIN_ACCOUNT', 'CHAIN_KEY'])
    return { mode: sec.CHAIN_ENDPOINT ? '已配置链数根接入（P1 适配器启用后生效）' : 'NOOP（哈希流水实时记录，链接入后补锚）',
      endpoint: sec.CHAIN_ENDPOINT || '', account: sec.CHAIN_ACCOUNT || '', keyConfigured: !!sec.CHAIN_KEY,
      note: '适配器接口 AttestationClient：P0=Noop，P1=ChainShuGenClient；链故障业务照跑、恢复后补锚' }
  },
}

export { web3 }
