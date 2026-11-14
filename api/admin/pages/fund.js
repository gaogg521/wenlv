// 统一资金工作台（T11）：四条资金线待办聚合 + 异常提示 + 下钻；只读，不改任何账。
// 口径如实标识：登记已付 ≠ 外部渠道确认到账（外部通道未接入，均为人工回单登记）。
async function fund() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const d = await api('GET', '/admin/fund-workbench')
  const yuan = (f) => '¥' + (Number(f || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
  const showEcon = ['super', 'finance', 'ops'].includes(ME.role)
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>资金待办全景</h2>${['super','finance','ops'].includes(ME.role)?'<button class="btn ghost sm" onclick="freedomPanel()">自由豆规则与发放</button>':''}${['super','finance'].includes(ME.role)?'<button class="btn primary sm" onclick="freedomFinance()">自由豆补贴对账</button>':''}<span class="muted">只读聚合 · 每条线保留各自账本与办理入口，点「去办理」下钻源业务</span></div>
    <p class="td-sub">⚠ ${esc(d.metricNote)}</p>
    <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-top:12px">
    ${d.lines.map((l) => `<div class="kpi go" ${dxKey} title="去办理：${esc(l.label)}" onclick="go('${l.goto}')"><i class="go-arrow">↗</i><div class="ico" style="background:var(--brand-soft)">💰</div>
      <div><div class="l">${esc(l.label)} · 待办</div><div class="v">${yuan(l.pending.amount)}</div>
      <div class="s">${l.pending.count} 笔待办${l.paidCount != null ? ' · 已登记回单 ' + l.paidCount + ' 笔' : ''}</div>
      ${l.issues.length ? l.issues.map((x) => `<div style="color:var(--red);margin-top:4px">⚠ ${esc(x)}</div>`).join('') : '<div class="td-sub" style="color:var(--green)">无异常标记</div>'}
      <div style="margin-top:8px"><button class="btn primary sm" onclick="event.stopPropagation();go('${l.goto}')">去办理 →</button></div></div></div>`).join('')}
    </div>
  </div>
  ${showEcon ? `<div class="card"><div class="card-head"><h2>经营看板 · 商品毛利与已知费用后收益</h2><span class="muted">实际成交口径（退款冲减）· 支付时间统计</span><button class="btn ghost sm" onclick="econBridge()">资金桥表</button></div>
    <div class="row" style="margin:8px 0">
      <input id="ecFrom" type="date" value="${econDefaultFrom()}"> <span class="td-sub">—</span> <input id="ecTo" type="date" value="${econDefaultTo()}">
      <input id="ecProduct" type="number" min="1" placeholder="产品ID（可空）" style="width:130px">
      <input id="ecCity" type="text" placeholder="城市代码（可空）" maxlength="6" style="width:110px">
      <button class="btn primary sm" onclick="economicsBoard()">查询</button>
    </div>
    <div id="econBoard">${skel(3)}</div>
    <p class="td-sub" style="margin-top:8px">"已知费用后收益"只扣减已接入的推广佣金；未含税费、工资、房租及全部期间费用，不冒充公司最终净利润；留存金额/GMV 均不等于平台净利润。汇总毛利率＝合计毛利÷合计同口径净销售额，不平均各单毛利率。</p>
  </div>` : ''}
  <div class="card">
    <div class="card-head"><h2>对账口径说明</h2></div>
    <ul class="tl">
      <li><div class="t">应付来源</div><div class="d">商户结算=完成订单五口径；提现=佣金可提余额申请；现金加奖=投稿通过奖励；共创分润=结算期留存毛利切分</div></li>
      <li><div class="t">申请/审批</div><div class="d">结算需商户确认+财务复核；提现财务审批；分润超阈值需超管复核（登记人≠复核人）</div></li>
      <li><div class="t">回单登记</div><div class="d">各线登记唯一真实流水号；重复流水/缺回单在源业务与对账页提示</div></li>
      <li><div class="t">外部确认</div><div class="d"><b>未接入</b>：无银行/支付渠道回执核对，"登记已付"即本系统终点，不宣称到账</div></li>
    </ul>
  </div>`
  if (showEcon) economicsBoard().catch((e) => { const el = document.getElementById('econBoard'); if (el) el.innerHTML = `<p class="muted">经营看板加载失败：${esc(e.message)}</p>` })
}
// ===== B12 经营看板 =====
const econStat = (label, value, sub) => `<div class="pstat"><div class="l">${label}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`
function econDateLocal(d) { return d.toLocaleDateString('en-CA') } // 本地日期（toISOString 是 UTC，凌晨会少一天）
function econDefaultFrom() { return econDateLocal(new Date(Date.now() - 29 * 86400000)) }
function econDefaultTo() { return econDateLocal(new Date()) }
async function economicsBoard() {
  const el = document.getElementById('econBoard')
  if (!el) return
  const from = document.getElementById('ecFrom').value, to = document.getElementById('ecTo').value
  const pid = document.getElementById('ecProduct').value.trim(), city = document.getElementById('ecCity').value.trim()
  el.innerHTML = '<div class="sk" style="height:80px"></div>'
  const d = await api('GET', `/admin/economics/dashboard?from=${from}&to=${to}${pid ? '&productId=' + pid : ''}${city ? '&city=' + city : ''}`)
  const num = (v) => v == null ? '<span class="muted">—</span>' : fen(v)
  const dimRows = (rows, keyLabel) => rows.length ? `<table><thead><tr><th>${keyLabel}</th><th>订单/人数</th><th>净销售额</th><th>直接成本</th><th>毛利</th><th>毛利率</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="td-main">${esc(r.title || r.key)}${r.costMissing ? `<div class="td-sub">⚠ ${r.costMissing} 单成本未维护（不可计算，未按0计）</div>` : ''}</td>
      <td class="num">${r.orders} / ${r.qty}</td><td class="num">${fen(r.netSalesFen)}</td><td class="num">${num(r.costFen)}</td>
      <td class="num">${r.profitFen != null ? '<b style="color:' + (r.profitFen < 0 ? 'var(--red)' : 'var(--green)') + '">' + fen(r.profitFen) + '</b>' : '—'}${r.negativeProfit ? ' <span class="pill warn">含负毛利</span>' : ''}</td>
      <td class="num" style="white-space:nowrap">${r.marginPct != null ? r.marginPct.toFixed(2) + '%' : '—'}</td></tr>`).join('')}</tbody></table>` : `<p class="td-sub">该维度暂无订单</p>`
  el.innerHTML = `
  <div class="pstats">
    ${econStat('净销售额', num(d.netSalesFen), d.orders + ' 单 · ' + d.qty + ' 人 · ' + esc(d.caliber))}
    ${econStat('直接成本', num(d.costFen), d.costMissing ? d.costMissing + ' 单成本未维护（不按0计）' : '下单快照合计')}
    ${econStat('商品经营毛利', d.profitFen != null ? num(d.profitFen) : '—', d.marginPct != null ? '毛利率 ' + d.marginPct.toFixed(2) + '%' : '毛利率 —（净销售额为0或成本缺失）')}
    ${econStat('已知费用后收益', d.operatingIncomeFen != null ? num(d.operatingIncomeFen) : '—', '扣推广佣金 ' + fen(d.commissionFen) + '；未含税费/工资/房租')}
  </div>
  <p class="td-sub">全额退款 ${d.refunedOrders} 单（冲减现金 ${fen(d.refundCashFen)}，实退以退款单为准）${d.pendingOrders ? ' · 另有 ' + d.pendingOrders + ' 单待支付/退款中未计入' : ''}${d.negativeProfit ? ' · 含 ' + d.negativeProfit + ' 单负毛利（保留并提示）' : ''} · 统计口径 ${esc(d.period.by)}，含税/未税与订单状态口径一致</p>
  <div class="rv-grid"><div><div class="rv-box"><div class="rv-h">按产品下钻（点单号看订单经营明细）</div>${dimRows(d.byProduct, '产品')}</div></div>
  <div><div class="rv-box"><div class="rv-h">按城市下钻</div>${dimRows(d.byCity, '城市')}</div></div></div>
  <p class="td-sub">确认成本/应付/实付：${esc(d.confirmed.note)}。资金来源与五口径关系随 B04 交付资金桥表。</p>`
}

// ===== B04 资金桥表：收入→成本→毛利→已知费用→收益（逐项口径、不重复扣减；每次查询落快照） =====
async function econBridge() {
  const from = document.getElementById('ecFrom').value, to = document.getElementById('ecTo').value
  const d = await api('GET', `/admin/economics/bridge?from=${from}&to=${to}`)
  const rows = d.rows.map((r) => `<tr><td class="td-main">${esc(r.label)}<div class="td-sub">${esc(r.caliber)}${r.note ? " · " + esc(r.note) : ""}</div></td><td class="money num" style="white-space:nowrap">${r.fen == null ? "—" : fen(r.fen)}</td></tr>`).join("")
  modal('资金桥表 · ' + from + ' → ' + to, `
    <p class="td-sub">${esc(d.note)} 恒等校验：${d.balanceOk === 1 ? '<b style="color:var(--green)">平</b>' : '<b style="color:var(--red)">不平（请核对）</b>'}</p>
    <table><thead><tr><th>项目 / 口径</th><th>金额</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="td-sub">确认成本=订单进入结算时回填（B01 快照口径）；未结算完成单按下单快照计为预计并在口径中标注；五口径是收入分配视角，桥表是利润视角，佣金同源不重复扣。</p>
  `, `<button class="btn ghost" onclick="closeModal()">关闭</button>`)
}