// 站内收件箱与顶栏未读(V94):提交→超管+获授权运营;批准/退回→提交人;已读≠已处理,待审数独立计算。
// 权限变化/账号停用后,详情与通知按当前权限重验(服务端逐请求复验,点开过期链接明确报权限)。
window.refreshInboxBadge = async () => {
  try {
    if (!window.TOKEN) return
    const s = await window.api('GET', '/admin/inbox/summary')
    const badge = document.getElementById('inboxBadge')
    const bell = document.getElementById('inboxBell')
    if (!badge || !bell) return
    badge.textContent = Number(s.unread || 0) > 99 ? '99+' : String(Number(s.unread || 0))
    bell.hidden = false
    badge.hidden = !(Number(s.unread || 0) > 0)
    if (Number(s.pendingApprovals || 0) > 0 && s.canApprove) {
      bell.title = `站内未读 ${s.unread} · 主体待审 ${s.pendingApprovals}`
    } else {
      bell.title = `站内未读 ${s.unread}`
    }
  } catch { /* 徽标尽力而为,失败不打扰 */ }
}

window.openInbox = async () => {
  const d = await window.api('GET', '/admin/inbox')
  const KIND_TAG = { subject_request_submitted: '新申请', subject_request_approved: '已批准', subject_request_rejected: '已退回', subject_request_withdrawn: '已撤回' }
  window.modal('站内收件箱', `
    <div class="row" style="margin-bottom:8px"><button class="btn ghost sm" onclick="inboxReadAll()">全部标为已读</button>
      <span class="td-sub">已读不等于已处理;待审队列以申请状态为准,读过的待审单仍留在队列。</span></div>
    ${d.items.length ? d.items.map((it) => `
      <div class="card" style="margin:6px 0;padding:10px 14px;${it.read_at ? '' : 'border-left:3px solid var(--primary,#2563eb)'}">
        <div class="card-head" style="margin:0"><b>${esc(it.title)}</b>
          <span class="pill ${it.handled_at ? 'off' : 'warn'}">${it.handled_at ? '已处理' : (KIND_TAG[it.kind] || '通知')}</span></div>
        <p class="td-sub" style="margin:4px 0">${esc(it.body || '')}</p>
        <div class="td-actions"><span class="td-sub">${esc((it.created_at || '').slice(0, 16))}</span>
          ${it.link ? `<button class="btn primary sm" onclick="inboxGo(${it.id}, '${escJs(it.link)}')">${it.handled_at ? '查看结果' : '去处理'}</button>` : ''}
          ${!it.read_at ? `<button class="btn ghost sm" onclick="inboxRead(${it.id})">标为已读</button>` : ''}</div>
      </div>`).join('') : '<p class="td-sub">暂无通知</p>'}`,
    `<button class="btn ghost sm" onclick="closeModal()">关闭</button>`, true)
}

window.inboxGo = async (id, link) => {
  try { await window.api('POST', '/admin/inbox/' + id + '/read') } catch { /* 忽略 */ }
  window.closeModal()
  await window.refreshInboxBadge?.()
  if (String(link).startsWith('#')) window.go(String(link).slice(1).split('?')[0], { history: true })
  else if (String(link)) location.hash = link
}
window.inboxRead = async (id) => {
  await window.api('POST', '/admin/inbox/' + id + '/read')
  await window.refreshInboxBadge?.()
  window.openInbox()
}
window.inboxReadAll = async () => {
  await window.api('POST', '/admin/inbox/read-all')
  await window.refreshInboxBadge?.()
  window.openInbox()
}
