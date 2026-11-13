// 订单售后工单（T04）：新建→认领→处理中→等待外部→已解决→关闭；转派/恢复/重开全留痕。
// 平台客服（super/ops）办理；城市账号发起本城请求、补充材料。普通脚本共享全局作用域。

const TICKET_ST = {
  0: '<span class="pill warn">待认领</span>', 1: '<span class="pill s20">处理中</span>', 2: '<span class="pill s40">等待外部</span>',
  3: '<span class="pill ok">已解决</span>', 4: '<span class="pill off">已关闭</span>',
}
const TICKET_CAT = { refund: '退款诉求', reschedule: '改期咨询', contact: '联系人变更', complaint: '投诉', other: '其他' }
const TICKET_PRI = { 1: '<span class="pill s70">紧急</span>', 2: '<span class="pill off">普通</span>', 3: '<span class="pill off">低</span>' }
const TICKET_ACT = { create: '创建', claim: '认领', transfer: '转派', wait: '转等待', resume: '恢复处理', note: '记录', resolve: '办结', close: '关闭', reopen: '重开' }

async function tickets() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  window.__tkQ = window.__tkQ || { page: 1, status: '', kw: '' }
  const Q = window.__tkQ
  const data = await api('GET', '/admin/tickets?' + new URLSearchParams({ page: Q.page, status: Q.status, kw: Q.kw }).toString())
  const rows = data.rows
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const counts = data.statusCounts || {}
  const canManage = adminCan('ticket.manage')
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    <div class="kpi go" ${dxKey} title="筛选：待认领的工单" onclick="window.__tkQ={page:1,status:'0',kw:''};tickets()"><i class="go-arrow">↗</i><div class="ico" style="background:#fdecec">${ICONS.orders}</div><div><div class="l">待认领</div><div class="v">${Number(counts[0] || 0)}</div><div class="s">客服认领后开始处理</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">${ICONS.config}</div><div><div class="l">处理中 / 等待外部</div><div class="v">${dxNumGo(Number(counts[1] || 0), "window.__tkQ={page:1,status:'1',kw:''};tickets()", "筛选：处理中")} / ${dxNumGo(Number(counts[2] || 0), "window.__tkQ={page:1,status:'2',kw:''};tickets()", "筛选：等待外部")}</div><div class="s">含等待游客/商户/财务</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e3f6ec">${ICONS.check}</div><div><div class="l">已解决 / 已关闭</div><div class="v">${dxNumGo(Number(counts[3] || 0), "window.__tkQ={page:1,status:'3',kw:''};tickets()", "筛选：已解决")} / ${dxNumGo(Number(counts[4] || 0), "window.__tkQ={page:1,status:'4',kw:''};tickets()", "筛选：已关闭")}</div><div class="s">结论与时间线留痕</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>售后工单队列</h2><span class="muted">按诉求类别发起，客服认领办理；城市账号可发起本城请求与补充材料，办结由平台客服负责</span></div>
    <div class="cfg-tabs">${[['', '全部'], [0, '待认领'], [1, '处理中'], [2, '等待外部'], [3, '已解决'], [4, '已关闭']].map(([v, n]) => `<button class="cfg-tab ${String(Q.status) === String(v) ? 'on' : ''}" onclick="window.__tkQ.status='${v}';window.__tkQ.page=1;tickets()">${n} ${v === '' ? Number(counts.all || 0).toLocaleString() : Number(counts[v] || 0).toLocaleString()}</button>`).join('')}
      <input class="inp" id="tkKw" placeholder="工单号 / 订单号" value="${esc(Q.kw)}" style="width:180px;margin-left:8px"> <button class="btn ghost sm" onclick="window.__tkQ.kw=document.getElementById('tkKw').value.trim();window.__tkQ.page=1;tickets()">搜索</button></div>
    ${rows.length ? `<table><thead><tr><th>工单号</th><th>订单 / 类别</th><th>优先级</th><th>责任人</th><th>状态</th><th>创建 / 承诺</th><th>操作</th></tr></thead><tbody>
    ${rows.map((t) => {
      const overdue = t.promised_at && Number(t.status) < 3 && parseDate(t.promised_at) < new Date()
      const ops = [`<button class="btn ghost sm" onclick="ticketDrawer(${t.id})">时间线</button>`]
      if (canManage) {
        if (Number(t.status) === 0) ops.push(`<button class="btn primary sm" onclick="ticketAction(${t.id},'claim',{})">认领</button>`)
        if ([1, 2].includes(Number(t.status))) {
          ops.push(`<button class="btn ghost sm" onclick="ticketAction(${t.id},'transfer',{needAssignee:true})">转派</button>`)
          if (Number(t.status) === 1) ops.push(`<button class="btn ghost sm" onclick="ticketAction(${t.id},'wait',{})">转等待</button>`)
          if (Number(t.status) === 2) ops.push(`<button class="btn ghost sm" onclick="ticketAction(${t.id},'resume',{})">恢复处理</button>`)
          ops.push(`<button class="btn primary sm" onclick="ticketAction(${t.id},'resolve',{needNote:true})">办结</button>`)
        }
        if (Number(t.status) !== 4) ops.push(`<button class="btn danger sm" onclick="ticketAction(${t.id},'close',{needNote:true})">关闭</button>`)
        if ([3, 4].includes(Number(t.status))) ops.push(`<button class="btn ghost sm" onclick="ticketAction(${t.id},'reopen',{needNote:true})">重开</button>`)
      }
      return `<tr><td class="num">${esc(t.ticket_no)}${Number(t.source) === 0 ? '' : (t.source === 'city' ? '<div><span class="pill s40">城市发起</span></div>' : '')}</td>
      <td><button class="order-link" data-order-no="${esc(t.order_no)}">${esc(t.order_no)}</button><div class="td-sub">${TICKET_CAT[t.category] || esc(t.category)}</div></td>
      <td>${TICKET_PRI[t.priority] || ''}</td>
      <td class="td-sub">${esc(t.assignee || '—')}</td>
      <td>${TICKET_ST[t.status] || t.status}${overdue ? '<div><span class="pill s70">已超时</span></div>' : ''}</td>
      <td class="td-sub">${esc(String(t.created_at).slice(5, 16).replace('T', ' '))}${t.promised_at ? '<br>承诺 ' + esc(String(t.promised_at).slice(5, 16).replace('T', ' ')) : ''}</td>
      <td><div class="td-actions">${ops.join('')}</div></td></tr>` }).join('')}</tbody></table>`
    : emptyBox((Q.kw || Q.status !== '') ? '没有符合条件的工单。' : '暂无售后工单——从订单详情或本页上方「发起售后」创建。')}
    <div class="pagination"><span>共 ${Number(data.total).toLocaleString()} 单 · 第 ${data.page} / ${pages} 页</span><div><button class="btn ghost sm" ${data.page <= 1 ? 'disabled' : ''} onclick="window.__tkQ.page--;tickets()">上一页</button> <button class="btn ghost sm" ${data.page >= pages ? 'disabled' : ''} onclick="window.__tkQ.page++;tickets()">下一页</button></div></div>
  </div>`
  document.querySelectorAll('#app [data-order-no]').forEach((b) => { b.onclick = () => orderDrawer(b.dataset.orderNo).catch((e) => toast(e.message, true)) })
}

// 发起售后（订单详情抽屉与工单页共用）
window.ticketCreateModal = (orderNo) => {
  modal('发起售后工单 · ' + esc(orderNo), `
    <div class="field"><label>诉求类别 *</label><select id="tkCat"><option value="refund">退款诉求</option><option value="reschedule">改期咨询</option><option value="contact">联系人变更</option><option value="complaint">投诉</option><option value="other">其他</option></select></div>
    <div class="field"><label>优先级</label><select id="tkPri"><option value="2">普通</option><option value="1">紧急</option><option value="3">低</option></select></div>
    <div class="field"><label>诉求说明 *（4–500 字，进入工单时间线）</label><textarea id="tkNote" rows="3" maxlength="500"></textarea></div>
    <div class="field"><label>承诺办结时限（可选）</label><input id="tkPromised" type="datetime-local"></div>
    <div id="tkErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="ticketCreateSubmit('${escJs(orderNo)}')">创建工单</button>`)
}
window.ticketCreateSubmit = async (orderNo) => {
  try {
    const r = await api('POST', '/admin/tickets', { orderNo, category: $('#tkCat').value, priority: Number($('#tkPri').value), note: ($('#tkNote').value || '').trim(), promisedAt: $('#tkPromised').value || null })
    closeModal(); toast('工单 ' + r.ticketNo + ' 已创建，等待客服认领')
    if (ADMIN_CAPABILITIES.role === 'city_partner') { /* 城市账号留在订单页 */ } else tickets()
  } catch (e) { $('#tkErr').textContent = e.message }
}

