// 审核工作队列（T07）：四类待办统一聚合 + 认领协调（不改判定逻辑，判定仍走各队列原接口）。
// 认领 = "我在处理"；同一待办同时只允许一人认领，判定完成后自动释放；超时(≥48h)标红。
// V-07：total 为独立计数——列表只显示前 20 条（显示窗口），超出时明确提示，不把窗口当全部待办。
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
      <div class="card-head"><h3>${esc(q.kindCn)} <span class="pill ${Number(q.total) ? 'warn' : 'off'}">共 ${Number(q.total).toLocaleString()} 待办</span></h3>
        <button class="btn ghost sm" onclick="go('${RQ_ROUTE[q.kind]}')">前往${esc(q.kindCn)} →</button></div>
      ${q.truncated ? `<p class="td-sub" style="margin:4px 0 0">⚠ 待办共 ${Number(q.total).toLocaleString()} 条，本页按等待时长仅显示最早 ${q.items.length} 条，其余请到${esc(q.kindCn)}栏目按列表翻页处理。</p>` : ''}
      ${q.items.length ? `<table><thead><tr><th style="width:36px"></th><th>ID</th><th>摘要</th><th>等待时长</th><th>认领状态</th><th>操作</th></tr></thead><tbody>
      ${q.items.map((it) => {
        // 本人判定优先按不可变 UID（旧数据无 uid 时回退名字快照）
        const mine = it.claimedUid != null ? (ME?.uid != null && Number(it.claimedUid) === Number(ME.uid)) : it.claimedBy === myName
        return `<tr><td>${(q.kind === 'note' || q.kind === 'report') && !it.claimedBy ? `<input type="checkbox" class="rq-sel" data-kind="${q.kind}" data-id="${it.item_id}" aria-label="选择待办 ${it.item_id}">` : ''}</td>
        <td class="num">#${it.item_id}</td><td class="td-sub" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.extra || '—')}</td>
        <td>${it.overdue ? '<span class="pill s70">' + it.waitingHours + 'h 超时</span>' : '<span class="pill ' + (it.waitingHours >= 24 ? 'warn' : 'off') + '">' + it.waitingHours + 'h</span>'}</td>
        <td>${it.claimedBy ? (mine ? '<span class="pill ok">本人处理中</span>' : '<span class="pill s40">' + esc(it.claimedBy.replace('admin:', '')) + '</span>') : '<span class="pill off">未认领</span>'}</td>
        <td><div class="td-actions">
          ${!it.claimedBy ? `<button class="btn primary sm" onclick="rqClaim('${q.kind}', ${it.item_id})">认领</button>` : ''}
          ${mine ? `<button class="btn ghost sm" onclick="rqRelease('${q.kind}', ${it.item_id})">释放</button>` : ''}
          <button class="btn ghost sm" onclick="go('${RQ_ROUTE[q.kind]}')">去处理</button>
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
window.rqRelease = async (kind, itemId) => {
  try { await api('POST', `/admin/review-queue/${kind}/${itemId}/release`); toast('已释放'); reviewqueue() } catch (e) { toast(e.message, true) }
}
