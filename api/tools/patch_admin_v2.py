# -*- coding: utf-8 -*-
import io

p = 'admin/app.js'
s = io.open(p, encoding='utf-8').read()

# ── 1. NAV 加两项 ──
old_nav = "  ['生态', [['merchants', '商户与进件', 'merchants'], ['content', '内容审核', 'content'], ['faqs', '常见问题', 'audit'], ['banners', '轮播管理', 'flag'], ['promoters', '推广服务商', 'promoters'], ['withdrawals', '提现审批', 'withdraw'], ['agreements', '协议变更', 'eco'], ['budgets', '旅豆预算', 'budgets']]],"
assert old_nav in s, 'nav'
new_nav = "  ['生态', [['merchants', '商户与进件', 'merchants'], ['content', '内容审核', 'content'], ['tasks', '约稿任务', 'flag'], ['faqs', '常见问题', 'audit'], ['banners', '轮播管理', 'flag'], ['promoters', '推广服务商', 'promoters'], ['withdrawals', '提现审批', 'withdraw'], ['agreements', '协议变更', 'eco'], ['budgets', '旅豆预算', 'budgets']]],"
s = s.replace(old_nav, new_nav)

old_gov = "  ['治理', [['config', '参数中心', 'config'], ['attest', '存证中心', 'eco'], ['risk', '风控', 'risk'], ['audit', '审计日志', 'audit'], ['phrases', '暗号管理', 'flag'], ['rateov', '逐品佣金', 'promoters'], ['kyc', '实名认证', 'audit'], ['cocreate', '共创分润', 'eco']]],"
assert old_gov in s, 'gov'
new_gov = "  ['治理', [['config', '参数中心', 'config'], ['attest', '存证中心', 'eco'], ['risk', '风控', 'risk'], ['conflicts', '离线冲突', 'risk'], ['audit', '审计日志', 'audit'], ['phrases', '暗号管理', 'flag'], ['rateov', '逐品佣金', 'promoters'], ['kyc', '实名认证', 'audit'], ['cocreate', '共创分润', 'eco']]],"
s = s.replace(old_gov, new_gov)

# ── 2. crumb 名称 ──
old_name = "wallets: '用户数字钱包', contract: '合约调用账户', faqs: '常见问题', banners: '轮播管理', phrases: '暗号管理', rateov: '逐品佣金', kyc: '实名认证', cocreate: '共创分润', terms: '术语映射' }[page]"
assert old_name in s, 'name'
s = s.replace(old_name, "wallets: '用户数字钱包', contract: '合约调用账户', faqs: '常见问题', banners: '轮播管理', phrases: '暗号管理', rateov: '逐品佣金', kyc: '实名认证', cocreate: '共创分润', terms: '术语映射', tasks: '约稿任务', conflicts: '离线冲突' }[page]")

# ── 3. go() 分派 ──
old_disp = "({ dash, orders, products, merchants, settlements, budgets, promoters, config, risk, audit, system, features, content, withdrawals, agreements, attest, security, integrations, web3dash, pointassets, badges, wallets, contract, faqs, banners, phrases, rateov, kyc, cocreate, terms }[page] || dash)()"
assert old_disp in s, 'disp'
s = s.replace(old_disp, "({ dash, orders, products, merchants, settlements, budgets, promoters, config, risk, audit, system, features, content, withdrawals, agreements, attest, security, integrations, web3dash, pointassets, badges, wallets, contract, faqs, banners, phrases, rateov, kyc, cocreate, terms, tasks, conflicts }[page] || dash)()")

# ── 4. 约稿任务 + 离线冲突视图（追加在 terms 函数后面）──
anchor = "/* ============ WEB3 工作区 ============ */"
assert anchor in s, 'anchor'

