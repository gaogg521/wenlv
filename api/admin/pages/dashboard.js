// 驾驶舱与小程序访问趋势
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

/* ============ 驾驶舱 ============ */
const KPI_ICON = {
  gmv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v18M16.5 7.5c-.8-1.5-2.5-2.3-4.5-2.3-2.6 0-4.5 1.4-4.5 3.4 0 4.6 9.5 2.5 9.5 7.2 0 2-2 3.5-4.8 3.5-2.2 0-4-.9-4.8-2.6"/></svg>',
  order: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.6L16 9.5"/></svg>',
  bean: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="12" cy="12" rx="6.5" ry="9" transform="rotate(35 12 12)"/><path d="M9 16c2-1.5 3.5-5 6-8"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3 2.5 20h19zM12 10v4.5M12 17.5v.3"/></svg>',
  trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></svg>',
}
async function dash() {
  try {
  $('#app').innerHTML = `<div class="kpi-grid">${Array(6).fill('<div class="kpi"><div class="sk" style="width:44px;height:44px;border-radius:12px"></div><div style="flex:1"><div class="sk" style="height:12px;width:60%;margin-bottom:8px"></div><div class="sk" style="height:22px;width:40%"></div></div></div>').join('')}</div>
    <div class="card"><div class="sk" style="height:220px"></div></div>`
  const R = window.__dashRange || (window.__dashRange = { range: 'today', from: '', to: '' })
  const qs = new URLSearchParams({ range: R.range })
  if (R.range === 'custom') { qs.set('from', R.from); qs.set('to', R.to) }
  const k = await api('GET', '/admin/dash/kpi?' + qs.toString())
  const orders = await api('GET', '/admin/orders')
  const wxd = await api('GET', '/admin/wxdata/visit-trend').catch(() => ({ mock: true, list: [] }))
  const recent = orders.slice(0, 8)
  const cityTag = k.scopeCity ? `本城 ${k.scopeCity} 口径` : '全域口径'
  const inRange = k.range === 'today'
  const rangeCn = { today: '今日', '7d': '近 7 天', '30d': '近 30 天', '1y': '近一年' }[k.range] || (k.rangeLabel || '自定义')
  const kpis = [
    ['gmv', 't-amber', rangeCn + ' GMV', '¥' + Number(inRange ? k.gmvToday : k.gmvInRange).toLocaleString('zh-CN', { maximumFractionDigits: 2 }), cityTag + ' · 按支付时间'],
    ['order', 't-blue', rangeCn + '订单', inRange ? k.ordersToday : k.ordersInRange, '已支付以上状态'],
    ['check', 't-green', '核销率（累计）', k.verifyRate, '已核销 / 已签发凭证'],
    ['bean', 't-gold', '预算池水位', k.globalScope ? k.budgetUsage : '—', k.globalScope ? '已发放 / 批次总额' : '全域科目 · 仅总部可见'],
    ['alert', 't-red', '待处理告警', k.globalScope ? k.alerts : '—', k.globalScope ? (k.alerts ? '需要关注' : '一切正常') : '全域风控 · 仅总部'],
    ['trend', 't-violet', rangeCn + '订单（趋势合计）', (k.trend || []).reduce((s, t) => s + t.orders, 0), (k.scopeCity ? '本城' : '全域') + ' · ' + (k.range === 'today' ? '近 7 天趋势' : (k.rangeLabel || '') + ' 趋势')],
  ]
  const trend = k.trend || []
  const maxG = Math.max(...trend.map((t) => Number(t.gmv)), 1)
  const W = 860, H = 170, P = 26
  const pts = trend.map((t, i) => [P + (i * (W - 2 * P)) / Math.max(trend.length - 1, 1), H - P - (Number(t.gmv) / maxG) * (H - 2 * P)])
  const path = pts.length ? 'M' + pts.map((p) => p.join(',')).join(' L') : ''
  const area = path ? path + ` L${pts[pts.length - 1][0]},${H - P} L${pts[0][0]},${H - P} Z` : ''
  const w3 = await api('GET', '/admin/web3/overview').catch(() => null)
  const ins = await api('GET', '/admin/dash/insights').catch(() => null)
  const P_ = ins ? ins.pending : null
  const todoTotal = P_ ? P_.notes + P_.merchants + P_.withdrawals + P_.conflicts + P_.tasks : 0
  const todo = (k, label, n, verb) => `<button class="task-link${n ? ' has' : ''}" onclick="go('${k}')"><span>${label}</span><b>${n}</b>${n ? verb + ' →' : '已清空'}</button>`
  const hour = new Date().getHours()
  const hello = (hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好') + '，' + esc(ME?.displayName || ME?.username || '')
  $('#app').innerHTML = `
  <section class="dash-hero"><div><div class="dash-eyebrow">${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</div>
    <h2>${hello}</h2><p>${todoTotal ? `今天有 <b>${todoTotal}</b> 项待处理，建议先从下方待办开始。` : '待办已全部处理完毕，可以看看经营趋势。'}</p></div>
    <div class="dash-hero-kpi"><span>${rangeCn} GMV</span><b>¥${(k.trend || []).reduce((s, t) => s + Number(t.gmv || 0), 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</b><small>${esc(cityTag)} · ${(k.trend || []).reduce((s, t) => s + t.orders, 0)} 单</small></div></section>
  <div class="card" style="margin-bottom:16px"><div class="row" style="align-items:center;flex-wrap:wrap">
    <b style="margin-right:8px">统计范围</b>
    ${[['today','今日'],['7d','近 7 天'],['30d','近 30 天'],['1y','近一年']].map(function (p) {
      return '<button class="cfg-tab ' + (k.range === p[0] ? 'on' : '') + '" onclick="window.__dashRange.range=\'' + p[0] + '\';window.__dashRange.from=\'\';window.__dashRange.to=\'\';dash()">' + p[1] + '</button>'
    }).join('')}
    <button class="cfg-tab ${k.range === 'custom' ? 'on' : ''}" onclick="var x=document.getElementById('dashCustom');x.style.display=x.style.display==='none'?'flex':'none'">自定义</button>
    <span id="dashCustom" style="display:${k.range === 'custom' ? 'flex' : 'none'};gap:8px;align-items:center;margin-left:8px">
      <input type="date" id="dashFrom" value="${window.__dashRange.from || ''}" class="inp" style="width:140px"> <span class="muted">~</span> <input type="date" id="dashTo" value="${window.__dashRange.to || ''}" class="inp" style="width:140px">
      <button class="btn primary sm" onclick="window.__dashRange.from=document.getElementById('dashFrom').value;window.__dashRange.to=document.getElementById('dashTo').value;if(!window.__dashRange.from||!window.__dashRange.to)return toast('请选择起止日期',true);window.__dashRange.range='custom';dash()">应用</button>
    </span>
    <span class="muted" style="margin-left:auto">${esc(k.rangeLabel || rangeCn)} · 口径：已支付以上订单按支付时间</span>
  </div></div>
  ${P_ ? `<div class="card todo-card"><div class="card-head"><h3>今日待办 <span class="muted">· ${cityTag}</span></h3>
      <span class="${todoTotal ? 'pill s10' : 'pill s50'}">${todoTotal ? '共 ' + todoTotal + ' 项待处理' : '全部处理完毕'}</span></div>
    <div class="todo-row">
      ${todo('merchants', '商户进件', P_.merchants, '去审批')}
      ${todo('withdrawals', '提现待审', P_.withdrawals, '去复核')}
      ${todo('conflicts', '核销异常', P_.conflicts, '去处理')}
      ${todo('content', '内容待审', P_.notes, '去审核')}
      ${todo('tasks', '约稿待审', P_.tasks, '去处理')}
    </div></div>` : ''}
  <div class="kpi-grid">${kpis.map(([ic, bg, l, v, s]) => `
    <div class="kpi ${bg}"><div class="ico">${KPI_ICON[ic] || ''}</div>
    <div><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div></div>`).join('')}
  </div>
  <div class="card chart-box">
    <div class="card-head"><h3>近 7 日 GMV 走势</h3><span class="muted">单位：元</span></div>
    <svg viewBox="0 0 ${W} ${H}" height="${H}">
      <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2563eb" stop-opacity=".28"/><stop offset="1" stop-color="#2563eb" stop-opacity=".02"/></linearGradient></defs>
      ${[0.25, 0.5, 0.75].map((r) => `<line x1="${P}" x2="${W - P}" y1="${H * r}" y2="${H * r}" stroke="#eef1f5" stroke-dasharray="4 4"/>`).join('')}
      ${area ? `<path d="${area}" fill="url(#ga)"/><path d="${path}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>` : ''}
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#2563eb" stroke-width="2"><title>${trend[i].date}：¥${trend[i].gmv}（${trend[i].orders} 单）</title></circle>`).join('')}
      ${trend.map((t, i) => `<text x="${pts[i][0]}" y="${H - 6}" font-size="10.5" fill="#8595a8" text-anchor="middle">${t.date.slice(5)}</text>`).join('')}
    </svg>
    ${trend.length ? '' : emptyBox('暂无成交数据——去「商品与团期」上架第一条线路吧')}
  </div>
  ${wxd.list && wxd.list.length && !wxd.mock ? miniVisitCard(wxd) : `<div class="card chart-box"><div class="card-head"><h3>小程序访问趋势</h3></div>
    ${emptyBox('尚未接入微信数据分析：在「集成中心」配置小程序 AppSecret 后显示真实 PV/UV（不展示模拟曲线）')}</div>`}
  ${ins ? `<div class="card"><div class="card-head"><h3>热门主题游 TOP5 <span class="muted">· 已支付口径</span></h3>
      <div class="row" style="gap:20px;margin:0">
        <span class="muted">报名→支付 <b>${ins.funnel.payRate}</b></span>
        <span class="muted">复购线索 <b>${ins.funnel.rebuyRate}</b></span>
        <span class="muted" title="累计抵扣旅豆 ÷ 累计发放旅豆">旅豆使用率 <b>${ins.funnel.beanUseRate}</b></span>
      </div></div>
    <table><thead><tr><th>#</th><th>主题游</th><th>订单</th><th>GMV</th></tr></thead><tbody>
    ${ins.topTours.map((t, i) => `<tr><td class="num">${i + 1}</td><td>${esc(t.title)}</td><td class="num">${Number(t.orders)}</td><td class="num">¥${(Number(t.gmv) / 100).toFixed(0)}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无数据</td></tr>'}
    </tbody></table></div>` : ''}
  <div class="card">
    <div class="card-head"><h3>最近订单</h3><button class="btn ghost sm" onclick="go('orders')">全部订单 →</button></div>
    ${recent.length ? `<table><thead><tr><th>单号</th><th>商品</th><th>用户</th><th>金额</th><th>状态</th><th>支付时间</th></tr></thead><tbody>
      ${recent.map((o) => `<tr style="cursor:pointer" onclick="orderDrawer('${o.order_no}')">
        <td class="num">${esc(o.order_no)}</td><td class="td-main">${esc(o.title)}</td><td>${esc(o.nickname)}</td>
        <td class="money num">${fen(o.amount_pay)}</td><td><span class="pill s${o.status}">${ST[o.status]}</span></td>
        <td class="td-sub">${esc(String(o.paid_at || o.created_at || '').slice(5, 16))}</td></tr>`).join('')}</tbody></table>` : emptyBox('还没有订单')}
  </div>`
  } catch (e) {
    console.error('dash error:', e.message)
    toast(e.message || '驾驶舱加载失败', true)
    $('#app').innerHTML = '<div class="empty"><div class="e-ico">⚠</div>驾驶舱加载失败</div>'
  }
}


/* ============ 小程序访问趋势（官方数据分析，未配置凭据=MOCK） ============ */
function miniVisitCard(wxd) {
  const list = wxd.list, W = 860, H = 150, P = 26
  const maxV = Math.max(...list.map((t) => t.visitPv), 1)
  const pts = list.map((t, i) => [P + (i * (W - 2 * P)) / Math.max(list.length - 1, 1), H - P - (t.visitPv / maxV) * (H - 2 * P)])
  const path = 'M' + pts.map((p) => p.join(',')).join(' L')
  const area = path + ` L${pts[pts.length - 1][0]},${H - P} L${pts[0][0]},${H - P} Z`
  return `<div class="card chart-box">
    <div class="card-head"><h3>小程序访问趋势</h3><span class="muted">PV/UV · ${wxd.mock ? 'MOCK 演示（集成中心配置小程序凭据后为真实数据）' : '微信官方数据分析'}</span></div>
    <svg viewBox="0 0 ${W} ${H}" height="${H}">
      <defs><linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5b8def" stop-opacity=".25"/><stop offset="1" stop-color="#5b8def" stop-opacity=".02"/></linearGradient></defs>
      ${[0.5].map((r) => `<line x1="${P}" x2="${W - P}" y1="${H * r}" y2="${H * r}" stroke="#eef1f5" stroke-dasharray="4 4"/>`).join('')}
      <path d="${area}" fill="url(#gv)"/><path d="${path}" fill="none" stroke="#5b8def" stroke-width="2.5" stroke-linecap="round"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#5b8def" stroke-width="2"><title>${list[i].date}：PV ${list[i].visitPv} · UV ${list[i].visitUv}</title></circle>`).join('')}
      ${list.map((t, i) => `<text x="${pts[i][0]}" y="${H - 6}" font-size="10.5" fill="#8595a8" text-anchor="middle">${t.date.slice(5)}</text>`).join('')}
    </svg>
  </div>`
}
