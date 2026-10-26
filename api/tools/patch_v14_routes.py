# -*- coding: utf-8 -*-
# routes.mjs 补丁：暗号玩法 / 逐品佣金 / KYC / 共创分润 四组路由
import io

p = 'src/routes.mjs'
s = io.open(p, encoding='utf-8').read()

# ---------- 1) 游客端：凭证暗号显示 + KYC 提交 ----------
anchor = "// 用户侧数字身份（小程序 A「我的数字身份」页：Travel ID = 凭证+徽章+存证流水）"
assert anchor in s, 'anchor1'
c_add = """// ---------- 暗号玩法 + KYC 实名（游客端） ----------
const cPhraseKyc = {
  // 游客凭证暗号：出票后可见（剧本游"入戏"开场白）
  'GET /c/orders/:no/phrase': async (req) => {
    const u = requireUser(req)
    const o = await order.byNo(req.params.no)
    if (!o || Number(o.user_id) !== Number(u.uid)) throw new BizError(2003, '订单不存在')
    if (!o.paid_at) throw new BizError(2002, '支付后可见暗号')
    const p = await one('SELECT phrase_user, phrase_merchant FROM tour_product WHERE id = ?', [o.product_id])
    if (!p || !p.phrase_user) return { enabled: false }
    return { enabled: true, userPhrase: p.phrase_user, hint: '到达剧情点位后，向 NPC 说出你的暗号' }
  },

  // KYC 实名提交（一户一档：重复提交=更新待审资料）
  'POST /c/kyc/submit': async (req) => {
    const u = requireUser(req)
    const { realName, idNo } = req.body
    const name = String(realName || '').trim()
    const id = String(idNo || '').trim().toUpperCase()
    if (!/^[\\u4e00-\\u9fa5]{2,20}$/.test(name)) throw new BizError(1001, '请输入真实中文姓名')
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

"""
s = s.replace(anchor, c_add + anchor)

# ---------- 2) 商户端：对暗号核销 ----------
anchor2 = "const mApply = {"
assert anchor2 in s, 'anchor2'
m_add = """// ---------- 商户端：暗号核销（§4 剧本游玩法） ----------
const mPhrase = {
  // 核销员输入游客说出的暗号 → 与本店已出票订单的产品用户暗号比对；命中即核销该订单全部有效凭证
  'POST /m/verify/phrase': async (req) => {
    const u = requireUser(req)
    const { phrase, orderNo } = req.body
    const said = String(phrase || '').trim()
    if (!said) throw new BizError(1001, '请输入游客说出的暗号')
    let o = null
    if (orderNo) {
      o = await one(`SELECT o.id, o.order_no, p.phrase_user, p.phrase_merchant FROM orders o
        JOIN tour_product p ON p.id = o.product_id WHERE o.order_no = ? AND o.merchant_id = ?`,
        [orderNo, u.merchantId])
    } else {
      o = await one(`SELECT o.id, o.order_no, p.phrase_user, p.phrase_merchant FROM orders o
        JOIN tour_product p ON p.id = o.product_id
        WHERE o.merchant_id = ? AND p.phrase_user = ? AND o.status IN (20,30) ORDER BY o.id DESC LIMIT 1`,
        [u.merchantId, said])
    }
    if (!o || !o.phrase_user) return { ok: false, reason: '未找到对应该暗号的在途订单' }
    if (said !== o.phrase_user) return { ok: false, reason: '暗号不对（再核对一下游客说的口令）', orderNo: o.order_no }
    const ids = (await q('SELECT id FROM travel_pass WHERE order_id = ? AND status = 1', [o.id])).map((r) => r.id)
    for (const pid of ids) {
      await pass.adminConfirmPass(pid, u.uid)
      await pass.attest('pass_verify', 'pass-' + pid, JSON.stringify({ by: u.merchantId, way: 'phrase' }))
    }
    if (ids.length) await q('INSERT INTO verification_log (pass_id, merchant_id, staff_id, method, result) VALUES (?,?,?,?,1)',
      [ids[0], u.merchantId, u.uid, 4])
    return { ok: true, reason: '暗号对上了 · 已核销 ' + ids.length + ' 张凭证', orderNo: o.order_no, verified: ids.length,
      counterPhrase: o.phrase_merchant || null }
  },
}

"""
s = s.replace(anchor2, m_add + anchor2)

# ---------- 3) 后台：暗号/逐品/KYC/共创 ----------
anchor3 = "const adminFin = {"
assert anchor3 in s, 'anchor3'
admin_add = """// ---------- 旧后台评估吸收：暗号/逐品佣金/KYC/共创（治理后台专用，词汇走 Web3 口径） ----------
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
    return await q(`SELECT p.id, p.title, p.promo_rate_bp, p.price_from FROM tour_product p
      WHERE p.promo_rate_bp IS NOT NULL ORDER BY p.id DESC`)
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

"""
s = s.replace(anchor3, admin_add + anchor3)

# ---------- 4) 挂路由 ----------
old = "export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...cPromo, ...integrations, ...web3, ...open, ...cIdentity, ...cNotes, ...mApply, ...callback }"
assert old in s, 'anchor4'
s = s.replace(old, "export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...cPromo, ...integrations, ...web3, ...open, ...cIdentity, ...cNotes, ...mApply, ...cPhraseKyc, ...mPhrase, ...adminNew, ...callback }")

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('routes patched')