// 工单时间线抽屉
window.ticketDrawer = async (id) => {
  const d = await api('GET', '/admin/tickets/' + id)
  const t = d.ticket
  drawer('售后工单 ' + esc(t.ticket_no) + ' · ' + (TICKET_ST[t.status] || ''), `
    ${kv('订单', `<button class="order-link" data-order-no="${esc(t.order_no)}">${esc(t.order_no)}</button>`)}
    ${kv('类别 / 优先级', (TICKET_CAT[t.category] || esc(t.category)) + ' · ' + (t.priority === 1 ? '紧急' : t.priority === 3 ? '低' : '普通'))}
    ${kv('责任人', esc(t.assignee || '尚未认领'))}
    ${t.promised_at ? kv('承诺时限', esc(String(t.promised_at).slice(0, 16).replace('T', ' '))) : ''}
    ${t.resolution ? kv('结论', esc(t.resolution)) : ''}
    <div class="rv-box"><div class="rv-h">处理时间线（不可改写）</div>
    ${d.records.map((r) => `<div style="margin:6px 0"><b>${TICKET_ACT[r.action] || esc(r.action)}</b> · ${esc(r.actor)} <span class="td-sub">${esc(String(r.created_at).slice(5, 16).replace('T', ' '))}</span>${r.note ? '<div class="td-sub">' + esc(r.note) + '</div>' : ''}</div>`).join('')}</div>
    <div class="field"><label>补充处理记录（2–500 字）</label><input id="tkAddNote" maxlength="500"></div>
    <button class="btn ghost sm" onclick="ticketAddNote(${t.id})">追加记录</button>`)
  document.querySelectorAll('#modalRoot [data-order-no]').forEach((b) => { b.onclick = () => { closeModal(); orderDrawer(b.dataset.orderNo).catch((e) => toast(e.message, true)) } })
}
window.ticketAddNote = async (id) => {
  try { await api('POST', '/admin/tickets/' + id + '/note', { note: ($('#tkAddNote').value || '').trim() }); toast('记录已追加'); ticketDrawer(id) } catch (e) { toast(e.message, true) }
}

