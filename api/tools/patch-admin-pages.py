# -*- coding: utf-8 -*-
import io

j = io.open('admin/app.js', encoding='utf-8').read()

# 图标与导航重组（五工作区）
old_icons = "const ICONS = {"
new_icons_block = """const ICONS = {
  sys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V4c4-2 8 2 12 0v9c-4 2-8-2-12 0"/></svg>',
  content: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16v14H4zM8 9h8M8 13h5"/></svg>',
  eco: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3c3 3.5 3 14.5 0 18M3.5 9h17M3.5 15h17"/></svg>',
  withdraw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5h.01M18 14.5h.01"/></svg>',"""
if old_icons in j:
    j = j.replace(old_icons, new_icons_block, 1)

old_nav = """const NAV = [
  ['经营', [['dash', '驾驶舱', 'dash']]],
  ['交易', [['orders', '订单', 'orders'], ['products', '商品与团期', 'products'], ['merchants', '商户', 'merchants'], ['settlements', '结算', 'settlements']]],
  ['生态', [['budgets', '旅豆预算', 'budgets'], ['promoters', '推广服务商', 'promoters']]],
  ['治理', [['config', '参数中心', 'config'], ['risk', '风控', 'risk'], ['audit', '审计日志', 'audit']]],
]"""
new_nav = """const NAV = [
  ['经营', [['dash', '驾驶舱', 'dash']]],
  ['交易', [['orders', '订单', 'orders'], ['products', '商品与团期', 'products'], ['settlements', '结算', 'settlements']]],
  ['生态', [['merchants', '商户与进件', 'merchants'], ['content', '内容审核', 'content'], ['promoters', '推广服务商', 'promoters'], ['withdrawals', '提现审批', 'withdraw'], ['agreements', '协议变更', 'eco'], ['budgets', '旅豆预算', 'budgets']]],
  ['治理', [['config', '参数中心', 'config'], ['risk', '风控', 'risk'], ['audit', '审计日志', 'audit']]],
  ['系统', [['system', '运维控制台', 'sys'], ['features', '功能开关', 'flag']]],
]"""
if old_nav in j:
    j = j.replace(old_nav, new_nav)

old_go = "const name = { dash: '驾驶舱', orders: '订单', products: '商品与团期', merchants: '商户', settlements: '结算',\n    budgets: '旅豆预算', promoters: '推广服务商', config: '参数中心', risk: '风控', audit: '审计日志' }[page]"
new_go = "const name = { dash: '驾驶舱', orders: '订单', products: '商品与团期', merchants: '商户与进件', settlements: '结算',\n    budgets: '旅豆预算', promoters: '推广服务商', config: '参数中心', risk: '风控', audit: '审计日志',\n    system: '运维控制台', features: '功能开关', content: '内容审核', withdrawals: '提现审批', agreements: '协议变更' }[page]"
if old_go in j:
    j = j.replace(old_go, new_go)

old_disp = ";({ dash, orders, products, merchants, settlements, budgets, promoters, config, risk, audit }[page] || dash)()"
new_disp = ";({ dash, orders, products, merchants, settlements, budgets, promoters, config, risk, audit, system, features, content, withdrawals, agreements }[page] || dash)()"
if old_disp in j:
    j = j.replace(old_disp, new_disp)

