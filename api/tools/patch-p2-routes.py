# -*- coding: utf-8 -*-
# P2 路由补丁：笔记详情/约稿任务/目的地/商户邀请码/手机号登录/进件/admin 任务判决
import io
p = 'src/routes.mjs'
s = io.open(p, encoding='utf-8').read()

# 1) c 侧新路由（插到 c map 结尾前）
anchor_c = "  },\n}\n\n// 用户侧数字身份"
assert anchor_c in s, 'c-map anchor'
add_c = '''  },
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
  'GET /c/notes/tasks': async (req) => {
    const u = requireUser(req)
    const open = await q("SELECT id, task_no, title, brief, reward_beans FROM content_task WHERE status = 0 ORDER BY id DESC LIMIT 20")
    const mine = await q("SELECT id, task_no, title, status, reward_beans, submitted_at FROM content_task WHERE claimed_by = ? ORDER BY id DESC LIMIT 20", [u.uid])
    return { open, mine }
  },
  'POST /c/notes/tasks/:id/claim': async (req) => {
    const u = requireUser(req)
    const n = await tx(async (c) => c.upd("UPDATE content_task SET status = 1, claimed_by = ?, claimed_at = NOW(3) WHERE id = ? AND status = 0", [u.uid, req.params.id]))
    if (n !== 1) throw new BizError(2002, '任务已被领取或不可领取')
    return { claimed: true }
  },
  'POST /c/notes/tasks/:id/submit': async (req) => {
    const u = requireUser(req)
    const { noteId } = req.body
    const note = await one('SELECT id, user_id, status FROM content_note WHERE id = ?', [noteId])
    if (!note || Number(note.user_id) !== Number(u.uid)) throw new BizError(1004, '笔记不存在')
    if (Number(note.status) !== 2) throw new BizError(1001, '仅已发布的笔记可提交审核')
    const n = await tx(async (c) => c.upd("UPDATE content_task SET status = 2, note_id = ?, submitted_at = NOW(3) WHERE id = ? AND status = 1 AND claimed_by = ?", [noteId, req.params.id, u.uid]))
    if (n !== 1) throw new BizError(2002, '仅进行中任务可提交')
    return { submitted: true }
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
const mApply = {
  'POST /m/apply': async (req) => {
    const { name, cityCode = '310118', contact, mobile, note } = req.body
    if (!name || !contact || !mobile) throw new BizError(1001, '门店名/联系人/电话必填')
    const mno = 'MAPPLY' + String(Date.now()).slice(-10)
    const id = await tx(async (c) => c.ins(`INSERT INTO merchant (city_code, name, merchant_no, status, apply_contact, apply_mobile, apply_note)
      VALUES (?,?,?,?,?,?,?)`, [cityCode, name, mno, 0, contact, mobile, note || null]))
    return { id, merchantNo: mno, msg: '已提交，等待平台审核（审核通过后可在小程序凭邀请码加入）' }
  },
}
'''
s = s.replace(anchor_c, add_c + "\n// 用户侧数字身份")

# 2) m 侧：邀请码 / 加入 / 手机号登录
anchor_m = "  // 离线名单（§10）：断网前同步本店有效凭证 + 展示码映射"
assert anchor_m in s, 'm anchor'
add_m = '''  // 店员邀请码（P2）：老板/店长获取（无则生成 INV+8位）
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
    if (exist) return { joined: true, merchantId: Number(m.id), role: Number(exist.role), alreadyBound: true }
    await q('INSERT INTO merchant_staff (merchant_id, user_id, role) VALUES (?,?,1)', [m.id, u.uid])
    return { joined: true, merchantId: Number(m.id), role: 1, merchantName: m.name }
  },
  // 商户手机号登录（P2）：微信手机号快速验证组件 code → 手机号找用户 → 回报绑定状态
  'POST /m/auth/phone-login': async (req) => {
    const { phoneCode } = req.body
    const { phoneNumber } = await wxapi.getPhoneNumber(phoneCode || '')
    const buf = Buffer.from(phoneNumber, 'utf8')
    const u = await one('SELECT * FROM user_account WHERE mobile_enc = ?', [buf])
    if (!u) throw new BizError(1004, '该手机号未注册，请先用微信登录')
    const staff = await one('SELECT merchant_id, role FROM merchant_staff WHERE user_id = ? AND status = 1', [u.id])
    return { linked: phoneNumber.replace(/(\\d{3})\\d{4}(\\d{4})/, '$1****$2'),
      bound: !!staff, merchantId: staff ? Number(staff.merchant_id) : null, role: staff ? Number(staff.role) : null }
  },
'''
s = s.replace(anchor_m, add_m + anchor_m)

