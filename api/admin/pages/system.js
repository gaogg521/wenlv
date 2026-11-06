// 系统设置：参数中心、风控/审计、运维控制台、功能开关、安全中心、集成中心
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

/* ============ 参数中心 ============ */
let cfgGroup = 'bean'
async function config() {
  $('#app').innerHTML = `<div class="card">${skel(6)}</div>`
  const rows = await api('GET', '/admin/config')
  window.__cfgNames = Object.fromEntries(rows.map(r => [r.k, r.name]))
  const groups = {}
  rows.forEach((r) => (groups[r.group_name] = groups[r.group_name] || []).push(r))
  const GNAMES = { bean: '旅豆', member: '会员', promoter: '推广', contribution: '贡献分', order: '订单', pass: '核销', settlement: '结算', cost: '成本控制', channel: '城市与频道', feature: '功能开关', security: '安全' }
  const items = groups[cfgGroup] || []
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>参数中心</h2><span class="muted">代码零硬编码 · 敏感参数双人复核 · 版本可回滚</span></div>
    <div class="cfg-tabs">${Object.keys(groups).map((g) => `<div class="cfg-tab ${cfgGroup === g ? 'on' : ''}" onclick="cfgGroup='${g}';config()">${GNAMES[g] || g}</div>`).join('')}</div>
    ${items.length ? `<table><thead><tr><th>参数名称</th><th>参数键</th><th>当前值</th><th>说明</th><th>复核</th><th>最近变更</th><th></th></tr></thead><tbody>
    ${items.map((r) => `<tr><td class="td-main">${esc(r.name || r.memo || '自定义参数（待补名称）')}</td><td><code>${esc(r.k)}</code></td><td><b>${esc(r.v)}</b></td>
      <td class="td-sub">${esc(r.memo || '')}</td>
      <td>${Number(r.sensitive) ? '<span class="pill warn">双人复核</span>' : '<span class="pill off">直接生效</span>'}</td>
      <td class="td-sub">${esc(String(r.updated_at).slice(5, 16))}${r.updated_by ? ' · ' + esc(r.updated_by) : ''}</td>
      <td><button class="btn ghost sm" onclick="cfgEdit('${escJs(r.k)}', '${escJs(String(r.v))}')">修改</button></td></tr>`).join('')}</tbody></table>` : emptyBox('该分组暂无参数')}
  </div>`
}
function cfgEdit(k, v) {
  modal('修改参数 · ' + esc(window.__cfgNames?.[k] || k) + ' <code>' + esc(k) + '</code>', `
    <div style="margin-bottom:12px">当前值：<code>${esc(v)}</code> → 新值：
    <input id="cfg_new" value="${esc(v)}" style="width:100%;margin-top:8px;padding:9px 12px;border:1.5px solid var(--line);border-radius:9px"></div>
    <input id="cfg_reason" placeholder="修改原因（必填，将写入审计）" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:9px">
    <div id="cfg_hint" class="muted" style="margin-top:10px"></div>`,
    `<button class="btn ghost" onclick="cfgHistory('${escJs(k)}')">变更历史</button>
     <button class="btn ghost" onclick="closeModal()">取消</button>
     <button class="btn primary" onclick="cfgPropose('${escJs(k)}')">提交提案</button>`)
}
async function cfgPropose(k) {
  const reason = $('#cfg_reason').value.trim()
  if (!reason) return toast('必须填写修改原因', true)
  try {
    const r = await api('POST', '/admin/config/proposal', { key: k, newValue: $('#cfg_new').value, reason })
    closeModal()
    toast('提案 #' + r.historyId + ' 已提交' + (r.sensitive ? '，需另一账号审批生效' : '，可由财务/超管审批生效') +
      (r.preview ? `｜近30日 ${r.preview.orders30d} 单：返豆 ${r.preview.beanOld} → ${r.preview.beanNew}` : ''))
    config()
  } catch (e) { toast(e.message, true) }
}
async function cfgHistory(k) {
  const rows = await api('GET', '/admin/config/history?key=' + encodeURIComponent(k))
  modal('变更历史 <code>' + k + '</code>',
    rows.length ? `<table><thead><tr><th>时间</th><th>变更</th><th>提案 → 审批</th><th>状态</th></tr></thead><tbody>
    ${rows.map((h) => `<tr><td class="td-sub">${esc(String(h.created_at).slice(5, 16))}</td>
      <td><span class="diff-old">${esc(h.old_value)}</span> → <span class="diff-new">${esc(h.new_value)}</span></td>
      <td class="td-sub">${esc(h.proposer)} → ${esc(h.approver || '待批')}</td>
      <td>${['<span class="pill warn">待审</span>' + (ME.role !== 'ops' ? ` <button class="btn primary sm" onclick="cfgApprove(${h.id})">审批生效</button>` : ''), '<span class="pill ok">生效</span>', '<span class="pill s70">驳回</span>', '<span class="pill off">回滚</span>'][h.status]}</td></tr>`).join('')}
    </tbody></table>
    <div class="row" style="margin-top:14px"><button class="btn ghost sm" onclick="cfgRollback('${escJs(k)}')">↩ 回滚到上一版本</button></div>`
    : emptyBox('无变更记录'),
    `<button class="btn ghost" onclick="closeModal()">关闭</button>`)
}
async function cfgApprove(id) {
  try { await api('POST', '/admin/config/approve', { historyId: id }); toast('参数已生效'); closeModal(); config() } catch (e) { toast(e.message, true) }
}
async function cfgRollback(k) {
  try { const r = await api('POST', '/admin/config/rollback', { key: k }); toast('已回滚，恢复为 ' + r.restored) } catch (e) { toast(e.message, true) }
}


/* ============ 风控 / 审计 ============ */
// 风控事件：库里存的是英文代码，页面上先看中文名与一句话说明，原始代码退到小字（便于排查 / 对日志）
const RISK_KIND_CN = {
  device_cluster: ['设备聚集', '同一设备短时间内登录或切换多个账号'],
  verify_replay: ['核销码异常重放', '核销码被暴力枚举或重复使用'],
  refund_abuse: ['退款滥用', '短时间内频繁下单后申请退款'],
  commission_anomaly: ['佣金异常', '推广佣金出现自购、刷单等嫌疑'],
  anchor_fail: ['存证锚定失败', '链上回执校验失败，需人工核对'],
  attest_anchor_failed: ['存证锚定失败', '批次多次重试仍未能上链锚定'],
  attest_reconcile_failed: ['存证对账不一致', '六条不变式对账有未通过的检查项'],
}
const RISK_KEY_CN = { reason: '原因', batchId: '批次', attempt: '重试次数', err: '错误信息', name: '检查项', ok: '是否通过', msg: '说明', message: '说明', userId: '用户', orderNo: '订单号', count: '次数' }
const riskKindHtml = (k) => RISK_KIND_CN[k]
  ? `<span class="pill off">${RISK_KIND_CN[k][0]}</span><div class="td-sub">${RISK_KIND_CN[k][1]}</div><div class="td-sub" style="opacity:.55">${esc(k)}</div>`
  : `<span class="pill off">${esc(k)}</span><div class="td-sub">未登记的类型</div>`
function riskDetailHtml(raw) { // detail 是 JSON：先给原因，其余字段按「名称：值」列出
  let d = raw
  if (typeof d === 'string') { try { d = JSON.parse(d) } catch { return `<span>${esc(d.slice(0, 80))}</span>` } }
  if (d == null || d === '') return '<span class="td-sub">—</span>'
  const val = (v) => v === true ? '是' : v === false ? '否' : typeof v === 'object' ? esc(JSON.stringify(v).slice(0, 60)) : esc(String(v).slice(0, 80))
  const one = (o) => {
    if (o == null || typeof o !== 'object') return esc(String(o))
    const rest = Object.entries(o).filter(([k]) => k !== 'reason' && k !== 'demo')
    return (o.reason ? `<div>${esc(String(o.reason))}</div>` : '')
      + (rest.length ? `<div class="td-sub">${rest.map(([k, v]) => `${esc(RISK_KEY_CN[k] || k)}：${val(v)}`).join(' · ')}</div>` : '')
      + (o.demo ? '<span class="pill off">演示数据</span>' : '')
  }
  if (Array.isArray(d)) return d.length ? d.slice(0, 3).map(one).join('<div style="border-top:1px dashed #eee;margin:5px 0"></div>') + (d.length > 3 ? `<div class="td-sub">… 共 ${d.length} 项</div>` : '') : '<span class="td-sub">—</span>'
  return one(d)
}
window.riskClearKw = () => { window.__riskQ.kw = ''; window.__riskQ.page = 1; risk() }
async function risk() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  // T03/T10：服务端分页 + 处理状态筛选
  window.__riskQ = window.__riskQ || { page: 1, handled: '', kw: '' }
  const data = await api('GET', '/admin/risk?' + new URLSearchParams({ page: window.__riskQ.page, handled: window.__riskQ.handled, kw: window.__riskQ.kw || '' }).toString())
  const rows = data.rows
  const rkPages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const hasRiskKw = !!(window.__riskQ.kw || '').trim()
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h2>风控事件</h2><span class="muted">核销重放 / 设备聚集 / 退款滥用 / 佣金异常</span></div>
    <div class="orders-search"><label for="riskKw" class="muted">搜索事件</label><input id="riskKw" type="search" value="${esc(window.__riskQ.kw || '')}" placeholder="事件类型（如 attest）或说明文字" style="max-width:320px"><button class="btn primary sm" onclick="window.__riskQ.kw=document.getElementById('riskKw').value.trim();window.__riskQ.page=1;risk()">查询</button>${hasRiskKw ? '<button class="btn ghost sm" onclick="riskClearKw()">清除</button>' : ''}</div>
    <div class="cfg-tabs">${[['', '全部'], [0, '未处理'], [1, '已处理']].map(([v, n]) => `<button class="cfg-tab ${String(window.__riskQ.handled) === String(v) ? 'on' : ''}" onclick="window.__riskQ.handled='${v}';window.__riskQ.page=1;risk()">${n}</button>`).join('')}</div>
    ${rows.length ? `<table><thead><tr><th>类型</th><th>级别</th><th>详情</th><th>时间</th><th>状态</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${riskKindHtml(r.kind)}</td>
      <td>${r.severity >= 3 ? '<span class="pill s70">高</span>' : r.severity === 2 ? '<span class="pill warn">中</span>' : '<span class="pill off">低</span>'}</td>
      <td>${riskDetailHtml(r.detail)}</td>
      <td class="td-sub">${esc(String(r.created_at).slice(5, 16))}</td>
      <td>${r.handled ? '<span class="pill ok">已处理</span>' : `<button class="btn ghost sm" onclick="handleRisk(${r.id})">处理（填结论）</button> <button class="btn danger sm" onclick="caseFromEvent(${r.id}, ${Number(r.user_id) || 0})">升级为案件</button>`}</td></tr>`).join('')}</tbody></table>` : emptyBox(hasRiskKw || window.__riskQ.handled !== '' ? '没有符合条件的风控事件——试试清除关键词或切换处理状态。' : '暂无风控事件 🎉')}
    <div class="pagination"><span>共 ${Number(data.total).toLocaleString()} 条 · 第 ${data.page} / ${rkPages} 页</span><div><button class="btn ghost sm" ${data.page <= 1 ? 'disabled' : ''} onclick="window.__riskQ.page--;risk()">上一页</button> <button class="btn ghost sm" ${data.page >= rkPages ? 'disabled' : ''} onclick="window.__riskQ.page++;risk()">下一页</button></div></div>
  </div>`
}
async function audit() {
  $('#app').innerHTML = `<div class="card">${skel(6)}</div>`
  window.__auditQ = window.__auditQ || { page: 1, kw: '', module: '' }
  const Q = window.__auditQ
  const d = await api('GET', '/admin/audit-logs?' + new URLSearchParams({ page: Q.page, kw: Q.kw, module: Q.module, pageSize: 30 }).toString())
  const rows = d.rows
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize))
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h2>操作审计</h2><span class="muted">只增不改 · 每次写操作前后快照 · 共 ${Number(d.total).toLocaleString()} 条</span></div>
    <form class="orders-search" onsubmit="event.preventDefault();window.__auditQ.kw=this.kw.value.trim();window.__auditQ.module=this.module.value;window.__auditQ.page=1;audit()">
      <input name="kw" type="search" value="${esc(Q.kw)}" placeholder="操作人 / 模块 / 动作 / 对象">
      <select name="module"><option value="">全部模块</option>${['order', 'user', 'content', 'account', 'security', 'risk-case', 'config', 'settlement', 'withdraw', 'bean', 'badge', 'chain', 'integration', 'vc', 'merchant', 'product'].map((m) => `<option value="${m}" ${Q.module === m ? 'selected' : ''}>${auditModuleCn(m)}（${m}）</option>`).join('')}</select>
      <button class="btn primary" type="submit">查询</button>
      ${Q.kw || Q.module ? '<button class="btn ghost" type="button" onclick="window.__auditQ={page:1,kw:\'\',module:\'\'};audit()">重置</button>' : ''}</form>
    ${rows.length ? `<table><thead><tr><th>时间</th><th>操作人</th><th>模块 / 动作</th><th>对象</th><th>变更</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="td-sub num">${esc(String(a.created_at).slice(5, 19))}</td><td>${esc(a.actor)}</td>
      <td><b>${esc(auditModuleCn(a.module))}</b> · ${esc(auditActionCn(a.action))}<div class="td-sub">${esc(a.module)} / ${esc(a.action)}</div></td><td class="td-sub">${esc(a.biz_ref || '')}</td>
      <td>${auditDiff(a.before_val, a.after_val)}</td></tr>`).join('')}</tbody></table>
    <div class="pagination"><span>第 ${d.page} / ${pages} 页</span><div class="pagination-actions">
      <button class="btn ghost sm" ${d.page <= 1 ? 'disabled' : ''} onclick="window.__auditQ.page--;audit()">上一页</button>
      <button class="btn ghost sm" ${d.page >= pages ? 'disabled' : ''} onclick="window.__auditQ.page++;audit()">下一页</button></div></div>`
    : emptyBox(Q.kw || Q.module ? '没有符合条件的审计记录' : '暂无操作记录')}
  </div>`
}


/* ============ 系统工作区：运维控制台 ============ */
async function system() {
  $('#app').innerHTML = `<div class="card">${skel(5)}</div>`
  const o = await api('GET', '/admin/system/overview')
  const sp = (ok, t, b) => ok ? '<span class="pill ok">● ' + t + '</span>' : '<span class="pill s70">● ' + b + '</span>'
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>系统健康</h2><span class="muted">SRE 控制台 · 手动干预均留审计</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="ico" style="background:${o.db.ok ? '#e3f6ec' : '#fdecec'}">🗄</div><div><div class="l">数据库</div><div class="v" style="font-size:18px">${o.db.latencyMs} ms</div><div class="s">${sp(o.db.ok, '正常', '异常')}</div></div></div>
      <div class="kpi go" ${dxKey} title="定位到定时任务" onclick="document.getElementById('sysJobs').scrollIntoView({behavior:'smooth'})"><i class="go-arrow">↗</i><div class="ico" style="background:${o.jobs.alive ? '#e3f6ec' : '#fdecec'}">⏱</div><div><div class="l">任务进程</div><div class="v" style="font-size:18px">${o.jobs.runCount} 轮</div><div class="s">${sp(o.jobs.alive, '存活', '心跳丢失')}</div></div></div>
      <div class="kpi go" ${dxKey} title="去存证中心" onclick="go('attest')"><i class="go-arrow">↗</i><div class="ico" style="background:#e8effd">⛓</div><div><div class="l">存证队列</div><div class="v" style="font-size:18px">${o.attestQueue.pending}</div><div class="s">已锚 ${o.attestQueue.anchored} · 失败 ${o.attestQueue.failed}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#f1e9fd">🧾</div><div><div class="l">支付单</div><div class="v" style="font-size:18px">${o.payment.ok}/${o.payment.total}</div><div class="s">成功/总数</div></div></div>
      <div class="kpi"><div class="ico" style="background:${o.ledger.perOk ? '#e3f6ec' : '#fdecec'}">⚖️</div><div><div class="l">账本试算</div><div class="v" style="font-size:18px">${o.ledger.credit}</div><div class="s">${sp(o.ledger.perOk && o.ledger.globalOk, '借贷平衡', '不平衡P0')}</div></div></div>
      <div class="kpi go" ${dxKey} title="查看待支付订单" onclick="dxGo('orders',{status:'10'})"><i class="go-arrow">↗</i><div class="ico" style="background:#fdf3e0">🧯</div><div><div class="l">滞留待付</div><div class="v" style="font-size:18px">${o.ordersHealth.stuckWaitPay30m}</div><div class="s">超30分钟未付</div></div></div>
    </div>
    ${o.mfaChannels ? `<div class="row" style="margin-top:6px"><span class="muted">验证码通道</span> 短信 ${mfaChanState(o.mfaChannels.sms)} 邮箱 ${mfaChanState(o.mfaChannels.email)} <button class="btn ghost sm" onclick="go('integrations')">去配置 →</button></div>` : ''}
    <div class="row" style="margin-top:6px"><span class="muted">服务运行 ${Math.floor(o.service.uptimeSec / 60)} 分钟 · Node ${esc(o.service.node)} · 支付通道 ${esc(o.service.payMode)} · ${o.tables} 张表 · 幂等键 ${o.idempotencyKeys}</span></div>
    ${o.secrets ? `<div class="row" style="margin-top:4px"><span class="muted">凭据主密钥：${o.secrets.keySource === 'env' ? '<span class="pill ok">SECRETS_KEY</span>' : '<span class="pill warn">由 JWT_SECRET 派生</span> 生产环境请运行 <code>node scripts/secrets-key.mjs current</code> 并设为 SECRETS_KEY'} · 已存 ${o.secrets.stored} 条${o.secrets.undecryptable.length ? ` · <span class="pill err">${o.secrets.undecryptable.length} 条无法解密：${o.secrets.undecryptable.map(esc).join('、')}</span>` : ''}</span></div>` : ''}
  </div>
  <div class="card">
    <div class="card-head" id="sysJobs"><h3>定时任务</h3>
      <div>
        ${adminCan('system.jobRun') ? `<button class="btn ghost sm" onclick="runJob('close-timeout')">关单</button>
        <button class="btn ghost sm" onclick="runJob('commission-due')">佣金到期</button>
        <button class="btn ghost sm" onclick="runJob('complete-due')">完成到期单</button>
        <button class="btn ghost sm" onclick="runJob('attest-pack','attest')">存证打包</button>
        <button class="btn ghost sm" onclick="runJob('bean-expire')">豆过期</button>` : '<span class="muted">手动任务干预由超级管理员或运维执行</span>'}
      </div></div>
    <div class="row" style="margin-top:4px"><span class="muted">迁移脚本：${(o.migrations || []).map((m) => '<code>' + esc(m) + '</code>').join(' ')}</span></div>
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
async function runJob(name, thenPage) {
  try {
    const r = await api('POST', '/admin/system/jobs/' + name + '/run', {})
    toast('已执行，影响 ' + r.affected + ' 条')
    // 跑完停在原地更符合直觉：存证中心点的按钮，回到存证中心而不是跳到运维控制台
    const back = thenPage || 'system'
    if (typeof window[back] === 'function') window[back](); else system()
  } catch (e) { toast(e.message, true) }
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
      <td><button class="btn ${f.on ? 'ghost' : 'primary'} sm" onclick="toggleFeature('${escJs(f.key)}')">${f.on ? '关闭' : '开启'}</button></td></tr>`).join('')}
    </tbody></table>
    <p class="muted" style="margin-top:12px">扩展维度：feature.city.320508（苏州开城）· feature.promo（推广灰度）· 新主题小程序上线 = 新增 feature.channel.yoga</p>
  </div>`
}
async function toggleFeature(key) {
  try { const r = await api('POST', '/admin/features/' + key + '/toggle', {}); toast(r.key + ' → ' + (r.on ? '开启' : '关闭')); features() } catch (e) { toast(e.message, true) }
}


/* ============ 安全中心（MFA / 通知通道）============ */
async function security() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const accounts = await api('GET', '/admin/security/accounts')
  const codes = await api('GET', '/admin/security/recent-codes')
  const chn = await api('GET', '/admin/security/channels')
  window.__mfaAfter = security // 绑定/停用完成后刷新的页面（从后台账号页进入时会改成 accounts）
  const MODE_CARDS = [
    ['off', '关闭', '所有账号登录都不要求两步验证（已绑定的也不再询问）'],
    ['optional', '可选模式', '已绑定 MFA 的账号登录需两步验证；未绑定的不要求'],
    ['required', '强制模式', '所有账号（除豁免）登录都要求两步验证；未绑定的进入绑定引导'],
  ]
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>登录二次认证（全局策略）</h2><button class="btn ghost sm" onclick="go('accounts')">去后台账号管理 →</button></div>
    <p class="td-sub">当前生效：<b>${({ off: '关闭', optional: '可选模式', required: '强制模式' })[chn.mode] || esc(chn.mode)}</b> · 全局策略是敏感参数，切换需另一位超级管理员在「参数中心 → 参数审批」复核后生效</p>
    ${chn.pendingReview ? `<p class="td-sub" style="color:var(--red)">⏳ 待复核提案：${({ off: '关闭', optional: '可选模式', required: '强制模式' })[chn.pendingReview.newValue] || esc(chn.pendingReview.newValue)}（提案人 ${esc(chn.pendingReview.proposer)}）——请另一位超级管理员到参数中心处理</p>` : ''}
    <div class="row" style="margin:10px 0;align-items:stretch">${MODE_CARDS.map(([v, n, d]) => `
      <div class="card" style="flex:1;margin:0;${chn.mode === v ? 'border:2px solid var(--brand);' : ''}cursor:pointer" onclick="mfaModeSet('${v}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')mfaModeSet('${v}')">
        <b>${n}</b> ${chn.mode === v ? '<span class="pill ok">当前</span>' : ''}<div class="td-sub" style="margin-top:6px">${d}</div>
      </div>`).join('')}</div>
  </div>
  <div class="card">
    <div class="card-head"><h2>验证方式与通道</h2><span class="muted">单账号豁免/强制在「后台账号 → 验证方式」或下表操作</span></div>
    ${mfaChannelPanel(chn)}
  </div>
  <div class="card">
    <div class="card-head"><h2>安全中心 · MFA</h2><span class="muted">TOTP / 短信 / 邮箱三通道 · 单账号强制 &gt; 豁免 &gt; 全局策略</span></div>
    <table><thead><tr><th>账号</th><th>角色</th><th>MFA 状态</th><th>手机/邮箱</th><th>最近登录</th><th>操作</th></tr></thead><tbody>
    ${accounts.map((a2) => `<tr><td class="td-main">${esc(a2.display_name || a2.username)}<div class="td-sub">${esc(a2.username)}</div></td>
      <td>${ACCOUNT_ROLE_CN[a2.role] || esc(a2.role)}</td>
      <td>${Number(a2.mfa_enabled) ? '<span class="pill ok">已绑定 · ' + (({ totp: '验证器 App', sms: '短信', email: '邮箱' })[a2.mfa_channel] || esc(a2.mfa_channel)) + '</span>' : '<span class="pill off">未绑定</span>'}
        ${Number(a2.mfa_force) ? '<span class="pill s70">单账号强制</span>' : ''}${Number(a2.mfa_exempt) ? '<span class="pill s40">豁免</span>' : ''}</td>
      <td class="td-sub">${esc(a2.mobile || a2.email || '—')}</td>
      <td class="td-sub">${esc(String(a2.last_login_at || '').slice(5, 16))}</td>
      <td><button class="btn ghost sm" onclick="mfaSetup(${a2.id}, '${escJs(a2.username)}')">开 TOTP</button>
          <button class="btn ghost sm" onclick="bindContact(${a2.id}, 'sms')">绑手机</button>
          <button class="btn ghost sm" onclick="bindContact(${a2.id}, 'email')">绑邮箱</button>
          <button class="btn ghost sm" onclick="mfaFlagsHere(${a2.id}, { exempt: ${Number(a2.mfa_exempt) ? 0 : 1} })">${Number(a2.mfa_exempt) ? '取消豁免' : '设为豁免'}</button>
          <button class="btn ghost sm" onclick="mfaFlagsHere(${a2.id}, { force: ${Number(a2.mfa_force) ? 0 : 1} })">${Number(a2.mfa_force) ? '取消单账号强制' : '单账号强制'}</button>
          ${Number(a2.mfa_enabled) ? `<button class="btn danger sm" onclick="mfaDisable(${a2.id})">停用</button>` : ''}</td></tr>`).join('')}
    </tbody></table>
  </div>
  <div class="card">
    <div class="card-head"><h3>最近验证码（MOCK 通道演示用）</h3><span class="muted">真实短信/邮箱凭据接入后此表为空，仅日志留痕</span></div>
    ${codes.length ? `<table><thead><tr><th>目标</th><th>通道</th><th>验证码</th><th>用途</th><th>状态</th><th>时间</th></tr></thead><tbody>
    ${codes.map((c3) => `<tr><td>${esc(c3.target)}</td><td>${esc(c3.channel)}</td><td><code>${esc(c3.code)}</code></td><td class="td-sub">${esc(c3.purpose)}</td>
      <td>${c3.used_at ? '<span class="pill off">已用</span>' : (new Date(c3.expires_at) > new Date() ? '<span class="pill ok">有效</span>' : '<span class="pill s70">过期</span>')}</td>
      <td class="td-sub">${esc(String(c3.created_at).slice(5, 19))}</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无验证码记录')}
  </div>`
}
// 通道状态（M-03 五态）：配置齐全 ≠ 已验证可送达——verified 只能由真实发送测试/自然发送产生
const MFA_STATE_CN = {
  unconfigured: '<span class="pill off">● 未配置</span>',
  mock: '<span class="pill warn">● 模拟发送（MOCK）</span>',
  ready: '<span class="pill s20">● 已配置·待联调</span>',
  verified: '<span class="pill ok">● 最近联调通过</span>',
  fault: '<span class="pill s70">● 最近发送故障</span>',
}
const mfaChanState = (c) => MFA_STATE_CN[c.state] || (c.deliverable ? '<span class="pill ok">● 可用</span>'
  : c.configured ? '<span class="pill warn">● 凭据已配置，发送器尚未接入</span>' : '<span class="pill warn">● 未配置</span>')
// 发送测试（M-03）：真实发一条到指定目标并记录结果；只存脱敏目标
window.mfaProbeModal = (channel) => {
  const name = channel === 'sms' ? '短信' : '邮箱'
  modal('真实发送测试 · ' + name, `
    <p class="td-sub">将向下方目标真实发送一条验证码并记录受理结果（脱敏入审计）。注意：服务商受理 ≠ 收件端已收到；请确认收到并完成一次校验后才视为真实收件通过。</p>
    <div class="field"><label>测试收件目标（真实${name === '短信' ? '手机号' : '邮箱地址'}）</label><input id="mfaProbeTarget" placeholder="${name === '短信' ? '例如 13800000000' : '例如 ops@example.com'}"></div>
    <div id="mfaProbeErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="mfaProbeSubmit('${channel}')">发送测试</button>`)
}
window.mfaProbeSubmit = async (channel) => {
  const target = ($('#mfaProbeTarget').value || '').trim()
  if (!target) { $('#mfaProbeErr').textContent = '请填写测试收件目标'; return }
  try {
    const r = await api('POST', `/admin/security/channels/${channel}/test`, { target })
    modal('测试已发起', `<p>${esc(r.note)}</p><p class="td-sub">当前通道状态：${mfaChanState({ state: r.state })}${r.lastProbe ? `<br>最近测试：${esc(r.lastProbe.target_masked)} · ${esc(String(r.lastProbe.created_at || '').slice(0, 19))} · ${Number(r.lastProbe.result) === 1 ? '受理成功' : '失败'}` : ''}</p>`,
      `<button class="btn primary" onclick="closeModal();security()">知道了</button>`)
  } catch (e) { $('#mfaProbeErr').textContent = e.message }
}
// C-02：全局三档切换（D-02：admin.mfa.mode 是敏感参数——提交提案，第二人复核后生效，不直接改）
window.mfaModeSet = (mode) => {
  const names = { off: '关闭', optional: '可选模式', required: '强制模式' }
  const impacts = {
    off: '切换后：所有账号登录不再要求两步验证；已绑定的也不再询问。',
    optional: '切换后：已绑定 MFA 的账号登录需两步验证；未绑定的不要求。',
    required: '切换后：所有账号（除豁免）登录都要求两步验证；未绑定的登录时进入绑定引导。',
  }
  modal('切换全局 MFA 策略 · ' + names[mode], `
    <p>${impacts[mode]}</p>
    <div class="field"><label>变更原因（进入参数审批记录）</label><input id="mfaModeReason" maxlength="200" placeholder="例如：安全整改要求全员两步验证"></div>
    <p class="td-sub">全局 MFA 策略是敏感参数：提交后需<b>另一位超级管理员</b>在「参数中心 → 参数审批」通过才生效；策略生效后各账号按「单账号强制 &gt; 豁免 &gt; 全局策略」执行。</p>
    <div id="mfaModeErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="mfaModeSubmit('${mode}')">提交策略变更提案</button>`)
}
window.mfaModeSubmit = async (mode) => {
  try {
    const r = await api('POST', '/admin/security/mfa-mode', { mode, reason: ($('#mfaModeReason').value || '').trim() })
    modal('提案已提交', `<p>${esc(r.note)}</p>`, `<button class="btn primary" onclick="closeModal();security()">知道了</button>`)
  } catch (e) { $('#mfaModeErr').textContent = e.message }
}
// 安全中心内的单账号豁免/强制（与账号页共用同一接口；完成后刷新本页）
window.mfaFlagsHere = async (id, patch) => {
  try {
    const r = await api('POST', `/admin/accounts/${id}/mfa-flags`, patch)
    toast(r.note || '已调整'); security()
  } catch (e) { toast(e.message, true) }
}
const mfaChanHint = (c) => c.deliverable || c.state === 'verified' ? '凭据齐全，走真实发送程序' : c.state === 'mock' ? '未真实送达：验证码只显示在安全中心「最近验证码」（MOCK，仅演示/联调）' : c.state === 'ready' ? '凭据已保存，但尚未完成一次真实发送联调' : c.state === 'fault' ? '最近一次真实发送失败，请检查凭据/网络后重试' : '未配置：请先在集成中心保存凭据'
const mfaProbeLine = (c) => c.lastProbe ? `<div>最近测试：${esc(c.lastProbe.target_masked)} · ${esc(String(c.lastProbe.created_at || '').slice(0, 19))} · ${Number(c.lastProbe.result) === 1 ? '<span class="pill ok">受理成功</span>' : '<span class="pill s70">失败</span>'}${c.lastProbe.detail ? `<div class="td-sub">${esc(c.lastProbe.detail)}</div>` : ''}</div>` : ''
const testBtn = (ch, c) => c.configured && ADMIN_CAPABILITIES.role === 'super' ? `<button class="btn ghost sm" onclick="mfaProbeModal('${ch}')">发送测试</button>` : (c.configured ? '' : cfgBtn())
const cfgBtn = () => `<button class="btn ghost sm" onclick="closeModal();go('integrations')">去集成中心配置 →</button>`
function mfaChannelPanel(chn) {
  const row = (name, hint, state, go) => `<tr><td class="td-main" style="width:180px">${name}</td><td>${state}</td><td class="td-sub">${hint}</td><td style="text-align:right">${go || ''}</td></tr>`
  return `<table><tbody>
    ${row('验证器 App（TOTP）', 'Microsoft / Google Authenticator 等，无需任何配置', mfaChanState(chn.totp), '')}
    ${row('短信验证码', mfaChanHint(chn.sms) + mfaProbeLine(chn.sms), mfaChanState(chn.sms), testBtn('sms', chn.sms))}
    ${row('邮箱验证码', mfaChanHint(chn.email) + mfaProbeLine(chn.email), mfaChanState(chn.email), testBtn('email', chn.email))}
  </tbody></table><p class="td-sub" style="margin-top:8px">状态口径：未配置 / 模拟发送（MOCK，仅演示联调，不作为真实双因素证据）/ 已配置·待联调 / 最近联调通过 / 最近发送故障。「最近联调通过」表示服务商受理了一次真实发送，收件端确认仍以最近测试记录与实际收件为准。</p>`
}
async function mfaSetup(userId, username) {
  const r = await api('POST', '/admin/security/mfa/setup', { userId })
  modal('开启 TOTP · ' + username, `
    <p>在验证器 App（Microsoft/Google Authenticator 等）中添加账户：</p>
    <div class="row" style="margin:14px 0"><input id="mfa_secret_show" readonly value="${esc(r.secret)}" style="width:100%"></div>
    <p class="muted" style="word-break:break-all">otpauth URI：<code>${esc(r.uri)}</code></p>
    <div class="card" style="background:#f0faf7;margin-top:14px">
      <p><b>演示直通码：${r.current}</b>（30 秒轮换，免装 App 即可体验两步登录）</p>
    </div>`,
    `<button class="btn primary" onclick="closeModal();toast('TOTP 已绑定，该账号下次登录需两步验证');(window.__mfaAfter || security)()">我已录入了</button>`)
}
function bindContact(userId, channel) {
  const sms = channel === 'sms'
  modal(sms ? '绑定手机（短信验证码）' : '绑定邮箱（邮箱验证码）', `
    <div class="field"><label>${sms ? '手机号（11 位）' : '邮箱地址'}</label><input id="bcTarget" ${sms ? 'inputmode="numeric" maxlength="11" placeholder="13800000000"' : 'type="email" placeholder="name@company.com"'} autocomplete="off"></div>
    <p class="muted">绑定后会立即发一条测试验证码；该账号之后登录需要输入验证码。</p>
    <div id="bcErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="bindContactSubmit(${userId},'${channel}')">绑定并发送测试码</button>`)
  document.getElementById('bcTarget').focus()
}
async function bindContactSubmit(userId, channel) {
  const target = document.getElementById('bcTarget').value.trim(), err = document.getElementById('bcErr')
  if (!(channel === 'sms' ? /^1d{10}$/.test(target) : /^[^s@]+@[^s@]+.[^s@]+$/.test(target))) { err.textContent = channel === 'sms' ? '请输入 11 位手机号' : '请输入正确的邮箱地址'; return }
  try {
    const r = await api('POST', '/admin/security/bind-contact', { userId, channel, target })
    closeModal(); toast(r.mock ? '已绑定。验证码未真实发出（通道未接入），请到安全中心「最近验证码」查看测试码' : '已绑定并发送测试验证码')
    ;(window.__mfaAfter || security)()
  } catch (e) { err.textContent = e.message }
}
async function mfaDisable(userId) {
  if (!confirm('确认停用该账号 MFA？')) return
  try { await api('POST', '/admin/security/mfa/disable', { userId }); (window.__mfaAfter || security)() } catch (e) { toast(e.message, true) }
}


/* ============ 集成中心（凭据后台化）============ */
async function integrations() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/integrations')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>集成中心</h2><span class="muted">${esc(d.envNote)}</span></div>
    <p class="muted" style="margin:-6px 0 16px">保存即热生效（10 秒缓存刷新）· AES-256-GCM 加密落库 · 仅超管可见可改 · 每次变更审计留痕</p>
    ${d.channels.map((ch) => `
    <div style="padding:16px 0;border-bottom:1px solid #f1f4f8">
      <div class="row" style="margin:0 0 10px;justify-content:space-between">
        <div><b>${esc(ch.name)}</b> <span class="muted" style="margin-left:8px">${esc(ch.desc)}</span></div>
        ${ch.ready ? '<span class="pill ok">● 已配置（生产模式）</span>' : '<span class="pill warn">● 未配置（MOCK 联调）</span>'}
      </div>
      <table>${ch.fields.map((f) => `<tr>
        <td style="width:340px">${f.label ? `<div>${esc(f.label)}</div><code class="td-sub">${esc(f.key)}</code>` : `<code>${esc(f.key)}</code>`}</td>
        <td>${f.stored ? `<span class="pill ok">${esc(f.stored)}</span>` : f.envFallback ? '<span class="pill s20">来自 .env</span>' : '<span class="pill off">未设置</span>'}</td>
        <td style="text-align:right">
          ${ADMIN_CAPABILITIES.role === 'super' ? `<button class="btn ghost sm" onclick="setCred('${escJs(f.key)}', ${f.secret ? 'true' : 'false'})">设置</button>
          ${f.stored ? `<button class="btn danger sm" onclick="delCred('${escJs(f.key)}')">清除</button>` : ''}` : '<span class="td-sub">凭据由超级管理员维护</span>'}
        </td></tr>`).join('')}</table>
    </div>`).join('')}
  </div>`
}
function setCred(key, secret) {
  modal('设置 ' + key, `
    <div class="field"><label>值（保存后 AES-256-GCM 加密存储，保存后不再显示明文）</label><input id="credVal" type="${secret ? 'password' : 'text'}" autocomplete="off" style="width:100%"></div>
    <div id="credErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="saveCred('${key}')">保存</button>`)
  document.getElementById('credVal').focus()
}
async function saveCred(key) {
  const val = document.getElementById('credVal').value.trim()
  if (!val) { document.getElementById('credErr').textContent = '请输入值'; return }
  try { await api('POST', '/admin/integrations/' + key, { value: val }); closeModal(); toast(key + ' 已保存，热生效'); integrations() } catch (e) { document.getElementById('credErr').textContent = e.message }
}
async function delCred(key) {
  if (!confirm('清除 ' + key + '？（对应通道将回落到 MOCK 或 .env）')) return
  try { await api('DELETE', '/admin/integrations/' + key); toast('已清除'); integrations() } catch (e) { toast(e.message, true) }
}
