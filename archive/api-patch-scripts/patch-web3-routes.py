# -*- coding: utf-8 -*-
# WEB3 工作区后台接口（对齐旧后台 WEB3管理 六项，D6 双层口径：PC 后台内部可用链上表述）
import io
p = 'src/routes.mjs'
s = io.open(p, encoding='utf-8').read()
anchor = """  'GET /admin/attest/verify': async (req) => {
    await requireAdmin(req)
    return await web3._verify(String(req.query.bizType || 'order'), String(req.query.bizRef || ''))
  },
}"""
assert anchor in s
add = """  'GET /admin/attest/verify': async (req) => {
    await requireAdmin(req)
    return await web3._verify(String(req.query.bizType || 'order'), String(req.query.bizRef || ''))
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
      chainMode: 'NOOP（链数根适配 P1）', trustPath: ['订单支付', '权益核销', '勋章发放', '存证报告'],
      events,
    }
  },

  // 积分资产发行台账（旅豆 = 向往自由链积分资产，D6 外层口径）
  'GET /admin/web3/point-assets': async (req) => {
    await requireAdmin(req)
    const budgets = await q('SELECT id, total, granted, returned, status, created_at FROM bean_budget ORDER BY id DESC LIMIT 20')
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
      JOIN user_account u ON u.id = ub.user_id JOIN badge b ON b.id = ub.badge_id ORDER BY ub.id DESC LIMIT 20`)
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
    // 勋章发放同步入存证队列（链上事件：勋章发放节点）
    await pass.attest('badge', 'badge-' + userId + '-' + b.id, JSON.stringify({ badge: b.name, by: a.name, reason: reason || null }))
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

  // 合约调用账户（链数根适配器接入位）：凭据经集成中心配置，此处只读展示
  'GET /admin/web3/contract-account': async (req) => {
    await requireAdmin(req)
    const { getSecrets } = await import('../src/infra/secrets.mjs')
    const sec = await getSecrets(['CHAIN_ENDPOINT', 'CHAIN_ACCOUNT', 'CHAIN_KEY'])
    return { mode: sec.CHAIN_ENDPOINT ? '已配置链数根接入（P1 适配器启用后生效）' : 'NOOP（哈希流水实时记录，链接入后补锚）',
      endpoint: sec.CHAIN_ENDPOINT || '', account: sec.CHAIN_ACCOUNT || '', keyConfigured: !!sec.CHAIN_KEY,
      note: '适配器接口 AttestationClient：P0=Noop，P1=ChainShuGenClient；链故障业务照跑、恢复后补锚' }
  },
}"""
s = s.replace(anchor, add)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('web3 routes ok')
