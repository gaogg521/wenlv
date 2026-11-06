async function contentdash() {
  const load = window.__contentDashLoad = (window.__contentDashLoad || 0) + 1
  const page = window.__contentDashPage || 1
  let d
  try { d = await api('GET', '/admin/content-dashboard?page=' + page) }
  catch (e) {
    if (load === window.__contentDashLoad && location.hash === '#contentdash') $('#app').innerHTML = `<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="contentdash()">重试</button></div>`
    return
  }
  if (load !== window.__contentDashLoad || location.hash !== '#contentdash') return
  const s = d.stats
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h2>内容看板</h2><span class="muted">${d.scopeCity ? esc(CITY_CN[d.scopeCity] || d.scopeCity) : '全平台'} · 当前累计数据</span></div>
    <p class="td-sub">过审率 =（已发布 + 已下架）/（已发布 + 已下架 + 已驳回），按笔记当前状态统计；待审不计入分母。城市范围按关联线路归属，未关联或线路已删除的笔记仅平台可见。</p>
    <div class="pstats">${stat('当前发布量', s.published + ' 篇', `笔记总数 ${s.total}`, "window.__contentQ={page:1,status:'2',kw:''};go('content')", '去笔记审核：查看已发布的笔记')}${stat('过审率', s.passRate == null ? '—' : pct(s.passRate), `已判定 ${s.reviewed} · 待审 ${s.pending}`)}${stat('累计获赞', s.likes, '范围内全部笔记，含已下架', "document.getElementById('cdLikes').scrollIntoView({behavior:'smooth'})", '定位到已发布笔记获赞榜')}${stat('关联线路成交额', fen(d.trade.gmv), `${PN(d.trade.orders)} 单 · ${PN(d.trade.travelers)} 人次`, "document.getElementById('cdTrade').scrollIntoView({behavior:'smooth'})", '定位到关联线路成交明细')}</div>
    <p class="td-sub"><button type="button" class="inl-go" title="去笔记审核：已驳回" onclick="window.__contentQ={page:1,status:'3',kw:''};go('content')">已驳回 ${s.rejected}</button> · <button type="button" class="inl-go" title="去笔记审核：已下架" onclick="window.__contentQ={page:1,status:'4',kw:''};go('content')">已下架 ${s.offline}</button>${d.scopeCity ? '' : ` · 未关联有效线路 ${s.unlinked}`}</p></div>
    <div class="card"><div class="card-head"><h2>近 14 日发布</h2><span class="muted">按最近发布时间，含当前已下架；不代表逐次审核历史</span></div>${dayBars(d.daily, { label: '发布笔记', fmt: v => v + ' 篇' })}</div>
    <div class="card" id="cdTrade"><div class="card-head"><h2>关联线路成交</h2><span class="muted">${d.total} 条线路</span></div><p class="td-sub">只统计当前已发布笔记关联的线路；同一线路多篇笔记去重。成交为该线路全部已支付未退款订单，含笔记发布前成交，不代表笔记直接带来的购买。</p>
    ${d.products.length ? `<table><thead><tr><th>线路</th><th>城市</th><th>状态</th><th>已发布笔记</th><th>笔记获赞</th><th>有效订单</th><th>成交额</th></tr></thead><tbody>${d.products.map(p => `<tr ${dxKey} title="查看这条线路的有效订单" onclick="dxGo('orders',{productId:${Number(p.id)},pt:'${escJs(String(p.title))}',status:'20,30,40,50'})"><td>${esc(p.title)}</td><td>${esc(CITY_CN[p.city_code] || p.city_code)}</td><td>${PN(p.status) === 1 ? '在架' : '下架'}</td><td>${PN(p.notes)}</td><td>${PN(p.likes)}</td><td>${PN(p.orders)}</td><td>${fen(p.gmv)}</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无已发布笔记关联的线路')}
    <div class="pagination"><span>第 ${d.page} 页 · 共 ${d.total} 条</span><div><button class="btn ghost sm" ${d.page <= 1 ? 'disabled' : ''} onclick="window.__contentDashPage--;contentdash()">上一页</button><button class="btn ghost sm" ${d.page * d.size >= d.total ? 'disabled' : ''} onclick="window.__contentDashPage=(window.__contentDashPage||1)+1;contentdash()">下一页</button></div></div></div>
    <div class="card" id="cdLikes"><div class="card-head"><h2>已发布笔记获赞榜</h2><span class="muted">最多 10 篇</span></div>${d.notes.length ? `<table><thead><tr><th>笔记</th><th>关联线路</th><th>获赞</th><th>最近发布</th></tr></thead><tbody>${d.notes.map(n => `<tr><td>${esc(n.title || '（无题）')}</td><td>${esc(n.product_title || '未关联有效线路')}</td><td>${PN(n.like_count)}</td><td>${dt(n.published_at)}</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无已发布笔记')}</div>`
}
