// 内容运营：内容审核、约稿任务、创作者池、常见问题、轮播
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

/* ============ 内容审核（笔记 + 线路评价） ============ */
async function content() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const [rows, rvs] = await Promise.all([api('GET', '/admin/content'), api('GET', '/admin/reviews')])
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>笔记审核</h2><span class="muted">查看全文与图片，处理待审笔记；已发布内容可下架并告知作者原因。</span></div>
    ${adminCan('note.review') ? '' : '<p class="muted">当前账号可查看审核材料；通过、驳回由审核员或超级管理员处理。</p>'}
    ${rows.length ? `<table><thead><tr><th>作者</th><th>标题</th><th>内容</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
    ${rows.map((n) => `<tr><td>${esc(n.nickname)}${n.creator_tag && n.creator_tag !== 'none' ? ` <span class="pill ${n.creator_tag === 'star' ? 'ok' : (n.creator_tag === 'limited' ? 's70' : 's40')}">${CREATOR_TAG[n.creator_tag] || ''}</span>` : ''}</td><td class="td-main">${esc(n.title || '（无题）')}</td>
      <td class="td-sub" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(noteExcerpt(n.body))}</td>
      <td>${['<span class="pill warn">机审中</span>', '<span class="pill s20">人工审核</span>', '<span class="pill ok">已发布</span>', '<span class="pill s70">已驳回</span>', '<span class="pill off">已下架</span>'][n.status]}</td>
      <td class="td-sub">${esc(String(n.created_at).slice(5, 16))}</td>
      <td>${[0, 1].includes(Number(n.status)) && adminCan('note.review') ? `<button class="btn primary sm" onclick="reviewNote(${n.id})">审核</button>` : `<button class="btn ghost sm" onclick="reviewNote(${n.id})">查看</button>`}${Number(n.status)===2?`<button class="btn ghost sm" onclick="contentTakedown(${n.id})">下架</button>`:''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('暂无笔记；游客提交笔记后会显示在这里，待审内容可查看材料后处理。')}
  </div>
  <div class="card">
    <div class="card-head"><h2>线路评价管理</h2><span class="muted">游客核销后一单一评 · 文本已过机审 · 可隐藏违规/刷评</span></div>
    ${rvs.length ? `<table><thead><tr><th>用户</th><th>线路</th><th>评分</th><th>内容</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${rvs.map((r) => `<tr><td>${esc(r.nickname)}</td><td class="td-main">${esc(r.title)}</td>
      <td class="num" style="color:var(--brand);font-weight:700">${r.rating} ★</td>
      <td class="td-sub" style="max-width:320px">${esc(r.content)}</td>
      <td><span class="pill ${r.status === 1 ? 'ok' : 'off'}">${r.status === 1 ? '展示中' : '已隐藏'}</span></td>
      <td>${adminCan('review.moderate') ? `<button class="btn ${r.status === 1 ? 'danger' : 'primary'} sm" onclick="toggleReview(${r.id}, ${r.status === 1 ? 0 : 1})">${r.status === 1 ? '隐藏' : '恢复展示'}</button>` : '<span class="muted">由审核员管理展示</span>'}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('还没有评价——游客核销完成后可评价')}
  </div>`
}
async function toggleReview(id, show) {
  if (!adminCan('review.moderate')) return toast('评价展示由审核员或超级管理员处理', true)
  try { await api('POST', `/admin/reviews/${id}/hide`, { show }); content() } catch (e) { toast(e.message, true) }
}


/* ============ 约稿任务管理 ============ */
// ---- 富表单共享组件：富文本编辑器 / 单图上传（各页复用）----
async function tasks() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const [list, cashRows] = await Promise.all([api('GET', '/admin/content-tasks'), api('GET', '/admin/task-cash').catch(() => [])])
  const N = (v) => Number(v || 0)
  const now = Date.now()
  const stateOf = (t) => t.status === 4 ? 'off' : (t.deadline && new Date(String(t.deadline).replace(' ', 'T')).getTime() < now) ? 'ended'
    : (N(t.max_participants) && N(t.taken) >= N(t.max_participants)) ? 'full' : 'open'
  const ST = { open: '<span class="pill warn">招募中</span>', full: '<span class="pill s20">名额已满</span>', ended: '<span class="pill off">已截止</span>', off: '<span class="pill off">已下线</span>' }
  const sum = (k) => list.reduce((s, t) => s + N(t[k]), 0)
  const cashPending = cashRows.filter((r) => Number(r.cash_status) === 1)
  window.__taskSt = window.__taskSt === undefined ? '' : window.__taskSt
  const TABS = [['', '全部', list.length], ['review', '有待审', list.filter((t) => N(t.reviewing)).length], ['open', '招募中', list.filter((t) => stateOf(t) === 'open').length], ['off', '已下线', list.filter((t) => t.status === 4).length]]
  const frs = list.filter((t) => window.__taskSt === '' || (window.__taskSt === 'review' ? N(t.reviewing) > 0 : window.__taskSt === 'off' ? t.status === 4 : stateOf(t) === 'open'))
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico">📢</div><div><div class="l">招募中任务</div><div class="v" style="font-size:20px">${list.filter((t) => stateOf(t) === 'open').length}</div><div class="s">游客可在小程序领取</div></div></div>
    <div class="kpi"><div class="ico">✍️</div><div><div class="l">创作中</div><div class="v" style="font-size:20px">${sum('doing')}</div><div class="s">已领取未投稿 / 驳回待修改</div></div></div>
    <div class="kpi"><div class="ico">🔎</div><div><div class="l">待审核投稿</div><div class="v" style="font-size:20px">${sum('reviewing')}</div><div class="s">点任务的「参与者」逐个审核</div></div></div>
    <div class="kpi"><div class="ico">✅</div><div><div class="l">已通过</div><div class="v" style="font-size:20px">${sum('passed')}</div><div class="s">旅豆已发放</div></div></div>
    <div class="kpi"><div class="ico">💰</div><div><div class="l">现金加奖待打款</div><div class="v" style="font-size:20px">${cashPending.length}</div><div class="s">${cashPending.length ? '合计 ' + fen(cashPending.reduce((s, r) => s + N(r.cash_reward), 0)) : '没有待打款'}</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>约稿任务</h2>
      <div class="cfg-tabs" style="margin:0">${TABS.map(([v, n, c]) => `<div class="cfg-tab ${String(window.__taskSt) === v ? 'on' : ''}" onclick="window.__taskSt='${v}';tasks()">${n} ${c}</div>`).join('')}</div>
      ${adminCan('entity.task.create') ? '<button class="btn primary sm" onclick="taskModal()">＋ 新建任务</button>' : '<span class="muted">当前账号可查看任务与参与进度</span>'}</div>
    ${frs.length ? `<table><thead><tr><th>任务</th><th>类型</th><th>报酬</th><th>交付要求</th><th>名额</th><th>进度</th><th>截止</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${frs.map((t) => `<tr>
      <td><div style="display:flex;gap:8px;align-items:center">${t.cover_img ? `<img src="${esc(t.cover_img)}" style="width:56px;height:38px;object-fit:cover;border-radius:6px;flex:none">` : ''}
        <div><div class="td-main">${esc(t.title)}</div><div class="td-sub">${esc((t.tags || '').split(',').filter(Boolean).map((x) => '#' + x.trim()).join(' ') || (t.product_title ? '目标：' + t.product_title : String(t.brief || '').slice(0, 26)))}</div></div></div></td>
      <td><span class="pill off">${TASK_CAT[t.category] || esc(t.category)}</span></td>
      <td class="num"><b>${N(t.reward_beans)}</b> 豆${N(t.cash_reward) ? '<br>+' + fen(t.cash_reward) : ''}</td>
      <td class="td-sub">${[t.min_words ? N(t.min_words) + ' 字' : '', t.min_images ? N(t.min_images) + ' 图' : ''].filter(Boolean).join(' · ') || '不限'}</td>
      <td class="num">${N(t.taken)} / ${N(t.max_participants) || '不限'}</td>
      <td class="td-sub">${N(t.taken) ? `创作中 ${N(t.doing)} · <b style="color:${N(t.reviewing) ? 'var(--brand)' : 'inherit'}">待审 ${N(t.reviewing)}</b> · 通过 ${N(t.passed)}` : '暂无人领取'}</td>
      <td class="td-sub">${t.deadline ? esc(String(t.deadline).slice(0, 10)) : '长期'}</td>
      <td>${ST[stateOf(t)]}</td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap">
        ${N(t.taken) ? `<button class="btn ${N(t.reviewing) ? 'primary' : 'ghost'} sm" onclick="taskEntries(${t.id})">${N(t.reviewing) ? '审核投稿 ' + N(t.reviewing) : '参与者 ' + N(t.taken)}</button>` : ''}
        ${adminCan('entity.task.edit') ? `<button class="btn ghost sm" onclick="taskModal(${t.id})">编辑</button>` : ''}
        ${t.rich_brief ? `<button class="btn ghost sm" onclick="taskDetail(${t.id})">说明</button>` : ''}
        ${adminCan('task.status') ? `<button class="btn ghost sm" onclick="taskStatus(${t.id}, ${t.status === 4 ? 0 : 4})">${t.status === 4 ? '重新上线' : '下线'}</button>` : '<span class="muted">上下线由运营处理</span>'}
        ${adminCan('task.delete') && !N(t.taken) ? `<button class="btn ghost sm" onclick="deleteTask(${t.id})">删除</button>` : ''}${N(t.taken) ? '<span class="muted">已有参与记录，保留任务</span>' : ''}</div></td></tr>`).join('')}</tbody></table>`
    : emptyBox(window.__taskSt === '' ? (adminCan('entity.task.create') ? '暂无约稿任务：点右上「新建任务」发布第一单' : '暂无约稿任务；有权限的运营或审核人员新建后可在这里查看') : '该筛选下暂无任务')}</div>
  ${cashRows.length ? taskCashTable(cashRows) : ''}`
}
async function taskStatus(id, status) {
  if (!adminCan('task.status')) return toast('任务上下线由运营或超级管理员处理', true)
  if (status === 4 && !confirm('下线后游客不能再领取；已领取的人仍可投稿，审核照常。确定下线？')) return
  try { await api('POST', `/admin/content-tasks/${id}/status`, { status }); toast(status ? '已下线' : '已重新上线'); tasks() } catch (e) { toast(e.message, true) }
}
async function taskCashPaid(entryId, amount) {
  if (!adminCan('task.cashPaid')) return toast('请由财务或超级管理员在「资金结算 → 现金加奖打款」登记实际打款', true)
  const source = location.hash
  const ref = prompt(`登记现金加奖打款 ${amount}\n请输入打款流水号（银行/支付平台流水，唯一）：`)
  if (!ref) return
  try {
    await api('POST', `/admin/task-entries/${entryId}/cash-paid`, { ref: ref.trim() })
    toast('已登记打款')
    if (location.hash === source) await (source === '#taskcash' ? taskCash() : tasks())
  } catch (e) { toast(e.message, true) }
}
function taskCashTable(rows) {
  return `<div class="card"><div class="card-head"><h2>现金加奖打款</h2><span class="muted">投稿通过后进入待打款；财务实际打款后登记唯一流水号，记录可追溯。</span></div>
    ${adminCan('task.cashPaid') ? '' : '<p class="muted">当前账号可核对奖励与打款进度；登记实际打款请由财务或超级管理员在「资金结算 → 现金加奖打款」处理。</p>'}
    ${rows.length ? `<table><thead><tr><th>任务</th><th>作者</th><th>金额</th><th>通过时间</th><th>状态</th><th>打款流水</th><th>操作</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="td-main">${esc(r.title)}<div class="td-sub">${esc(r.task_no)} · 参与#${r.id}</div></td><td>${esc(r.nickname || '用户#' + r.user_id)}</td>
      <td class="money num">${fen(r.cash_reward)}</td><td class="td-sub">${esc(String(r.finished_at || '').slice(0, 16).replace('T', ' '))}</td>
      <td>${Number(r.cash_status) === 2 ? '<span class="pill ok">已打款</span>' : '<span class="pill warn">待打款</span>'}</td>
      <td class="td-sub">${r.cash_ref ? esc(r.cash_ref) + '<br>' + esc(String(r.cash_paid_at || '').slice(0, 16).replace('T', ' ')) + ' · ' + esc(r.cash_by || '') : '—'}</td>
      <td>${Number(r.cash_status) === 1 ? (adminCan('task.cashPaid') ? `<button class="btn primary sm" onclick="taskCashPaid(${Number(r.id)}, '${fen(r.cash_reward)}')">登记打款</button>` : '<span class="muted">待财务处理</span>') : '<span class="muted">已登记，保留流水记录</span>'}</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无现金加奖；约稿投稿审核通过且设有现金奖励后进入待打款。')}</div>`
}
async function taskCash() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/task-cash')
  $('#app').innerHTML = taskCashTable(rows)
}
const ENTRY_ST = { 1: '<span class="pill s20">创作中</span>', 2: '<span class="pill warn">待审核</span>', 3: '<span class="pill ok">已通过</span>' }
async function taskEntries(taskId) {
  let rows
  try { rows = await api('GET', `/admin/content-tasks/${taskId}/entries`) } catch (e) { return toast(e.message, true) }
  const t = (await api('GET', '/admin/content-tasks')).find((x) => x.id === taskId) || { title: '' }
  reviewDrawer(`参与者 · ${esc(t.title)}`, rows.length ? `<table><thead><tr><th>作者</th><th>进度</th><th>投稿</th><th>领取 / 投稿时间</th><th>操作</th></tr></thead><tbody>
    ${rows.map((e) => `<tr><td>${esc(e.nickname || '用户#' + e.user_id)}${e.creator_tag && e.creator_tag !== 'none' ? ` <span class="pill s40">${esc(CREATOR_TAG[e.creator_tag] || '')}</span>` : ''}</td>
      <td>${ENTRY_ST[e.status] || ''}${Number(e.rejected_times) ? `<div class="td-sub">被驳回 ${e.rejected_times} 次</div>` : ''}${Number(e.cash_status) === 1 ? '<div class="td-sub">现金待打款</div>' : ''}</td>
      <td class="td-sub">${e.note_title ? esc(e.note_title) : '—'}</td>
      <td class="td-sub">${esc(String(e.claimed_at || '').slice(5, 16).replace('T', ' '))}${e.submitted_at ? ' / ' + esc(String(e.submitted_at).slice(5, 16).replace('T', ' ')) : ''}</td>
      <td>${Number(e.status) === 2 ? `<button class="btn primary sm" onclick="reviewEntry(${e.id})">审核</button>` : `<button class="btn ghost sm" onclick="reviewEntry(${e.id})">查看</button>`}</td></tr>`).join('')}</tbody></table>`
    : emptyBox('还没有人领取'), '')
}
const TASK_CAT = { note: '图文笔记', video: '短视频', strategy: '攻略长文', review: '体验点评' }
async function taskModal(id) {
  if (!adminCan(id ? 'entity.task.edit' : 'entity.task.create')) return toast('当前账号没有任务维护权限', true)
  return entityEditor('task', id || null, { onSaved: () => tasks() })
}
async function taskDetail(id) {
  const t = (await api('GET', '/admin/content-tasks')).find((x) => x.id === id)
  if (!t) return
  modal('任务说明 · ' + esc(t.title), `
    <div class="rt-preview">${t.rich_brief || ''}</div>
    <div class="row" style="margin-top:12px"><span class="muted">报酬 ${Number(t.reward_beans)} 豆${Number(t.cash_reward) ? ' + ' + fen(t.cash_reward) : ''} ·
      要求 ${Number(t.min_words) ? Number(t.min_words) + ' 字' : '字数不限'}${Number(t.min_images) ? ' / ' + Number(t.min_images) + ' 图' : ''} ·
      截止 ${t.deadline ? String(t.deadline).slice(0, 10) : '长期'}${t.product_title ? ' · 目标商品：' + esc(t.product_title) : ''}</span></div>`,
    `<button class="btn primary" onclick="closeModal()">关闭</button>`)
}
/* ============ 投稿审核（约稿任务 / 笔记共用）============ */
// 审核员必须看得到投稿全文与图片，并对照约稿要求逐项核对后再判定；驳回原因作者可见。
function noteExcerpt(body) {
  let b = body
  if (typeof b === 'string') { try { b = JSON.parse(b) } catch { b = { text: b } } }
  return String((b && b.text) || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '（无正文）'
}
function reviewDrawer(title, bodyHtml, footHtml) {
  $('#modalRoot').innerHTML = `<div class="drawer-overlay" onclick="closeModal()"></div>
    <div class="drawer review-drawer"><div class="drawer-head"><h3>${title}</h3><button class="modal-x" onclick="closeModal()">✕</button></div>
    <div class="drawer-body">${bodyHtml}</div>${footHtml ? `<div class="rv-foot">${footHtml}</div>` : ''}</div>`
}
const NOTE_ST = ['机审中', '人工审核', '已发布', '已驳回', '已下架']
function submissionHtml(n) {
  if (!n) return `<div class="empty"><div class="e-ico">🗒</div>当前没有投稿（被驳回后作者尚未重新提交）</div>`
  return `<div class="rv-sub">
    <div class="rv-meta"><span class="pill ${n.status === 2 ? 'ok' : 'warn'}">${NOTE_ST[n.status] || '—'}</span>
      <span>${n.wordCount} 字</span><span>${n.imageCount} 张图</span><span>${esc(n.machineCheck)}</span>
      ${n.publishedAt ? `<span>发布于 ${esc(String(n.publishedAt).slice(0, 16).replace('T', ' '))}</span>` : ''}</div>
    <h2 class="rv-title">${esc(n.title || '（无题）')}</h2>
    <div class="rv-body rt-preview">${n.html || esc(n.text) || '<span class="muted">（无正文）</span>'}</div>
    ${n.images.length ? `<div class="rv-h" style="margin-top:12px">图片一览（${n.images.length}，点击看原图）</div><div class="rv-imgs">${n.images.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="投稿图片" loading="lazy"></a>`).join('')}</div>` : ''}
    ${n.rejectReason ? `<p class="rv-reason">上次驳回原因：${esc(n.rejectReason)}</p>` : ''}
  </div>`
}
function authorHtml(u, extra) {
  if (!u) return ''
  return `<div class="rv-box"><div class="rv-h">作者</div><b>${esc(u.nickname || '用户#' + u.id)}</b>
    ${u.creator_tag && u.creator_tag !== 'none' ? ` <span class="pill s40">${esc(CREATOR_TAG[u.creator_tag] || u.creator_tag)}</span>` : ''}
    <div class="td-sub">已发布作品 ${Number(u.published || 0)} 篇${extra || ''}</div></div>`
}
async function reviewEntry(id) {
  let p
  try { p = await api('GET', `/admin/task-entries/${id}/review`) } catch (e) { return toast(e.message, true) }
  const r = p.requirements, live = p.entry.status === 2 && p.submission
  const fails = p.checks.filter((c) => !c.ok).length
  const right = `
    <div class="rv-box"><div class="rv-h">约稿要求</div><p>${esc(r.brief || '')}</p>
      ${r.must_mention.length ? `<div class="rv-chips">必须提及：${r.must_mention.map((w) => `<span class="pill s20">${esc(w)}</span>`).join('')}</div>` : ''}
      ${r.forbidden.length ? `<div class="rv-chips">禁止出现：${r.forbidden.map((w) => `<span class="pill s70">${esc(w)}</span>`).join('')}</div>` : ''}
      <div class="td-sub">${[r.min_words ? `≥ ${r.min_words} 字` : '', r.min_images ? `≥ ${r.min_images} 图` : '', r.deadline ? '截止 ' + esc(String(r.deadline).slice(0, 16)) : '长期'].filter(Boolean).join(' · ')}${p.product ? ' · 种草线路：' + esc(p.product.title) : ''}</div>
      ${r.rich_brief ? `<details class="rv-more"><summary>任务详细说明</summary><div class="rt-preview">${r.rich_brief}</div></details>` : ''}</div>
    ${p.checks.length ? `<div class="rv-box"><div class="rv-h">自动核对 ${fails ? `<span class="pill s70">${fails} 项未通过</span>` : '<span class="pill ok">全部通过</span>'}</div>
      ${p.checks.map((c) => `<div class="rv-check ${c.ok ? 'ok' : 'bad'}"><span>${c.ok ? '✓' : '✗'}</span>${esc(c.label)}<em>${esc(c.detail)}</em></div>`).join('')}
      <div class="td-sub" style="margin-top:6px">字数按去空白后的字符计；提及/禁用词按标题+正文包含判断，仅供参考，以人工判断为准。</div></div>` : ''}
    ${live && r.review_rules.length ? `<div class="rv-box"><div class="rv-h">审核标准（逐条确认后才能通过）</div>
      ${r.review_rules.map((x, i) => `<label class="rv-rule"><input type="checkbox" data-rule="${i}" onchange="rvSync()"> ${esc(x)}</label>`).join('')}</div>` : ''}
    <div class="rv-box"><div class="rv-h">奖励</div><b>${r.reward_beans} 旅豆</b>${r.cash_reward ? ` + ${fen(r.cash_reward)} 现金<div class="td-sub">通过后进入「现金加奖打款」待打款，由财务线下打款并登记流水号</div>` : ''}
      ${p.entry.status === 3 ? `<div class="td-sub">已发放 ${p.entry.reward_beans} 旅豆${p.entry.cash_reward ? ' · 现金 ' + fen(p.entry.cash_reward) + (p.entry.cash_status === 2 ? '（已打款 ' + esc(p.entry.cash_ref || '') + '）' : '（待打款）') : ''}</div>` : ''}</div>
    ${authorHtml(p.author, p.author ? ` · 完成约稿 ${Number(p.author.done_tasks || 0)} 单` : '')}
    ${p.history.length ? `<div class="rv-box"><div class="rv-h">审核记录</div>${p.history.map((h) => `<div class="rv-hist"><span class="pill ${Number(h.verdict) ? 'ok' : 's70'}">${Number(h.verdict) ? '通过' : '驳回'}</span>
      <span class="td-sub">${esc(String(h.created_at).slice(0, 16).replace('T', ' '))} · ${esc(h.reviewer)}${h.note_id ? ' · 作品#' + h.note_id : ''}</span>${h.reason ? `<div>${esc(h.reason)}</div>` : ''}</div>`).join('')}</div>` : ''}`
  const foot = live ? `<textarea id="rvReason" rows="2" maxlength="300" placeholder="驳回原因（必填，作者会在小程序里看到）/ 通过备注（选填）"></textarea>
    <div class="rv-actions"><button class="btn danger" onclick="entryVerdict(${id}, false, 0, ${p.task.id})">驳回，退回修改</button>
      <button class="btn primary" id="rvPass" onclick="entryVerdict(${id}, true, ${fails}, ${p.task.id})">通过并发放 ${r.reward_beans} 旅豆</button></div>` : ''
  reviewDrawer(`${live ? '审核投稿' : '投稿与审核记录'} · ${esc(p.task.title)}`, `<div class="rv-grid"><div>${submissionHtml(p.submission)}</div><div>${right}</div></div>`, foot)
  rvSync()
}
function rvSync() {
  const pass = document.getElementById('rvPass'); if (!pass) return
  const boxes = [...document.querySelectorAll('[data-rule]')]
  const left = boxes.filter((b) => !b.checked).length
  pass.disabled = left > 0
  pass.title = left ? `还有 ${left} 条审核标准未确认` : ''
}
async function entryVerdict(id, pass, fails = 0, taskId) {
  const reason = (document.getElementById('rvReason')?.value || '').trim()
  if (!pass && reason.length < 4) { toast('请填写驳回原因（至少 4 个字），作者会看到它', true); document.getElementById('rvReason')?.focus(); return }
  if (pass && fails && !confirm(`有 ${fails} 项自动核对未通过，确定仍然通过？`)) return
  const rules = [...document.querySelectorAll('[data-rule]')].map((b) => b.checked)
  try {
    const r = await api('POST', '/admin/task-entries/' + id + '/verdict', { pass, reason, rules })
    toast(pass ? `已通过，发放 ${r.rewarded} 旅豆${r.cashReward ? '；现金加奖已进入待打款' : ''}` : '已驳回，退回作者修改')
    await tasks(); taskEntries(taskId)
  } catch (e) { toast(e.message, true) }
}
async function reviewNote(id) {
  let p
  try { p = await api('GET', `/admin/content/${id}`) } catch (e) { return toast(e.message, true) }
  const n = p.note, pending = [0, 1].includes(Number(n.status)), live = pending && adminCan('note.review')
  const right = `${authorHtml(p.author, ` · 被驳回 ${Number(p.author?.rejected || 0)} 篇`)}
    ${p.product ? `<div class="rv-box"><div class="rv-h">关联线路</div>${esc(p.product.title)}</div>` : ''}
    ${p.tasks.length ? `<div class="rv-box"><div class="rv-h">作为约稿投稿</div>${p.tasks.map((t) => esc(t.title)).join('<br>')}</div>` : ''}
    <div class="rv-box"><div class="rv-h">审核要点</div><div class="td-sub">是否原创、图文是否相符、有无广告导流/联系方式、有无不实承诺或违规内容。驳回原因会展示给作者。</div></div>`
  const foot = live ? `<textarea id="rvReason" rows="2" maxlength="300" placeholder="驳回原因（必填，作者会在小程序里看到）"></textarea>
    <div class="rv-actions"><button class="btn danger" onclick="noteVerdict(${id}, false)">驳回</button><button class="btn primary" onclick="noteVerdict(${id}, true)">通过并发布</button></div>` : (pending ? '<p class="muted">当前账号仅可查看审核材料；请由审核员或超级管理员完成通过或驳回。</p>' : '')
  reviewDrawer(`${live ? '审核笔记' : '查看笔记'} · ${esc(n.title || '（无题）')}`, `<div class="rv-grid"><div>${submissionHtml(n)}</div><div>${right}</div></div>`, foot)
}
async function noteVerdict(id, pass) {
  if (!adminCan('note.review')) return toast('请由审核员或超级管理员处理笔记审核', true)
  const reason = (document.getElementById('rvReason')?.value || '').trim()
  if (!pass && reason.length < 4) { toast('请填写驳回原因（至少 4 个字），作者会看到它', true); document.getElementById('rvReason')?.focus(); return }
  try { await api('POST', `/admin/content/${id}/verdict`, { pass, reason }); toast(pass ? '已通过并发布' : '已驳回，作者可看到原因'); closeModal(); content() } catch (e) { toast(e.message, true) }
}
async function deleteTask(id) {
  if (!adminCan('task.delete')) return toast('任务删除由运营或超级管理员处理', true)
  if (!confirm('删除该任务？')) return
  try { await api('POST', '/admin/content-tasks/' + id + '/delete', {}); toast('任务已删除'); tasks() } catch (e) { toast(e.message, true) }
}


// ---- 创作者池（UGC 运营）：内容产出聚合 + 合作标签 ----
const CREATOR_TAG = { none: '普通', signed: '签约', star: '优质', limited: '限流' }
async function creators() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  window.__kw = window.__kw || {}
  const all = await api('GET', '/admin/creators')
  const K = (window.__kw.creators || '').trim()
  const rows = K ? all.filter((c) => (c.nickname || '').includes(K) || (c.creator_tag || '').includes(K)) : all
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>创作者池</h2>
      <input id="cr_kw" placeholder="搜昵称 / 标签" style="width:170px" value="${esc(window.__kw.creators || '')}" onchange="window.__kw.creators=this.value;creators()">
      <span class="muted">${K ? '筛出 ' + rows.length + ' / ' + all.length + ' 人' : '共 ' + all.length + ' 人'}</span>
      ${EXPBTN('creators', '创作者 CSV')}<span class="muted">有内容产出的用户自动入池 · 标签 = 资源合作状态（签约/优质享受激励加权）</span></div>
    ${rows.length ? `<table><thead><tr><th>用户</th><th>标签</th><th>笔记</th><th>已发布</th><th>点评</th><th>约稿完成</th><th>最近发布</th><th></th></tr></thead><tbody>
    ${rows.map((c) => `<tr><td class="td-main">${esc(c.nickname || '用户' + c.id)}<div class="td-sub">Lv${c.member_level}${Number(c.status) === 0 ? ' · <span class="pill s70">封禁</span>' : ''}</div></td>
      <td><span class="pill ${c.creator_tag === 'star' ? 'ok' : (c.creator_tag === 'signed' ? 's40' : (c.creator_tag === 'limited' ? 's70' : 'off'))}">${CREATOR_TAG[c.creator_tag] || esc(c.creator_tag)}</span></td>
      <td class="num">${c.note_count}</td><td class="num"><b>${c.published_count}</b></td><td class="num">${c.review_count}</td>
      <td class="num">${c.task_done}</td><td class="td-sub">${c.last_published ? esc(String(c.last_published).slice(0, 10)) : '—'}</td>
      <td><button class="btn primary sm" onclick="userProfile(${c.id})">画像</button> ${adminCan('creator.manage') ? `<button class="btn ghost sm" onclick="setCreatorTag(${c.id},'${esc(c.creator_tag || 'none')}')">设标签</button>` : '<span class="muted">标签由运营维护</span>'}</td></tr>`).join('')}</tbody></table>`
    : emptyBox(window.__kw.creators ? '没有匹配的创作者' : '池子还空：用户发布笔记或点评后自动入池')}
  </div>`
}
async function setCreatorTag(id, cur) {
  if (!adminCan('creator.manage')) return toast('创作者标签由运营或超级管理员维护', true)
  modal('设置创作者标签 · 用户#' + id, `
    <div class="field"><label>标签</label><select id="ct_tag">${Object.entries(CREATOR_TAG).map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <p class="muted">签约/优质创作者在约稿任务与内容激励中享受加权（运营口径）；限流用于配合风控。</p>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="saveCreatorTag(${id})">保存</button>`)
}
async function saveCreatorTag(id) {
  if (!adminCan('creator.manage')) return toast('创作者标签由运营或超级管理员维护', true)
  try { await api('PUT', '/admin/creators/' + id + '/tag', { tag: $('#ct_tag').value }); toast('标签已更新'); closeModal(); creators() }
  catch (e) { toast(e.message, true) }
}


/* ============ 常见问题 / 轮播管理（低垂果实 #5）============ */
const FAQ_CAT = ['预订', '出行', '旅豆', '退款', '会员', '其他']
async function faqs() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const d = await api('GET', '/admin/faqs')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>常见问题管理</h2><span class="muted">小程序「我的-常见问题」展示位 · 分类 + 热门标记 + 排序</span>
      <button class="btn primary sm" onclick="faqModal()">＋ 新增问题</button></div>
    <table><thead><tr><th>分类</th><th>问题</th><th>答案摘要</th><th>热门</th><th>序号</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${d.map((f) => `<tr><td><span class="pill off">${esc(f.category || '通用')}</span></td>
      <td class="td-main">${esc(f.question)}</td><td class="td-sub">${esc(String(f.answer).slice(0, 46))}…</td>
      <td>${Number(f.is_hot) ? '<span class="pill s10">🔥 热门</span>' : '<span class="pill off">—</span>'}</td>
      <td class="num">${f.sort}</td>
      <td>${f.status === 1 ? '<span class="pill ok">上架</span>' : '<span class="pill s70">下架</span>'}</td>
      <td><button class="btn ghost sm" onclick="faqModal(${f.id})">编辑</button>
      <button class="btn ghost sm" onclick="toggleFaq(${f.id}, ${f.status === 1 ? 0 : 1})">${f.status === 1 ? '下架' : '上架'}</button>
      <button class="btn ghost sm" onclick="delFaq(${f.id})">删除</button></td></tr>`).join('') || `<tr><td colspan="7" class="td-sub">暂无问题</td></tr>`}
    </tbody></table>
  </div>`
}
async function faqModal(id) { return entityEditor('faq', id || null, { onSaved: () => faqs() }) }
async function toggleFaq(id, status) { await api('POST', '/admin/faqs/' + id + '/update', { status }); faqs() }
async function delFaq(id) {
  if (!confirm('确认删除该问题？')) return
  await api('POST', '/admin/faqs/' + id + '/delete', {}); toast('已删除'); faqs()
}
async function banners() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const d = await api('GET', '/admin/banners')
  const live = (b) => Number(b.status) === 1 && (!b.start_at || new Date(b.start_at) <= new Date()) && (!b.end_at || new Date(b.end_at) >= new Date())
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>轮播媒体管理</h2><span class="muted">小程序首页轮播位 · 图片上传 + 投放窗口 + 排序</span>
      <button class="btn primary sm" onclick="bannerModal()">＋ 新增轮播</button></div>
    <table><thead><tr><th>预览</th><th>标题</th><th>跳转</th><th>投放窗口</th><th>序号</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${d.map((b) => `<tr><td><img src="${esc(b.image)}" style="width:88px;height:48px;object-fit:cover;border-radius:6px"></td>
      <td><div class="td-main">${esc(b.title)}</div>${b.sub_title ? `<div class="td-sub">${esc(b.sub_title)}</div>` : ''}</td>
      <td class="td-sub">${esc(b.link || '不跳转')}</td>
      <td class="td-sub">${b.start_at || b.end_at ? esc(String(b.start_at || '').slice(0, 10)) + ' ~ ' + esc(String(b.end_at || '').slice(0, 10)) : '长期'}</td>
      <td class="num">${b.sort}</td>
      <td>${live(b) ? '<span class="pill ok">投放中</span>' : (Number(b.status) === 1 ? '<span class="pill warn">未在窗口</span>' : '<span class="pill s70">已下架</span>')}</td>
      <td><button class="btn ghost sm" onclick="bannerModal(${b.id})">编辑</button>
      <button class="btn ghost sm" onclick="toggleBanner(${b.id}, ${b.status === 1 ? 0 : 1})">${b.status === 1 ? '下架' : '上架'}</button>
      <button class="btn ghost sm" onclick="delBanner(${b.id})">删除</button></td></tr>`).join('') || '<tr><td colspan="7" class="td-sub">暂无轮播（首页将隐藏轮播位）</td></tr>'}
    </tbody></table>
  </div>`
}
async function bannerModal(id) { return entityEditor('banner', id || null, { onSaved: () => banners() }) }
async function toggleBanner(id, status) { await api('POST', '/admin/banners/' + id + '/update', { status }); banners() }
async function delBanner(id) {
  if (!confirm('确认删除该轮播？')) return
  await api('POST', '/admin/banners/' + id + '/delete', {}); toast('已删除'); banners()
}

