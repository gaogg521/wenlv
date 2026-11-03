// 普通脚本共享全局作用域，栏目私有状态统一放 window.__partnerQ。
async function partners() {
  const Q = window.__partnerQ ||= { kind: '', kw: '', page: 1 }
  const load = window.__partnerLoad = (window.__partnerLoad || 0) + 1
  let data
  try { data = await api('GET', '/admin/partners?' + new URLSearchParams(Q)) }
  catch (e) {
    if (load === window.__partnerLoad && location.hash === '#partners') $('#app').innerHTML = `<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="partners()">重试</button></div>`
    return
  }
  if (load !== window.__partnerLoad || location.hash !== '#partners') return
  const labels = { city: '城市合伙人', promoter: '推广服务商', cocreator: '共创人' }
  $('#app').innerHTML = `<div class="pstats">${data.counts.map(x => stat(labels[x.kind], PN(x.n), '当前筛选范围')).join('')}</div><div class="card"><div class="card-head"><h2>合伙人中心</h2><span class="muted">共 ${data.total} 个身份登记</span>
    ${adminCan('entity.promoter.edit') ? '<button class="btn primary sm" onclick="go(\'promoters\')">开通推广资格</button>' : ''}
    ${adminCan('entity.cocreator.create') ? '<button class="btn primary sm" onclick="entityEditor(\'cocreator\',null,{onSaved:()=>partners()})">登记共创人</button>' : ''}</div>
    <div class="td-sub">城市业绩按城市统计，同城多个账号共享经营数据；共创人按产品登记，不按姓名合并。推广及共创全局资金数据仅内部角色可见。</div>
    <form class="orders-search" onsubmit="event.preventDefault();window.__partnerQ.kw=this.kw.value.trim();window.__partnerQ.page=1;partners()">
      <input name="kw" aria-label="搜索合伙人" placeholder="名称 / 登记编号" value="${esc(Q.kw)}"><button class="btn primary">查询</button>
      <button type="button" class="btn ghost" onclick="window.__partnerQ={kind:'',kw:'',page:1};partners()">重置</button></form>
    <div class="cfg-tabs">${[['', '全部'], ...Object.entries(labels)].filter(([k]) => ME.role !== 'city_partner' || !k || k === 'city').map(([k, n]) => `<button class="cfg-tab ${Q.kind === k ? 'on' : ''}" onclick="window.__partnerQ.kind='${k}';window.__partnerQ.page=1;partners()">${n}</button>`).join('')}</div>
    ${data.rows.length ? `<table><thead><tr><th>名称</th><th>身份</th><th>登记编号</th><th>城市</th><th>状态</th><th>管理操作</th></tr></thead><tbody>${data.rows.map(p => `<tr><td>${esc(p.name || '未命名')}</td><td>${labels[p.kind]}</td><td>${esc(p.ref)}</td><td>${esc(CITY_CN[p.city_code] || p.city_code || '全平台')}</td><td>${p.kind === 'promoter' ? ['申请中','生效','冻结'][PN(p.status)] || '未知' : PN(p.status) === 1 ? '生效' : '停用'}</td><td><button class="btn ghost sm" onclick="partnerProfile('${p.kind}',${p.id})">业绩画像</button>${partnerEditButton(p.kind,p.id)}</td></tr>`).join('')}</tbody></table>` : emptyBox('没有符合条件的合伙人')}
    <div class="pagination"><span>第 ${data.page} 页 · 每页 ${data.size} 条</span><div><button class="btn ghost sm" ${data.page <= 1 ? 'disabled' : ''} onclick="window.__partnerQ.page--;partners()">上一页</button><button class="btn ghost sm" ${data.page * data.size >= data.total ? 'disabled' : ''} onclick="window.__partnerQ.page++;partners()">下一页</button></div></div></div>`
}

function partnerEditButton(kind, id) {
  // T02：城市行直达后台账号的角色/城市授权（不混进合作资料编辑器）
  if (kind === 'city') return adminCan('account.manage') ? `<button class="btn primary sm" onclick="closeModal();accountFromPartner(${Number(id)})">账号授权</button>` : '<span class="td-sub">城市账号授权由超级管理员维护</span>'
  const entity = kind === 'promoter' ? 'promoter' : 'cocreator'
  return adminCan(`entity.${entity}.edit`) ? `<button class="btn primary sm" onclick="closeModal();entityEditor('${entity}',${Number(id)},{onSaved:()=>partners()})">编辑合作资料</button>` : '<span class="td-sub">当前角色仅查看业绩</span>'
}

async function partnerProfile(kind, id) {
  let p
  try { p = await api('GET', `/admin/partners/${kind}/${id}`) } catch (e) { return toast(e.message, true) }
  let body = ''
  if (kind === 'city') body = `<div class="pstats">${stat('本城有效 GMV', fen(p.kpi.gmv), '已支付且未退款')}${stat('有效订单', PN(p.kpi.orders))}${stat('本城商户', PN(p.merchants.total), `近 30 日新增 ${PN(p.merchants.new30)}`)}</div><div class="rv-box"><div class="rv-h">本城近 14 日成交额</div>${dayBars(p.daily, { key: 'gmv', fmt: fen, label: '成交额' })}</div>`
  if (kind === 'promoter') body = `<div class="pstats">${stat('触达用户', PN(p.hits.users), '推广码去重用户')}${stat('成交用户', PN(p.trade.buyers), `${PN(p.trade.orders)} 单`)}${stat('有效成交额', fen(p.trade.gmv), '计佣订单关联的未退款成交')}</div><div class="rv-box">${kv('档位 / 费率', `${p.promoter.tier} 档 / ${PN(p.promoter.rate_bp) / 100}%`)}${kv('近 90 日有效 GMV', fen(p.promoter.valid_gmv_90d))}${kv('服务评分', esc(p.promoter.service_score))}${p.commissions.map(x => kv(['观察期','待结算','已结算','已冲正','无效'][PN(x.status)] || '未知', `${x.n} 笔 · ${fen(x.amount)}`)).join('')}</div>`
  if (kind === 'cocreator') body = `<div class="pstats">${stat('登记投资', fen(p.co.invest_amount))}${stat('已打款分润', fen(p.paid))}${stat('已回款 / 投资', p.returnRate == null ? '—' : pct(p.returnRate), '累计回款比例，非净收益率')}</div><div class="rv-box">${kv('关联商品', esc(p.co.title))}${kv('共创角色', PN(p.co.role) === 1 ? '资金商' : '商品商')}${kv('联系电话', esc(p.co.mobile))}${kv('分润比例', PN(p.co.share_pct) / 100 + '%')}${p.profits.length ? p.profits.map(x => kv(esc(x.period), `${fen(x.amount)} · ${PN(x.status) === 1 ? '已打款' : '待打款'}`)).join('') : '<div class="td-sub">暂无分润记录</div>'}</div>`
  reviewDrawer(`合伙人画像 · ${esc(p.partner.name || p.partner.ref)}`, `<div class="rv-box">${kv('登记编号', esc(p.partner.ref))}${kv('城市', esc(CITY_CN[p.partner.city_code] || p.partner.city_code || '全平台'))}</div>` + body, partnerEditButton(kind,id))
}
