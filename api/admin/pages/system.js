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
      <td><button class="btn ghost sm" onclick="cfgEdit('${esc(r.k)}', '${esc(String(r.v)).replace(/'/g, '')}')">修改</button></td></tr>`).join('')}</tbody></table>` : emptyBox('该分组暂无参数')}
  </div>`
}
function cfgEdit(k, v) {
  modal('修改参数 · ' + esc(window.__cfgNames?.[k] || k) + ' <code>' + esc(k) + '</code>', `
    <div style="margin-bottom:12px">当前值：<code>${esc(v)}</code> → 新值：
    <input id="cfg_new" value="${esc(v)}" style="width:100%;margin-top:8px;padding:9px 12px;border:1.5px solid var(--line);border-radius:9px"></div>
    <input id="cfg_reason" placeholder="修改原因（必填，将写入审计）" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:9px">
    <div id="cfg_hint" class="muted" style="margin-top:10px"></div>`,
    `<button class="btn ghost" onclick="cfgHistory('${esc(k)}')">变更历史</button>
     <button class="btn ghost" onclick="closeModal()">取消</button>
     <button class="btn primary" onclick="cfgPropose('${esc(k)}')">提交提案</button>`)
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
    <div class="row" style="margin-top:14px"><button class="btn ghost sm" onclick="cfgRollback('${esc(k)}')">↩ 回滚到上一版本</button></div>`
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
async function risk() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/risk')
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h2>风控事件</h2><span class="muted">核销重放 / 设备聚集 / 退款滥用 / 佣金异常</span></div>
    ${rows.length ? `<table><thead><tr><th>类型</th><th>级别</th><th>详情</th><th>时间</th><th>状态</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><span class="pill off">${esc(r.kind)}</span></td>
      <td>${r.severity >= 3 ? '<span class="pill s70">高</span>' : r.severity === 2 ? '<span class="pill warn">中</span>' : '<span class="pill off">低</span>'}</td>
      <td><code>${esc(String(r.detail).slice(0, 60))}</code></td>
      <td class="td-sub">${esc(String(r.created_at).slice(5, 16))}</td>
      <td>${r.handled ? '<span class="pill ok">已处理</span>' : `<button class="btn ghost sm" onclick="handleRisk(${r.id})">标记已处理</button>`}</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无风控事件 🎉')}
  </div>`
}
async function audit() {
  $('#app').innerHTML = `<div class="card">${skel(6)}</div>`
  const rows = await api('GET', '/admin/audit-logs')
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h2>操作审计</h2><span class="muted">只增不改 · 每次写操作前后快照</span></div>
    ${rows.length ? `<table><thead><tr><th>时间</th><th>操作人</th><th>模块 / 动作</th><th>对象</th><th>变更</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="td-sub num">${esc(String(a.created_at).slice(5, 19))}</td><td>${esc(a.actor)}</td>
      <td><b>${esc(a.module)}</b> · ${esc(a.action)}</td><td class="td-sub">${esc(a.biz_ref || '')}</td>
      <td>${auditDiff(a.before_val, a.after_val)}</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无操作记录')}
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
      <div class="kpi"><div class="ico" style="background:${o.jobs.alive ? '#e3f6ec' : '#fdecec'}">⏱</div><div><div class="l">任务进程</div><div class="v" style="font-size:18px">${o.jobs.runCount} 轮</div><div class="s">${sp(o.jobs.alive, '存活', '心跳丢失')}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">⛓</div><div><div class="l">存证队列</div><div class="v" style="font-size:18px">${o.attestQueue.pending}</div><div class="s">已锚 ${o.attestQueue.anchored} · 失败 ${o.attestQueue.failed}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#f1e9fd">🧾</div><div><div class="l">支付单</div><div class="v" style="font-size:18px">${o.payment.ok}/${o.payment.total}</div><div class="s">成功/总数</div></div></div>
      <div class="kpi"><div class="ico" style="background:${o.ledger.perOk ? '#e3f6ec' : '#fdecec'}">⚖️</div><div><div class="l">账本试算</div><div class="v" style="font-size:18px">${o.ledger.credit}</div><div class="s">${sp(o.ledger.perOk && o.ledger.globalOk, '借贷平衡', '不平衡P0')}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">🧯</div><div><div class="l">滞留待付</div><div class="v" style="font-size:18px">${o.ordersHealth.stuckWaitPay30m}</div><div class="s">超30分钟未付</div></div></div>
    </div>
    <div class="row" style="margin-top:6px"><span class="muted">服务运行 ${Math.floor(o.service.uptimeSec / 60)} 分钟 · Node ${esc(o.service.node)} · 支付通道 ${esc(o.service.payMode)} · ${o.tables} 张表 · 幂等键 ${o.idempotencyKeys}</span></div>
    ${o.secrets ? `<div class="row" style="margin-top:4px"><span class="muted">凭据主密钥：${o.secrets.keySource === 'env' ? '<span class="pill ok">SECRETS_KEY</span>' : '<span class="pill warn">由 JWT_SECRET 派生</span> 生产环境请运行 <code>node scripts/secrets-key.mjs current</code> 并设为 SECRETS_KEY'} · 已存 ${o.secrets.stored} 条${o.secrets.undecryptable.length ? ` · <span class="pill err">${o.secrets.undecryptable.length} 条无法解密：${o.secrets.undecryptable.map(esc).join('、')}</span>` : ''}</span></div>` : ''}
  </div>
  <div class="card">
    <div class="card-head"><h3>定时任务</h3>
      <div>
        <button class="btn ghost sm" onclick="runJob('close-timeout')">关单</button>
        <button class="btn ghost sm" onclick="runJob('commission-due')">佣金到期</button>
        <button class="btn ghost sm" onclick="runJob('complete-due')">完成到期单</button>
        <button class="btn ghost sm" onclick="runJob('attest-pack','attest')">存证打包</button>
        <button class="btn ghost sm" onclick="runJob('bean-expire')">豆过期</button>
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
      <td><button class="btn ${f.on ? 'ghost' : 'primary'} sm" onclick="toggleFeature('${esc(f.key)}')">${f.on ? '关闭' : '开启'}</button></td></tr>`).join('')}
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
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>安全中心 · MFA</h2><span class="muted">TOTP / 短信 / 邮箱三通道 · 全局策略走参数中心 admin.mfa.mode（off/optional/required）</span></div>
    <table><thead><tr><th>账号</th><th>角色</th><th>MFA</th><th>通道</th><th>手机/邮箱</th><th>最近登录</th><th>操作</th></tr></thead><tbody>
    ${accounts.map((a2) => `<tr><td class="td-main">${esc(a2.display_name || a2.username)}<div class="td-sub">${esc(a2.username)}</div></td>
      <td>${esc(a2.role)}</td>
      <td>${Number(a2.mfa_enabled) ? '<span class="pill ok">已启用</span>' : '<span class="pill off">未启用</span>'}</td>
      <td>${Number(a2.mfa_enabled) ? esc(a2.mfa_channel) : '—'}</td>
      <td class="td-sub">${esc(a2.mobile || a2.email || '—')}</td>
      <td class="td-sub">${esc(String(a2.last_login_at || '').slice(5, 16))}</td>
      <td><button class="btn ghost sm" onclick="mfaSetup(${a2.id}, '${esc(a2.username)}')">开 TOTP</button>
          <button class="btn ghost sm" onclick="bindContact(${a2.id}, 'sms')">绑手机</button>
          <button class="btn ghost sm" onclick="bindContact(${a2.id}, 'email')">绑邮箱</button>
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
async function mfaSetup(userId, username) {
  const r = await api('POST', '/admin/security/mfa/setup', { userId })
  modal('开启 TOTP · ' + username, `
    <p>在验证器 App（Microsoft/Google Authenticator 等）中添加账户：</p>
    <div class="row" style="margin:14px 0"><input id="mfa_secret_show" readonly value="${esc(r.secret)}" style="width:100%"></div>
    <p class="muted" style="word-break:break-all">otpauth URI：<code>${esc(r.uri)}</code></p>
    <div class="card" style="background:#f0faf7;margin-top:14px">
      <p><b>演示直通码：${r.current}</b>（30 秒轮换，免装 App 即可体验两步登录）</p>
    </div>`,
    `<button class="btn primary" onclick="closeModal();toast('TOTP 已绑定，该账号下次登录需两步验证')">我已录入了</button>`)
}
async function bindContact(userId, channel) {
  const target = prompt(channel === 'sms' ? '输入手机号（MOCK 通道，验证码在安全中心可见）：' : '输入邮箱：')
  if (!target) return
  try { const r = await api('POST', '/admin/security/bind-contact', { userId, channel, target }); toast('已绑定并发送测试验证码' + (r.mock ? '（MOCK）' : '')); security() } catch (e) { toast(e.message, true) }
}
async function mfaDisable(userId) {
  if (!confirm('确认停用该账号 MFA？')) return
  try { await api('POST', '/admin/security/mfa/disable', { userId }); security() } catch (e) { toast(e.message, true) }
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
        <td style="width:280px"><code>${esc(f.key)}</code></td>
        <td>${f.stored ? `<span class="pill ok">${esc(f.stored)}</span>` : f.envFallback ? '<span class="pill s20">来自 .env</span>' : '<span class="pill off">未设置</span>'}</td>
        <td style="text-align:right">
          <button class="btn ghost sm" onclick="setCred('${esc(f.key)}')">设置</button>
          ${f.stored ? `<button class="btn danger sm" onclick="delCred('${esc(f.key)}')">清除</button>` : ''}
        </td></tr>`).join('')}</table>
    </div>`).join('')}
  </div>`
}
async function setCred(key) {
  const val = prompt('输入 ' + key + ' 的值（保存后 AES-256-GCM 加密存储）：')
  if (!val) return
  try { await api('POST', '/admin/integrations/' + key, { value: val }); toast(key + ' 已保存，热生效'); integrations() } catch (e) { toast(e.message, true) }
}
async function delCred(key) {
  if (!confirm('清除 ' + key + '？（对应通道将回落到 MOCK 或 .env）')) return
  try { await api('DELETE', '/admin/integrations/' + key); toast('已清除'); integrations() } catch (e) { toast(e.message, true) }
}
