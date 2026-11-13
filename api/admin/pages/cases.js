// 风险案件（T12）：待研判→处理中→待补材料/待协查→待复核→关闭，可重开；时间线不可改写。
// 平台客服=super/risk 办理；城市账号发起本城协查、补充材料、跟踪本城案件。
const CASE_ST = {
  0: '<span class="pill warn">待研判</span>', 1: '<span class="pill s20">处理中</span>', 2: '<span class="pill s40">待补材料</span>',
  3: '<span class="pill s40">待协查</span>', 4: '<span class="pill warn">待复核</span>', 5: '<span class="pill ok">已关闭</span>',
}
const CASE_ACT = { create: '建案', judge: '研判受理', need_info: '转待补材料', coordinate: '转待协查', resume: '恢复处理', review: '提交复核', close: '复核结案', reopen: '重开', note: '记录', freeze: '冻结账号', unfreeze: '解冻账号' }
const CASE_SRC = { risk_event: '风控事件', verify_conflict: '核销冲突', manual: '人工建案', city: '城市协查' }

async function cases() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  window.__rcQ = window.__rcQ || { page: 1, status: '', kw: '' }
  const Q = window.__rcQ
  const data = await api('GET', '/admin/risk-cases?' + new URLSearchParams({ page: Q.page, status: Q.status, kw: Q.kw }).toString())
  const rows = data.rows
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const counts = data.statusCounts || {}
  const canManage = adminCan('case.manage')
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdecec">${ICONS.pin}</div><div><div class="l">待研判 / 处理中</div><div class="v">${dxNumGo(Number(counts[0] || 0), "window.__rcQ={page:1,status:'0',kw:''};cases()", "筛选：待研判")} / ${dxNumGo(Number(counts[1] || 0), "window.__rcQ={page:1,status:'1',kw:''};cases()", "筛选：处理中")}</div><div class="s">研判受理后开始处理</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">${ICONS.mail}</div><div><div class="l">待补材料 / 待协查</div><div class="v">${dxNumGo(Number(counts[2] || 0), "window.__rcQ={page:1,status:'2',kw:''};cases()", "筛选：待补材料")} / ${dxNumGo(Number(counts[3] || 0), "window.__rcQ={page:1,status:'3',kw:''};cases()", "筛选：待协查")}</div><div class="s">城市账号可补充本城反馈</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e3f6ec">${ICONS.scale}</div><div><div class="l">待复核 / 已关闭</div><div class="v">${dxNumGo(Number(counts[4] || 0), "window.__rcQ={page:1,status:'4',kw:''};cases()", "筛选：待复核")} / ${dxNumGo(Number(counts[5] || 0), "window.__rcQ={page:1,status:'5',kw:''};cases()", "筛选：已关闭")}</div><div class="s">复核人≠责任人 · 结论必填</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>风险案件</h2><span class="muted">事件升级为可办理案件：处置动作引用冻结/解冻，解冻与结案分离，复核后才算关闭</span></div>
    <div class="cfg-tabs">${[['', '全部'], [0, '待研判'], [1, '处理中'], [2, '待补材料'], [3, '待协查'], [4, '待复核'], [5, '已关闭']].map(([v, n]) => `<button class="cfg-tab ${String(Q.status) === String(v) ? 'on' : ''}" onclick="window.__rcQ.status='${v}';window.__rcQ.page=1;cases()">${n} ${v === '' ? Number(counts.all || 0).toLocaleString() : Number(counts[v] || 0).toLocaleString()}</button>`).join('')}
      <input class="inp" id="rcKw" placeholder="案件号 / 标题" value="${esc(Q.kw)}" style="width:170px;margin-left:8px"> <button class="btn ghost sm" onclick="window.__rcQ.kw=document.getElementById('rcKw').value.trim();window.__rcQ.page=1;cases()">搜索</button>
      ${adminCan('case.manage') || ADMIN_CAPABILITIES.role === 'city_partner' ? '<button class="btn primary sm" style="margin-left:8px" onclick="caseCreateModal()">＋ 建案</button>' : ''}</div>
    ${rows.length ? `<table><thead><tr><th>案件号</th><th>标题 / 来源</th><th>级别</th><th>责任人 / 复核</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${rows.map((k) => {
      const ops = [`<button class="btn ghost sm" onclick="caseDrawer(${k.id})">时间线</button>`]
      if (canManage) {
        if (Number(k.status) === 0) ops.push(`<button class="btn primary sm" onclick="caseAction(${k.id},'judge')">研判受理</button>`)
        if (Number(k.status) === 1) {
          ops.push(`<button class="btn ghost sm" onclick="caseAction(${k.id},'need_info')">转待补材料</button>`)
          ops.push(`<button class="btn ghost sm" onclick="caseAction(${k.id},'coordinate')">转待协查</button>`)
          ops.push(`<button class="btn primary sm" onclick="caseAction(${k.id},'review')">提交复核</button>`)
        }
        if ([2, 3].includes(Number(k.status))) ops.push(`<button class="btn ghost sm" onclick="caseAction(${k.id},'resume')">恢复处理</button>`)
        // V-01：本人判定按不可变 UID（旧数据只有名字快照时回退名字比较）
        const isCaseMine = k.handler_uid != null ? (ME?.uid != null && Number(k.handler_uid) === Number(ME.uid)) : k.handler === 'admin:' + (ME?.displayName || ME?.username || '')
        if (Number(k.status) === 4 && !isCaseMine) ops.push(`<button class="btn primary sm" onclick="caseAction(${k.id},'close')">复核结案</button>`)
        if (Number(k.status) === 5) ops.push(`<button class="btn ghost sm" onclick="caseAction(${k.id},'reopen')">重开</button>`)
      }
      return `<tr><td class="num">${esc(k.case_no)}</td>
      <td class="td-main">${esc(k.title)}<div class="td-sub">${CASE_SRC[k.source_type] || esc(k.source_type)}${k.source_id ? ' #' + k.source_id : ''}</div></td>
      <td>${k.severity === 1 ? '<span class="pill s70">高</span>' : k.severity === 2 ? '<span class="pill warn">中</span>' : '<span class="pill off">低</span>'}</td>
      <td class="td-sub">${esc(k.handler || '—')}${k.reviewer ? '<br>复核：' + esc(k.reviewer) : ''}</td>
      <td>${CASE_ST[k.status] || k.status}</td>
      <td><div class="td-actions">${ops.join('')}</div></td></tr>` }).join('')}</tbody></table>`
    : emptyBox((Q.kw || Q.status !== '') ? '没有符合条件的案件。' : '暂无风险案件——从风控事件「升级为案件」或直接建案。')}
    <div class="pagination"><span>共 ${Number(data.total).toLocaleString()} 件 · 第 ${data.page} / ${pages} 页</span><div><button class="btn ghost sm" ${data.page <= 1 ? 'disabled' : ''} onclick="window.__rcQ.page--;cases()">上一页</button> <button class="btn ghost sm" ${data.page >= pages ? 'disabled' : ''} onclick="window.__rcQ.page++;cases()">下一页</button></div></div>
  </div>`
}

window.caseCreateModal = (preset = {}) => {
  const isCity = ADMIN_CAPABILITIES.role === 'city_partner'
  modal('新建风险案件', `
    <div class="field"><label>案件标题 *（1–120 字）</label><input id="rcTitle" maxlength="120" value="${esc(preset.title || '')}"></div>
    <div class="field"><label>关联用户 ID（可选，用于冻结/解冻引用）</label><input id="rcUser" type="number" value="${esc(preset.userId || '')}"></div>
    <div class="field"><label>严重度</label><select id="rcSev"><option value="2">中</option><option value="1">高</option><option value="3">低</option></select></div>
    <div class="field"><label>${isCity ? '协查说明 *（4–500 字，说明疑点与请求事项）' : '研判说明 *（4–500 字）'}</label><textarea id="rcNote" rows="3" maxlength="500"></textarea></div>
    <div id="rcErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="caseCreateSubmit(${preset.sourceId || 'null'}, '${preset.sourceType || (isCity ? 'city' : 'manual')}')">创建案件</button>`)
}
window.caseCreateSubmit = async (sourceId, sourceType) => {
  try {
    const r = await api('POST', '/admin/risk-cases', { sourceType, sourceId, objectType: $('#rcUser').value ? 'user' : 'other',
      objectId: Number($('#rcUser').value) || null, userId: Number($('#rcUser').value) || null,
      severity: Number($('#rcSev').value), title: ($('#rcTitle').value || '').trim(), note: ($('#rcNote').value || '').trim() })
    closeModal(); toast('案件 ' + r.caseNo + ' 已创建'); cases()
  } catch (e) { $('#rcErr').textContent = e.message }
}

