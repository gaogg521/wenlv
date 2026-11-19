async function contentCases() {
  const Q={...(window.__contentCaseQ ||= {kind:'reports',status:'pending',page:1})}
  const load=window.__contentCaseLoad=(window.__contentCaseLoad||0)+1
  let d
  try {d=await api('GET','/admin/content-cases?'+new URLSearchParams(Q))}
  catch(e){if(load===window.__contentCaseLoad&&location.hash==='#contentcases')$('#app').innerHTML=`<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="contentCases()">重试</button></div>`;return}
  if(load!==window.__contentCaseLoad||location.hash!=='#contentcases')return
  const labels=Q.kind==='reports'?['待处理','不成立','已下架']:['待复核','恢复展示','维持下架']
  $('#app').innerHTML=`<div class="card"><div class="card-head"><h2>举报与申诉</h2><span class="muted">${d.total} 条 · 城市范围按内容及提交时归属双重限制</span></div>
    <div class="cfg-tabs">${[['reports','读者举报'],['appeals','作者申诉']].map(([k,n])=>`<button class="cfg-tab ${Q.kind===k?'on':''}" data-kind="${k}" onclick="window.__contentCaseQ.kind=this.dataset.kind;window.__contentCaseQ.page=1;contentCases()">${n}</button>`).join('')}</div>
    <div class="orders-search"><select aria-label="处理状态" onchange="window.__contentCaseQ.status=this.value;window.__contentCaseQ.page=1;contentCases()"><option value="pending" ${Q.status==='pending'?'selected':''}>待处理</option><option value="all" ${Q.status==='all'?'selected':''}>全部记录</option></select></div>
    ${d.rows.length?`<table><thead><tr><th>笔记</th><th>提交原因</th><th>状态</th><th>处理结果</th><th>时间</th><th></th></tr></thead><tbody>${d.rows.map(r=>`<tr><td>${esc(r.title||'（无题）')}</td><td>${esc(r.reason)}</td><td>${labels[r.status]||'未知'}</td><td>${esc(r.resolution||'—')}</td><td>${dt(r.created_at)}</td><td><button class="btn ghost sm" data-kind="${Q.kind}" data-id="${r.id}" onclick="contentCaseReview(this.dataset.kind,this.dataset.id)">查看与处理</button></td></tr>`).join('')}</tbody></table>`:emptyBox('暂无治理记录——举报成立或处理过的内容会在这里留痕')}
    <div class="pagination"><span>第 ${d.page} 页</span><div><button class="btn ghost sm" ${d.page<=1?'disabled':''} onclick="window.__contentCaseQ.page--;contentCases()">上一页</button><button class="btn ghost sm" ${d.page*d.size>=d.total?'disabled':''} onclick="window.__contentCaseQ.page++;contentCases()">下一页</button></div></div></div>`
}
async function contentCaseReview(kind,id) {
  const load=window.__contentCaseReviewLoad=(window.__contentCaseReviewLoad||0)+1
  let d
  try{d=await api('GET',`/admin/content-cases/${kind}/${id}`)}catch(e){return toast(e.message,true)}
  if(load!==window.__contentCaseReviewLoad||!['#contentcases','#reviewqueue'].includes(location.hash))return
  window.__contentCaseActive={kind,id}
  reviewDrawer(kind==='reports'?'举报处理':'下架申诉复核',`<div class="rv-box">${kv('提交原因',esc(d.reason))}${d.offlineReason?kv('下架原因',esc(d.offlineReason)):''}${d.resolution?kv('处理结果',esc(d.resolution)):''}</div>
    <div class="rv-box"><div class="rv-h">当前内容 · ${esc(d.note.title)}</div>${submissionHtml(d.note)}</div>
    ${d.snapshot?`<div class="rv-box"><div class="rv-h">下架时内容快照</div>${submissionHtml(d.snapshot)}</div>`:''}
    ${Number(d.status)===0?`<div class="rv-box"><label for="caseReason">处理原因（4—300 字，将向提交人反馈）</label><textarea id="caseReason" maxlength="300" style="width:100%;min-height:100px"></textarea><p id="caseError" role="alert"></p></div>`:''}`,
    Number(d.status)===0?(kind==='reports'?'<button class="btn ghost" onclick="contentCaseDecide(\'dismiss\')">举报不成立</button><button class="btn danger" onclick="contentCaseDecide(\'takedown\')">确认下架</button>':'<button class="btn ghost" onclick="contentCaseDecide(\'uphold\')">维持下架</button><button class="btn primary" onclick="contentCaseDecide(\'restore\')">恢复展示</button>'):'')
}
async function contentCaseDecide(action) {
  const {kind,id}=window.__contentCaseActive
  try{await api('POST',`/admin/content-cases/${kind}/${id}/verdict`,{action,reason:$('#caseReason').value});toast('处理完成，结果已反馈');if(await rqFinish(kind==='reports'?'report':'appeal',id))return;closeModal();contentCases()}
  catch(e){if($('#caseError'))$('#caseError').textContent=e.message;else toast(e.message,true)}
}
async function contentTakedown(id) {
  const reason=prompt('下架原因（4—300 字，作者可见）：')
  if(reason==null)return
  try{await api('POST',`/admin/content/${id}/takedown`,{reason});toast('已下架，作者可在创作中心申诉');content()}catch(e){toast(e.message,true)}
}
async function adminComments() {
  const Q={...(window.__commentsQ ||= {status:'all',kw:'',page:1})}
  const load=window.__commentsLoad=(window.__commentsLoad||0)+1
  let d
  try{d=await api('GET','/admin/comments?'+new URLSearchParams(Q))}
  catch(e){if(load===window.__commentsLoad&&location.hash==='#comments')$('#app').innerHTML=`<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="adminComments()">重试</button></div>`;return}
  if(load!==window.__commentsLoad||location.hash!=='#comments')return
  const labels=['已隐藏','展示中']
  $('#app').innerHTML=`<div class="card"><div class="card-head"><h2>评论管理</h2><span class="muted">${d.total} 条 · 隐藏/恢复与小程序计数同步</span></div>
    <div class="orders-search"><select aria-label="评论状态" onchange="window.__commentsQ.status=this.value;window.__commentsQ.page=1;adminComments()">
      <option value="all" ${Q.status==='all'?'selected':''}>全部</option>
      <option value="shown" ${Q.status==='shown'?'selected':''}>展示中</option>
      <option value="hidden" ${Q.status==='hidden'?'selected':''}>已隐藏</option></select>
      <input type="search" placeholder="搜索评论 / 用户 / 笔记" value="${esc(Q.kw)}" oninput="window.__commentsQ.kw=this.value" onchange="window.__commentsQ.page=1;adminComments()"></div>
    ${d.rows.length?`<table><thead><tr><th>评论内容</th><th>用户</th><th>所属笔记</th><th>状态</th><th>时间</th><th></th></tr></thead><tbody>${d.rows.map(r=>`<tr><td><span class="ellip" title="${esc(r.content)}">${esc(r.content)}</span></td><td>${esc(r.nickname)}</td><td>${esc(r.note_title||'（无题）')}</td><td>${labels[r.status]||'未知'}</td><td>${dt(r.created_at)}</td><td><button class="btn ${r.status===1?'danger':'primary'} sm" data-id="${r.id}" data-act="${r.status===1?'hide':'restore'}" onclick="commentModerate(this.dataset.id,this.dataset.act)">${r.status===1?'隐藏':'恢复'}</button></td></tr>`).join('')}</tbody></table>`:emptyBox('暂无评论——游客在小程序笔记下评论后，这里可隐藏或恢复')}
    <div class="pagination"><span>第 ${d.page} 页</span><div><button class="btn ghost sm" ${d.page<=1?'disabled':''} onclick="window.__commentsQ.page--;adminComments()">上一页</button><button class="btn ghost sm" ${d.page*d.size>=d.total?'disabled':''} onclick="window.__commentsQ.page++;adminComments()">下一页</button></div></div></div>
  <div class="card"><div class="card-head"><h2>评价回复审核</h2><span class="muted">商户回复经平台审核后游客可见（X-04）</span></div><div id="reviewReplyBox" class="muted">加载中…</div></div>`
  reviewReplyPanel()
}