# 3) admin：约稿任务管理 + approve 补 approved_at
anchor_a = "  // 离线核销冲突人工队列（治理）"
assert anchor_a in s, 'admin anchor'
add_a = '''  // 约稿任务管理（P2 四态机：创建/审核）
  'GET /admin/content-tasks': async (req) => {
    await requireAdmin(req)
    return await q(`SELECT t.*, u.nickname claimer FROM content_task t
      LEFT JOIN user_account u ON u.id = t.claimed_by ORDER BY t.id DESC LIMIT 100`)
  },
  'POST /admin/content-tasks': async (req) => {
    const a = await requireAdmin(req)
    const { title, brief, rewardBeans } = req.body
    if (!title || !brief) throw new BizError(1001, '标题与要求必填')
    const taskNo = 'TK' + Date.now()
    const id = await tx(async (c) => c.ins(
      'INSERT INTO content_task (task_no, title, brief, reward_beans, created_by) VALUES (?,?,?,?,?)',
      [taskNo, title, brief, Number(rewardBeans) || 200, a.uid || null]))
    return { id, taskNo }
  },
  'POST /admin/content-tasks/:id/verdict': async (req) => {
    await requireAdmin(req)
    const { pass } = req.body
    const t = await one('SELECT * FROM content_task WHERE id = ?', [req.params.id])
    if (!t) throw new BizError(1004, '任务不存在')
    if (Number(t.status) !== 2) throw new BizError(2002, '仅审核中任务可判决')
    if (pass) {
      await tx(async (c) => c.upd("UPDATE content_task SET status = 3, finished_at = NOW(3) WHERE id = ? AND status = 2", [req.params.id]))
      const budget = await one('SELECT id FROM bean_budget WHERE status = 1 ORDER BY id DESC LIMIT 1')
      if (budget && t.claimed_by) {
        await bean.grant(Number(t.claimed_by), Number(t.reward_beans), bean.BIZ.TASK, t.task_no, budget.id)
      }
      return { finished: true, rewarded: Number(t.reward_beans) }
    }
    await q("UPDATE content_task SET status = 1 WHERE id = ? AND status = 2", [req.params.id])
    return { rejected: true, backTo: '进行中' }
  },
'''
s = s.replace(anchor_a, add_a + anchor_a)
old_ap = "await q('UPDATE merchant SET status = 1 WHERE id = ? AND status = 0', [req.params.id])"
assert old_ap in s
s = s.replace(old_ap, "await q('UPDATE merchant SET status = 1, approved_at = NOW(3) WHERE id = ? AND status = 0', [req.params.id])")

# 4) 商户订阅通知：支付回调确认后通知门店店员（模板未配置自动跳过，MOCK 安全）
anchor_n = "    const passIds = await pass.issueForOrder(orderNo)"
assert anchor_n in s
add_n = anchor_n + '''
    // 商户端订阅消息（P2）：新订单通知门店（WX_TMPL_NEW_ORDER 未配置则 skipped，不阻断）
    notifyMerchantStaff(o.merchant_id, orderNo).catch((e) => console.error('[notify:merchant]', e.message))'''
s = s.replace(anchor_n, add_n, 1)

# notifyMerchantStaff 函数（放在 handlePayNotify 后面）
anchor_f = "async function handlePayNotify(orderNo, transNo, mock = false) {"
assert anchor_f in s
s = s.replace(anchor_f, '''async function notifyMerchantStaff(merchantId, orderNo) {
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

''' + anchor_f)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('routes patched OK')