# 五个新页面函数（插在 boot() 之前）
pages_code = '''/* ============ 系统工作区：运维控制台 ============ */
async function system() {
  $('#app').innerHTML = `<div class="card">${skel(5)}</div>`
  const o = await api('GET', '/admin/system/overview')
  const sp = (ok, t, b) => ok ? '<span class="pill ok">● ' + t + '</span>' : '<span class="pill s70">● ' + b + '</span>'
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>系统健康</h2><span class="muted">SRE 控制台 · 手动干预均留审计</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">
      <div class="kpi"><div class="ico" style="background:${o.db.ok ? '#e3f6ec' : '#fdecec'}">🗄</div><div><div class="l">数据库</div><div class="v" style="font-size:18px">${o.db.latencyMs} ms</div><div class="s">${sp(o.db.ok, '正常', '异常')}</div></div></div>
      <div class="kpi"><div class="ico" style="background:${o.jobs.alive ? '#e3f6ec' : '#fdecec'}">⏱</div><div><div class="l">任务进程</div><div class="v" style="font-size:18px">${o.jobs.runCount} 轮</div><div class="s">${sp(o.jobs.alive, '存活', '心跳丢失')}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">⛓</div><div><div class="l">存证队列</div><div class="v" style="font-size:18px">${o.attestQueue.pending}</div><div class="s">已锚 ${o.attestQueue.anchored} · 失败 ${o.attestQueue.failed}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#f1e9fd">🧾</div><div><div class="l">支付单</div><div class="v" style="font-size:18px">${o.payment.ok}/${o.payment.total}</div><div class="s">成功/总数</div></div></div>
      <div class="kpi"><div class="ico" style="background:${o.ledger.perOk ? '#e3f6ec' : '#fdecec'}">⚖️</div><div><div class="l">账本试算</div><div class="v" style="font-size:18px">${o.ledger.credit}</div><div class="s">${sp(o.ledger.perOk && o.ledger.globalOk, '借贷平衡', '不平衡P0')}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">🧯</div><div><div class="l">滞留待付</div><div class="v" style="font-size:18px">${o.ordersHealth.stuckWaitPay30m}</div><div class="s">超30分钟未付</div></div></div>
    </div>
    <div class="row" style="margin-top:6px"><span class="muted">服务运行 ${Math.floor(o.service.uptimeSec / 60)} 分钟 · Node ${esc(o.service.node)} · 支付通道 ${esc(o.service.payMode)} · ${o.tables} 张表 · 幂等键 ${o.idempotencyKeys}</span></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>定时任务</h3>
      <div><button class="btn ghost sm" onclick="runJob('close-timeout')">执行关单</button>
      <button class="btn ghost sm" onclick="runJob('commission-due')">执行佣金到期</button></div></div>
    <table><thead><tr><th>任务</th><th>最近执行</th><th>状态</th><th>累计</th></tr></thead><tbody>
    ${(o.jobs.detail || []).map((jb) => `<tr><td class="td-main">${esc(jb.name)}</td>
      <td class="td-sub">${esc(String(jb.last_run_at).slice(0, 19))}</td>
      <td>${jb.last_status === 'ok' ? '<span class="pill ok">ok</span>' : '<span class="pill s70">fail</span>'}</td>
      <td class="num">${jb.run_count}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">任务进程未上报（未启动 jobs.mjs 时属正常）</td></tr>'}
    </tbody></table>
  </div>
  <div class="card">
    <div class="card-head"><h3>日志检索（订单事件 / 审计 / 核销联查）</h3></div>
    <div class="row" style="margin-top:0"><input id="logkw" placeholder="输入订单号 / 操作人 / passId" style="width:320px">
      <button class="btn primary sm" onclick="searchLogs()">检索</button></div>
    <div id="logout2" class="muted">一次输入同时检索订单状态机事件、后台审计与核销流水</div>
  </div>`
}
async function runJob(name) {
  try { const r = await api('POST', '/admin/system/jobs/' + name + '/run', {}); toast('已执行，影响 ' + r.affected + ' 条'); system() } catch (e) { toast(e.message, true) }
}
async function searchLogs() {
  const kw = document.getElementById('logkw').value.trim()
  const r = await api('GET', '/admin/system/logs?q=' + encodeURIComponent(kw))
  document.getElementById('logout2').innerHTML = `
    <h3 style="margin:8px 0">订单事件（${r.orderEvents.length}）</h3>
    ${r.orderEvents.length ? `<ul class="tl">${r.orderEvents.map((e) => `<li><div class="t">${esc(e.order_no)}：${ST[e.from_st] || e.from_st} → ${ST[e.to_st] || e.to_st}</div><div class="d">${esc(String(e.detail || '').replace(/"/g, ''))} · ${esc(e.actor)} · ${esc(String(e.created_at).slice(5, 19))}</div></li>`).join('')}</ul>` : '<p class="muted">无</p>'}
    <h3 style="margin:12px 0 8px">审计（${r.audits.length}）</h3>
    ${r.audits.length ? `<table>${r.audits.map((a) => `<tr><td class="td-sub">${esc(String(a.created_at).slice(5, 19))}</td><td>${esc(a.actor)}</td><td><b>${esc(a.module)}</b>·${esc(a.action)}</td><td class="td-sub">${esc(a.biz_ref || '')}</td></tr>`).join('')}</table>` : '<p class="muted">无</p>'}
    <h3 style="margin:12px 0 8px">核销流水（${r.verifies.length}）</h3>
    ${r.verifies.length ? `<table>${r.verifies.map((v) => `<tr><td>pass#${v.pass_id}</td><td>${['', '扫码', '输码', '补登'][v.method]}</td><td>${v.result === 1 ? '<span class="pill ok">成功</span>' : '<span class="pill s70">异常' + v.result + '</span>'}</td><td class="td-sub">${esc(String(v.created_at).slice(5, 19))}</td></tr>`).join('')}</table>` : '<p class="muted">无</p>'}`
}

/* ============ 功能开关（能力管理）============ */
async function features() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const rows = await api('GET', '/admin/features')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>功能开关</h2><span class="muted">4 角色 × 端 × 城市的能力开关 · SaaS 化与灰度的载体 · 即时生效并留审计</span></div>
    <table><thead><tr><th>能力</th><th>说明</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${rows.map((f) => `<tr><td><code>${esc(f.key)}</code></td><td class="td-sub">${esc(f.memo || '')}</td>
      <td>${f.on ? '<span class="pill ok">开启</span>' : '<span class="pill off">关闭</span>'}</td>
      <td><button class="btn ${f.on ? 'ghost' : 'primary'} sm" onclick="toggleFeature('${esc(f.key)}')">${f.on ? '关闭' : '开启'}</button></td></tr>`).join('')}
    </tbody></table>
    <p class="muted" style="margin-top:12px">扩展维度：feature.city.320508（苏州开城）· feature.promo（推广灰度）· 新主题小程序上线 = 新增 feature.channel.yoga</p>
  </div>`
}
async function toggleFeature(key) {
  try { const r = await api('POST', '/admin/features/' + key + '/toggle', {}); toast(r.key + ' → ' + (r.on ? '开启' : '关闭')); features() } catch (e) { toast(e.message, true) }
}

/* ============ 内容审核 ============ */
async function content() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const rows = await api('GET', '/admin/content')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>内容审核</h2><span class="muted">P0 笔记只读 · P1 开放发布后进入此队列（机审+人工）</span></div>
    ${rows.length ? `<table><thead><tr><th>作者</th><th>标题</th><th>内容</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
    ${rows.map((n) => `<tr><td>${esc(n.nickname)}</td><td class="td-main">${esc(n.title || '（无题）')}</td>
      <td class="td-sub" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(String(n.body).slice(0, 50))}</td>
      <td>${['<span class="pill warn">机审中</span>', '<span class="pill s20">人工审核</span>', '<span class="pill ok">已发布</span>', '<span class="pill s70">已驳回</span>', '<span class="pill off">已下架</span>'][n.status]}</td>
      <td class="td-sub">${esc(String(n.created_at).slice(5, 16))}</td>
      <td>${[0, 1].includes(n.status) ? `<button class="btn primary sm" onclick="verdict('content', ${n.id}, true)">通过</button>
        <button class="btn danger sm" onclick="verdict('content', ${n.id}, false)">驳回</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('暂无待审内容（P1 开放笔记发布后进入此队列）')}
  </div>`
}

/* ============ 提现审批（资金出口）============ */
async function withdrawals() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/withdrawals')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>推广服务费提现审批</h2><span class="muted">资金出口 · 财务角色审批 · 打款流水必填留痕</span></div>
    ${rows.length ? `<table><thead><tr><th>申请号</th><th>推广员</th><th>金额</th><th>备注</th><th>状态</th><th>审批</th><th>操作</th></tr></thead><tbody>
    ${rows.map((w) => `<tr><td class="num">#${w.id}</td><td>${esc(w.nickname)}<div class="td-sub">ID ${w.promoter_id}</div></td>
      <td class="money num">${fen(w.amount)}</td><td class="td-sub">${esc(w.proposer_note || '')}</td>
      <td>${['<span class="pill warn">待审</span>', '<span class="pill ok">已打款</span>', '<span class="pill s70">已驳回</span>'][w.status]}</td>
      <td class="td-sub">${esc(w.reviewed_by || '—')}${w.pay_ref ? '<div>' + esc(w.pay_ref) + '</div>' : ''}</td>
      <td>${w.status === 0 ? `<button class="btn primary sm" onclick="approveWithdraw(${w.id}, true)">通过并打款</button>
        <button class="btn danger sm" onclick="approveWithdraw(${w.id}, false)">驳回</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('暂无提现申请（推广员在小程序 A「推广中心」发起）')}
  </div>`
}
async function approveWithdraw(id, pass) {
  const payRef = pass ? prompt('打款流水号（商家转账单号）：', 'BANK-' + Date.now()) : null
  if (pass && !payRef) return
  try { await api('POST', '/admin/withdrawals/' + id + '/verdict', { pass, payRef }); toast(pass ? '已打款并留痕' : '已驳回'); withdrawals() } catch (e) { toast(e.message, true) }
}

/* ============ 协议变更 ============ */
async function agreements() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/agreements')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商户协议变更</h2><span class="muted">生效即重算五口径分账 · 财务审批</span></div>
    ${rows.length ? `<table><thead><tr><th>商户</th><th>科目</th><th>变更</th><th>理由</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="td-main">${esc(a.merchant_name)}</td><td><code>${esc(a.item_code)}</code></td>
      <td><span class="diff-old">${fen(a.old_price)}</span> → <span class="diff-new">${fen(a.new_price)}</span></td>
      <td class="td-sub">${esc(a.reason || '')}</td>
      <td>${['<span class="pill warn">待审</span>', '<span class="pill ok">生效</span>', '<span class="pill s70">驳回</span>'][a.status]}</td>
      <td>${a.status === 0 ? `<button class="btn primary sm" onclick="verdict('agreements', ${a.id}, true)">同意</button>
        <button class="btn danger sm" onclick="verdict('agreements', ${a.id}, false)">驳回</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('暂无协议变更申请（商户端小程序 B 发起）')}
  </div>`
}
async function verdict(kind, id, pass) {
  try { await api('POST', `/admin/${kind}/${id}/verdict`, { pass }); toast(pass ? '已通过' : '已驳回'); kind === 'content' ? content() : agreements() } catch (e) { toast(e.message, true) }
}

'''
assert "\nboot()" in j
j = j.replace("\nboot()", "\n" + pages_code + "boot()", 1)
io.open('admin/app.js', 'w', encoding='utf-8', newline='\n').write(j)
print('five workspace pages added')
