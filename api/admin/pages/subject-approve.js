// 主体资源审批页(V94):超管与获授权平台运营办理主体提交的资源变更申请。
// 详情展示 当前正式值 / 提交基线 / 拟生效值 三列对比与加载时最新影响数据;
// 批准前按重点影响勾选确认(改价/库存/上下架/履约安排/退改须知),退回必填原因,按钮防重复提交。
const SA_IMPACT_CN = {
  price: '改价', stock: '库存', schedule: '时段/时间', status: '上下架/停售',
  policy: '退改与费用须知', contact: '对外联系方式', address: '地址/集合点',
}
const SA_KIND_CN = { product: '商品', session: '团期', stock: '直购库存', merchant: '商户资料', scenic: '景区资料' }
const SA_STATUS_CN = { 0: '草稿', 1: '待审核', 2: '已撤回', 3: '已退回', 4: '已生效' }
const SA_STATUS_PILL = { 1: 'warn', 3: 's70', 4: 'ok', 2: 'off', 0: 'off' }

let saQ = { status: '1', kw: '', kind: '', subjectType: '', channel: '', from: '', to: '' }

async function subjectapprove() {
  saQ = { status: '1', kw: '', kind: '', subjectType: '', channel: '', from: '', to: '', ...restoreQ('sa', {}) }
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:140px"></div></div>'
  const qs = saQuery()
  const d = await api('GET', '/admin/subject-requests?view=approval' + qs)
  const canApprove = adminCan('subject.approve')
  const canPreaudit = adminCan('subject.preaudit')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>主体资源审批</h2>
      <span class="pill ${canApprove ? 'ok' : 'off'}">${canApprove ? '已获审批授权 · 批准即生效' : '未获审批授权 · 可预审,批准需超管授予'}</span></div>
    <p class="td-sub">流程:保存草稿 → 提交审核 → 超管或获授权运营确认 → 生效。一个有效批准即可生效,每笔提交均通知超管;审批前游客端继续使用原正式版本。</p>
    <div class="filters" style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">
      <select id="saStatus" class="input sm">${[['', '全部状态'], ['1', '待审核'], ['4', '已生效'], ['3', '已退回'], ['2', '已撤回']].map(([v, t]) => `<option value="${v}" ${String(saQ.status) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="saKind" class="input sm"><option value="">全部对象</option>${Object.entries(SA_KIND_CN).map(([v, t]) => `<option value="${v}" ${saQ.kind === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="saSubject" class="input sm"><option value="">全部主体</option><option value="merchant" ${saQ.subjectType === 'merchant' ? 'selected' : ''}>商户</option><option value="scenic" ${saQ.subjectType === 'scenic' ? 'selected' : ''}>景区</option></select>
      <select id="saChannel" class="input sm"><option value="">全部来源</option><option value="pc" ${saQ.channel === 'pc' ? 'selected' : ''}>PC 后台</option><option value="mini" ${saQ.channel === 'mini' ? 'selected' : ''}>商户小程序</option></select>
      <input id="saKw" class="input sm" style="width:180px" placeholder="申请号/提交人" value="${esc(saQ.kw)}">
      <input id="saFrom" type="date" class="input sm" value="${esc(saQ.from)}" title="提交起始日">
      <input id="saTo" type="date" class="input sm" value="${esc(saQ.to)}" title="提交截止日">
      <button class="btn primary sm" onclick="saSearch()">查询</button>
      <button class="btn ghost sm" onclick="saReset()">重置</button>
    </div>
    ${d.items.length ? `<table><thead><tr><th>申请号</th><th>主体</th><th>对象</th><th>变更内容</th><th>重点影响</th><th>提交人</th><th>提交时间</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${d.items.map((r) => `<tr>
        <td class="num">${esc(r.req_no)}</td>
        <td>${esc(r.subject_type === 'merchant' ? '商户#' : '景区#') + r.subject_id}${r.city_code ? '<small class="td-sub"> ' + esc(r.city_code) + '</small>' : ''}</td>
        <td>${esc(r.kindCn)} · ${r.action === 'create' ? '新增' : '修改'}</td>
        <td class="td-sub" style="max-width:220px">${esc(r.changedLabels.join('、') || (r.action === 'create' ? '新资源' : '—'))}</td>
        <td>${Object.keys(r.impacts || {}).filter((k) => r.impacts[k]).map((k) => `<span class="pill warn">${SA_IMPACT_CN[k] || k}</span>`).join(' ') || '<span class="pill off">无</span>'}</td>
        <td>${esc(r.submitted_by_name || '—')}<small class="td-sub"> ${r.channel === 'mini' ? '小程序' : 'PC'}</small></td>
        <td class="td-sub">${esc((r.submitted_at || '').slice(0, 16) || '—')}</td>
        <td><span class="pill ${SA_STATUS_PILL[r.status] || 'off'}">${r.statusCn}</span></td>
        <td><div class="td-actions"><button class="btn primary sm" onclick="saDetail(${r.id})">详情</button></div></td>
      </tr>`).join('')}</tbody></table>`
      : emptyBox('暂无符合条件的申请')}
  </div>`
}

function saQuery() {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(saQ)) if (v !== '' && v != null) p.set(k, v)
  persistQ('sa', saQ)
  const s = p.toString()
  return s ? '&' + s : ''
}
function saSearch() {
  saQ = { status: $('#saStatus').value, kw: $('#saKw').value.trim(), kind: $('#saKind').value,
    subjectType: $('#saSubject').value, channel: $('#saChannel').value, from: $('#saFrom').value, to: $('#saTo').value }
  subjectapprove()
}
function saReset() { saQ = { status: '1', kw: '', kind: '', subjectType: '', channel: '', from: '', to: '' }; subjectapprove() }

async function saDetail(id) {
  const d = await api('GET', '/admin/subject-requests/' + id)
  const canApprove = adminCan('subject.approve') && Number(d.status) === 1
  const canPreaudit = adminCan('subject.preaudit') && [0, 1].includes(Number(d.status))
  const rows = (d.diffs || []).map((x) => `<tr ${x.important ? 'style="background:var(--warn-bg,rgba(255,180,0,.07))"' : ''}>
    <td>${esc(x.label)}<small class="td-sub"> ${esc(x.key)}</small>${x.important ? ' <span class="pill warn">重点</span>' : ''}</td>
    <td>${esc(x.before)}</td><td>${esc(x.before)}</td><td><b>${esc(x.after)}</b></td></tr>`).join('')
  const impacts = Object.entries(d.impactsRaw || {}).filter(([, v]) => v).map(([k]) => `<span class="pill warn">${SA_IMPACT_CN[k] || k}</span>`).join(' ')
  const live = Object.entries(d.impact || {}).map(([k, v]) => ({ bookedNow: '当前已报名', quotaNow: '当前名额', sessions: '现有团期数', booked: '累计报名', availableNow: '当前可售库存' }[k] || k) + ':' + v).join(' · ')
  const children = (d.children || []).map((c) => {
    let payload = {}
    try { payload = typeof c.payload === 'string' ? JSON.parse(c.payload || '{}') : (c.payload || {}) } catch { /* 忽略 */ }
    return `<tr><td>${esc(c.req_no)}</td><td>${esc(payload.depart_date || '')}</td><td>${esc(payload.quota ?? '')}</td><td>${esc(payload.price_adult ?? '')} 元</td>
      <td>${esc(payload.early_price ? payload.early_price + ' 元' : '—')}</td><td><span class="pill ${SA_STATUS_PILL[c.status] || 'off'}">${c.statusCn}</span></td></tr>`
  }).join('')
  const preaudit = (d.preaudit || []).map((p) => `<div class="td-sub">· ${esc(p.at)} ${esc(p.byName || '')}:${esc(p.note)}</div>`).join('') || '<span class="td-sub">暂无预审记录</span>'
  modal('审批详情 · ' + d.req_no, `
    <p><span class="pill ${SA_STATUS_PILL[d.status] || 'off'}">${d.statusCn}</span>
      <b>${esc(d.kindCn)} · ${d.action === 'create' ? '新增' : '修改'}</b>
      ${d.resource_id ? `<span class="td-sub">正式资源 #${d.resource_id}</span>` : ''}
      <span class="td-sub">主体:${d.subject_type === 'merchant' ? '商户' : '景区'}#${d.subject_id} ${esc(d.city_code || '')}</span>
      <span class="td-sub">来源:${d.channel === 'mini' ? '商户小程序' : 'PC 后台'}</span></p>
    ${d.note ? `<p class="td-sub">申请说明:${esc(d.note)}</p>` : ''}
    ${d.impact_note ? `<p class="td-sub" style="color:var(--warn,#a15c00)">影响说明:${esc(d.impact_note)}</p>` : ''}
    ${impacts ? `<p>重点影响:${impacts}</p>` : ''}
    ${live ? `<p class="td-sub">加载时最新影响数据:${esc(live)}(以当前库为准,非提交时快照)</p>` : ''}
    <h4 style="margin:10px 0 6px">字段对比(当前正式值 / 提交基线 / 拟生效值)</h4>
    ${rows ? `<table><thead><tr><th>字段</th><th>当前正式值</th><th>提交基线</th><th>拟生效值</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="td-sub">' + (d.action === 'create' ? '新增申请:以下为拟生效值' : '无字段差异') + '</p>'}
    ${d.action === 'create' ? `<table><thead><tr><th>字段</th><th>拟生效值</th></tr></thead><tbody>${Object.entries(d.payload || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''))}</td></tr>`).join('')}</tbody></table>` : ''}
    ${children ? `<h4 style="margin:12px 0 6px">首批团期(合并生效)</h4><table><thead><tr><th>申请号</th><th>出发日期</th><th>名额</th><th>成人价</th><th>早鸟价</th><th>状态</th></tr></thead><tbody>${children}</tbody></table>` : ''}
    ${d.formal ? `<p class="td-sub">正式资源当前版本:v${d.formal.version ?? '—'}${d.baseline_version != null ? ' · 申请基线:v' + d.baseline_version + (Number(d.formal.version) !== Number(d.baseline_version) ? ' <b style="color:#c00">⚠ 版本已变化,批准将被拒绝,需退回重提</b>' : '') : ''}</p>` : ''}
    <h4 style="margin:12px 0 6px">预审记录</h4>${preaudit}
    ${d.reviewed_by_name ? `<p class="td-sub">历史决策:${esc(d.reviewed_by_name)} ${esc((d.reviewed_at || '').slice(0, 16))}${d.review_note ? ' · ' + esc(d.review_note) : ''}</p>` : ''}
    ${d.reentry_of ? `<p class="td-sub">关联历史申请:#${d.reentry_of}(退回/撤回后重提版本)</p>` : ''}`,
    `${canPreaudit ? `<button class="btn ghost sm" onclick="saPreaudit(${d.id})">预审意见</button>` : ''}
      ${canApprove ? `<button class="btn ghost sm" onclick="saReject(${d.id})">退回</button>` : ''}
      ${canApprove ? `<button class="btn primary sm" onclick="saApprove(${d.id})">批准生效</button>` : ''}
      <button class="btn ghost sm" onclick="closeModal()">关闭</button>`, true)
  window.__saDetailId = id
}

async function saApprove(id) {
  const d = await api('GET', '/admin/subject-requests/' + id)
  const flags = Object.entries(d.impactsRaw || {}).filter(([, v]) => v)
  if (d.channel === 'pc' && Number(d.submitted_by) === Number(ME?.uid)) return toast('不能审批本人提交的申请', true)
  modal('批准生效 · ' + d.req_no, `
    <p>对象:<b>${esc(d.kindCn)} · ${d.action === 'create' ? '新增' : '修改'}</b>${d.resource_id ? ' #'+d.resource_id : ''}
      <span class="td-sub">主体:${d.subject_type === 'merchant' ? '商户' : '景区'}#${d.subject_id}</span></p>
    <p class="td-sub">重点变更:${esc((d.diffs || []).filter((x) => x.important).map((x) => x.label + ' ' + x.before + ' → ' + x.after).join(';') || (d.changedLabels.join('、') || '—'))}</p>
    <p class="td-sub">上架状态:${d.action === 'create' ? (Number(d.payload?.status) === 1 ? '按批准值直接上架(先过完整性校验)' : '生效后为草稿,上架需另行申请') : esc(String(d.payload?.status ?? '不变更'))}
      ${live(d)}${adminShortNote(d)}</p>
    ${flags.length ? `<h4 style="margin:10px 0 6px">影响确认(须逐项勾选)</h4>` + flags.map(([k]) => `
      <label style="display:block;margin:6px 0"><input type="checkbox" id="saCf_${k}"> 我已确认${SA_IMPACT_CN[k] || k}影响${k === 'status' || k === 'schedule' ? '(已订游客按原约定履约,调整进入现有履约与通知流程)' : ''}</label>`).join('') : ''}
    <label style="display:block;margin-top:10px">审批说明<textarea id="saNote" class="input" rows="2" style="width:100%" placeholder="批准说明(生效结果随通知回到提交人)"></textarea></label>`,
    `<button class="btn ghost sm" onclick="saDetail(${d.id})">返回</button>
     <button class="btn primary sm" id="saApproveBtn" onclick="saApproveDo(${d.id})">确认批准</button>`, true)
}
function live(d) { return d.impact && Object.keys(d.impact).length ? '<span class="td-sub"> · 当前影响:' + esc(JSON.stringify(d.impact)) + '</span>' : '' }
function adminShortNote(d) { return d.impact_note ? '<span class="td-sub"> · 主体说明:' + esc(d.impact_note.slice(0, 60)) + '</span>' : '' }

async function saApproveDo(id) {
  const btn = document.getElementById('saApproveBtn')
  if (btn) { if (btn.disabled) return; btn.disabled = true }
  const confirm = {}
  for (const el of document.querySelectorAll('[id^="saCf_"]')) if (el.checked) confirm[el.id.replace('saCf_', '')] = true
  const note = (document.getElementById('saNote')?.value || '').trim()
  try {
    const r = await api('POST', '/admin/subject-requests/' + id + '/approve', { confirm, note })
    closeModal()
    toast(r.idempotent ? '该申请已被批准(幂等,未重复生效)' : '已批准生效,结果已通知提交人')
    await refreshInboxBadge?.()
    subjectapprove()
  } catch (e) {
    if (btn) btn.disabled = false
    if (e.code === 2002) { toast(e.message, true); closeModal(); saDetail(id) } else toast(e.message, true)
  }
}

async function saReject(id) {
  modal('退回申请 · ' + id, `
    <p class="td-sub">退回后主体可重新核对并再次提交(新版本关联历史);退回原因将通知提交人。</p>
    <label style="display:block;margin-top:8px">退回原因(必填)<textarea id="saReason" class="input" rows="3" style="width:100%" placeholder="请说明需要补正的字段、材料或业务原因"></textarea></label>`,
    `<button class="btn ghost sm" onclick="closeModal()">取消</button>
     <button class="btn s70 sm" id="saRejectBtn" onclick="saRejectDo(${id})">确认退回</button>`, true)
}
async function saRejectDo(id) {
  const btn = document.getElementById('saRejectBtn')
  if (btn) { if (btn.disabled) return; btn.disabled = true }
  const reason = (document.getElementById('saReason')?.value || '').trim()
  if (!reason) { if (btn) btn.disabled = false; return toast('退回必须填写原因', true) }
  try {
    await api('POST', '/admin/subject-requests/' + id + '/reject', { reason })
    closeModal(); toast('已退回,原因已通知提交人'); subjectapprove()
  } catch (e) { if (btn) btn.disabled = false; toast(e.message, true) }
}

async function saPreaudit(id) {
  modal('预审意见 · ' + id, `
    <p class="td-sub">预审是意见与办理记录,不改变申请状态;可提醒主体补材料,批准/退回仍按审批流程办理。</p>
    <label style="display:block;margin-top:8px">预审意见<textarea id="saPre" class="input" rows="3" style="width:100%" placeholder="如:请补充价格依据/更新图集后再提交"></textarea></label>`,
    `<button class="btn ghost sm" onclick="closeModal()">取消</button>
     <button class="btn primary sm" onclick="saPreauditDo(${id})">记录</button>`, true)
}
async function saPreauditDo(id) {
  const note = (document.getElementById('saPre')?.value || '').trim()
  if (!note) return toast('请填写预审意见', true)
  try { await api('POST', '/admin/subject-requests/' + id + '/preaudit', { note }); closeModal(); toast('预审意见已记录'); saDetail(id) }
  catch (e) { toast(e.message, true) }
}
