// 审核工作队列（T07）：四类待办统一聚合 + 认领协调（不改判定逻辑，判定仍走各队列原接口）。
// 认领 = "我在处理"；同一待办同时只允许一人认领，判定完成后自动释放；超时(≥48h)标红。
// V-07：total 为独立计数——列表只显示前 20 条（显示窗口），超出时明确提示，不把窗口当全部待办。
const RQ_KIND = { note: '独立笔记审核', task_entry: '约稿投稿审核', report: '举报处理', appeal: '作者申诉' }
const RQ_ROUTE = { note: 'content', task_entry: 'tasks', report: 'contentcases', appeal: 'contentcases' }

let rqItems = []
let rqActive = null

async function rqOpen(kind, id) {
  rqActive = { kind, id, scroll: window.scrollY }
  if (kind === 'note') return reviewNote(id)
  if (kind === 'task_entry') return reviewEntry(id)
  return contentCaseReview(kind === 'report' ? 'reports' : 'appeals', id)
}

async function rqFinish(kind, id, next = false) {
  if (location.hash !== '#reviewqueue' || rqActive?.kind !== kind || Number(rqActive.id) !== Number(id)) return false
  const { scroll } = rqActive
  const group = rqItems.find(queue => queue.kind === kind)?.items || []
  const idx = group.findIndex(row => Number(row.item_id) === Number(id))
  const candidates = [...group.slice(idx + 1), ...group.slice(0, Math.max(idx, 0))]
  rqActive = null
  closeModal()
  await reviewqueue()
  if (location.hash !== '#reviewqueue') return true
  window.scrollTo(0, scroll)
  const remaining = rqItems.find(queue => queue.kind === kind)?.items || []
  const available = row => !row.claimedBy || Number(row.claimedUid) === Number(ME?.uid)
  const target = candidates.find(row => remaining.some(item => item.item_id === row.item_id && available(item))) || remaining.find(available)
  const button = target && document.querySelector(`[data-rq-kind="${kind}"][data-rq-id="${target.item_id}"]`)
  if (button) button.focus({ preventScroll: true })
  if (next && target) await rqOpen(kind, target.item_id)
  return true
}