// X-04：评价回复管控——商户回复提交后进入平台审核，这里通过/下架；下架后两端同步消失
async function reviewReplyPanel() {
  let d
  try { d = await api('GET', '/admin/reviews') } catch (e) { return }
  const replies = d.filter ? d : (d.rows || [])
  const withReply = (Array.isArray(replies) ? replies : []).filter((r) => r.reply)
  const RS = { 0: ['<span class="pill warn">待审核</span>', true], 1: ['<span class="pill ok">已展示</span>', false], 2: ['<span class="pill s70">已下架</span>', true] }
  const box = document.getElementById('reviewReplyBox')
  if (!box) return
  box.innerHTML = withReply.length ? `<table><thead><tr><th>评价内容</th><th>商户回复</th><th>商品</th><th>回复状态</th><th></th></tr></thead><tbody>
    ${withReply.map((r) => { const [pill, can] = RS[r.reply_status] || ['<span class="pill off">未知</span>', false]
      return `<tr><td class="td-sub">${esc(String(r.content || '').slice(0, 40))}</td><td class="td-main">${esc(r.reply)}${r.reply_at ? `<div class="td-sub">回复于 ${esc(String(r.reply_at).slice(0, 16))}</div>` : ''}</td>
      <td class="td-sub">${esc(r.title || '')}</td><td>${pill}</td>
      <td>${can ? `<button class="btn ${r.reply_status === 0 ? 'primary' : 'ghost'} sm" onclick="reviewReplyVerdict(${r.id},true)">通过</button>
        <button class="btn danger sm" onclick="reviewReplyVerdict(${r.id},false)">下架</button>` : '<span class="td-sub">展示中（可下架）</span>'}</td></tr>` }).join('')}</tbody></table>`
    : emptyBox('暂无商户回复待审核——商户在小程序端回复评价后，这里会出现待审回复')
}
async function reviewReplyVerdict(id, show) {
  try { await api('POST', `/admin/reviews/${id}/reply-verdict`, { show }); toast(show ? '回复已通过，游客端可见' : '回复已下架，两端同步消失'); reviewReplyPanel() }
  catch (e) { toast(e.message, true) }
}
async function commentModerate(id,act) {
  try{await api('POST',`/admin/comments/${id}/${act}`);toast(act==='hide'?'已隐藏，小程序评论数已同步':'已恢复展示');adminComments()}
  catch(e){toast(e.message,true)}
}
