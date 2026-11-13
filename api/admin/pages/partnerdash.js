// 主体方经营看板（V82）：商户/景区主体方登录 PC 的默认首页。
// 只读聚合，口径与各源账一致（订单实付/退款已结算/结算应付含调整）；不含平台内部成本与其他主体数据。
window.partnerDashPage = async function () {
  window.__partnerDashLoad = (window.__partnerDashLoad || 0) + 1
  const load = window.__partnerDashLoad
  let d
  try { d = await api('GET', '/admin/partner-dash') } catch (e) {
    if (load === window.__partnerDashLoad && location.hash.replace('#', '').split('?')[0] === 'partnerdash') {
      $('#app').innerHTML = `<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="partnerDashPage()">重试</button></div>`
    }
    return
  }
  if (load !== window.__partnerDashLoad) return
  const fen = v => '¥' + (Number(v || 0) / 100).toFixed(2)
  const isMerchant = d.kind === 'merchant'
  const sub = `<span class="muted">${esc(d.subject.name)}（#${d.subject.id} · ${esc(d.subject.cityCode)}） · 近 ${d.windowDays} 天</span>`
  const cards = [
    ['订单（已支付后状态）', String(d.recent.orders), fen(d.recent.gmvFen) + ' 实付'],
    ['退款（已成功，按结清时间）', String(d.refunds.count), fen(d.refunds.amountFen)],
    ['结算单', String(d.settlement.count), `应付 ${fen(d.settlement.payableFen)} · 已付 ${fen(d.settlement.paidFen)}`],
  ]
  const extra = isMerchant
    ? [['待履约订单项', String(d.pendingItems), '本店待履约（含按人凭证与服务项）'], ['在库商品', String(d.products), '本店商品（可在「商品与团期」自维护）']]
    : [['关联商户', String(d.boundMerchants), '本景区商品绑定的商户'], ['经营复盘', String(d.reviews), '已保存的景区算账复盘次数']]
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>${isMerchant ? '商户' : '景区'}主体方经营看板</h2></div>
    <p class="muted" style="margin:-8px 0 14px">${sub} · 数据口径与各源账一致：订单=实付（含保费代收口径另见订单详情）、结算应付=履约+手续费分成−已出账后调整；平台内部成本与其他主体数据不在本页范围。</p>
    <div class="kpi-grid">${cards.concat(extra).map(([t, v, s]) => `
      <div class="kpi"><div class="kpi-label">${t}</div><div class="kpi-value">${esc(v)}</div><div class="td-sub">${s}</div></div>`).join('')}
    </div>
    <div class="card-head" style="margin-top:16px"><h3>经营测算与示例</h3></div>
    <p class="muted" style="margin:-6px 0 8px">底部测算工具与已验收的经营分析一致：六项假设（订单量/客单价/综合变现率/变动成本率/权益成本率/固定成本）、月经营贡献结余、最少打平单量、四条单变量达标路径与敏感性表。朱家角示例（Codex 核验）：4,900 单月亏 ¥4,041，最少 5,013 单，最低变现率 20.21%；情景测算用于假设比较，实际收入/应付以订单与结算账本为准。</p>
    <button type="button" class="btn primary sm scenic-calc-help" data-context="${isMerchant ? 'merchant' : 'scenic'}" data-target="${d.subject.id}" onclick="openScenicCalcHelp(this)">❓ 经营测算（六项假设 · 四条路径 · 敏感性 · 朱家角示例）</button>
    <span class="muted" style="margin-left:10px">测算仅供估算；写入预算、付款、权益发放仍走既有审批与业务入口。</span>
    <div class="card-head" style="margin-top:16px"><h3>下一步</h3></div>
    <p class="muted" style="margin:-6px 0 0">
      ${isMerchant
        ? '订单与结算明细见「订单管理」「商户周结算」；本店商品/团期可在「商品与团期」维护（仅本店）。'
        : '本景区算账与复盘见「景区资源」→「经营测算」；订单与关联商户结算见「订单管理」「商户周结算」。'}
    </p>
  </div>`
}
