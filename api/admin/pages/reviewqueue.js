// 审核工作队列（T07）：四类待办统一聚合 + 认领协调（不改判定逻辑，判定仍走各队列原接口）。
// 认领 = "我在处理"；同一待办同时只允许一人认领，判定完成后自动释放；超时(≥48h)标红。
const RQ_KIND = { note: '独立笔记审核', task_entry: '约稿投稿审核', report: '举报处理', appeal: '作者申诉' }
const RQ_ROUTE = { note: 'content', task_entry: 'tasks', report: 'contentcases', appeal: 'contentcases' }

async function reviewqueue() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const d = await api('GET', '/admin/review-queue')
  const myName = 'admin:' + (ME?.displayName || ME?.username || '')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>审核工作队列</h2><span class="muted">四类待办统一聚合 · 认领协调（同一待办同时一人） · 判定仍走各队列原接口 · 超 48 小时标红</span></div>
    <p class="td-sub">认领后请到对应栏目完成审核判定；判定完成后认领自动释放。本页只做待办发现与认领协调，不做审核判定。</p>
    ${d.queues.map((q) => `
    <div class="card" style="margin-bottom:12px">
      <div class="card-head"><h3>${esc(q.kindCn)} <span class="pill ${q.items.length ? 'warn' : 'off'}">${q.items.length} 待办</span></h3>
        <button class="btn ghost sm" onclick="go('${RQ_ROUTE[q.kind]}')">前往${esc(q.kindCn)} →</button></div>
      ${q.items.length ? `<table><thead><tr><th>ID</th><th>摘要</th><th>等待时长</th><th>认领状态</th><th>操作</th></tr></thead><tbody>
      ${q.items.map((it) => {
        const mine = it.claimedBy === myName
        return `<tr><td class="num">#${it.item_id}</td><td class="td-sub" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.extra || '—')}</td>
        <td>${it.overdue ? '<span class="pill s70">' + it.waitingHours + 'h 超时</span>' : '<span class="pill ' + (it.waitingHours >= 24 ? 'warn' : 'off') + '">' + it.waitingHours + 'h</span>'}</td>
        <td>${it.claimedBy ? (mine ? '<span class="pill ok">本人处理中</span>' : '<span class="pill s40">' + esc(it.claimedBy.replace('admin:', '')) + '</span>') : '<span class="pill off">未认领</span>'}</td>
        <td><div class="td-actions">
          ${!it.claimedBy ? `<button class="btn primary sm" onclick="rqClaim('${q.kind}', ${it.item_id})">认领</button>` : ''}
          ${mine ? `<button class="btn ghost sm" onclick="rqRelease('${q.kind}', ${it.item_id})">释放</button>` : ''}
          <button class="btn ghost sm" onclick="go('${RQ_ROUTE[q.kind]}')">去处理</button>
        </div></td></tr>`}).join('')}</tbody></table>`
      : emptyBox('该队列暂无待办 ✓')}</div>`).join('')}
  </div>`
}
window.rqClaim = async (kind, itemId) => {
  try {
    const r = await api('POST', `/admin/review-queue/${kind}/${itemId}/claim`)
    toast(r.already ? '该待办本就由你认领' : '已认领，请尽快到对应栏目完成判定')
    reviewqueue()
  } catch (e) { toast(e.message, true) }
}
window.rqRelease = async (kind, itemId) => {
  try { await api('POST', `/admin/review-queue/${kind}/${itemId}/release`); toast('已释放'); reviewqueue() } catch (e) { toast(e.message, true) }
}
