// 主体工作台(V94):商户/景区主体方的资源办理入口。
// 展示 当前身份可办入口(新增商品/维护资料/我的变更申请)、待审/退回/新近生效概览、
// 资源列表(正式状态 + 申请状态,如「在售 · 价格变更待审」)。编辑走审批制(entityEditor 审批模式):
// 保存草稿 → 提交审核 → 超管或获授权运营确认 → 生效;新增商品可携带首批团期合并生效。
const SW_STATUS_PILL = { 0: 'off', 1: 'warn', 2: 'off', 3: 's70', 4: 'ok' }

let swData = null
let swTab = 'all'

async function subjectwork() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:160px"></div></div>'
  swData = await api('GET', '/admin/subject-workbench')
  window.__swPerms = swData.perms // 团期选择弹窗的行内 onclick 使用
  const d = swData
  const e = d.entries
  const sub = d.identity
  const reqs = (d.requests.recent || []).filter((r) => swTab === 'all' || (swTab === 'draft' ? Number(r.status) === 0 : Number(r.status) === Number(swTab)))
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>${sub.subjectType === 'merchant' ? '商户' : '景区'}主体工作台</h2>
      <span class="pill ${Number(sub.status) === 1 ? 'ok' : 's70'}">${sub.name}</span>
      <span class="pill off">${esc(sub.city || '')}</span>
      <span class="pill off">权限版本 v${d.permVersion}</span></div>
    <p class="td-sub">资源变更统一流程:保存草稿 → 提交审核 → 平台确认 → 生效。审批前游客端继续使用原正式版本;权限由平台统一配置下发,最新下发的权限为准。</p>
    <div class="kpi-grid" style="margin:10px 0">
      ${[['draft', '我的草稿', d.requests.count[0]], ['1', '待审核', d.requests.count[1]], ['3', '已退回', d.requests.count[3]], ['4', '已生效', d.requests.count[4]]]
        .map(([k, t, v]) => `<div class="kpi" onclick="swSetTab('${k}')" style="cursor:pointer"><b>${Number(v || 0)}</b><span>${t}</span></div>`).join('')}
    </div>
    <div class="row" style="gap:8px;margin:8px 0">
      ${e.productCreate ? `<button class="btn primary" onclick="swCreateProduct()">＋ 新增商品</button>` : ''}
      ${e.profileEdit ? `<button class="btn" onclick="swEditProfile()">${sub.subjectType === 'merchant' ? '维护商户资料' : '维护景区资料'}</button>` : '<button class="btn" disabled title="当前授权不含资料维护">维护资料(未授权)</button>'}
      ${e.productEdit ? `<button class="btn ghost" onclick="swSetTab('all')">商品变更申请</button>` : ''}
      ${e.sessionEdit ? `<span class="td-sub">团期/库存变更:在下方商品列表按团期发起</span>` : ''}
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h3>我的变更申请</h3>
      <select class="input sm" onchange="swSetTab(this.value)">
        ${[['all', '全部'], ['draft', '草稿'], ['1', '待审核'], ['3', '已退回'], ['2', '已撤回'], ['4', '已生效']].map(([v, t]) => `<option value="${v}" ${swTab === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select></div>
    ${reqs.length ? `<table><thead><tr><th>申请号</th><th>对象</th><th>变更</th><th>状态</th><th>提交时间</th><th>结果/原因</th><th>操作</th></tr></thead><tbody>
      ${reqs.map((r) => `<tr>
        <td class="num">${esc(r.req_no)}</td>
        <td>${esc(r.kindCn)} · ${r.action === 'create' ? '新增' : '修改'}${r.resource_id ? ' #' + r.resource_id : ''}</td>
        <td class="td-sub" style="max-width:200px">${esc(r.changedLabels.join('、') || '—')}</td>
        <td><span class="pill ${SW_STATUS_PILL[r.status] || 'off'}">${r.statusCn}</span></td>
        <td class="td-sub">${esc((r.submitted_at || r.created_at || '').slice(0, 16))}</td>
        <td class="td-sub" style="max-width:200px">${Number(r.status) === 3 && r.review_note ? '退回:' + esc(r.review_note) : Number(r.status) === 4 ? '已生效 #'+(r.effective_resource_id||'') : '—'}</td>
        <td><div class="td-actions">
          <button class="btn ghost sm" onclick="swDetail(${r.id})">查看</button>
          ${Number(r.status) === 0 ? `<button class="btn primary sm" onclick="swContinueDraft(${r.id})">续编</button>
            <button class="btn primary sm" onclick="swSubmitDraft(${r.id})">提交审核</button>
            <button class="btn s70 sm" onclick="swDeleteDraft(${r.id})">删除</button>` : ''}
          ${Number(r.status) === 1 ? `<button class="btn ghost sm" onclick="swWithdraw(${r.id})">撤回</button>` : ''}
          ${[2, 3].includes(Number(r.status)) ? `<button class="btn primary sm" onclick="swResubmit(${r.id})">重新发起</button>` : ''}
        </div></td></tr>`).join('')}</tbody></table>` : emptyBox('暂无申请记录')}
  </div>
  <div class="card">
    <div class="card-head"><h3>本店商品(正式状态 · 申请状态)</h3>
      ${e.productCreate ? `<button class="btn primary sm" onclick="swCreateProduct()">＋ 新增商品</button>` : ''}</div>
    ${(d.resources.products || []).length ? `<table><thead><tr><th>ID</th><th>标题</th><th>品类</th><th>状态</th><th>起售价</th><th>操作</th></tr></thead><tbody>
      ${d.resources.products.map((p) => `<tr>
        <td class="num">#${p.id}</td><td>${esc(p.title)}</td><td>${esc(p.cat)}</td>
        <td>${esc(p.statusText)}${p.pending ? `<button class="btn ghost sm" onclick="swDetailByNo('${escJs(p.pending.reqNo)}')">查看申请</button>` : ''}</td>
        <td class="num">¥${((Number(p.price_from) || 0) / 100).toFixed(2)}</td>
        <td><div class="td-actions">
          ${e.productEdit ? `<button class="btn ghost sm" onclick="swEditProduct(${p.id})">修改申请</button>` : ''}
          ${e.sessionEdit ? `<button class="btn ghost sm" onclick="swSessionApply(${p.id})">团期变更申请</button>` : ''}
          ${e.stockEdit && p.cat === 'shop' ? `<button class="btn ghost sm" onclick="swStockApply(${p.id})">库存申请</button>` : ''}
        </div></td></tr>`).join('')}</tbody></table>` : emptyBox('暂无商品')}
  </div>`
}

function swSetTab(t) { swTab = String(t); subjectwork() }

// ---- 查看申请详情(主体视角:复用审批详情渲染,只读) ----
async function swDetail(id) {
  const d = await api('GET', '/admin/subject-requests/' + id)
  const rows = (d.diffs || []).map((x) => `<tr ${x.important ? 'style="background:rgba(255,180,0,.07)"' : ''}><td>${esc(x.label)}${x.important ? ' <span class="pill warn">重点</span>' : ''}</td><td>${esc(x.before)}</td><td><b>${esc(x.after)}</b></td></tr>`).join('')
  const pre = (d.preaudit || []).map((p) => `<div class="td-sub">· ${esc(p.at)} ${esc(p.byName || '')}:${esc(p.note)}</div>`).join('') || '<span class="td-sub">暂无预审意见</span>'
  const statusFlow = ['草稿', '待审核', '已生效', '已退回', '已撤回']
  modal('申请详情 · ' + d.req_no, `
    <p><span class="pill ${SW_STATUS_PILL[d.status] || 'off'}">${d.statusCn}</span> <b>${esc(d.kindCn)} · ${d.action === 'create' ? '新增' : '修改'}</b>
      ${d.resource_id ? '<span class="td-sub">正式资源 #' + d.resource_id + '</span>' : ''}</p>
    <p class="td-sub">流程:保存草稿 → 提交审核 → 平台确认 → 生效;审批前继续使用原正式版本。</p>
    ${d.note ? `<p class="td-sub">申请说明:${esc(d.note)}</p>` : ''}
    ${d.impact_note ? `<p class="td-sub">影响说明:${esc(d.impact_note)}</p>` : ''}
    ${rows ? `<table><thead><tr><th>字段</th><th>原值</th><th>拟生效值</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    ${(d.children || []).length ? `<h4 style="margin:10px 0 6px">首批团期</h4><table><thead><tr><th>申请号</th><th>状态</th><th>生效资源</th></tr></thead><tbody>
      ${d.children.map((c) => `<tr><td>${esc(c.req_no)}</td><td><span class="pill ${SW_STATUS_PILL[c.status] || 'off'}">${c.statusCn}</span></td><td>${c.effective_resource_id ? '#' + c.effective_resource_id : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
    <h4 style="margin:12px 0 6px">平台预审意见</h4>${pre}
    ${d.review_note ? `<p class="td-sub">平台结论:${esc(d.reviewed_by_name || '')} ${esc((d.reviewed_at || '').slice(0, 16))} · ${esc(d.review_note)}</p>` : ''}`,
    `${Number(d.status) === 0 ? `<button class="btn primary sm" onclick="closeModal();swContinueDraft(${d.id})">续编草稿</button><button class="btn primary sm" onclick="swSubmitDraft(${d.id})">提交审核</button>` : ''}
      ${Number(d.status) === 1 ? `<button class="btn ghost sm" onclick="closeModal();swWithdraw(${d.id})">撤回</button>` : ''}
      ${[2, 3].includes(Number(d.status)) ? `<button class="btn primary sm" onclick="closeModal();swResubmit(${d.id})">重新发起</button>` : ''}
      <button class="btn ghost sm" onclick="closeModal()">关闭</button>`, true)
}
async function swDetailByNo(no) {
  const d = await api('GET', '/admin/subject-requests?view=mine&kw=' + encodeURIComponent(no))
  const item = (d.items || []).find((r) => r.req_no === no)
  if (!item) return toast('未找到该申请', true)
  swDetail(item.id)
}

// ---- 草稿/提交/撤回/重提 ----
async function swSubmitDraft(id) {
  const ok = await uiConfirm({ title: '提交审核', message: '提交后进入平台审批队列,提交内容锁定;审批前游客端继续使用原正式版本。确认提交?', danger: false })
  if (!ok) return
  try {
    const r = await api('POST', '/admin/subject-requests/' + id + '/submit', {})
    closeModal()
    toast(r.idempotent ? '该申请已在待审队列(幂等)' : '已提交审核,申请号 ' + r.reqNo + ',已通知平台审批人')
    subjectwork()
  } catch (e) { toast(e.message, true) }
}
async function swWithdraw(id) {
  const ok = await uiConfirm({ title: '撤回申请', message: '撤回后待审任务移除(原通知保留历史);可重新核对后再次提交。确认撤回?', danger: true })
  if (!ok) return
  try { await api('POST', '/admin/subject-requests/' + id + '/withdraw', {}); closeModal(); toast('已撤回'); subjectwork() }
  catch (e) { toast(e.message, true) }
}
async function swDeleteDraft(id) {
  const ok = await uiConfirm({ title: '删除草稿', message: '删除后不可恢复。确认删除?', danger: true })
  if (!ok) return
  try { await api('DELETE', '/admin/subject-requests/' + id); closeModal(); toast('草稿已删除'); subjectwork() }
  catch (e) { toast(e.message, true) }
}
async function swResubmit(id) {
  try {
    const r = await api('POST', '/admin/subject-requests/' + id + '/resubmit', {})
    toast('已创建新草稿(关联历史申请 #' + id + '),请核对最新正式值后提交')
    swContinueDraft(r.id)
  } catch (e) { toast(e.message, true) }
}

// ---- 审批模式编辑器入口 ----
function swEditorOpts(action, resourceId) {
  const perms = swData?.perms || {}
  return { approval: { perms, action, resourceId } }
}
function swCreateProduct() {
  if (!swData?.entries?.productCreate) return toast('当前授权不含新增商品', true)
  entityEditor('product', null, swEditorOpts('create', null))
}
async function swContinueDraft(id) {
  const d = await api('GET', '/admin/subject-requests/' + id)
  entityEditor(d.kind, d.resource_id, { approval: { perms: swData?.perms || {}, action: d.action, resourceId: d.resource_id, draftId: id, payload: d.payload } })
}
async function swEditProduct(id) {
  if (!swData?.entries?.productEdit) return toast('当前授权不含商品修改', true)
  entityEditor('product', id, swEditorOpts('update', id))
}
function swEditProfile() {
  const kind = swData?.identity?.subjectType === 'merchant' ? 'merchant' : 'scenic'
  if (!swData?.entries?.profileEdit) return toast('当前授权不含资料维护', true)
  entityEditor(kind, swData.identity.subjectId, swEditorOpts('update', swData.identity.subjectId))
}
async function swSessionApply(productId) {
  // 团期变更:先选团期(拉取商品团期列表),再进入审批模式编辑器
  const d = await api('GET', '/admin/products/' + productId + '/sessions')
  if (!(d.sessions || []).length) return toast('该商品暂无团期,请在新增商品申请中携带首批团期', true)
  modal('选择团期 · ' + d.title, `<table><thead><tr><th>日期</th><th>名额</th><th>已报</th><th>成人价</th><th>状态</th><th></th></tr></thead><tbody>
    ${d.sessions.map((s) => `<tr><td>${esc(s.depart_date)}</td><td>${s.quota}</td><td>${s.booked}</td><td>¥${(Number(s.price_adult) / 100).toFixed(2)}</td>
      <td>${['', '报名中', '已成团', '已截止', '已取消'][s.status] || s.status}</td>
      <td><button class="btn primary sm" onclick="closeModal();entityEditor('session', ${s.id}, { approval: { perms: (window.__swPerms||{}), action: 'update', resourceId: ${s.id} } })">变更申请</button></td></tr>`).join('')}
    </tbody></table>`, `<button class="btn ghost sm" onclick="closeModal()">取消</button>`, true)
}
async function swStockApply(productId) {
  const d = await api('GET', '/admin/products/' + productId + '/sessions')
  if (!d.stock) return toast('该商品不是商城直购商品', true)
  modal('直购库存变更申请', `
    <p>当前可售库存:<b>${d.stock.available}</b></p>
    <label style="display:block;margin-top:8px">调整后可售库存<input id="swStock" type="number" class="input" style="width:160px" value="${d.stock.available}"></label>
    <label style="display:block;margin-top:8px">调整原因<textarea id="swStockNote" class="input" rows="2" style="width:100%" placeholder="受影响时段与订单处理说明"></textarea></label>`,
    `<button class="btn ghost sm" onclick="closeModal()">取消</button>
     <button class="btn primary sm" onclick="swStockSubmit(${productId}, ${d.stock.available})">保存草稿并提交</button>`, true)
}
async function swStockSubmit(productId, previous) {
  const available = Number(document.getElementById('swStock')?.value)
  const note = (document.getElementById('swStockNote')?.value || '').trim()
  if (!Number.isInteger(available) || available < 0) return toast('库存须为非负整数', true)
  if (!note) return toast('影响类变更须填写说明(受影响时段与订单处理)', true)
  try {
    const rows = await api('GET', '/admin/products/' + productId + '/sessions')
    if (!rows.stock?.id) return toast('未找到库存行,请刷新后重试', true)
    const r = await api('POST', '/admin/subject-requests', { kind: 'stock', action: 'update',
      resourceId: rows.stock.id, expectedVersion: rows.stock.version, payload: { available }, note, impactNote: note, submit: true })
    closeModal()
    toast('已提交库存变更申请 ' + (r.reqNo || ''))
    subjectwork()
  } catch (e) { toast(e.message, true) }
}
