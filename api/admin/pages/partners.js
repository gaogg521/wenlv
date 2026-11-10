// 普通脚本共享全局作用域，栏目私有状态统一放 window.__partnerQ。
async function partners() {
  const Q = window.__partnerQ ||= { kind: '', kw: '', page: 1 }
  const load = window.__partnerLoad = (window.__partnerLoad || 0) + 1
  let data
  try { data = await api('GET', '/admin/partners?' + new URLSearchParams(Q)) }
  catch (e) {
    if (load === window.__partnerLoad && location.hash === '#partners') $('#app').innerHTML = `<div class="card"><p>${esc(e.message)}</p><button class="btn primary" onclick="partners()">重试</button></div>`
    return
  }
  if (load !== window.__partnerLoad || location.hash !== '#partners') return
  const labels = { city: '城市合伙人', promoter: '推广服务商', cocreator: '共创人' }
  $('#app').innerHTML = `<div class="pstats">${data.counts.map(x => stat(labels[x.kind], PN(x.n), '当前筛选范围', `window.__partnerQ.kind='${x.kind}';window.__partnerQ.page=1;partners()`, '只看' + labels[x.kind])).join('')}</div><div class="card"><div class="card-head"><h2>合伙人中心</h2><span class="muted">共 ${data.total} 个身份登记</span>
    ${ME.role === 'super' ? '<button class="btn primary sm" onclick="workAccessPanel()">主体与经办授权</button>' : ''}${['super','ops','finance'].includes(ME.role)?'<button class="btn ghost sm" onclick="cooperationFeedback()">合作对账反馈</button>':''}
    ${adminCan('entity.promoter.edit') ? '<button class="btn primary sm" onclick="go(\'promoters\')">开通推广资格</button>' : ''}
    ${adminCan('entity.cocreator.create') ? '<button class="btn primary sm" onclick="entityEditor(\'cocreator\',null,{onSaved:()=>partners()})">登记共创人</button>' : ''}</div>
    <div class="td-sub">城市业绩按城市统计，同城多个账号共享经营数据；共创人按产品登记，不按姓名合并。推广及共创全局资金数据仅内部角色可见。</div>
    <form class="orders-search" onsubmit="event.preventDefault();window.__partnerQ.kw=this.kw.value.trim();window.__partnerQ.page=1;partners()">
      <input name="kw" aria-label="搜索合伙人" placeholder="名称 / 登记编号" value="${esc(Q.kw)}"><button class="btn primary">查询</button>
      <button type="button" class="btn ghost" onclick="window.__partnerQ={kind:'',kw:'',page:1};partners()">重置</button></form>
    <div class="cfg-tabs">${[['', '全部'], ...Object.entries(labels)].filter(([k]) => ME.role !== 'city_partner' || !k || k === 'city').map(([k, n]) => `<button class="cfg-tab ${Q.kind === k ? 'on' : ''}" onclick="window.__partnerQ.kind='${k}';window.__partnerQ.page=1;partners()">${n}</button>`).join('')}</div>
    ${data.rows.length ? `<table><thead><tr><th>名称</th><th>身份</th><th>登记编号</th><th>城市</th><th>状态</th><th>管理操作</th></tr></thead><tbody>${data.rows.map(p => `<tr><td>${esc(p.name || '未命名')}</td><td>${labels[p.kind]}</td><td>${esc(p.ref)}</td><td>${esc(CITY_CN[p.city_code] || p.city_code || '全平台')}</td><td>${p.kind === 'promoter' ? ['申请中','生效','冻结'][PN(p.status)] || '未知' : PN(p.status) === 1 ? '生效' : '停用'}</td><td><button class="btn ghost sm" onclick="partnerProfile('${p.kind}',${p.id})">业绩画像</button>${partnerEditButton(p.kind,p.id)}</td></tr>`).join('')}</tbody></table>` : emptyBox('没有符合条件的合伙人')}
    <div class="pagination"><span>第 ${data.page} 页 · 每页 ${data.size} 条</span><div><button class="btn ghost sm" ${data.page <= 1 ? 'disabled' : ''} onclick="window.__partnerQ.page--;partners()">上一页</button><button class="btn ghost sm" ${data.page * data.size >= data.total ? 'disabled' : ''} onclick="window.__partnerQ.page++;partners()">下一页</button></div></div></div>`
}

