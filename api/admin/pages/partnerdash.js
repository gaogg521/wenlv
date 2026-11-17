// 主体方经营看板（V82）：商户/景区主体方登录 PC 的默认首页。
// 只读聚合，口径与各源账一致（订单实付/退款已结算/结算应付含调整）；不含平台内部成本与其他主体数据。
// R-01：超管可从预览页选择一个主体进入只读代看（顶部固定横幅 + 一键退出 + 进入/退出审计）。
window.partnerDashPage = async function () {
  window.__partnerDashLoad = (window.__partnerDashLoad || 0) + 1
  const load = window.__partnerDashLoad
  // R-01：代看参数从地址栏透传（#partnerdash?viewAsType=merchant&viewAsId=3）
  const hq = new URLSearchParams(location.hash.split('?')[1] || '')
  const viewAsQs = hq.get('viewAsType') ? '?viewAsType=' + encodeURIComponent(hq.get('viewAsType')) + '&viewAsId=' + encodeURIComponent(hq.get('viewAsId') || '') : ''
  let d
  try { d = await api('GET', '/admin/partner-dash' + viewAsQs) } catch (e) {
    if (load === window.__partnerDashLoad && location.hash.replace('#', '').split('?')[0] === 'partnerdash') {
      $('#app').innerHTML = `<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="partnerDashPage()">重试</button></div>`
    }
    return
  }
  if (load !== window.__partnerDashLoad || location.hash.replace('#', '').split('?')[0] !== 'partnerdash') return
  // C-04：超管只读预览——不冒充主体数据，明确告知查看口径；R-01：有 partner.viewAs 能力时给出主体选择入口
  if (d.previewOnly) {
    const canViewAs = adminCan('partner.viewAs')
    $('#app').innerHTML = `<div class="card">
      <div class="card-head"><h2>主体方经营看板 · 只读预览</h2><span class="pill s40">预览</span></div>
      <p class="td-sub" style="margin:-6px 0 12px">${esc(d.previewNote || '')}</p>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">订单（已支付后状态）</div><div class="kpi-value">0</div><div class="td-sub">按主体授权范围聚合 · 预览为全零</div></div>
        <div class="kpi"><div class="kpi-label">退款（已成功）</div><div class="kpi-value">0</div><div class="td-sub">按结清时间</div></div>
        <div class="kpi"><div class="kpi-label">结算单</div><div class="kpi-value">0</div><div class="td-sub">应付/已付按主体口径</div></div>
      </div>
      ${canViewAs ? `<div class="card-head" style="margin-top:16px"><h3>以主体视角只读查看</h3></div>
      <p class="muted" style="margin:-6px 0 10px">选择一个商户或景区主体，以该主体的授权范围只读查看经营数据（进入/退出都会记入审计；代看模式下所有写操作被拒绝）。</p>
      <div class="row" style="gap:10px;flex-wrap:wrap">
        <select id="viewAsMerchant" style="max-width:280px"><option value="">商户主体…</option></select>
        <select id="viewAsScenic" style="max-width:280px"><option value="">景区主体…</option></select>
        <button class="btn primary sm" onclick="partnerViewAsEnter()">进入只读代看</button>
      </div>
      <p class="td-sub" id="viewAsErr" style="color:var(--red);margin-top:8px"></p>` : '<p class="muted" style="margin-top:12px">真实经营数据请用商户/景区主体方账号登录查看（数据按主体行级隔离）。</p>'}
    </div>`
    if (canViewAs) partnerViewAsFillOptions()
    return
  }
  const fen = v => '¥' + (Number(v || 0) / 100).toFixed(2)
  const isMerchant = d.kind === 'merchant'
  // R-01：代看横幅——顶部固定展示当前视角与退出按钮
  const viewAsBanner = d.viewAs
    ? `<div class="card" style="border-left:4px solid #d97706;margin-bottom:12px"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <b>正在以 ${esc(d.subject.name)} 视角只读查看 · 所有写操作已禁用</b>
        <button class="btn ghost sm" onclick="partnerViewAsExit()">退出代看</button></div></div>`
    : ''
  const sub = `<span class="muted">${esc(d.subject.name)}（#${d.subject.id} · ${esc(d.subject.cityCode)}） · 近 ${d.windowDays} 天</span>`
  const cards = [
    ['订单（已支付后状态）', String(d.recent.orders), fen(d.recent.gmvFen) + ' 实付'],
    ['退款（已成功，按结清时间）', String(d.refunds.count), fen(d.refunds.amountFen)],
    [isMerchant ? '结算单' : '本景区结算投影', String(d.settlement.count), `${isMerchant ? '应付' : '估算应付'} ${fen(d.settlement.payableFen)} · ${isMerchant ? '已付' : '已付款账单投影'} ${fen(d.settlement.paidFen)}`],
  ]
  const extra = isMerchant
    ? [['待履约订单项', String(d.pendingItems), '本店待履约（含按人凭证与服务项）'], ['在库商品', String(d.products), '本店商品（可在「商品与团期」自维护）']]
    : [['关联商户', String(d.boundMerchants), '本景区商品绑定的商户'], ['经营复盘', String(d.reviews), '已保存的景区算账复盘次数']]
  $('#app').innerHTML = `${viewAsBanner}<div class="card">
    <div class="card-head"><h2>${isMerchant ? '商户' : '景区'}主体方经营看板${d.viewAs ? ' · 只读代看' : ''}</h2></div>
    <p class="muted" style="margin:-8px 0 14px">${sub} · 数据口径与各源账一致：${isMerchant ? '订单为实付，结算包含履约及手续费分成。' : '结算按本景区订单行和账单比例估算，已付款账单投影仅作复盘参考。'}</p>
    <div class="kpi-grid">${cards.concat(extra).map(([t, v, s]) => `
      <div class="kpi"><div class="kpi-label">${t}</div><div class="kpi-value">${esc(v)}</div><div class="td-sub">${s}</div></div>`).join('')}
    </div>
    <div class="scenic-calc-context">${scenicCalcHelpButton(isMerchant ? 'merchant' : 'scenic', d.subject.id)}</div>
    <div class="card-head" style="margin-top:16px"><h3>下一步</h3></div>
    <p class="muted" style="margin:-6px 0 0">
      ${d.viewAs
        ? `下钻同主体范围数据：<button class="btn ghost sm" onclick="go('orders?viewAsType=${encodeURIComponent(d.subject.kind || (isMerchant ? 'merchant' : 'scenic'))}&viewAsId=${d.subject.id}')">订单管理</button>
           <button class="btn ghost sm" onclick="go('settlements?viewAsType=${encodeURIComponent(isMerchant ? 'merchant' : 'scenic')}&viewAsId=${d.subject.id}')">商户周结算</button>
           <button class="btn ghost sm" onclick="go('products?viewAsType=${encodeURIComponent(isMerchant ? 'merchant' : 'scenic')}&viewAsId=${d.subject.id}')">商品与团期</button>（只读）`
        : isMerchant
          ? '订单与结算明细见「订单管理」「商户周结算」；本店商品/团期可在「商品与团期」维护（仅本店）。'
          : '本景区算账与复盘见「景区资源」→「经营测算」；订单与关联商户结算见「订单管理」「商户周结算」。'}
    </p>
  </div>${d.viewAs ? '' : operatingScenarioPanel()}`
  if (!d.viewAs) void mountOperatingScenario($('#app'))
}