// 办理动作（认领/转派/等待/恢复/办结/关闭/重开）：平台客服
window.ticketAction = (id, action, opt = {}) => {
  const titles = { claim: '认领工单', transfer: '转派工单', wait: '转为等待外部', resume: '恢复处理', resolve: '办结工单', close: '关闭工单', reopen: '重开工单' }
  const needNote = opt.needNote || ['resolve', 'close', 'reopen', 'transfer'].includes(action)
  modal(titles[action] + ' · #' + id, `
    ${action === 'transfer' ? '<div class="field"><label>新责任人（admin:显示名）*</label><input id="tkTo"></div>' : ''}
    <div class="field"><label>${action === 'resolve' ? '结论 *' : action === 'close' ? '关闭说明 *（含结论）' : action === 'transfer' ? '转派原因 *' : action === 'reopen' ? '重开原因 *' : '说明（可选）'}</label>
      <textarea id="tkActNote" rows="2" maxlength="500"></textarea></div>
    <div id="tkActErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="ticketActionSubmit(${id}, '${action}')">确认</button>`)
}
window.ticketActionSubmit = async (id, action) => {
  try {
    const body = { note: ($('#tkActNote').value || '').trim() }
    if (action === 'transfer') body.assignee = ($('#tkTo').value || '').trim()
    const r = await api('POST', '/admin/tickets/' + id + '/' + action, body)
    closeModal(); toast('工单已' + (TICKET_ACT[action] || action) + '，状态：' + (r.statusCn || '')); tickets()
  } catch (e) { $('#tkActErr').textContent = e.message }
}