async function reviewqueue() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const d = await api('GET', '/admin/review-queue')
  rqItems = d.queues
  const myName = 'admin:' + (ME?.displayName || ME?.username || '')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>审核工作队列</h2><span class="muted">四类待办统一聚合 · 认领后他人不可重复处理 · 完成判定自动释放 · 超 48 小时标红</span></div>
    <p class="td-sub">点「去处理」打开对应待办。完成判定后认领自动释放，回到当前队列。</p>
    ${d.queues.map((q) => `
    <div class="card" style="margin-bottom:12px">
      <div class="card-head"><h3>${esc(q.kindCn)} <span class="pill ${Number(q.total) ? 'warn' : 'off'}">共 ${Number(q.total).toLocaleString()} 待办</span></h3>
        <button class="btn ghost sm" onclick="go('${RQ_ROUTE[q.kind]}')">前往${esc(q.kindCn)} →</button></div>
      ${q.truncated ? `<p class="td-sub" style="margin:4px 0 0">⚠ 待办共 ${Number(q.total).toLocaleString()} 条，本页按等待时长仅显示最早 ${q.items.length} 条，其余请到${esc(q.kindCn)}栏目按列表翻页处理。</p>` : ''}
      ${q.items.length ? `<table><thead><tr><th style="width:36px"></th><th>ID</th><th>摘要</th><th>等待时长</th><th>认领状态</th><th>操作</th></tr></thead><tbody>
      ${q.items.map((it) => {
        // 本人判定优先按不可变 UID（旧数据无 uid 时回退名字快照）
        const mine = it.claimedUid != null ? (ME?.uid != null && Number(it.claimedUid) === Number(ME.uid)) : it.claimedBy === myName
        // B3（498,564 小时异常修复）：submitted_at 为空（驳回回退置 NULL）时服务端返回 null——显示「待核对」，
        // 不参与超时判定与 SLA 排序（服务端已把空值排最后）；正常超时项仍按时长标红定位。
        const waitCell = it.waitingHours == null
          ? '<span class="pill off" title="提交时间缺失（历史驳回回退数据），待核对">待核对</span>'
          : (it.overdue ? '<span class="pill s70">' + it.waitingHours + 'h 超时</span>' : '<span class="pill ' + (it.waitingHours >= 24 ? 'warn' : 'off') + '">' + it.waitingHours + 'h</span>')
        return `<tr><td>${(q.kind === 'note' || q.kind === 'report') && !it.claimedBy ? `<input type="checkbox" class="rq-sel" data-kind="${q.kind}" data-id="${it.item_id}" aria-label="选择待办 ${it.item_id}">` : ''}</td>
        <td class="num">#${it.item_id}</td><td class="td-sub" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.extra || '—')}</td>
        <td>${waitCell}</td>
        <td>${it.claimedBy ? (mine ? '<span class="pill ok">本人处理中</span>' : '<span class="pill s40">' + esc(it.claimedBy.replace('admin:', '')) + '</span>') : '<span class="pill off">未认领</span>'}</td>
        <td><div class="td-actions">
          ${!it.claimedBy ? `<button class="btn primary sm" onclick="rqClaim('${q.kind}', ${it.item_id})">认领</button>` : ''}
          ${mine ? `<button class="btn ghost sm" onclick="rqRelease('${q.kind}', ${it.item_id})">释放</button>` : ''}
          ${mine && ['super', 'review'].includes(ME?.role) ? `<button class="btn ghost sm" onclick="rqReassign('${q.kind}', ${it.item_id})">转派</button>` : ''}
          <button class="btn ghost sm" data-rq-kind="${q.kind}" data-rq-id="${it.item_id}" onclick="rqOpen('${q.kind}', ${it.item_id})">去处理</button>
        </div></td></tr>`}).join('')}</tbody></table>
      ${(q.kind === 'note' || q.kind === 'report') ? `<div class="row" style="margin-top:10px"><button class="btn primary sm" onclick="rqBatch('${q.kind}')">批量${q.kind === 'note' ? '通过' : '不成立'}</button>
        <span class="td-sub">勾选未认领待办 → 先逐笔预检列异常 → 逐笔执行并反馈结果（单次 ≤50 条；${q.kind === 'note' ? '仅超管/审核员' : '统一处理意见进逐笔审计'}）</span></div>` : ''}`
      : emptyBox('该队列暂无待办 ✓')}</div>`).join('')}
  </div>`
}
// R-03：批量审批（同条件逐笔预检 → 逐笔执行 → 逐笔结果反馈）
window.rqBatch = (kind) => {
  const ids = [...document.querySelectorAll(`input.rq-sel[data-kind="${kind}"]:checked`)].map((c) => Number(c.dataset.id))
  if (!ids.length) return toast('请先勾选要批量处理的待办', true)
  const action = kind === 'note' ? '通过' : '不成立'
  modal(`批量${action} · ${ids.length} 条`, `
    <p class="td-sub">先逐笔预检（状态/城市/权限），异常进清单不执行；通过预检的逐笔执行并反馈结果。${kind === 'report' ? '同一处理意见会写入每笔审计。' : ''}</p>
    ${kind === 'report' ? '<div class="field"><label>统一处理意见 *（4–300 字，进入每笔审计）</label><input id="rqBatchReason" maxlength="300"></div>' : ''}
    <div id="rqBatchErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="rqBatchSubmit('${kind}', ${JSON.stringify(ids).replace(/"/g, '&quot;')})">预检并执行 ${ids.length} 条</button>`)
}
window.rqBatchSubmit = async (kind, ids) => {
  try {
    const body = { kind, itemIds: ids, action: kind === 'note' ? 'pass' : 'dismiss', reason: ($('#rqBatchReason')?.value || '').trim() }
    const r = await api('POST', '/admin/review-queue/batch-verdict', body)
    const rows = [
      ...r.precheckFailed.map((p) => `<div style="margin:4px 0">#${p.id}：<span class="pill warn">预检未过</span> ${esc(p.reason)}</div>`),
      ...r.results.map((x) => `<div style="margin:4px 0">#${x.id}：${x.ok ? '<span class="pill ok">成功</span>' : '<span class="pill s70">' + esc(x.reason || '失败') + '</span>'}</div>`),
    ]
    modal('批量审批结果', `
      <p>成功 <span class="pill ok">${r.ok}</span> 失败 <span class="pill ${r.fail ? 's70' : 'off'}">${r.fail}</span> 预检未过 <span class="pill ${r.precheckFailed.length ? 'warn' : 'off'}">${r.precheckFailed.length}</span> / 共 ${r.total}</p>
      <div class="rv-box" style="max-height:320px;overflow:auto">${rows.join('') || '<p class="muted">无明细</p>'}</div>`,
      `<button class="btn primary" onclick="closeModal();reviewqueue()">完成</button>`)
  } catch (e) { $('#rqBatchErr') ? $('#rqBatchErr').textContent = e.message : toast(e.message, true) }
}
window.rqClaim = async (kind, itemId) => {
  try {
    const r = await api('POST', `/admin/review-queue/${kind}/${itemId}/claim`)
    toast(r.already ? '该待办本就由你认领' : '已认领，请尽快到对应栏目完成判定')
    reviewqueue()
  } catch (e) { toast(e.message, true) }
}
// P-07：组长转派——当前认领释放 + 目标审核员新认领（服务端同事务 + 审计）
window.rqReassign = (kind, itemId) => {
  modal('转派待办 #' + itemId, `
    <p class="td-sub">当前认领会先释放，目标审核员即刻获得认领；操作写入审计。被转派人需具备该队列的审核资格。</p>
    <div class="field"><label>被转派人账号 ID *</label><input id="rqToUid" type="number" placeholder="在「后台账号」页查看审核员的数字 ID"></div>
    <div id="rqReErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="rqReassignSubmit('${kind}', ${itemId})">确认转派</button>`)
}
window.rqReassignSubmit = async (kind, itemId) => {
  try {
    const r = await api('POST', `/admin/review-queue/${kind}/${itemId}/reassign`, { toUid: Number(document.getElementById('rqToUid').value) })
    toast('已转派给 ' + r.to)
    closeModal(); reviewqueue()
  } catch (e) { const el = $('#rqReErr'); if (el) el.textContent = e.message; else toast(e.message, true) }
}
window.rqRelease = async (kind, itemId) => {
  try { await api('POST', `/admin/review-queue/${kind}/${itemId}/release`); toast('已释放'); reviewqueue() } catch (e) { toast(e.message, true) }
}
