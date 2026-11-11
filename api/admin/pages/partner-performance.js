async function partnerPerformancePage() {
  const Q=window.__partnerPerfQ ||= {kind:'city',sort:'gmv',page:1}
  const load=window.__partnerPerfLoad=(window.__partnerPerfLoad||0)+1
  let d
  try { d=await api('GET','/admin/partner-performance?'+new URLSearchParams(Q)) }
  catch(e) { if(load===window.__partnerPerfLoad&&location.hash==='#partnerperf') $('#app').innerHTML=`<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="partnerPerformancePage()">重试</button></div>`;return }
  if(load!==window.__partnerPerfLoad||location.hash!=='#partnerperf') return
  const labels={city:'城市合伙人',promoter:'推广服务商',cocreator:'共创人'}
  const metrics={city:[['gmv','有效 GMV'],['orders','有效订单'],['merchants','商户数']],promoter:[['gmv','有效 GMV'],['earned','已放行佣金'],['paid','已登记提现打款']],cocreator:[['profit','累计分润'],['paid','已登记分润打款'],['return_rate','累计回款比例']]}
  const cols=metrics[d.kind]
  $('#app').innerHTML=`<div class="card"><div class="card-head"><h2>合伙人排行与对账</h2><span class="muted">累计业绩 · ${d.total} ${d.kind==='city'?'座城市':'条登记'}</span></div>
    <div class="cfg-tabs">${Object.entries(labels).filter(([k])=>(!ME.scopeCity&&ME.role!=='city_partner')||k==='city').map(([k,n])=>`<button class="cfg-tab ${Q.kind===k?'on':''}" data-kind="${k}" onclick="window.__partnerPerfQ={kind:this.dataset.kind,sort:this.dataset.kind==='cocreator'?'profit':'gmv',page:1};partnerPerformancePage()">${n}</button>`).join('')}</div>
    <div class="orders-search"><label>排行指标 <select aria-label="排行指标" onchange="window.__partnerPerfQ.sort=this.value;window.__partnerPerfQ.page=1;partnerPerformancePage()">${cols.map(([k,n])=>`<option value="${k}" ${d.sort===k?'selected':''}>${n}</option>`).join('')}</select></label><span class="td-sub">降序，同值按编号排序；城市按城市去重，共创按合同登记。</span></div>
    <p class="td-sub">${d.kind==='city'?'城市经营不是个人分红；对账展示本城商户结算。':d.kind==='promoter'?'有效 GMV 仅计有效计佣订单；佣金放行、结算与提现到账分别列示。':'回款比例=已登记打款/登记投资，非净收益率。付款明细与回单在共创分润中核对。'}</p>
    ${d.rows.length?`<table><thead><tr><th>排名</th><th>${labels[d.kind]}</th>${cols.map(([,n])=>`<th>${n}</th>`).join('')}<th></th></tr></thead><tbody>${d.rows.map(r=>`<tr><td>${r.rank}</td><td>${esc(d.kind==='city'?(CITY_CN[r.id]||r.id):r.name||'未命名')}${r.co_no?`<div class="td-sub">${esc(r.co_no)}</div>`:''}</td>${cols.map(([k])=>`<td>${k==='return_rate'?(r[k]==null?'—':pct(r[k])):['orders','merchants'].includes(k)?PN(r[k]):fen(r[k])}</td>`).join('')}<td><button class="btn ghost sm" data-kind="${d.kind}" data-id="${esc(r.id)}" onclick="partnerReconcile(this.dataset.kind,this.dataset.id)">查看对账</button></td></tr>`).join('')}</tbody></table>`:emptyBox('暂无合伙人业绩登记')}
    <div class="pagination"><span>第 ${d.page} 页 · 每页 ${d.size} 条</span><div><button class="btn ghost sm" ${d.page<=1?'disabled':''} onclick="window.__partnerPerfQ.page--;partnerPerformancePage()">上一页</button><button class="btn ghost sm" ${d.page*d.size>=d.total?'disabled':''} onclick="window.__partnerPerfQ.page++;partnerPerformancePage()">下一页</button></div></div></div>${operatingScenarioPanel()}`
  void mountOperatingScenario($('#app'))
}

