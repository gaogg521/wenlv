// 玩法与合规：暗号、逐品佣金、实名、共创、离线核销冲突
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

/* ============ 暗号 / 逐品佣金 / KYC / 共创 ============ */
async function phrases() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  window.__phQ = window.__phQ || { page: 1, kw: '' }
  const Q = window.__phQ
  const [d, unconf] = await Promise.all([
    api('GET', '/admin/phrases?' + new URLSearchParams({ page: Q.page, kw: Q.kw, pageSize: 20 }).toString()),
    api('GET', '/admin/phrases?unconfigured=1').catch(() => ({ rows: [] })),
  ])
  const list = d.rows
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize))
  const noPhrase = unconf.rows
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#f1e9fd">🎭</div><div><div class="l">已配暗号产品</div><div class="v">${Number(d.total).toLocaleString()}</div><div class="s">剧本游入戏凭证</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">📦</div><div><div class="l">待配置产品</div><div class="v">${noPhrase.length}</div><div class="s">可选配暗号（在架产品）</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>暗号管理</h2><span class="muted">剧本游「入戏」凭证 · 用户暗号给游客 · 商家暗号核销员对答</span></div>
    <form class="orders-search" onsubmit="event.preventDefault();window.__phQ.kw=this.kw.value.trim();window.__phQ.page=1;phrases()">
      <input name="kw" type="search" value="${esc(Q.kw)}" placeholder="按线路名称搜索">
      <button class="btn primary" type="submit">查询</button>
      ${Q.kw ? '<button class="btn ghost" type="button" onclick="window.__phQ={page:1,kw:\'\'};phrases()">重置</button>' : ''}</form>
    ${list.length ? `<table><thead><tr><th>产品</th><th>用户暗号</th><th>商家暗号</th><th>频道</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td class="td-main">${esc(x.title)}</td>
      <td><code style="background:#f1e9fd;color:#6d28d9">${esc(x.phrase_user)}</code></td>
      <td><code style="background:#e8effd;color:#1d4ed8">${esc(x.phrase_merchant || '—')}</code></td>
      <td><span class="pill off">${esc(x.channel || 'main')}</span></td>
      <td><div class="td-actions">
        <button class="btn ghost sm" onclick="entityEditor('phrase', ${x.id}, { onSaved: () => phrases() })">编辑</button>
        <button class="btn danger sm" onclick="clearPhrase(${x.id})">清除</button>
      </div></td></tr>`).join('')}</tbody></table>
    <div class="pagination"><span>共 ${Number(d.total).toLocaleString()} 条 · 第 ${d.page} / ${pages} 页</span><div><button class="btn ghost sm" ${d.page <= 1 ? 'disabled' : ''} onclick="window.__phQ.page--;phrases()">上一页</button> <button class="btn ghost sm" ${d.page >= pages ? 'disabled' : ''} onclick="window.__phQ.page++;phrases()">下一页</button></div></div>`
    : emptyBox(Q.kw ? '没有符合条件的暗号记录' : '还没有产品配暗号——下方选择线路开始配置')}
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
  window.__roQ = window.__roQ || { page: 1, kw: '' }
  const Q = window.__roQ
  const [prods, d] = await Promise.all([
    api('GET', '/admin/products'),
    api('GET', '/admin/rate-overrides?' + new URLSearchParams({ page: Q.page, kw: Q.kw, pageSize: 20 }).toString()).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 20, avgBp: 0 })),
  ])
  const ov = d.rows
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize))
  const avgRate = d.avgBp ? (d.avgBp / 100).toFixed(1) : '—'
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">📊</div><div><div class="l">已设覆盖</div><div class="v">${Number(d.total).toLocaleString()}</div><div class="s">单品费率覆盖</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">📈</div><div><div class="l">平均覆盖费率</div><div class="v">${avgRate}%</div><div class="s">全量口径 · 上限 12% · 留空=恢复档位</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>逐品佣金覆盖</h2><span class="muted">D2 扩展 · 单品费率优先于推广商档位 5/8/12%</span></div>
    <div class="row">
      <select id="roProd" class="inp" style="width:320px">${prods.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <button class="btn primary sm" onclick="saveRate()">设置覆盖 →</button>
      <span class="muted">需填写费率、生效期、调整原因与审批人；原因写入审计</span>
    </div>
    <form class="orders-search" onsubmit="event.preventDefault();window.__roQ.kw=this.kw.value.trim();window.__roQ.page=1;rateov()">
      <input name="kw" type="search" value="${esc(Q.kw)}" placeholder="按产品名称搜索">
      <button class="btn primary" type="submit">查询</button>
      ${Q.kw ? '<button class="btn ghost" type="button" onclick="window.__roQ={page:1,kw:\'\'};rateov()">重置</button>' : ''}</form>
    ${ov.length ? `<table><thead><tr><th>产品</th><th>单品费率</th><th>生效期</th><th>原因</th><th>操作</th></tr></thead><tbody>
    ${ov.map((x) => `<tr><td class="td-main">${esc(x.title)}</td>
      <td class="money num"><b>${(Number(x.promo_rate_bp) / 100).toFixed(2)}%</b></td>
      <td class="td-sub">${esc(x.rate_start || '—')} ~ ${esc(x.rate_end || '—')}</td><td class="td-sub">${esc(x.rate_reason || '—')}</td>
      <td><button class="btn ghost sm" onclick="entityEditor('rateov', ${x.id}, { onSaved: () => rateov() })">编辑</button></td></tr>`).join('')}</tbody></table>
    <div class="pagination"><span>共 ${Number(d.total).toLocaleString()} 条 · 第 ${d.page} / ${pages} 页</span><div><button class="btn ghost sm" ${d.page <= 1 ? 'disabled' : ''} onclick="window.__roQ.page--;rateov()">上一页</button> <button class="btn ghost sm" ${d.page >= pages ? 'disabled' : ''} onclick="window.__roQ.page++;rateov()">下一页</button></div></div>`
    : emptyBox(Q.kw ? '没有符合条件的覆盖记录' : '暂无单品覆盖，全部走推广商档位 5/8/12%')}</div>`
}
window.saveRate = () => entityEditor('rateov', $('#roProd').value, { onSaved: () => rateov() })
async function kyc() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const all = await api('GET', '/admin/kyc')
  window.__kycSt = window.__kycSt ?? '' // 卡片点击后只看某一状态
  const list = window.__kycSt === '' ? all : all.filter((x) => String(x.status) === window.__kycSt)
  const st = { 0: '<span class="pill warn">待审</span>', 1: '<span class="pill ok">已通过</span>', 2: '<span class="pill s70">已驳回</span>' }
  const pending = all.filter((x) => x.status === 0).length
  const passed = all.filter((x) => x.status === 1).length
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    <div class="kpi go" ${dxKey} title="只看待审" onclick="window.__kycSt='0';kyc()"><i class="go-arrow">↗</i><div class="ico" style="background:#fdf3e0">📋</div><div><div class="l">待审</div><div class="v">${pending}</div><div class="s">等待人工审核</div></div></div>
    <div class="kpi go" ${dxKey} title="只看已通过" onclick="window.__kycSt='1';kyc()"><i class="go-arrow">↗</i><div class="ico" style="background:#e3f6ec">✓</div><div><div class="l">已通过</div><div class="v">${passed}</div><div class="s">实名认证成功</div></div></div>
    <div class="kpi go" ${dxKey} title="只看已驳回" onclick="window.__kycSt='2';kyc()"><i class="go-arrow">↗</i><div class="ico" style="background:#fdecec">✗</div><div><div class="l">已驳回</div><div class="v">${all.filter((x) => x.status === 2).length}</div><div class="s">资料不符</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>实名认证审核</h2><span class="muted">身份证号加密落库 · 仅展示脱敏号</span>${window.__kycSt !== '' ? `<span class="src-chip">仅看：${['待审', '已通过', '已驳回'][window.__kycSt]}</span><button class="btn ghost sm" onclick="window.__kycSt='';kyc()">显示全部</button>` : ''}</div>
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
  // P-02：本页不再依赖 /admin/products（历史遗留的死请求让无 products 模块的财务整页打不开）；
  // 登记共创人的线路下拉由 entity-schemas（cocreate 模块）服务端填充，最小引用不含商品管理数据。
  // co-profits 加载失败如实报错并给重试，不再吞成空列表把"应付 0"冒充真实数据。
  const list = await api('GET', '/admin/co-creators')
  const profits = await api('GET', '/admin/co-profits')
  const canPay = adminCan('coProfit.pay'), canVoid = adminCan('coProfit.void')
  const totalInvest = list.reduce((s, c) => s + Number(c.invest_amount), 0)
  const totalPaid = profits.reduce((s, c) => s + Number(c.paid_amount), 0)
  const totalDue = profits.filter((c) => Number(c.status) !== 2).reduce((s, c) => s + Number(c.amount), 0)
  const pendingPay = profits.filter((c) => Number(c.status) === 0).reduce((s, c) => s + Number(c.amount) - Number(c.paid_amount), 0)
  const pendingApprovals = profits.reduce((s, c) => s + Number(c.pending_approvals || 0), 0)
  const activeCount = list.filter((c) => Number(c.status) === 1).length
  const CO_ST = { 0: '<span class="pill warn">待打款</span>', 1: '<span class="pill ok">已结清</span>', 2: '<span class="pill s70">已作废</span>' }
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
    <div class="kpi go" role="link" tabindex="0" onkeydown="if(event.key==='Enter')this.click()" title="定位到共创人列表" onclick="document.getElementById('coList').scrollIntoView({behavior:'smooth'})"><i class="go-arrow">↗</i><div class="ico" style="background:#fdf3e0">💰</div><div><div class="l">累计投资额</div><div class="v">¥${(totalInvest / 100).toLocaleString()}</div><div class="s">共创人投入</div></div></div>
    <div class="kpi go" role="link" tabindex="0" onkeydown="if(event.key==='Enter')this.click()" title="定位到共创分润台账" onclick="document.getElementById('coLedger').scrollIntoView({behavior:'smooth'})"><i class="go-arrow">↗</i><div class="ico" style="background:#e3f6ec">🏦</div><div><div class="l">应付分润</div><div class="v">¥${(totalDue / 100).toLocaleString()}</div><div class="s">结算期自动入账</div></div></div>
    <div class="kpi go" role="link" tabindex="0" onkeydown="if(event.key==='Enter')this.click()" title="定位到共创分润台账" onclick="document.getElementById('coLedger').scrollIntoView({behavior:'smooth'})"><i class="go-arrow">↗</i><div class="ico" style="background:var(--brand-soft)">✅</div><div><div class="l">已登记打款</div><div class="v">¥${(totalPaid / 100).toLocaleString()}</div><div class="s">按真实回单累计</div></div></div>
    <div class="kpi go" role="link" tabindex="0" onkeydown="if(event.key==='Enter')this.click()" title="定位到共创分润台账" onclick="document.getElementById('coLedger').scrollIntoView({behavior:'smooth'})"><i class="go-arrow">↗</i><div class="ico" style="background:#fdecec">⏳</div><div><div class="l">待打款 / 待复核</div><div class="v">¥${(pendingPay / 100).toLocaleString()}${pendingApprovals ? ' / ' + pendingApprovals + ' 笔' : ''}</div><div class="s">登记 ≠ 实际到账</div></div></div>
  </div>
  <div class="card">
    <div class="card-head" id="coList"><h2>共创人管理</h2><span class="muted">资金商/商品商 · 按产品投资分润 · 结算期自动入账</span></div>
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
    <div class="card-head" id="coLedger"><h3>共创分润台账</h3><span class="muted">打款走唯一流水登记：${canPay ? '核对后登记真实回单' : '由财务或超级管理员登记打款，当前账号可核对进度'}</span></div>
    ${profits.length ? `<table><thead><tr><th>分润单</th><th>结算期</th><th>共创人</th><th>产品</th><th>应付</th><th>已付</th><th>状态</th><th>最近打款</th><th>操作</th></tr></thead><tbody>
    ${profits.map((x) => {
      const remaining = Number(x.amount) - Number(x.paid_amount)
      const coOff = Number(x.co_status) !== 1
      const actions = []
      if (Number(x.status) === 0) {
        if (canPay) actions.push(`<button class="btn primary sm" onclick="payCoModal(${x.id})">登记打款</button>`)
        if (canVoid) actions.push(`<button class="btn danger sm" onclick="coVoid(${x.id})">作废</button>`)
        if (!canPay && !canVoid) actions.push('<span class="td-sub">待财务登记</span>')
        if (coOff) actions.unshift('<span class="pill off">合作停用</span>')
      } else if (Number(x.status) === 2) {
        actions.push('<span class="td-sub">错单作废，不参与应付</span>')
      } else {
        actions.push(`<button class="btn ghost sm" onclick="coPayHistory(${x.id})">打款流水</button>`)
      }
      return `<tr><td class="num">#${x.id}</td><td class="td-sub">${esc(x.settle_period || x.period)}</td>
      <td>${esc(x.name)}${coOff ? ' <span class="pill off">停用</span>' : ''}<div class="td-sub">${esc(x.co_no)}</div></td><td>${esc(x.title)}</td>
      <td class="num">¥${(Number(x.amount) / 100).toFixed(2)}</td>
      <td class="num">¥${(Number(x.paid_amount) / 100).toFixed(2)}${Number(x.paid_amount) > 0 && Number(x.status) === 0 ? '<div class="td-sub">部分已付</div>' : ''}</td>
      <td>${CO_ST[x.status] || x.status}${Number(x.pending_approvals) > 0 ? '<div><span class="pill warn">待复核 ' + x.pending_approvals + '</span></div>' : ''}</td>
      <td class="td-sub">${x.pay_ref ? esc(x.pay_ref) + '<br>' + esc(x.pay_channel || '') + (x.paid_by ? ' · ' + esc(x.paid_by) : '') : '—'}</td>
      <td><div class="td-actions">${actions.join('')}</div></td></tr>`}).join('')}</tbody></table>`
    : '<div class="empty"><div class="e-ico">📊</div>暂无分润记录——生成结算单后自动入账</div>'}</div>`
}
window.toggleCo = async (id, st) => { await api('POST', '/admin/co-creators/' + id + '/status', { status: st === 1 ? 0 : 1 }); go('cocreate') }
// 登记打款（T01）：真实流水号 + 回单附件 + 实付金额；达到审批阈值需超管复核后生效
window.payCoModal = async (id) => {
  const list = await api('GET', '/admin/co-profits').catch(() => [])
  const cp = list.find((x) => Number(x.id) === Number(id))
  if (!cp) return toast('分润单不存在', true)
  if (Number(cp.co_status) !== 1) return toast('共创人合作已停用，暂停打款；请先恢复合作生效', true)
  const remaining = Number(cp.amount) - Number(cp.paid_amount)
  modal('登记共创分润打款 · #' + cp.id, `
    <div class="field"><label>共创人 / 产品</label><div>${esc(cp.name)} · ${esc(cp.title)} · 结算期 ${esc(cp.settle_period || cp.period)}</div></div>
    <div class="field"><label>应付 / 未付</label><div class="num">应付 ${fen(cp.amount)} · 已付 ${fen(cp.paid_amount)} · 本次最多 <b>${fen(remaining)}</b></div></div>
    <div class="field"><label>实付金额（元）*</label><input id="cpAmount" type="number" step="0.01" min="0.01" value="${(remaining / 100).toFixed(2)}"><div class="td-sub">不可超付；分次打款请先登记部分金额</div></div>
    <div class="field"><label>支付渠道 *</label><select id="cpChannel"><option value="bank">银行转账</option><option value="alipay">支付宝</option><option value="wechat">微信</option><option value="cash">现金</option><option value="other">其他</option></select></div>
    <div class="field"><label>支付日期 *</label><input id="cpDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="field"><label>真实支付流水号 *</label><input id="cpRef" placeholder="以银行/渠道回单为准，6–64 位"><div class="td-sub">全局唯一：重复流水会被拒绝登记</div></div>
    <div class="field"><label>回单附件</label><input id="cpReceipt" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf"><div class="td-sub">存档用，不对外提供下载；仅财务/运营/超管可在流水中查看</div></div>
    <div class="field"><label>备注</label><input id="cpNote" maxlength="200" placeholder="付款用途、经办人等"></div>
    <div id="cpErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" id="cpSubmit" onclick="payCoSubmit(${id}, ${remaining})">提交登记</button>`)
}
window.payCoSubmit = async (id, remaining) => {
  const btn = $('#cpSubmit'); const fail = (m) => { $('#cpErr').textContent = m || '' }
  try {
    const amount = Math.round(Number($('#cpAmount').value) * 100)
    if (!amount || amount <= 0) return fail('请填写实付金额')
    if (amount > remaining) return fail('实付金额超过未付余额，不可超付')
    const payRef = ($('#cpRef').value || '').trim()
    if (!/^[\w-]{6,64}$/.test(payRef)) return fail('请填写真实支付流水号（6–64 位字母、数字、- 或 _）')
    let receiptUrl = null
    const f = $('#cpReceipt')?.files?.[0]
    if (f) {
      if (f.size > 5 * 1024 * 1024) return fail('回单附件需在 5MB 内')
      btn.disabled = true
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f) })
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
      receiptUrl = (await api('POST', '/admin/co-profits/receipt-upload', { data, ext })).url
    }
    btn.disabled = true
    const r = await api('POST', '/admin/co-profits/' + id + '/pay', { amount, payRef, channel: $('#cpChannel').value, payDate: $('#cpDate').value, receiptUrl, note: ($('#cpNote').value || '').trim() })
    closeModal()
    toast(r.pending ? '已提交登记，等待超级管理员复核后生效' : (r.settled ? '已登记打款，分润单结清' : '已登记部分打款'))
    cocreate()
  } catch (e) { btn.disabled = false; fail(e.message) }
}
// 打款流水轨迹：含待复核（超管可批/驳）与冲正入口
window.coPayHistory = async (id) => {
  const pays = await api('GET', '/admin/co-profits/' + id + '/pays').catch(() => [])
  const canPay = adminCan('coProfit.pay'), isSuper = ADMIN_CAPABILITIES.role === 'super'
  const myOperator = 'admin:' + (ME?.displayName || ME?.username || '')
  const ST = { 0: '<span class="pill warn">待复核</span>', 1: '<span class="pill ok">有效</span>', 2: '<span class="pill s70">已驳回</span>', 3: '<span class="pill s70">已被冲正</span>', 4: '<span class="pill s70">已撤回</span>' }
  const CH = { bank: '银行转账', alipay: '支付宝', wechat: '微信', cash: '现金', other: '其他' }
  drawer('打款流水轨迹 · 分润单 #' + id, pays.length ? `<table><thead><tr><th>方向</th><th>流水号</th><th>金额</th><th>渠道/日期</th><th>状态</th><th>登记/复核</th><th>操作</th></tr></thead><tbody>
    ${pays.map((y) => `<tr><td>${Number(y.direction) === 1 ? '打款' : '<b style="color:var(--red)">冲正</b>'}</td>
      <td class="td-sub">${esc(y.pay_ref)}</td><td class="num ${Number(y.amount) < 0 ? '' : ''}">¥${(Number(y.amount) / 100).toFixed(2)}</td>
      <td class="td-sub">${esc(CH[y.channel] || y.channel)}${y.pay_date ? '<br>' + esc(String(y.pay_date).slice(0, 10)) : ''}</td>
      <td>${ST[y.status] || y.status}</td>
      <td class="td-sub">${esc(y.operator || '')}${y.approver ? '<br>复核：' + esc(y.approver) : ''}${y.approve_note ? '<br>' + esc(y.approve_note) : ''}</td>
      <td><div class="td-actions">
        ${y.receipt_url ? `<button class="btn ghost sm" onclick="coViewReceipt(${y.id})">回单</button>` : ''}
        ${Number(y.direction) === 1 && Number(y.status) === 1 && canPay ? `<button class="btn danger sm" onclick="coReverseModal(${id}, ${y.id}, '${escJs(y.pay_ref)}', ${Number(y.amount)})">冲正</button>` : ''}
        ${Number(y.status) === 0 && isSuper ? `<button class="btn primary sm" onclick="coApprove(${id}, ${y.id}, true)">通过</button><button class="btn danger sm" onclick="coApprove(${id}, ${y.id}, false)">驳回</button>` : ''}
        ${Number(y.status) === 0 && canPay && y.operator === myOperator ? `<button class="btn ghost sm" onclick="coWithdraw(${id}, ${y.id})">撤回</button>` : ''}
      </div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无打款流水</div>')
}
window.coApprove = (id, payId, pass) => {
  if (pass) return coApproveSubmit(id, payId, true, '')
  // 驳回原因用模态框收集（原生 prompt 在部分环境不可用）
  modal('驳回打款登记 · #' + payId, `
    <p class="td-sub">驳回后登记人可重新登记；原因登记人可见。</p>
    <div class="field"><label>驳回原因（登记人可见）</label><input id="cpRejNote" maxlength="200"></div>
    <div id="cpRejErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn danger" onclick="coApproveSubmit(${id}, ${payId}, false, document.getElementById('cpRejNote').value.trim())">确认驳回</button>`)
}
window.coApproveSubmit = async (id, payId, pass, note) => {
  try { const r = await api('POST', '/admin/co-profits/pays/' + payId + '/approve', { pass, note }); closeModal(); toast(pass ? '复核通过，打款登记生效' : '已驳回该笔登记'); coPayHistory(id); cocreate() } catch (e) { const el = document.getElementById('cpRejErr'); if (el && !pass) el.textContent = e.message; else toast(e.message, true) }
}
window.coWithdraw = async (id, payId) => {
  try { await api('POST', '/admin/co-profits/pays/' + payId + '/withdraw'); toast('已撤回该笔登记'); coPayHistory(id); cocreate() } catch (e) { toast(e.message, true) }
}
window.coReverseModal = (id, payId, ref, amount) => {
  modal('冲正打款 · ' + ref, `
    <p class="td-sub">冲正不改写历史实付：会登记一笔负向流水（¥${(amount / 100).toFixed(2)}），分润单回到「待打款」，冲正前因与银行冲正回单流水号留痕。</p>
    <div class="field"><label>冲正流水号（银行冲正回单）*</label><input id="cpRevRef" placeholder="6–64 位，全局唯一"></div>
    <div class="field"><label>冲正原因 *</label><input id="cpRevNote" placeholder="例如：流水登记错误 / 合作方退款"></div>
    <div id="cpRevErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="coReverseSubmit(${id}, ${payId})">确认冲正</button>`)
}
window.coReverseSubmit = async (id, payId) => {
  try {
    const payRef = ($('#cpRevRef').value || '').trim()
    if (!/^[\w-]{6,64}$/.test(payRef)) { $('#cpRevErr').textContent = '请填写冲正流水号（6–64 位）'; return }
    await api('POST', '/admin/co-profits/pays/' + payId + '/reverse', { payRef, note: ($('#cpRevNote').value || '').trim() })
    closeModal(); toast('已登记冲正，分润单回到待打款'); cocreate()
  } catch (e) { $('#cpRevErr').textContent = e.message }
}
window.coVoid = (id) => {
  // 作废原因用模态框收集（原生 prompt 在部分环境不可用）
  modal('作废分润单 · #' + id, `
    <p class="td-sub">仅未付的待打款单可作废；作废后不参与应付，原因进入审计。</p>
    <div class="field"><label>作废原因 *（4–200 字）</label><input id="cpVoidReason" maxlength="200"></div>
    <div id="cpVoidErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn danger" onclick="coVoidSubmit(${id})">确认作废</button>`)
}
window.coVoidSubmit = async (id) => {
  const reason = ($('#cpVoidReason').value || '').trim()
  if (reason.length < 4 || reason.length > 200) { $('#cpVoidErr').textContent = '请填写 4–200 字作废原因'; return }
  try { await api('POST', '/admin/co-profits/' + id + '/void', { reason }); closeModal(); toast('分润单已作废'); cocreate() } catch (e) { $('#cpVoidErr').textContent = e.message }
}
window.coViewReceipt = async (payId) => {
  try {
    const r = await api('GET', '/admin/co-profits/pays/' + payId + '/receipt')
    const src = r.contentType === 'application/pdf'
      ? 'data:application/pdf;base64,' + r.data
      : 'data:' + r.contentType + ';base64,' + r.data
    drawer('打款回单 · ' + esc(r.name), r.contentType === 'application/pdf'
      ? `<object data="${src}" type="application/pdf" style="width:100%;height:80vh"></object>`
      : `<img src="${src}" style="max-width:100%">`)
  } catch (e) { toast(e.message, true) }
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