window.caseDrawer = async (id) => {
  const d = await api('GET', '/admin/risk-cases/' + id)
  const k = d.case
  const canManage = adminCan('case.manage')
  drawer('风险案件 ' + esc(k.case_no) + ' · ' + (CASE_ST[k.status] || ''), `
    ${kv('标题 / 来源', esc(k.title) + ' · ' + (CASE_SRC[k.source_type] || esc(k.source_type)) + (k.source_id ? ' #' + k.source_id : ''))}
    ${kv('责任人 / 复核', esc(k.handler || '—') + (k.reviewer ? ' / 复核 ' + esc(k.reviewer) : ''))}
    ${d.objectInfo ? kv('关联账号', `ID ${d.objectInfo.id} ${esc(d.objectInfo.nickname || '')} ${d.objectInfo.frozen ? '<span class="pill s70">已冻结</span>' : ''} ${d.objectInfo.riskFlag ? '<span class="pill warn">风险标记</span>' : ''}`) : ''}
    ${k.conclusion ? kv('结案结论', esc(k.conclusion)) : ''}
    <div class="rv-box"><div class="rv-h">处理时间线（不可改写）</div>
    ${d.records.map((r) => `<div style="margin:6px 0"><b>${CASE_ACT[r.action] || esc(r.action)}</b> · ${esc(r.actor)} <span class="td-sub">${esc(String(r.created_at).slice(5, 16).replace('T', ' '))}</span>${r.note ? '<div class="td-sub">' + esc(r.note) + '</div>' : ''}</div>`).join('') || '<p class="muted">暂无记录</p>'}</div>
    <div class="field"><label>补充材料（2–500 字）</label><input id="rcAddNote" maxlength="500"></div>
    <button class="btn ghost sm" onclick="caseAddNote(${k.id})">追加记录</button>
    ${canManage && k.user_id && ![4, 5].includes(Number(k.status)) ? `<button class="btn danger sm" onclick="caseFreeze(${k.id}, ${k.user_id}, ${d.objectInfo && d.objectInfo.frozen ? 1 : 0})">${d.objectInfo && d.objectInfo.frozen ? '解冻关联账号' : '冻结关联账号'}</button><span class="td-sub">处置写入本案件时间线；解冻≠结案</span>` : ''}`)
}
window.caseAddNote = async (id) => {
  try { await api('POST', '/admin/risk-cases/' + id + '/note', { note: ($('#rcAddNote').value || '').trim() }); toast('已追加'); caseDrawer(id) } catch (e) { toast(e.message, true) }
}
window.caseAction = (id, action) => {
  const titles = { judge: '研判受理', need_info: '转待补材料', coordinate: '转待协查', resume: '恢复处理', review: '提交复核', close: '复核结案', reopen: '重开案件' }
  const needNote = ['close', 'reopen'].includes(action)
  modal(titles[action] + ' · #' + id, `
    ${action === 'close' ? '<p class="td-sub">结案结论进入审计与时间线；复核人不能与当前责任人相同。解冻不等于结案。</p>' : ''}
    <div class="field"><label>${needNote ? (action === 'close' ? '结案结论 *（4–500 字）' : '重开原因 *（4–500 字）') : '处理说明（进入时间线）'}</label><textarea id="rcActNote" rows="2" maxlength="500"></textarea></div>
    <div id="rcActErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="caseActionSubmit(${id}, '${action}')">确认</button>`)
}
window.caseActionSubmit = async (id, action) => {
  try {
    const r = await api('POST', '/admin/risk-cases/' + id + '/' + action, { note: ($('#rcActNote').value || '').trim() })
    closeModal(); toast('案件已' + (CASE_ACT[action] || action) + '，状态：' + (r.statusCn || '')); cases()
  } catch (e) { $('#rcActErr').textContent = e.message }
}
window.caseFreeze = (id, userId, frozen) => {
  modal((frozen ? '解冻' : '冻结') + '关联账号 · 案件 #' + id, `
    <p class="td-sub">处置动作会写入本案件时间线（引用案件）。${frozen ? '解冻后案件保持当前状态，结案仍需复核。' : '冻结后该账号资金动作暂停、小程序会话立即失效。'}</p>
    <div class="field"><label>${frozen ? '解冻说明' : '冻结原因 *（4–200 字）'}</label><input id="rcFrReason" maxlength="200"></div>
    <div id="rcFrErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn ${frozen ? 'primary' : 'danger'}" onclick="caseFreezeSubmit(${id}, ${userId}, ${frozen ? 1 : 0})">确认${frozen ? '解冻' : '冻结'}</button>`)
}
window.caseFreezeSubmit = async (id, userId, st) => {
  try {
    await api('POST', '/admin/users/' + userId + '/status', { status: st, reason: ($('#rcFrReason').value || '').trim(), caseId: id })
    closeModal(); toast(st ? '已解冻并写入案件时间线' : '已冻结并写入案件时间线'); caseDrawer(id)
  } catch (e) { $('#rcFrErr').textContent = e.message }
}
