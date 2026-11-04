// 统一资金工作台（T11）：四条资金线待办聚合 + 异常提示 + 下钻；只读，不改任何账。
// 口径如实标识：登记已付 ≠ 外部渠道确认到账（外部通道未接入，均为人工回单登记）。
async function fund() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const d = await api('GET', '/admin/fund-workbench')
  const yuan = (f) => '¥' + (Number(f || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>资金待办全景</h2><span class="muted">只读聚合 · 每条线保留各自账本与办理入口，点「去办理」下钻源业务</span></div>
    <p class="td-sub">⚠ ${esc(d.metricNote)}</p>
    <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-top:12px">
    ${d.lines.map((l) => `<div class="kpi"><div class="ico" style="background:var(--brand-soft)">💰</div>
      <div><div class="l">${esc(l.label)} · 待办</div><div class="v">${yuan(l.pending.amount)}</div>
      <div class="s">${l.pending.count} 笔待办${l.paidCount != null ? ' · 已登记回单 ' + l.paidCount + ' 笔' : ''}</div>
      ${l.issues.length ? l.issues.map((x) => `<div style="color:var(--red);margin-top:4px">⚠ ${esc(x)}</div>`).join('') : '<div class="td-sub" style="color:var(--green)">无异常标记</div>'}
      <div style="margin-top:8px"><button class="btn primary sm" onclick="go('${l.goto}')">去办理 →</button></div></div></div>`).join('')}
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>对账口径说明</h2></div>
    <ul class="tl">
      <li><div class="t">应付来源</div><div class="d">商户结算=完成订单五口径；提现=佣金可提余额申请；现金加奖=投稿通过奖励；共创分润=结算期留存毛利切分</div></li>
      <li><div class="t">申请/审批</div><div class="d">结算需商户确认+财务复核；提现财务审批；分润超阈值需超管复核（登记人≠复核人）</div></li>
      <li><div class="t">回单登记</div><div class="d">各线登记唯一真实流水号；重复流水/缺回单在源业务与对账页提示</div></li>
      <li><div class="t">外部确认</div><div class="d"><b>未接入</b>：无银行/支付渠道回执核对，"登记已付"即本系统终点，不宣称到账</div></li>
    </ul>
  </div>`
}
