# -*- coding: utf-8 -*-
# admin-ui：WEB3 工作区（链上总览/积分资产发行/勋章资产发行/用户数字钱包/合约调用账户）+ 驾驶舱链上权益卡
import io
p = 'admin/app.js'
s = io.open(p, encoding='utf-8').read()

# 1) 导航
old = "  ['系统', [['system', '运维控制台', 'sys'], ['features', '功能开关', 'flag'], ['security', '安全中心', 'risk'], ['integrations', '集成中心', 'withdraw']]],\n]"
assert old in s
s = s.replace(old, """  ['系统', [['system', '运维控制台', 'sys'], ['features', '功能开关', 'flag'], ['security', '安全中心', 'risk'], ['integrations', '集成中心', 'withdraw']]],
  ['WEB3', [['web3dash', '链上总览', 'eco'], ['pointassets', '积分资产发行', 'budgets'], ['badges', '勋章资产发行', 'flag'], ['wallets', '用户数字钱包', 'orders'], ['contract', '合约调用账户', 'sys']]],
]""")

# 2) go() 名称与分发
old = "    system: '运维控制台', features: '功能开关', content: '内容审核', withdrawals: '提现审批', agreements: '协议变更', attest: '存证中心', security: '安全中心', integrations: '集成中心' }[page]"
assert old in s
s = s.replace(old, "    system: '运维控制台', features: '功能开关', content: '内容审核', withdrawals: '提现审批', agreements: '协议变更', attest: '存证中心', security: '安全中心', integrations: '集成中心',\n    web3dash: '链上总览', pointassets: '积分资产发行', badges: '勋章资产发行', wallets: '用户数字钱包', contract: '合约调用账户' }[page]")
old = "  ;({ dash, orders, products, merchants, settlements, budgets, promoters, config, risk, audit, system, features, content, withdrawals, agreements, attest, security, integrations }[page] || dash)()"
assert old in s
s = s.replace(old, "  ;({ dash, orders, products, merchants, settlements, budgets, promoters, config, risk, audit, system, features, content, withdrawals, agreements, attest, security, integrations, web3dash, pointassets, badges, wallets, contract }[page] || dash)()")