async function contract() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const d = await api('GET', '/admin/web3/contract-account')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>合约调用账户</h2><span class="muted">${esc(d.mode)}</span></div>
    <table><tr><td class="td-sub">接入状态</td><td>${esc(d.mode)}</td></tr>
      <tr><td class="td-sub">链端点 CHAIN_ENDPOINT</td><td>${d.endpoint ? '<code>' + esc(d.endpoint) + '</code>' : '<span class="muted">未配置（NOOP 模式）</span>'}</td></tr>
      <tr><td class="td-sub">账户 CHAIN_ACCOUNT</td><td>${d.account ? '<code>' + esc(d.account) + '</code>' : '<span class="muted">未配置</span>'}</td></tr>
      <tr><td class="td-sub">私钥 CHAIN_KEY</td><td>${d.keyConfigured ? '<span class="pill ok">已配置（加密落库）</span>' : '<span class="muted">未配置</span>'}</td></tr></table>
    <div class="muted" style="margin-top:8px">${esc(d.note)} · 凭据在「系统-集成中心」配置（AES-256-GCM 加密，库→env 兜底）</div>
  </div>`
}

async function verifyAttest() {
  const ref = document.getElementById('vref').value.trim()
  if (!ref) return
  const r = await api('GET', '/admin/attest/verify?bizType=order&bizRef=' + encodeURIComponent(ref))
  const anchored = !!r.chainRef
  document.getElementById('vout').innerHTML = r.found
    ? `<div class="card" style="margin-top:14px;background:#f0faf7"><div class="row" style="margin:0">
        <span class="pill ${anchored ? 'ok' : 's20'}">${anchored ? '✓ 已锚定上链' : '已打包·待锚定'}</span><span>${esc(r.note)}</span></div>
       <table style="margin-top:8px"><tr><td class="td-sub">业务单号</td><td class="num">${esc(r.bizRef)} · v${Number(r.versionNo || 1)}</td></tr>
       <tr><td class="td-sub">载荷哈希</td><td><code>${esc(r.payloadHash)}</code></td></tr>
       ${r.merkleRoot ? `<tr><td class="td-sub">Merkle 根</td><td><code>${esc(r.merkleRoot)}</code></td></tr>` : ''}
       <tr><td class="td-sub">证明路径</td><td>${r.leafPath ? `<span class="pill ok">${r.leafPath.length} 层 · 本地重算${r.proofValid ? '通过' : '不通过'}</span>` : '—'}${r.leafIndex != null ? ` <span class="td-sub">leaf#${r.leafIndex}</span>` : ''}</td></tr>
       ${anchored ? `<tr><td class="td-sub">链上编号</td><td><code>${esc(r.chainRef)}</code>${r.chainBlock ? ' · 区块 ' + esc(r.chainBlock) : ''}</td></tr>` : ''}
       </table>
       <div class="row" style="margin-top:10px">
         <a class="btn primary sm" target="_blank" rel="noopener" href="/open/report/order/${encodeURIComponent(r.bizRef)}">下载存证证明 PDF</a>
         <a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?no=${encodeURIComponent(r.bizRef)}">公开复核页</a>
       </div>
       <div class="muted" style="margin-top:6px">${esc(r.verifyTip || '')}</div></div>`
    : `<div class="card" style="margin-top:14px"><span class="pill s70">未找到该单存证记录</span></div>`
}
