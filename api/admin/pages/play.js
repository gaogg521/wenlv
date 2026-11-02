// 玩法与合规：暗号、逐品佣金、实名、共创、离线核销冲突
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

/* ============ 暗号 / 逐品佣金 / KYC / 共创 ============ */
async function phrases() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/phrases')
  const prods = await api('GET', '/admin/products')
  const noPhrase = prods.filter((p) => !list.some((x) => x.id === p.id))
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#f1e9fd">🎭</div><div><div class="l">已配暗号产品</div><div class="v">${list.length}</div><div class="s">剧本游入戏凭证</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">📦</div><div><div class="l">待配置产品</div><div class="v">${noPhrase.length}</div><div class="s">可选配暗号</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>暗号管理</h2><span class="muted">剧本游「入戏」凭证 · 用户暗号给游客 · 商家暗号核销员对答</span></div>
    ${list.length ? `<table><thead><tr><th>产品</th><th>用户暗号</th><th>商家暗号</th><th>频道</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td class="td-main">${esc(x.title)}</td>
      <td><code style="background:#f1e9fd;color:#6d28d9">${esc(x.phrase_user)}</code></td>
      <td><code style="background:#e8effd;color:#1d4ed8">${esc(x.phrase_merchant || '—')}</code></td>
      <td><span class="pill off">${esc(x.channel || 'main')}</span></td>
      <td><div class="td-actions">
        <button class="btn ghost sm" onclick="entityEditor('phrase', ${x.id}, { onSaved: () => phrases() })">编辑</button>
        <button class="btn danger sm" onclick="clearPhrase(${x.id})">清除</button>
      </div></td></tr>`).join('')}</tbody></table>`
    : emptyBox('还没有产品配暗号——下方选择线路开始配置')}
    <div class="card-head" style="margin-top:16px"><h3>为线路配置暗号</h3></div>
    <div class="row">
      <select id="phProd" class="inp" style="width:320px">${noPhrase.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('') || '<option value="">全部线路均已配置</option>'}</select>
      <button class="btn primary sm" onclick="savePhrase()">配置暗号与剧情 →</button>
      <span class="muted">上下半句、NPC 角色、对暗号地点、启停日期、剧情背景、可接受变体</span>
    </div></div>`
}
window.clearPhrase = async (id) => {
  if (!confirm('清除后该线路不再使用暗号核销，确定？')) return
  try { await api('PUT', '/admin/entities/phrase/' + id, { values: { phrase_user: '', phrase_merchant: '' } }); toast('暗号已清除'); phrases() } catch (e) { toast(e.message, true) }
}
// 选择未配置的线路 → 打开完整编辑器
window.savePhrase = () => {
  const pid = $('#phProd')?.value
  if (!pid) return toast('请先选择线路', true)
  entityEditor('phrase', pid, { onSaved: () => phrases() })
}
async function rateov() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const prods = await api('GET', '/admin/products')
  const ov = await api('GET', '/admin/rate-overrides').catch(() => [])
  const avgRate = ov.length ? (ov.reduce((s, x) => s + Number(x.promo_rate_bp), 0) / ov.length / 100).toFixed(1) : '—'
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">📊</div><div><div class="l">已设覆盖</div><div class="v">${ov.length}</div><div class="s">单品费率覆盖</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">📈</div><div><div class="l">平均覆盖费率</div><div class="v">${avgRate}%</div><div class="s">上限 12% · 留空=恢复档位</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>逐品佣金覆盖</h2><span class="muted">D2 扩展 · 单品费率优先于推广商档位 5/8/12%</span></div>
    <div class="row">
      <select id="roProd" class="inp" style="width:320px">${prods.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <button class="btn primary sm" onclick="saveRate()">设置覆盖 →</button>
      <span class="muted">需填写费率、生效期、调整原因与审批人；原因写入审计</span>
    </div>
    ${ov.length ? `<table><thead><tr><th>产品</th><th>单品费率</th><th>生效期</th><th>原因</th><th>操作</th></tr></thead><tbody>
    ${ov.map((x) => `<tr><td class="td-main">${esc(x.title)}</td>
      <td class="money num"><b>${(Number(x.promo_rate_bp) / 100).toFixed(2)}%</b></td>
      <td class="td-sub">${esc(x.rate_start || '—')} ~ ${esc(x.rate_end || '—')}</td><td class="td-sub">${esc(x.rate_reason || '—')}</td>
      <td><button class="btn ghost sm" onclick="entityEditor('rateov', ${x.id}, { onSaved: () => rateov() })">编辑</button></td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无单品覆盖，全部走推广商档位 5/8/12%')}</div>`
}
window.saveRate = () => entityEditor('rateov', $('#roProd').value, { onSaved: () => rateov() })
async function kyc() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/kyc')
  const st = { 0: '<span class="pill warn">待审</span>', 1: '<span class="pill ok">已通过</span>', 2: '<span class="pill s70">已驳回</span>' }
  const pending = list.filter((x) => x.status === 0).length
  const passed = list.filter((x) => x.status === 1).length
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">📋</div><div><div class="l">待审</div><div class="v">${pending}</div><div class="s">等待人工审核</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e3f6ec">✓</div><div><div class="l">已通过</div><div class="v">${passed}</div><div class="s">实名认证成功</div></div></div>
    <div class="kpi"><div class="ico" style="background:#fdecec">✗</div><div><div class="l">已驳回</div><div class="v">${list.filter((x) => x.status === 2).length}</div><div class="s">资料不符</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>实名认证审核</h2><span class="muted">身份证号加密落库 · 仅展示脱敏号</span></div>
    ${list.length ? `<table><thead><tr><th>用户</th><th>姓名</th><th>证件号（脱敏）</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td>${esc(x.nickname || ('用户' + x.user_id))}</td><td>${esc(x.real_name)}</td><td class="num">${esc(x.id_no_mask)}</td>
      <td>${st[x.status] || x.status}</td><td class="td-sub">${String(x.created_at).slice(0, 16)}</td>
      <td>${x.status === 0 ? `<button class="btn primary sm" onclick="kycResolve(${x.id},'pass')">通过</button>
        <button class="btn danger sm" onclick="kycResolve(${x.id},'reject')">驳回</button>` : (x.reject_note ? `<span class="td-sub">${esc(x.reject_note)}</span>` : '')}</td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无实名认证申请')}</div>`
}
window.kycResolve = async (id, action) => {
  let note = null
  if (action === 'reject') {
    note = prompt('驳回原因：') || '资料不符'
  }
  await api('POST', '/admin/kyc/' + id + '/resolve', { action, note })
  go('kyc')
}
async function cocreate() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const prods = await api('GET', '/admin/products')
  const list = await api('GET', '/admin/co-creators')
  const profits = await api('GET', '/admin/co-profits').catch(() => [])
  const totalInvest = list.reduce((s, c) => s + Number(c.invest_amount), 0)
  const totalProfit = profits.reduce((s, c) => s + Number(c.amount), 0)
  const activeCount = list.filter((c) => Number(c.status) === 1).length
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">💰</div><div><div class="l">累计投资额</div><div class="v">¥${(totalInvest / 100).toLocaleString()}</div><div class="s">共创人投入</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e3f6ec">🏦</div><div><div class="l">累计分润</div><div class="v">¥${(totalProfit / 100).toLocaleString()}</div><div class="s">已入账待打款</div></div></div>
    <div class="kpi"><div class="ico" style="background:var(--brand-soft)">👥</div><div><div class="l">活跃共创人</div><div class="v">${activeCount}/${list.length}</div><div class="s">生效中</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>共创人管理</h2><span class="muted">资金商/商品商 · 按产品投资分润 · 结算期自动入账</span></div>
    <div class="row"><button class="btn primary sm" onclick="entityEditor('cocreator', null, { onSaved: () => cocreate() })">＋ 登记共创人</button>
      <span class="muted">身份 · 投资与分润 · 协议与收款账户</span></div>
    ${list.length ? `<table><thead><tr><th>编号</th><th>产品</th><th>姓名</th><th>角色</th><th>投资额</th><th>分润比例</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td class="num">${esc(x.co_no)}</td><td>${esc(x.title)}</td><td>${esc(x.name)}</td>
      <td>${Number(x.role) === 1 ? '<span class="pill s60">资金商</span>' : '<span class="pill s20">商品商</span>'}</td>
      <td class="num">¥${(Number(x.invest_amount) / 100).toLocaleString()}</td>
      <td class="num"><b>${(Number(x.share_pct) / 100).toFixed(1)}%</b></td>
      <td>${Number(x.status) === 1 ? '<span class="pill ok">生效</span>' : '<span class="pill off">停用</span>'}</td>
      <td><div class="td-actions"><button class="btn ghost sm" onclick="entityEditor('cocreator', ${x.id}, { onSaved: () => cocreate() })">资料</button>${Number(x.status) === 1 ? `<button class="btn ghost sm" onclick="toggleCo(${x.id},${x.status})">停用</button>` : `<button class="btn primary sm" onclick="toggleCo(${x.id},${x.status})">启用</button>`}</div></td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无共创人——点「登记共创人」')}</div>
  <div class="card">
    <div class="card-head"><h3>共创分润台账</h3><span class="muted">链上分润凭证 · 结算期自动入账</span></div>
    ${profits.length ? `<table><thead><tr><th>期</th><th>共创人</th><th>产品</th><th>基数</th><th>分润额</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${profits.map((x) => `<tr><td>${esc(x.period)}</td><td>${esc(x.name)}</td><td>${esc(x.title)}</td>
      <td class="num">¥${(Number(x.base_amount) / 100).toFixed(2)}</td><td class="money num"><b>¥${(Number(x.amount) / 100).toFixed(2)}</b></td>
      <td>${Number(x.status) === 1 ? '<span class="pill ok">已打款</span>' : '<span class="pill warn">待打款</span>'}</td>
      <td>${Number(x.status) === 0 ? `<button class="btn primary sm" onclick="payCo(${x.id})">标记打款</button>` : '<span class="td-sub">✓</span>'}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty"><div class="e-ico">📊</div>暂无分润记录——生成结算单后自动入账</div>'}</div>`
}
window.toggleCo = async (id, st) => { await api('POST', '/admin/co-creators/' + id + '/status', { status: st === 1 ? 0 : 1 }); go('cocreate') }
window.payCo = async (id) => { await api('POST', '/admin/co-profits/' + id + '/pay'); go('cocreate') }


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
