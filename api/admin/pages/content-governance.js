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
    ${d.rows.length?`<table><thead><tr><th>笔记</th><th>提交原因</th><th>状态</th><th>处理结果</th><th>时间</th><th></th></tr></thead><tbody>${d.rows.map(r=>`<tr><td>${esc(r.title||'（无题）')}</td><td>${esc(r.reason)}</td><td>${labels[r.status]||'未知'}</td><td>${esc(r.resolution||'—')}</td><td>${dt(r.created_at)}</td><td><button class="btn ghost sm" data-kind="${Q.kind}" data-id="${r.id}" onclick="contentCaseReview(this.dataset.kind,this.dataset.id)">查看与处理</button></td></tr>`).join('')}</tbody></table>`:emptyBox('暂无记录')}
    <div class="pagination"><span>第 ${d.page} 页</span><div><button class="btn ghost sm" ${d.page<=1?'disabled':''} onclick="window.__contentCaseQ.page--;contentCases()">上一页</button><button class="btn ghost sm" ${d.page*d.size>=d.total?'disabled':''} onclick="window.__contentCaseQ.page++;contentCases()">下一页</button></div></div></div>`
}
async function contentCaseReview(kind,id) {
  const load=window.__contentCaseReviewLoad=(window.__contentCaseReviewLoad||0)+1
  let d
  try{d=await api('GET',`/admin/content-cases/${kind}/${id}`)}catch(e){return toast(e.message,true)}
  if(load!==window.__contentCaseReviewLoad||location.hash!=='#contentcases')return
  window.__contentCaseActive={kind,id}
  reviewDrawer(kind==='reports'?'举报处理':'下架申诉复核',`<div class="rv-box">${kv('提交原因',esc(d.reason))}${d.offlineReason?kv('下架原因',esc(d.offlineReason)):''}${d.resolution?kv('处理结果',esc(d.resolution)):''}</div>
    <div class="rv-box"><div class="rv-h">当前内容 · ${esc(d.note.title)}</div>${submissionHtml(d.note)}</div>
    ${d.snapshot?`<div class="rv-box"><div class="rv-h">下架时内容快照</div>${submissionHtml(d.snapshot)}</div>`:''}
    ${Number(d.status)===0?`<div class="rv-box"><label for="caseReason">处理原因（4—300 字，将向提交人反馈）</label><textarea id="caseReason" maxlength="300" style="width:100%;min-height:100px"></textarea><p id="caseError" role="alert"></p></div>`:''}`,
    Number(d.status)===0?(kind==='reports'?'<button class="btn ghost" onclick="contentCaseDecide(\'dismiss\')">举报不成立</button><button class="btn danger" onclick="contentCaseDecide(\'takedown\')">确认下架</button>':'<button class="btn ghost" onclick="contentCaseDecide(\'uphold\')">维持下架</button><button class="btn primary" onclick="contentCaseDecide(\'restore\')">恢复展示</button>'):'')
}
async function contentCaseDecide(action) {
  const {kind,id}=window.__contentCaseActive
  try{await api('POST',`/admin/content-cases/${kind}/${id}/verdict`,{action,reason:$('#caseReason').value});closeModal();toast('处理完成，结果已反馈');contentCases()}
  catch(e){if($('#caseError'))$('#caseError').textContent=e.message;else toast(e.message,true)}
}
async function contentTakedown(id) {
  const reason=prompt('下架原因（4—300 字，作者可见）：')
  if(reason==null)return
  try{await api('POST',`/admin/content/${id}/takedown`,{reason});toast('已下架，作者可在创作中心申诉');content()}catch(e){toast(e.message,true)}
}