// ---- R-01：主体只读代看 ----
async function partnerViewAsFillOptions() {
  try {
    const [merchants, scenics] = await Promise.all([api('GET', '/admin/merchants'), api('GET', '/admin/scenics')])
    const mRows = Array.isArray(merchants) ? merchants : (merchants.rows || [])
    const sRows = Array.isArray(scenics) ? scenics : (scenics.rows || [])
    const mSel = document.getElementById('viewAsMerchant'), sSel = document.getElementById('viewAsScenic')
    if (mSel) mSel.innerHTML = '<option value="">商户主体…</option>' + mRows.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')
    if (sSel) sSel.innerHTML = '<option value="">景区主体…</option>' + sRows.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
  } catch (e) { const el = document.getElementById('viewAsErr'); if (el) el.textContent = '主体列表加载失败：' + e.message }
}
window.partnerViewAsEnter = async function () {
  const mSel = document.getElementById('viewAsMerchant'), sSel = document.getElementById('viewAsScenic')
  const type = mSel && mSel.value ? 'merchant' : (sSel && sSel.value ? 'scenic' : '')
  const id = type === 'merchant' ? mSel.value : (type === 'scenic' ? sSel.value : '')
  if (!type) { document.getElementById('viewAsErr').textContent = '请先选择一个商户或景区主体'; return }
  try {
    await api('POST', '/admin/partner-dash/view-as', { subjectType: type, subjectId: Number(id) }) // 进入代看记审计
    history.replaceState(null, '', '#partnerdash?viewAsType=' + type + '&viewAsId=' + id)
    partnerDashPage()
  } catch (e) { document.getElementById('viewAsErr').textContent = e.message }
}
window.partnerViewAsExit = async function () {
  try { await api('POST', '/admin/partner-dash/view-as', { subjectId: null }) } catch (e) { /* 退出审计失败不阻断 */ }
  history.replaceState(null, '', '#partnerdash')
  partnerDashPage()
}