async function partnerReconcile(kind,id) {
  if(kind) window.__partnerLedgerQ={kind,id,tab:'commission',page:1}
  const Q={...window.__partnerLedgerQ},load=window.__partnerLedgerLoad=(window.__partnerLedgerLoad||0)+1
  let d
  try { d=await api('GET',`/admin/partner-reconciliation/${encodeURIComponent(Q.kind)}/${encodeURIComponent(Q.id)}?`+new URLSearchParams({tab:Q.tab,page:Q.page})) }
  catch(e) { if(load===window.__partnerLedgerLoad) reviewDrawer('对账加载失败',`<p>${esc(e.message)}</p><button class="btn primary" onclick="partnerReconcile()">重试</button>`,'');return }
  if(load!==window.__partnerLedgerLoad) return
  const s=d.summary
  let cards,note,tabs=''
  if(d.kind==='city') {
    cards=stat('结算单',d.total)+stat('商户应付合计',fen(s.payable))+stat('已登记打款',fen(s.paid))
    note='按本城商户结算单核对订单数、订单净额、五口径及退改费；混入外城订单或退改费的整单不展示。账内一致不代表银行到账核验，不是城市合伙人个人分红。'
  } else if(d.kind==='promoter') {
    cards=stat('已放行佣金',fen(s.earned),`观察期 ${fen(s.observing)} · 冲正/无效 ${fen(s.reversed)}`)+stat('已登记提现打款',fen(s.paid),`待审申请 ${fen(s.pending)}`)+stat('账面未提现',fen(s.balance),`扣待审后 ${fen(s.after_pending)}`)
    note=`${PN(d.user_status)!==1?'账号已冻结，资金动作暂停。':''}${s.balance<0?'异常：已打款超过当前有效放行佣金。':''}${s.after_pending<0?'异常：待审申请超过账面余额。':''}计佣按入账时基数/费率快照复算；商户结算单不是推广商打款回单。待审提现仅作核对展示，不代表已冻结余额。`
    tabs=`<div class="cfg-tabs">${[['commission','计佣明细'],['withdrawal','提现明细']].map(([k,n])=>`<button class="cfg-tab ${d.tab===k?'on':''}" data-tab="${k}" onclick="window.__partnerLedgerQ.tab=this.dataset.tab;window.__partnerLedgerQ.page=1;partnerReconcile()">${n}</button>`).join('')}</div>`
  } else {
    cards=stat('累计分润',fen(s.profit))+stat('待登记打款',fen(s.pending))+stat('已登记打款',fen(s.paid),'无银行回单字段')
    note='按来源结算单及商品收入占比复算分润基数。历史合同费率未快照，不用当前比例判定历史分润额对错；已打款仅为状态登记，仍缺银行回单证据。'
  }
  reviewDrawer(`结算对账 · ${esc(d.kind==='city'?(CITY_CN[d.name]||d.name):d.name)}`,`${d.kind==='city' ? '<div class="scenic-calc-context">' + scenicCalcHelpButton('city', Q.id) + '</div>' : ''}<div class="pstats">${cards}</div><p class="td-sub">${esc(note)}</p>${tabs}${partnerLedgerRows(d)}
    <div class="pagination"><span>第 ${d.page} 页 · 共 ${d.total} 条</span><div><button class="btn ghost sm" ${d.page<=1?'disabled':''} onclick="window.__partnerLedgerQ.page--;partnerReconcile()">上一页</button><button class="btn ghost sm" ${d.page*d.size>=d.total?'disabled':''} onclick="window.__partnerLedgerQ.page++;partnerReconcile()">下一页</button></div></div>`,'')
}

function partnerLedgerRows(d) {
  if(!d.rows.length) return emptyBox('暂无对账明细')
  const issue=r=>r.issues.length?`<span class="pill warn">${esc(r.issues.join('；'))}</span>`:'<span class="pill ok">账内检查一致</span>'
  let heads,rows
  if(d.kind==='city') {
    heads=['结算单 / 周期','商户','结算净额 / 来源净额','应付商户','状态 / 回单','核对']
    rows=d.rows.map(r=>[`#${r.id} · ${esc(r.period)}`,esc(r.merchant_name),`${fen(r.total_amount)} / ${fen(r.source_total)}`,fen(r.payable),`${['待确认','待复核','待打款','已登记打款','异议'][r.status]||'未知'}<br>${esc(r.payment_ref||'—')}`,issue(r)])
  } else if(d.kind==='promoter'&&d.tab==='commission') {
    heads=['订单 / 商户结算','计佣基数','快照费率','入账 / 复算','佣金状态','核对']
    rows=d.rows.map(r=>[`${esc(r.order_no||'来源缺失')}<br>${r.settlement_id?'#'+r.settlement_id+' '+esc(r.period||''):'未关联商户结算'}`,fen(r.base_amount),PN(r.rate_bp)/100+'%',`${fen(r.amount)} / ${fen(r.expected)}`,['观察期','已放行待结算','已结算（非到账）','已冲正','无效'][r.status]||'未知',issue(r)])
  } else if(d.kind==='promoter') {
    heads=['提现申请','金额','状态','申请 / 审核','打款流水','核对']
    rows=d.rows.map(r=>[`#${r.id}`,fen(r.amount),['待审','已登记打款','已驳回'][r.status]||'未知',`${dt(r.created_at)}<br>${dt(r.reviewed_at)}`,esc(r.pay_ref||'—'),issue(r)])
  } else {
    heads=['结算单 / 周期','商品','基数 / 复算基数','分润金额','状态','核对']
    rows=d.rows.map(r=>[`#${r.settlement_id} · ${esc(r.period)}`,esc(r.title||'来源缺失'),`${fen(r.base_amount)} / ${r.expected_base==null?'—':fen(r.expected_base)}`,fen(r.amount),PN(r.status)===1?'已登记打款（缺回单）':'待登记打款',issue(r)])
  }
  return `<table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(c=>`<tr>${c.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}