# 3) 五个页面函数（追加到 attest 页之后）
anchor = "async function verifyAttest() {"
assert anchor in s
pages = '''/* ============ WEB3 工作区 ============ */
async function web3dash() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/overview')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>链上总览 · 向往自由链</h2><span class="muted">${esc(d.chainMode)} · 双层口径：小程序内=旅豆积分，对外=链上权益凭证</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">⛓</div><div><div class="l">锚定批次</div><div class="v" style="font-size:18px">${d.anchoredBatches}/${d.batches}</div><div class="s">Merkle 小时级打包</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">🔗</div><div><div class="l">链上事件</div><div class="v" style="font-size:18px">${d.anchoredEvents}/${d.events}</div><div class="s">待打包 ${d.pendingEvents}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">🏅</div><div><div class="l">勋章发放</div><div class="v" style="font-size:18px">${d.badgeGrants}</div><div class="s">发放即入存证队列</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e3f6ec">🫘</div><div><div class="l">积分资产</div><div class="v" style="font-size:18px">${d.beanGranted}</div><div class="s">已消耗 ${d.beanConsumed}</div></div></div>
    </div>
    <div class="row" style="margin-top:10px">${(d.trustPath || []).map((t, i) => `<span class="pill ${i ? 'off' : 'ok'}">${esc(t)}</span>`).join('<span class="muted">→</span>')}<span class="muted" style="margin-left:auto">上链的只有哈希指纹+时间戳，业务数据全在 MySQL（数据库是事实来源，链是审计锚点）</span></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>链上事件动态</h3><button class="btn ghost sm" onclick="go('attest')">进入存证中心 ›</button></div>
    <table><thead><tr><th>类型</th><th>业务单号</th><th>状态</th><th>时间</th></tr></thead><tbody>
    ${(d.events || []).map((e) => `<tr><td><span class="pill off">${esc(e.biz_type)}</span></td><td class="num">${esc(e.biz_ref)}</td>
      <td>${e.status === 2 ? '<span class="pill ok">已上链</span>' : '<span class="pill warn">待打包</span>'}</td>
      <td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无事件</td></tr>'}
    </tbody></table>
  </div>`
}
async function pointassets() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/point-assets')
  const BIZ = { 1: '消费返豆', 2: '任务奖励', 3: '内容奖励', 4: '抵扣', 5: '退款冲正', 6: '过期回收', 7: '风控调整' }
  const capPct = d.globalCap ? Math.min(100, Math.round(Number(d.globalCap.granted || 0) / Math.max(Number(d.globalCap.cap_total || d.globalCap.total || 1), 1) * 100)) : 0
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>积分资产发行台账</h2><span class="muted">旅豆 = 向往自由链积分资产（D6 外层口径）</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="ico" style="background:#fdf3e0">👥</div><div><div class="l">持有人数</div><div class="v" style="font-size:18px">${d.holders}</div><div class="s">一户一账（bean_account）</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">📦</div><div><div class="l">发行批次</div><div class="v" style="font-size:18px">${(d.budgets || []).length}</div><div class="s">按批次预算发行</div></div></div>
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">🛡</div><div><div class="l">年度总量哨兵</div><div class="v" style="font-size:18px">${d.globalCap ? (d.globalCap.cap_total || d.globalCap.total || '—') : '—'}</div><div class="s">严禁超发 · 双分录平衡</div></div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h3>发行批次</h3></div>
    <table><thead><tr><th>批次</th><th>名称</th><th>额度</th><th>已发放</th><th>回流</th><th>状态</th></tr></thead><tbody>
    ${(d.budgets || []).map((b) => `<tr><td>#${b.id}</td><td>${esc(b.name || '—')}</td><td class="num">${Number(b.total)}</td>
      <td class="num">${Number(b.granted)}</td><td class="num">${Number(b.returned)}</td>
      <td>${b.status === 1 ? '<span class="pill ok">启用</span>' : '<span class="pill s70">停用</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="td-sub">暂无批次</td></tr>'}
    </tbody></table>
  </div>
  <div class="card">
    <div class="card-head"><h3>按科目流水汇总（发行/销毁）</h3></div>
    <table><thead><tr><th>科目</th><th>发行（贷）</th><th>消耗/回收（借）</th></tr></thead><tbody>
    ${(d.byBiz || []).map((x) => `<tr><td>${BIZ[x.biz_type] || ('类型' + x.biz_type)}</td><td class="num">${Number(x.issued)}</td><td class="num">${Number(x.burned)}</td></tr>`).join('')}
    </tbody></table>
  </div>`
}
async function badges() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/badges')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>勋章资产发行</h2><span class="muted">勋章发放即写入链上存证队列（badge 事件）</span></div>
    <div class="row">
      <input id="bgName" placeholder="勋章名称（如 朱家角探索者）" style="width:200px">
      <input id="bgIcon" placeholder="图标键（如 badge_zjj）" style="width:160px">
      <input id="bgRule" placeholder="授予规则说明" style="width:220px">
      <button class="btn primary sm" onclick="createBadge()">新建定义</button>
    </div>
    <table style="margin-top:10px"><thead><tr><th>ID</th><th>名称</th><th>图标键</th><th>授予规则</th><th>已发放</th><th>操作</th></tr></thead><tbody>
    ${(d.defs || []).map((b) => `<tr><td>#${b.id}</td><td>${esc(b.name)}</td><td class="td-sub">${esc(b.icon_key)}</td>
      <td class="td-sub">${esc(b.rule_desc || '—')}</td><td class="num">${Number(b.granted)}</td>
      <td><button class="btn ghost sm" onclick="grantBadge(${b.id})">发放给用户</button></td></tr>`).join('') || '<tr><td colspan="6" class="td-sub">暂无勋章定义（先新建）</td></tr>'}
    </tbody></table>
  </div>
  <div class="card">
    <div class="card-head"><h3>最近发放</h3></div>
    <table><thead><tr><th>用户</th><th>勋章</th><th>时间</th></tr></thead><tbody>
    ${(d.recent || []).map((r) => `<tr><td>${esc(r.nickname || ('用户' + r.user_id))}</td><td>${esc(r.name)}</td><td class="td-sub">${esc(String(r.granted_at).slice(0, 19))}</td></tr>`).join('') || '<tr><td colspan="3" class="td-sub">暂无发放记录</td></tr>'}
    </tbody></table>
  </div>`
}
async function createBadge() {
  const name = document.getElementById('bgName').value.trim()
  const iconKey = document.getElementById('bgIcon').value.trim()
  if (!name || !iconKey) return toast('名称与图标键必填', true)
  const ruleDesc = document.getElementById('bgRule').value.trim()
  const r = await api('POST', '/admin/web3/badges', { name, iconKey, ruleDesc })
  toast('勋章定义已创建 #' + r.id); badges()
}
async function grantBadge(id) {
  const userId = prompt('发放给用户 ID：')
  if (!userId) return
  const reason = prompt('授予原因（可选）：') || ''
  try {
    const r = await api('POST', '/admin/web3/badges/' + id + '/grant', { userId: Number(userId), reason })
    toast('已发放「' + r.badge + '」并入存证队列'); badges()
  } catch (e) { toast(e.message, true) }
}
async function wallets() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const kw = (document.getElementById('wkw') && document.getElementById('wkw').value.trim()) || ''
  const d = await api('GET', '/admin/web3/wallets' + (kw ? '?kw=' + encodeURIComponent(kw) : ''))
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>用户数字钱包 / 数字资产</h2>
      <div class="row" style="margin:0"><input id="wkw" placeholder="昵称 / 用户ID" style="width:180px" value="${esc(kw)}">
      <button class="btn ghost sm" onclick="wallets()">查询</button></div></div>
    <table><thead><tr><th>用户</th><th>积分余额</th><th>等级</th><th>成长值</th><th>勋章</th><th>存证事件</th><th></th></tr></thead><tbody>
    ${d.map((w) => `<tr><td>${esc(w.nickname || '用户' + w.user_id)}</td><td class="num"><b>${Number(w.balance)}</b></td>
      <td><span class="pill off">Lv${w.member_level}</span></td><td class="num">${Number(w.growth_value)}</td>
      <td class="num">${Number(w.badges)}</td><td class="num">${Number(w.attest_n)}</td>
      <td><button class="btn ghost sm" onclick="walletDetail(${w.user_id})">资产明细 ›</button></td></tr>`).join('') || '<tr><td colspan="7" class="td-sub">暂无钱包</td></tr>'}
    </tbody></table>
  </div>
  <div id="wdetail"></div>`
}
async function walletDetail(uid) {
  const d = await api('GET', '/admin/web3/wallets/' + uid)
  $('#wdetail').innerHTML = `
  <div class="card">
    <div class="card-head"><h3>${esc(d.profile.nickname || '用户' + uid)} · 数字资产明细</h3><span class="muted">余额 ${Number(d.balance)} · Lv${d.profile.member_level} · 成长值 ${Number(d.profile.growth_value)}</span></div>
    <div class="row" style="gap:8px">${(d.badges || []).map((b) => `<span class="pill ok">🏅 ${esc(b.name)}</span>`).join('') || '<span class="muted">暂无勋章</span>'}</div>
    <table style="margin-top:10px"><thead><tr><th>流水</th><th>方向</th><th>科目</th><th>数量</th><th>关联单号</th><th>时间</th></tr></thead><tbody>
    ${(d.ledger || []).slice(0, 12).map((l) => `<tr><td class="td-sub">${esc(String(l.tx_no).slice(0, 20))}…</td>
      <td>${l.direction === 1 ? '<span class="pill ok">+ 发行</span>' : '<span class="pill s20">- 消耗</span>'}</td>
      <td>${l.biz_type}</td><td class="num">${Number(l.amount)}</td><td class="td-sub">${esc(l.biz_ref || '—')}</td>
      <td class="td-sub">${esc(String(l.created_at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="6" class="td-sub">暂无流水</td></tr>'}
    </tbody></table>
    <div class="card-head" style="margin-top:12px"><h3>存证流水</h3></div>
    <table><thead><tr><th>订单号</th><th>载荷哈希</th><th>状态</th><th>时间</th></tr></thead><tbody>
    ${(d.attestations || []).map((a) => `<tr><td class="num">${esc(a.orderNo)}</td><td><code>${esc(String(a.hash).slice(0, 20))}…</code></td>
      <td>${a.anchored ? '<span class="pill ok">已锚定</span>' : '<span class="pill warn">待打包</span>'}</td><td class="td-sub">${esc(String(a.at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无存证流水</td></tr>'}
    </tbody></table>
    <div class="muted" style="margin-top:8px">${esc(d.statement)}</div>
  </div>`
}
async function contract() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const d = await api('GET', '/admin/web3/contract-account')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>合约调用账户</h2><span class="muted">${esc(d.mode)}</span></div>
    <table><tr><td class="td-sub">接入状态</td><td>${esc(d.mode)}</td></tr>
      <tr><td class="td-sub">链端点 CHAIN_ENDPOINT</td><td>${d.endpoint ? '<code>' + esc(d.endpoint) + '</code>' : '<span class="muted">未配置（NOOP 模式）</span>'}</td></tr>
      <tr><td class="td-sub">账户 CHAIN_ACCOUNT</td><td>${d.account ? '<code>' + esc(d.account) + '</code>' : '<span class="muted">未配置</span>'}</td></tr>
      <tr><td class="td-sub">私钥 CHAIN_KEY</td><td>${d.keyConfigured ? '<span class="pill ok">已配置（加密落库）</span>' : '<span class="muted">未配置</span>'}</td></tr></table>
    <div class="muted" style="margin-top:8px">${esc(d.note)} · 凭据在「系统-集成中心」配置（AES-256-GCM 加密，库→env 兜底）</div>
  </div>`
}

'''
s = s.replace(anchor, pages + anchor)

# 4) 驾驶舱加链上权益卡（kpi-grid 后）
old = "  $('#app').innerHTML = `\n  <div class=\"kpi-grid\">${kpis.map("
assert old in s
s = s.replace(old, """  const w3 = await api('GET', '/admin/web3/overview').catch(() => null)
  $('#app').innerHTML = `${w3 ? `<div class="card"><div class="card-head"><h3>链上权益 · 向往自由链</h3><span class="muted">${esc(w3.chainMode)}</span>
    <button class="btn ghost sm" onclick="go('web3dash')" style="margin-left:auto">WEB3 工作区 ›</button></div>
    <div class="row" style="gap:24px;margin:0"><span>锚定批次 <b>${w3.anchoredBatches}/${w3.batches}</b></span>
    <span>链上事件 <b>${w3.anchoredEvents}/${w3.events}</b></span><span>待打包 <b>${w3.pendingEvents}</b></span>
    <span>勋章发放 <b>${w3.badgeGrants}</b></span><span>积分发行 <b>${w3.beanGranted}</b></span></div></div>` : ''}
  <div class="kpi-grid">${kpis.map(""")

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('admin-ui patched')
