// 运营工作台(V94):按当前授权聚合「本人和岗位队列」——资源预审(主体申请)、内容待办(审核队列)、
// 售后工单。按有效模块显示,可直接办理(深链到对应栏目);审批类动作仍按 subject.approve 授权执行。
async function opsdesk() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:140px"></div></div>'
  const mods = new Set(ME?.modules || [])
  const canSubject = mods.has('subjectapprove')
  const canQueue = mods.has('reviewqueue')
  const canTickets = mods.has('tickets')
  const [subject, queue, tickets, inboxSum] = await Promise.all([
    canSubject ? api('GET', '/admin/subject-requests?view=approval&status=1').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
    canQueue ? api('GET', '/admin/review-queue').catch(() => ({ queues: [] })) : Promise.resolve({ queues: [] }),
    canTickets ? api('GET', '/admin/tickets?page=1&pageSize=1&status=open').catch(() => ({ total: 0 })) : Promise.resolve({ total: 0 }),
    api('GET', '/admin/inbox/summary').catch(() => ({ unread: 0 })),
  ])
  const pendingSubject = (subject.items || []).filter((r) => !r.parent_id)
  const queueTotal = (queue.queues || []).reduce((s, q) => s + Number(q.total || 0), 0)
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>运营工作台</h2>
      <span class="pill ${inboxSum.canApprove ? 'ok' : 'off'}">${inboxSum.canApprove ? '已获主体审批授权' : '未获主体审批授权(超管可在「后台账号」按员工授予)'}</span>
      <span class="pill off">站内未读 ${Number(inboxSum.unread || 0)}</span></div>
    <p class="td-sub">按当前授权显示队列;预审=意见与办理记录(不改状态),批准/退回须审批授权。资金与系统动作沿用现有职责边界。</p>
    <div class="kpi-grid" style="margin:10px 0">
      <div class="kpi" ${canSubject ? 'style="cursor:pointer" onclick="go(\'subjectapprove\')"' : ''}><b>${pendingSubject.length}</b><span>主体申请待审</span></div>
      <div class="kpi" ${canQueue ? 'style="cursor:pointer" onclick="go(\'reviewqueue\')"' : ''}><b>${queueTotal}</b><span>内容待办</span></div>
      <div class="kpi" ${canTickets ? 'style="cursor:pointer" onclick="go(\'tickets\')"' : ''}><b>${Number(tickets.total || 0)}</b><span>开放售后工单</span></div>
    </div>
  </div>
  ${canSubject ? `<div class="card">
    <div class="card-head"><h3>主体申请待预审</h3><button class="btn ghost sm" onclick="go('subjectapprove')">进入审批页 →</button></div>
    ${pendingSubject.length ? `<table><thead><tr><th>申请号</th><th>主体</th><th>对象</th><th>变更</th><th>提交时间</th><th>操作</th></tr></thead><tbody>
      ${pendingSubject.slice(0, 8).map((r) => `<tr><td class="num">${esc(r.req_no)}</td>
        <td>${r.subject_type === 'merchant' ? '商户' : '景区'}#${r.subject_id}</td>
        <td>${esc(r.kindCn)} · ${r.action === 'create' ? '新增' : '修改'}</td>
        <td class="td-sub">${esc(r.changedLabels.join('、') || '—')}</td>
        <td class="td-sub">${esc((r.submitted_at || '').slice(0, 16))}</td>
        <td><button class="btn primary sm" onclick="saDetail(${r.id})">预审/详情</button></td></tr>`).join('')}</tbody></table>`
      : emptyBox('暂无待预审申请 ✓')}</div>` : ''}
  ${canQueue ? `<div class="card">
    <div class="card-head"><h3>内容待办(审核队列)</h3><button class="btn ghost sm" onclick="go('reviewqueue')">进入审核队列 →</button></div>
    <div class="kpi-grid">${(queue.queues || []).map((q) => `<div class="kpi" style="cursor:pointer" onclick="go('${q.kind === 'note' ? 'content' : q.kind === 'task_entry' ? 'tasks' : 'contentcases'}')"><b>${Number(q.total || 0)}</b><span>${esc(q.kindCn)}</span></div>`).join('')}</div>
  </div>` : ''}
  ${canTickets ? `<div class="card">
    <div class="card-head"><h3>售后工单</h3><button class="btn ghost sm" onclick="go('tickets')">进入工单 →</button></div>
    <p class="td-sub">认领/跟进/办结按现有工单权限办理;退款执行与资金动作走现有资金审批,不在本工作台。</p>
  </div>` : ''}
  `
}