views = r'''
/* ============ 约稿任务管理 ============ */
async function tasks() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/content-tasks')
  const ST = { 0: '<span class="pill warn">待领取</span>', 1: '<span class="pill s20">进行中</span>', 2: '<span class="pill s30">审核中</span>', 3: '<span class="pill ok">已完成</span>' }
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>约稿任务</h2><span class="muted">四态状态机 · 待领取→进行中→审核中→已完成</span></div>
    <div class="row"><input id="tkTitle" placeholder="任务标题"><input id="tkBrief" placeholder="任务简述" style="width:280px">
      <input id="tkReward" placeholder="报酬(豆)" style="width:120px"><button class="btn primary sm" onclick="addTask()">新建任务</button></div>
    ${list.length ? `<table><thead><tr><th>任务</th><th>简述</th><th>报酬</th><th>领取</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${list.map((t) => `<tr><td class="td-main">${esc(t.title)}</td><td class="td-sub">${esc(t.brief || '')}</td>
      <td class="num">${Number(t.reward_beans)} 豆</td><td class="num">${Number(t.claimed) || 0} 人</td>
      <td>${ST[t.status] || t.status}</td>
      <td><div style="display:flex;gap:4px">${t.status === 2 ? `<button class="btn primary sm" onclick="taskVerdict(${t.id},true)">通过</button><button class="btn danger sm" onclick="taskVerdict(${t.id},false)">驳回</button>` : ''}
      <button class="btn ghost sm" onclick="deleteTask(${t.id})">删除</button></div></td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无约稿任务')}</div>`
}
async function addTask() {
  const title = document.getElementById('tkTitle').value.trim()
  if (!title) return toast('任务标题必填', true)
  try {
    await api('POST', '/admin/content-tasks', { title, brief: document.getElementById('tkBrief').value.trim(), rewardBeans: Number(document.getElementById('tkReward').value) || 100 })
    toast('任务已创建'); tasks()
  } catch (e) { toast(e.message, true) }
}
async function taskVerdict(id, pass) {
  try { await api('POST', '/admin/content-tasks/' + id + '/verdict', { pass }); toast(pass ? '任务已通过' : '任务已驳回'); tasks() } catch (e) { toast(e.message, true) }
}
async function deleteTask(id) {
  if (!confirm('删除该任务？')) return
  try { await api('POST', '/admin/content-tasks/' + id + '/delete', {}); toast('任务已删除'); tasks() } catch (e) { toast(e.message, true) }
}

/* ============ 离线核销冲突队列 ============ */
async function conflicts() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/verify/conflicts')
  const ST = { 0: '<span class="pill warn">待处理</span>', 1: '<span class="pill ok">已确认</span>', 2: '<span class="pill s70">已驳回</span>' }
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>离线核销冲突</h2><span class="muted">断网恢复后二次校验失败的凭证 · 需人工确认或驳回</span></div>
    ${list.length ? `<table><thead><tr><th>商户</th><th>凭证</th><th>离线载荷</th><th>原因</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${list.map((c) => `<tr><td class="td-main">商户#${c.merchant_id}</td><td class="num">pass#${c.pass_id || '—'}</td>
      <td class="td-sub" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.payload)}</td>
      <td class="td-sub">${esc(c.reason)}</td><td class="td-sub">${String(c.offline_at || '').slice(0,16)}</td>
      <td>${ST[c.status] || c.status}</td>
      <td>${c.status === 0 ? `<button class="btn primary sm" onclick="conflictResolve(${c.id},'pass')">确认核销</button>
        <button class="btn danger sm" onclick="conflictResolve(${c.id},'reject')">驳回</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无离线冲突——断网核销恢复后自动入队')}</div>`
}
async function conflictResolve(id, action) {
  let note = null
  if (action === 'reject') note = prompt('驳回原因：') || '凭证异常'
  try { await api('POST', '/admin/verify/conflicts/' + id + '/resolve', { action, note }); toast('冲突已处理'); conflicts() } catch (e) { toast(e.message, true) }
}

'''
s = s.replace(anchor, views + anchor)

# ── 5. 商户进件审批 ──
old_mer = "      <td><span class=\"pill ${m.status === 1 ? 'ok' : 'warn'}\">${m.status === 1 ? '生效' : '进件中'}</span><div style=\"margin-top:4px\"><button class=\"btn ghost sm\" onclick=\"editMerchant(${m.id},'${esc(m.name)}','${esc(m.city_code)}','${esc(m.wxpay_sub_mchid || '')}')\">编辑</button></div></td>"
assert old_mer in s, 'merchant'
s = s.replace(old_mer, old_mer + "<div style=\"margin-top:4px\">${m.status === 0 ? `<button class=\"btn primary sm\" onclick=\"approveMerchant(${m.id})\">审批通过</button>` : ''}</div></td>")

# approveMerchant 函数（在 saveMerchantEdit 前插入）
old_fn = "async function saveMerchantEdit(id) {"
assert old_fn in s, 'fn'
s = s.replace(old_fn, "async function approveMerchant(id) {\n  try { await api('POST', '/admin/merchants/' + id + '/approve', {}); toast('商户进件已通过'); merchants() } catch (e) { toast(e.message, true) }\n}\n" + old_fn)

# ── 6. 结算异议处理 ──
old_settle = "${s.status === 0 ? `<button class=\"btn primary sm\" style=\"margin-left:10px\" onclick=\"confirmSettle(${s.id})\">复核通过并分账</button>` : ''}"
assert old_settle in s, 'settle'
new_settle = "${s.status === 0 ? `<button class=\"btn primary sm\" style=\"margin-left:10px\" onclick=\"confirmSettle(${s.id})\">复核通过并分账</button>` : ''}${s.status === 4 ? `<button class=\"btn ghost sm\" style=\"margin-left:10px\" onclick=\"resolveDispute(${s.id})\">处理异议</button>` : ''}"
s = s.replace(old_settle, new_settle)

# resolveDispute 函数（在 confirmSettle 前插入）
old_cs = "async function confirmSettle(id) {"
assert old_cs in s, 'cs'
s = s.replace(old_cs, "async function resolveDispute(id) {\n  const note = prompt('异议处理说明：', '商户已确认，异议解决') || '异议已处理'\n  try { await api('POST', '/admin/settlements/' + id + '/dispute', { note }); toast('异议已处理'); settlements() } catch (e) { toast(e.message, true) }\n}\n" + old_cs)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
