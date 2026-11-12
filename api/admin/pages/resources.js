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
    <div class="rv-box"><div class="scenic-calc-context">${scenicCalcHelpButton('scenic', id)}${['super','ops','finance','city_partner','scenic_partner'].includes(ME.role) ? `<button class="btn ghost sm" type="button" onclick="scenicFollowups(${Number(id)})">经营跟进</button>` : ''}</div>${kv('城市', esc(CITY_CN[data.scenic.city_code] || data.scenic.city_code))}${kv('统计口径', '按当前关联线路汇总；销量为已支付未退款人数，核销按成功凭证去重，评分按已发布评价加权。')}</div>
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
const SCENIC_FOLLOWUP_KINDS = { renewal: '合作续约', purchase: '采购申请', budget: '预算追加' }
const SCENIC_FOLLOWUP_STATUS = { submitted: '待审批', approved: '已批准，待办理', rejected: '已退回', recorded: '已登记办理' }

async function scenicFollowups(scenicId) {
  const root = '/admin/scenics/' + Number(scenicId) + '/followups'
  let data
  try { data = await api('GET', root) } catch (error) { return toast(error.message, true) }
  const rows = data.rows.map(r => `<details class="rv-box"><summary>#${Number(r.id)} · ${esc(SCENIC_FOLLOWUP_KINDS[r.kind])} · ${esc(SCENIC_FOLLOWUP_STATUS[r.status])}</summary>
    <p class="muted">复盘 #${Number(r.review_id)} · ${esc(String(r.created_at).slice(0, 10))}${r.amount_fen == null ? '' : ' · 申请金额 ' + fen(r.amount_fen)}</p>
    <p>${esc(r.purpose)}</p>
    ${r.decision_note ? '<p>审批说明 · ' + esc(r.decision_note) + '</p>' : ''}
    ${r.record_ref ? '<p>办理单据 · ' + esc(r.record_ref) + '</p><p>' + esc(r.record_note) + '</p>' : ''}
    ${r.canDecide || r.canRecord ? `<form data-followup-action="${Number(r.id)}" class="scenic-calc-fields">
      ${r.canRecord ? '<label>合同、采购或预算单据编号<input name="reference" required minlength="3" maxlength="128"></label>' : ''}
      <label>操作说明<input name="note" required minlength="4" maxlength="500"></label>
      <div class="scenic-calc-actions">${r.canDecide ? '<button class="btn primary" name="action" value="approve">批准</button><button class="btn ghost" name="action" value="reject">退回</button>' : '<button class="btn primary" name="action" value="record">登记办理结果</button>'}</div>
    </form>` : ''}
  </details>`).join('')
  reviewDrawer('经营跟进 · ' + esc(data.scenic.name), `
    <div data-scenic-followup>
      <div class="scenic-calc-actions"><button type="button" class="btn ghost sm" data-back>返回景点数据</button></div>
      <p class="muted">从本景区的已保存复盘发起续约、采购或预算追加。审批通过后，办理人员登记对应单据编号。资金与合同在原业务渠道办理。</p>
      ${Number(data.scenic.status) === 1 && data.reviews.length ? `<form data-followup-create class="rv-box">
        <h4>提交申请</h4>
        <div class="scenic-calc-fields">
          <label>复盘<select name="reviewId" required>${data.reviews.map(r => `<option value="${Number(r.id)}">#${Number(r.id)} · ${esc(String(r.created_at).replace('T',' ').slice(0,16))}</option>`).join('')}</select></label>
          <label>类型<select name="kind">${Object.entries(SCENIC_FOLLOWUP_KINDS).map(([k,label]) => `<option value="${k}">${label}</option>`).join('')}</select></label>
          <label>申请金额（元）<input type="number" min="0.01" max="1000000000" step="0.01" name="amount" placeholder="续约可留空"></label>
        </div>
        <label>办理依据<textarea rows="3" name="purpose" required minlength="4" maxlength="500" style="width:100%;box-sizing:border-box"></textarea></label>
        <button class="btn primary">提交申请</button>
      </form>` : '<p class="muted">办理申请需景区合作有效，并先保存一份本景区的经营复盘。</p>'}
      <h4>申请与办理记录</h4>
      ${rows || '<p class="muted">暂无跟进申请。</p>'}
      <p role="status" data-followup-message></p>
    </div>`, '')
  const panel = $('#modalRoot [data-scenic-followup]')
  panel.querySelector('[data-back]').onclick = () => scenicProfile(scenicId)
  const bind = (form, perform) => {
    if (!form) return
    form.onsubmit = async event => {
      event.preventDefault()
      if (form.dataset.busy) return
      form.dataset.busy = '1'
      const submitter = event.submitter
      if (submitter) submitter.disabled = true
      try {
        await perform(new FormData(form), submitter)
        if (form.isConnected) await scenicFollowups(scenicId)
      } catch (error) {
        if (form.isConnected) toast(error.message, true)
      } finally {
        delete form.dataset.busy
        if (submitter) submitter.disabled = false
      }
    }
  }
  bind(panel.querySelector('[data-followup-create]'), values => api('POST', root, {
    reviewId: Number(values.get('reviewId')), kind: values.get('kind'), purpose: values.get('purpose'),
    amountFen: values.get('amount') ? Math.round(Number(values.get('amount')) * 100) : null,
  }))
  for (const form of panel.querySelectorAll('[data-followup-action]')) {
    bind(form, (values, button) => {
      if (!button?.value) return Promise.reject(new Error('请选择操作'))
      return api('POST', root + '/' + Number(form.dataset.followupAction) + '/action',
        { action: button.value, note: values.get('note'), reference: values.get('reference') })
    })
  }
}