function workAccessTab(tab) {
  window.__waTab=tab
  document.querySelectorAll('.wa-tabs [data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)))
  document.querySelectorAll('.wa-pane').forEach(p=>p.hidden=p.dataset.pane!==tab)
  if($('#waReasonField'))$('#waReasonField').hidden=tab==='records'
}
function workAccessDraft(){
  const draft={tab:window.__waTab||'subjects'}
  for(const key of ['Subject','Resource','Kw','User','From','To','Reason','Store','Role'])draft[key]=$('#wa'+key)?.value||''
  draft.userLabel=$('#waUser')?.selectedOptions[0]?.textContent||''
  return draft
}
async function workAccessPanel(draft=null) {
  try {
    const d=await api('GET','/admin/work-access');window.__workAccess=d
    const names=Object.fromEntries(d.subjects.map(s=>[s.id,s.name])),kinds={merchant:'履约商户',supplier:'供应商',cocreator:'共创合同'}
    const status=s=>`<span class="pill ${Number(s)===1?'ok':'off'}">${Number(s)===1?'启用':'已停用'}</span>`
    const table=(heads,rows)=>`<div class="wa-table"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${heads.length}" class="wa-empty">暂无记录</td></tr>`}</tbody></table></div>`
    modal('主体与经办授权',`<p class="wa-intro">合作经办、门店岗位分别授权。先选择办理对象，再选择要维护的授权类型。</p>
      <section class="wa-target"><h4>本次办理对象</h4><p>合作主体沿用已有商户、供应商和共创合同；不会按姓名或手机号自动合并。</p>
        <div class="wa-grid"><div class="field"><label for="waSubject">合作主体</label><select id="waSubject" ${d.subjects.length?'':'disabled'}>${d.subjects.length?d.subjects.map(s=>`<option value="${s.id}">#${s.id} ${esc(s.name)}</option>`).join(''):'<option value="">请先创建合作主体</option>'}</select><div class="wa-hint">用于档案关联和合作经办授权</div></div>
        <div class="field"><label for="waKw">经办用户</label><div class="wa-inline"><input id="waKw" placeholder="昵称 / 用户ID / 已绑定手机号" onkeydown="if(event.key==='Enter'){event.preventDefault();workAccessUserSearch()}"><button type="button" class="btn ghost" onclick="workAccessUserSearch()">查找用户</button></div><select id="waUser" class="wa-user-select" aria-label="选择查找到的经办用户"><option value="">查找后选择用户</option></select></div><div class="field wa-full" id="waReasonField"><label for="waReason">核对依据 / 操作原因（必填）</label><textarea id="waReason" maxlength="300" placeholder="填写本次关联、授权或停用的核对依据（4–300字）"></textarea></div></div>
      </section>
      <div class="wa-tabs" role="tablist" aria-label="授权类型">${[['subjects','主体与档案'],['grants','合作经办'],['staff','门店岗位'],['records','授权记录']].map(([key,label])=>`<button type="button" role="tab" data-tab="${key}" aria-selected="false" onclick="workAccessTab('${key}')">${label}</button>`).join('')}</div>
      <section class="wa-pane wa-section" data-pane="subjects"><h4>创建主体与关联档案</h4><p>将已核对的合作资料归入同一主体，已售业务和原档案内容不会因此改写。</p>
        <div class="wa-grid"><div class="field wa-full"><label for="waName">新主体名称</label><div class="wa-inline"><input id="waName" maxlength="80" placeholder="填写核对后的公司或合作主体名称"><button class="btn ghost" onclick="workAccessSave('subjects')">创建主体</button></div></div>
        <div class="field wa-full"><label for="waResource">关联已有档案</label><select id="waResource">${d.catalog.map(r=>`<option value="${r.kind}:${r.id}">${kinds[r.kind]} #${r.id} · ${esc(r.name)}</option>`).join('')}</select></div></div>
        <div class="wa-actions"><button class="btn primary" onclick="workAccessSave('resources')">关联至所选主体</button><button class="btn ghost wa-danger" onclick="workAccessSave('resources',true)">解除所选关联</button></div>
      </section>
      <section class="wa-pane wa-section" data-pane="grants" hidden><h4>合作只读经办授权</h4><p>经办人可查看所选主体的项目与分润，不获得门店核销或财务付款权限。</p><div class="wa-grid">
        <div class="field"><label for="waFrom">授权开始时间</label><input id="waFrom" type="datetime-local"><div class="wa-hint">留空立即生效，按业务时区执行</div></div>
        <div class="field"><label for="waTo">授权结束时间</label><input id="waTo" type="datetime-local"><div class="wa-hint">留空表示长期，撤权立即生效</div></div></div>
        <div class="wa-actions"><button class="btn primary" onclick="workAccessSave('grants')">保存经办授权</button><button class="btn ghost wa-danger" onclick="workAccessSave('grants',true)">停用经办授权</button></div>
      </section>
      <section class="wa-pane wa-section" data-pane="staff" hidden><h4>门店岗位授权</h4><p>为上方所选用户单独配置门店与岗位；该授权独立于合作主体身份。</p><div class="wa-grid">
        <div class="field"><label for="waStore">授权门店</label><select id="waStore">${d.catalog.filter(r=>r.kind==='merchant').map(r=>`<option value="${r.id}">#${r.id} ${esc(r.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="waRole">门店岗位</label><select id="waRole"><option value="1">核销员</option><option value="2">店长</option><option value="3">老板</option></select></div></div>
        <div class="wa-actions"><button class="btn primary" onclick="workAccessSave('staff')">保存门店岗位</button><button class="btn ghost wa-danger" onclick="workAccessSave('staff',true)">停用门店岗位</button></div>
        ${table(['门店','用户','岗位','状态'],d.staff.map(s=>`<tr><td>#${s.merchant_id}</td><td>#${s.user_id} ${esc(s.nickname)}</td><td>${['','核销员','店长','老板'][s.role]}</td><td>${status(s.status)}</td></tr>`))}
      </section>
      <section class="wa-pane wa-section wa-tables" data-pane="records" hidden><h4>档案关联</h4>${table(['主体','类型','档案'],d.resources.map(r=>`<tr><td>${esc(names[r.subject_id]||r.subject_id)}</td><td>${kinds[r.kind]}</td><td>#${r.resource_id}</td></tr>`))}
        <h4>合作经办授权</h4>${table(['主体','用户','有效期','状态'],d.grants.map(g=>`<tr><td>${esc(names[g.subject_id]||g.subject_id)}</td><td>#${g.user_id} ${esc(g.nickname)}</td><td>${esc(g.valid_from)}<br>至 ${esc(g.valid_to||'长期')}</td><td>${status(g.status)}</td></tr>`))}<div class="wa-hint">当前最多显示200个主体、500条经办授权；启用记录仍须在有效期内。</div>
      </section>
<div id="waErr" role="alert" class="wa-error"></div>`, '<button class="btn ghost" onclick="closeModal()">关闭</button>')
    $('#modalRoot .modal').classList.add('access-dialog')
    if(draft){
      for(const key of ['Subject','Resource','Kw','From','To','Reason','Store','Role']){const el=$('#wa'+key);if(el&&draft[key])el.value=draft[key]}
      if(draft.User){const option=new Option(draft.userLabel,draft.User);$('#waUser').appendChild(option);$('#waUser').value=draft.User}
    }
    workAccessTab(draft?.tab||'subjects')
  }catch(e){toast(e.message,true)}
}
async function workAccessUserSearch(){
  const button=document.querySelector('.wa-target .wa-inline button');button.disabled=true
  try{const kw=$('#waKw').value.trim();if(!kw)throw new Error('请输入昵称、用户ID或已绑定手机号');const d=await api('GET','/admin/user-picker?kw='+encodeURIComponent(kw));$('#waUser').innerHTML=(d.rows||d).map(u=>`<option value="${u.id}">#${u.id} ${esc(u.nickname)}</option>`).join('')||'<option value="">没有找到匹配用户</option>';$('#waErr').textContent=''}catch(e){$('#waErr').textContent=e.message}finally{button.disabled=false}
}
async function workAccessSave(action,remove=false){
  if(window.__waSaving)return
  const body=action==='subjects'?{name:$('#waName').value.trim()}:{subjectId:Number($('#waSubject').value),reason:$('#waReason').value.trim()}
  if(action==='resources'){const[kind,id]=$('#waResource').value.split(':');Object.assign(body,{kind,resourceId:Number(id),remove})}
  if(action==='grants')Object.assign(body,{userId:Number($('#waUser').value),status:remove?0:1,validFrom:$('#waFrom').value,validTo:$('#waTo').value})
  if(action==='staff')Object.assign(body,{userId:Number($('#waUser').value),merchantId:Number($('#waStore').value),role:Number($('#waRole').value),status:remove?0:1})
  if(action!=='subjects'&&body.reason.length<4){$('#waErr').textContent='请填写至少4字核对依据后再保存';$('#waReason').focus();return}
  if(['grants','staff'].includes(action)&&!body.userId){$('#waErr').textContent='请先查找并选择经办用户';$('#waKw').focus();return}
  const draft=workAccessDraft();window.__waSaving=true
  document.querySelectorAll('.wa-actions .btn').forEach(b=>b.disabled=true)
  try{const r=await api('POST','/admin/work-access/'+action,body);if(action==='subjects')draft.Subject=String(r.id);await workAccessPanel(draft);toast('已保存，授权记录已更新')}catch(e){$('#waErr').textContent=e.message}finally{window.__waSaving=false;document.querySelectorAll('.wa-actions .btn').forEach(b=>b.disabled=false)}
}

function partnerEditButton(kind, id) {
  // T02：城市行直达后台账号的角色/城市授权（不混进合作资料编辑器）
  if (kind === 'city') return adminCan('account.manage') ? `<button class="btn primary sm" onclick="closeModal();accountFromPartner(${Number(id)})">账号授权</button>` : '<span class="td-sub">城市账号授权由超级管理员维护</span>'
  const entity = kind === 'promoter' ? 'promoter' : 'cocreator'
  return adminCan(`entity.${entity}.edit`) ? `<button class="btn primary sm" onclick="closeModal();entityEditor('${entity}',${Number(id)},{onSaved:()=>partners()})">编辑合作资料</button>` : '<span class="td-sub">当前角色仅查看业绩</span>'
}

async function partnerProfile(kind, id) {
  let p
  try { p = await api('GET', `/admin/partners/${kind}/${id}`) } catch (e) { return toast(e.message, true) }
  let body = ''
  if (kind === 'city') body = `<div class="pstats">${stat('本城有效 GMV', fen(p.kpi.gmv), '已支付且未退款')}${stat('有效订单', PN(p.kpi.orders))}${stat('本城商户', PN(p.merchants.total), `近 30 日新增 ${PN(p.merchants.new30)}`)}</div><div class="rv-box"><div class="rv-h">本城近 14 日成交额</div>${dayBars(p.daily, { key: 'gmv', fmt: fen, label: '成交额' })}</div>`
  if (kind === 'promoter') body = `<div class="pstats">${stat('触达用户', PN(p.hits.users), '推广码去重用户')}${stat('成交用户', PN(p.trade.buyers), `${PN(p.trade.orders)} 单`)}${stat('有效成交额', fen(p.trade.gmv), '计佣订单关联的未退款成交')}</div><div class="rv-box">${kv('档位 / 费率', `${p.promoter.tier} 档 / ${PN(p.promoter.rate_bp) / 100}%`)}${kv('近 90 日有效 GMV', fen(p.promoter.valid_gmv_90d))}${kv('服务评分', esc(p.promoter.service_score))}${p.commissions.map(x => kv(['观察期','待结算','已结算','已冲正','无效'][PN(x.status)] || '未知', `${x.n} 笔 · ${fen(x.amount)}`)).join('')}</div>`
  if (kind === 'cocreator') body = `<div class="pstats">${stat('登记投资', fen(p.co.invest_amount))}${stat('已打款分润', fen(p.paid))}${stat('已回款 / 投资', p.returnRate == null ? '—' : pct(p.returnRate), '累计回款比例，非净收益率')}</div><div class="rv-box">${kv('关联商品', esc(p.co.title))}${kv('共创角色', PN(p.co.role) === 1 ? '资金商' : '商品商')}${kv('联系电话', esc(p.co.mobile))}${kv('分润比例', PN(p.co.share_pct) / 100 + '%')}${p.profits.length ? p.profits.map(x => kv(esc(x.period), `${fen(x.amount)} · ${PN(x.status) === 1 ? '已打款' : '待打款'}`)).join('') : '<div class="td-sub">暂无分润记录</div>'}</div>`
  reviewDrawer(`合伙人画像 · ${esc(p.partner.name || p.partner.ref)}`, `<div class="rv-box">${kv('登记编号', esc(p.partner.ref))}${kv('城市', esc(CITY_CN[p.partner.city_code] || p.partner.city_code || '全平台'))}</div>` + body, partnerEditButton(kind,id))
}
