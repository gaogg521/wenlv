// 资源池：景区资源、供应商、资源关联商品
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

async function scenics() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  window.__kw = window.__kw || {}
  const all = await api('GET', '/admin/scenics')
  const K = (window.__kw.scenics || '').trim()
  const rows = K ? all.filter((s) => (s.name + (s.contact_name || '') + (s.city_code || '')).includes(K)) : all
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>景区资源</h2>
      <input id="sc_kw" placeholder="搜名称 / 联系人 / 城市码" style="width:200px" value="${esc(window.__kw.scenics || '')}" onchange="window.__kw.scenics=this.value;scenics()">
      <span class="muted">${K ? '筛出 ' + rows.length + ' / ' + all.length + ' 家' : '共 ' + all.length + ' 家'}</span>
      <span class="muted">G端合作台账 · 可在「商品与团期」把线路关联到景区</span>
      ${ME.role === 'super' ? '<button class="btn primary sm" onclick="scenicModal()">＋ 新增景区</button>' : ''}</div>
    ${rows.length ? `<table style="margin-top:10px"><thead><tr><th>景区</th><th>城市</th><th>等级</th><th>合作模式</th><th>票务对接</th><th>联系人</th><th>条款摘要</th><th>关联商品</th><th>状态</th><th></th></tr></thead><tbody>
    ${rows.map((s) => `<tr><td class="td-main">${esc(s.name)}</td><td class="num">${esc(s.city_code)}</td><td class="num">${esc(s.scenic_level || '—')}</td>
      <td>${esc(s.coop_mode || '—')}</td><td class="td-sub">${esc(s.ticket_interface || '—')}</td>
      <td class="td-sub">${esc(s.contact_name || '—')}${s.contact_phone ? '<br>' + esc(s.contact_phone) : ''}</td>
      <td class="td-sub">${esc(s.profit_terms || '—')}</td>
      <td class="num">${Number(s.product_count) ? `<a style="cursor:pointer;color:var(--brand)" onclick="resourceProducts('scenic',${s.id},'${escJs(s.name)}')">${s.product_count} 条 ›</a>` : '—'}</td>
      <td>${RESOURCE_ST[s.status] || ''}</td>
      <td><button class="btn ghost sm" onclick="scenicProfile(${s.id})">景点数据</button>${['super', 'ops'].includes(ME.role) ? `<button class="btn ghost sm" onclick="editScenic(${s.id})">编辑</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : emptyBox(K ? '没有匹配的景区：换个关键词试试' : '暂无景区：点右上「新增景区」入库')}
  </div>`
}
function scenicModal() { return entityEditor('scenic', null, { onSaved: () => scenics() }) }
async function scenicProfile(id) {
  let data
  try { data = await api('GET', `/admin/scenics/${id}/overview`) } catch (e) { return toast(e.message, true) }
  const k = data.kpi
  reviewDrawer(`景点数据 · ${esc(data.scenic.name)}`, `
    <div class="rv-box"><div class="scenic-calc-context">${scenicCalcHelpButton('scenic', id)}</div>${kv('城市', esc(CITY_CN[data.scenic.city_code] || data.scenic.city_code))}${kv('统计口径', '按当前关联线路汇总；销量为已支付未退款人数，核销按成功凭证去重，评分按已发布评价加权。')}</div>
    <div class="pstats">${stat('销量', k.sold + ' 人次', `${data.products.length} 条关联线路`)}${stat('有效 GMV', fen(k.gmv))}${stat('核销人次', k.verified, '成功核销凭证去重（含历史到访）')}${stat('评分', k.rating == null ? '—' : k.rating.toFixed(1) + ' ★', `${k.reviews} 条已发布评价`)}</div>
    <div class="rv-box"><div class="rv-h">近 14 日销量（按下单日）</div>${dayBars(data.daily, { label: '销量', fmt: v => v + ' 人次' })}</div>
    <div class="rv-box"><div class="rv-h">关联线路业绩</div>${data.products.length ? `<table><thead><tr><th>线路</th><th>状态</th><th>销量</th><th>GMV</th><th>核销人次</th><th>评分 / 评价</th></tr></thead><tbody>${data.products.map(p => `<tr><td>${esc(p.title)}</td><td>${Number(p.status) === 1 ? '在架' : '下架'}</td><td>${PN(p.sold)}</td><td>${fen(p.gmv)}</td><td>${PN(p.verified)}</td><td>${p.rating == null ? '—' : Number(p.rating).toFixed(1)} / ${PN(p.reviews)} 条</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无关联线路')}</div>${operatingScenarioPanel(true)}`, '')
  void mountOperatingScenario($('#modalRoot'))
}
async function editScenic(id) { return entityEditor('scenic', id, { onSaved: () => scenics() }) }
async function suppliers() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  window.__kw = window.__kw || {}
  const all = await api('GET', '/admin/suppliers')
  const K = (window.__kw.suppliers || '').trim()
  const rows = K ? all.filter((s) => (s.name + (s.contact_name || '') + (s.city_code || '') + (s.category || '')).includes(K)) : all
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>供应商</h2>
      <input id="sp_kw" placeholder="搜名称 / 联系人 / 类目" style="width:200px" value="${esc(window.__kw.suppliers || '')}" onchange="window.__kw.suppliers=this.value;suppliers()">
      <span class="muted">${K ? '筛出 ' + rows.length + ' / ' + all.length + ' 家' : '共 ' + all.length + ' 家'}</span>
      <span class="muted">资源供给方（门票/住宿/交通/地接/餐饮）· 与履约商户分账本管理</span>
      <button class="btn primary sm" onclick="supplierModal()">＋ 新增供应商</button></div>
    ${rows.length ? `<table style="margin-top:10px"><thead><tr><th>供应商</th><th>城市</th><th>类目</th><th>资质证照号</th><th>联系人</th><th>结算方式</th><th>备注</th><th>关联商品</th><th>状态</th><th></th></tr></thead><tbody>
    ${rows.map((s) => `<tr><td class="td-main">${esc(s.name)}</td><td class="num">${esc(s.city_code)}</td>
      <td><span class="pill off">${esc(SUP_KIND[s.category] || s.category)}</span></td>
      <td class="td-sub">${esc(s.license_no || '—')}</td>
      <td class="td-sub">${esc(s.contact_name || '—')}${s.contact_phone ? '<br>' + esc(s.contact_phone) : ''}</td>
      <td>${esc(SETTLE_MODE[s.settle_mode] || s.settle_mode)}</td>
      <td class="td-sub">${esc(s.note || '—')}</td>
      <td class="num">${Number(s.product_count) ? `<a style="cursor:pointer;color:var(--brand)" onclick="resourceProducts('supplier',${s.id},'${escJs(s.name)}')">${s.product_count} 条 ›</a>` : '—'}</td>
      <td>${RESOURCE_ST[s.status] || ''}</td>
      <td><button class="btn ghost sm" onclick="editSupplier(${s.id})">编辑</button></td></tr>`).join('')}</tbody></table>` : emptyBox('暂无供应商：门票/大巴/酒店等资源方在这里入库，商品可关联')}
  </div>`
}
function supplierModal() { return entityEditor('supplier', null, { onSaved: () => suppliers() }) }
async function editSupplier(id) { return entityEditor('supplier', id, { onSaved: () => suppliers() }) }
// 资源关联商品明细（景区/供应商 → 商品）
async function resourceProducts(kind, id, name) {
  const rows = (await api('GET', '/admin/products')).filter((p) => Number(kind === 'scenic' ? p.scenic_id : p.supplier_id) === Number(id))
  modal((kind === 'scenic' ? '景区' : '供应商') + '「' + esc(name) + '」关联商品（' + rows.length + '）', rows.length ? `
    <table><thead><tr><th>商品</th><th>城市</th><th>价格</th><th>状态</th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td class="td-main">${esc(p.title)}</td><td class="num">${esc(p.city_code)}</td>
      <td class="money num">${fen(p.price_from)}</td>
      <td><span class="pill ${p.status === 1 ? 'ok' : 'off'}">${p.status === 1 ? '上架' : '下架'}</span></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">还没有商品关联此资源；到「商品与团期」的创建/编辑表单里选择即可。</p>',
    `<button class="btn primary" onclick="closeModal()">知道了</button>`)
}
