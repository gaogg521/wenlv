// 主体管理：用户中心（列表 + 画像）、商户全景、商品数据。设计见《后台管理体系设计-20261102.md》
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

const PN = (v) => Number(v || 0)
const pct = (v) => (Math.round(PN(v) * 1000) / 10) + '%'
const dt = (t, n = 16) => t ? esc(String(t).slice(0, n).replace('T', ' ')) : '—'
const LEVEL_CN = {} // 等级名来自参数中心 member.levels（levelNames() 拉取），不再在前端写死一份
let __lvLoaded = false
async function levelNames() {
  if (__lvLoaded) return
  try { (await api('GET', '/admin/member/levels')).forEach((l) => { LEVEL_CN[l.lv] = l.name }); __lvLoaded = true } catch { /* 取不到时回退显示 Lv 数字 */ }
}
const KYC_CN = { 0: '<span class="pill warn">审核中</span>', 1: '<span class="pill ok">已实名</span>', 2: '<span class="pill s70">未通过</span>' }
const MERCHANT_ST = { 0: '<span class="pill warn">进件中</span>', 1: '<span class="pill ok">生效</span>', 2: '<span class="pill off">暂停</span>', 3: '<span class="pill s70">清退</span>' }
const STAFF_ROLE = { 1: '店员', 2: '店长', 3: '老板' }

/** 单序列日柱状图：一种颜色、细柱、顶部圆角；悬停看当日数值，只标注峰值与最新值 */
function dayBars(rows, { key = 'n', fmt = (v) => v, days = 14, label = '' } = {}) {
  const map = Object.fromEntries((rows || []).map((r) => [r.d, PN(r[key])]))
  const list = [...Array(days)].map((_, i) => { const d = new Date(Date.now() - (days - 1 - i) * 86400000); const k = d.toLocaleDateString('sv-SE'); return { d: k, v: map[k] || 0 } })
  const max = Math.max(1, ...list.map((x) => x.v))
  const peak = list.reduce((a, b, i) => (b.v > list[a].v ? i : a), 0)
  return `<div class="pbars" role="img" aria-label="${esc(label)}近 ${days} 日">${list.map((x, i) => `<div class="pbar" title="${x.d.slice(5)} · ${esc(String(fmt(x.v)))}">
      ${(i === peak && x.v) || i === days - 1 ? `<em>${esc(String(fmt(x.v)))}</em>` : ''}<i style="height:${Math.max(x.v ? 4 : 1, x.v / max * 100)}%"></i><span>${i % 3 === 0 || i === days - 1 ? x.d.slice(8) : ''}</span></div>`).join('')}</div>`
}
const kv = (k, v) => `<div class="pkv"><span>${k}</span><b>${v == null || v === '' ? '—' : v}</b></div>`
// 第 4 参 go（可选）：点击动作的 JS 串；有则成为真链接（手型/悬停/↗/键盘可达），第 5 参是悬停提示
const stat = (label, value, sub, go, tip) => `<div class="pstat${go ? ' go' : ''}"${go ? ` ${dxKey} title="${tip || ''}" onclick="${go}"` : ''}>${go ? '<i class="go-arrow">↗</i>' : ''}<div class="l">${label}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`

/* ============ 用户中心 ============ */
const USER_SEGS = [['', '全部'], ['new7', '近 7 日新增'], ['buyer', '下单用户'], ['repeat', '复购用户'], ['sleeping', '沉睡（90 天未下单）'], ['creator', '创作者'], ['promoter', '推广服务商'], ['staff', '商户员工'], ['kyc', '已实名'], ['risk', '风险标记'], ['frozen', '已冻结']]
window.__userQ = window.__userQ || { seg: '', kw: '', sort: '', page: 1 }
async function users() {
  $('#app').innerHTML = `<div class="card">${skel(5)}</div>`
  await levelNames()
  const Q = window.__userQ
  const [st, list] = await Promise.all([
    api('GET', '/admin/users/stats'),
    api('GET', `/admin/users?seg=${encodeURIComponent(Q.seg)}&kw=${encodeURIComponent(Q.kw)}&sort=${encodeURIComponent(Q.sort)}&page=${Q.page}`)])
  const sg = st.segments, pages = Math.max(1, Math.ceil(list.total / list.size))
  // V-10：批量打标页面闭环——选择状态跨页保留（全局 Set），本页可见行记录在 __userPageIds 供全选
  window.__userSel = window.__userSel || new Set()
  window.__userPageIds = list.rows.map((u) => Number(u.id))
  const canBulkTag = adminCan('user.manage')
  const allChecked = canBulkTag && window.__userPageIds.length > 0 && window.__userPageIds.every((id) => window.__userSel.has(id))
  const selHead = canBulkTag ? `<th style="width:36px"><input type="checkbox" aria-label="全选本页" ${allChecked ? 'checked' : ''} onchange="userSelAll(this.checked)"></th>` : ''
  const selBar = canBulkTag ? `<div class="row" style="margin:10px 0 0;align-items:center" id="userSelBar">
    <span class="td-sub">已选 <b id="userSelCount">${window.__userSel.size}</b> 人（选择跨页保留，单次最多 100 人）</span>
    <button class="btn primary sm" onclick="bulkTagModal()">批量打标</button>
    <button class="btn ghost sm" onclick="userSelClear()">清除选择</button></div>` : ''
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
    <div class="kpi go" ${dxKey} title="查看全部用户" onclick="window.__userQ={seg:'',kw:'',sort:'',page:1};users()"><i class="go-arrow">↗</i><div class="ico">👥</div><div><div class="l">注册用户</div><div class="v">${st.total.toLocaleString()}</div><div class="s">今日 +${st.today} · 近 7 日 +${sg.new7}</div></div></div>
    <div class="kpi go" ${dxKey} title="筛选：下单用户" onclick="window.__userQ={seg:'buyer',kw:'',sort:'',page:1};users()"><i class="go-arrow">↗</i><div class="ico">🛒</div><div><div class="l">下单转化</div><div class="v">${pct(st.conversion)}</div><div class="s">下单用户 ${sg.buyer} 人</div></div></div>
    <div class="kpi go" ${dxKey} title="筛选：复购用户" onclick="window.__userQ={seg:'repeat',kw:'',sort:'',page:1};users()"><i class="go-arrow">↗</i><div class="ico">🔁</div><div><div class="l">复购率</div><div class="v">${pct(st.repeatRate)}</div><div class="s">复购 ${sg.repeat} 人 · 沉睡 ${sg.sleeping} 人</div></div></div>
    <div class="kpi go" ${dxKey} title="筛选：下单用户，按消费金额排序" onclick="window.__userQ={seg:'buyer',kw:'',sort:'gmv',page:1};users()"><i class="go-arrow">↗</i><div class="ico">💳</div><div><div class="l">人均消费</div><div class="v">${fen(st.arpu)}</div><div class="s">按下单用户计</div></div></div>
  </div>
  <div class="people-grid">
    <div class="card"><div class="card-head"><h2>近 14 日新增注册</h2></div>${dayBars(st.signups, { label: '新增注册' })}</div>
    <div class="card"><div class="card-head"><h2>用户构成</h2></div>
      <div class="pmix">${[['creator', '创作者'], ['promoter', '推广服务商'], ['staff', '商户员工'], ['kyc', '已实名'], ['risk', '风险标记'], ['frozen', '已冻结']].map(([k, n]) =>
        `<button class="pmix-item" onclick="window.__userQ={seg:'${k}',kw:'',sort:'',page:1};users()"><b>${sg[k]}</b><span>${n}</span></button>`).join('')}</div>
      <div class="td-sub" style="margin-top:10px">会员等级：${(st.levels || []).map((l) => `${LEVEL_CN[l.lv] || 'Lv' + l.lv} ${l.n}`).join(' · ') || '—'}</div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>用户列表</h2><span class="muted">共 ${list.total} 人 · 点击行查看用户画像</span></div>
    <form class="orders-search" onsubmit="event.preventDefault();window.__userQ.kw=this.kw.value.trim();window.__userQ.page=1;users()">
      <input name="kw" type="search" value="${esc(Q.kw)}" placeholder="昵称 / 用户 ID / 11 位手机号">
      <select name="sort" onchange="window.__userQ.sort=this.value;window.__userQ.page=1;users()">${[['', '最新注册'], ['gmv', '消费金额'], ['orders', '订单数'], ['last', '最近下单'], ['growth', '成长值']].map(([v, n]) => `<option value="${v}" ${Q.sort === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn primary" type="submit">查询</button>
      ${Q.kw || Q.seg ? `<button class="btn ghost" type="button" onclick="window.__userQ={seg:'',kw:'',sort:'',page:1};users()">重置</button>` : ''}</form>
    <div class="cfg-tabs">${USER_SEGS.map(([v, n]) => `<button type="button" class="cfg-tab ${Q.seg === v ? 'on' : ''}" onclick="window.__userQ.seg='${v}';window.__userQ.page=1;users()">${n}${v ? ' ' + (sg[v] ?? '') : ''}</button>`).join('')}</div>
    ${selBar}
    ${list.rows.length ? `<table><thead><tr>${selHead}<th>用户</th><th>注册时间</th><th>等级 / 成长值</th><th>订单</th><th>消费金额</th><th>最近下单</th><th>旅豆</th><th>身份</th><th>状态 / 管理</th></tr></thead><tbody>
    ${list.rows.map((u) => `<tr class="click-row" onclick="userProfile(${u.id})">
      ${canBulkTag ? `<td><input type="checkbox" aria-label="选择用户 ${u.id}" ${window.__userSel.has(Number(u.id)) ? 'checked' : ''} onclick="event.stopPropagation()" onchange="userSel(${Number(u.id)}, this.checked)"></td>` : ''}
      <td><div class="puser">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : `<i>${esc(String(u.nickname || '?').slice(0, 1))}</i>`}<div><div class="td-main">${esc(u.nickname || '未命名')}</div><div class="td-sub">ID ${u.id}${PN(u.has_mobile) ? ' · 已绑手机' : ''}</div></div></div></td>
      <td class="td-sub">${dt(u.created_at, 10)}</td>
      <td>${LEVEL_CN[u.member_level] || 'Lv' + u.member_level}<div class="td-sub">${PN(u.growth_value)}</div></td>
      <td class="num">${PN(u.order_cnt)}</td><td class="money num">${PN(u.gmv) ? fen(u.gmv) : '—'}</td>
      <td class="td-sub">${dt(u.last_at, 10)}</td><td class="num">${PN(u.beans)}</td>
      <td>${[u.creator_tag && u.creator_tag !== 'none' ? `<span class="pill s40">${esc(CREATOR_TAG[u.creator_tag] || '创作者')}</span>` : (PN(u.note_cnt) ? '<span class="pill off">写过笔记</span>' : ''),
        PN(u.is_promoter) ? '<span class="pill s20">推广</span>' : '', PN(u.is_staff) ? '<span class="pill s30">商户员工</span>' : '', PN(u.kyc_status) === 1 ? '<span class="pill ok">实名</span>' : ''].join(' ') || '<span class="td-sub">游客</span>'}</td>
      <td>${PN(u.status) === 0 ? '<span class="pill s70">已冻结</span>' : PN(u.risk_flag) ? '<span class="pill warn">风险</span>' : '<span class="pill ok">正常</span>'}<button class="btn ghost sm" onclick="event.stopPropagation();userProfile(${u.id})">查看与管理</button></td></tr>`).join('')}</tbody></table>
    <div class="pagination"><span>第 ${list.page} / ${pages} 页</span><div class="pagination-actions">
      <button class="btn ghost sm" ${list.page <= 1 ? 'disabled' : ''} onclick="window.__userQ.page--;users()">上一页</button>
      <button class="btn ghost sm" ${list.page >= pages ? 'disabled' : ''} onclick="window.__userQ.page++;users()">下一页</button></div></div>`
    : emptyBox('没有符合条件的用户')}
  </div>`
}

// ---- V-10：批量打标页面闭环（选择 → 预览范围 → 确认 → 逐笔结果）----
window.userSel = (id, on) => {
  if (on) window.__userSel.add(id)
  else window.__userSel.delete(id)
  const cnt = document.querySelector('#userSelCount')
  if (cnt) cnt.textContent = window.__userSel.size
}
window.userSelAll = (on) => {
  for (const id of (window.__userPageIds || [])) { if (on) window.__userSel.add(id); else window.__userSel.delete(id) }
  users()
}
window.userSelClear = () => { window.__userSel = new Set(); users() }

window.bulkTagModal = async () => {
  if (!window.__userSel.size) return toast('请先勾选要打标的用户', true)
  if (window.__userSel.size > 100) return toast('单次最多 100 人，当前已选 ' + window.__userSel.size + ' 人', true)
  let words = []
  try { words = (await api('GET', '/admin/user-ops/tag-words')).words } catch (e) { return toast(e.message, true) }
  if (!words.length) return toast('词表为空：请先在参数中心 user.ops_tags 维护标签词表', true)
  const ids = [...window.__userSel]
  const preview = ids.slice(0, 10).join(', ') + (ids.length > 10 ? ' … 共 ' + ids.length + ' 人' : '')
  modal('批量打标 · 范围预览', `
    <p class="td-sub">将对以下用户打标（共 <b>${ids.length}</b> 人，单次上限 100）：ID ${esc(preview)}</p>
    <div class="field"><label>标签 *（词表：参数中心 user.ops_tags）</label><select id="bulkTagSel" class="inp" style="width:220px">${words.map((w) => `<option>${esc(w)}</option>`).join('')}</select></div>
    <div class="field"><label>打标说明（可选，逐笔进审计）</label><input id="bulkTagNote" class="inp" maxlength="200" placeholder="选填"></div>
    <p class="td-sub">已拥有该标签的用户会逐笔提示「已有该标签」，不会重复写入；已注销/不存在的 ID 逐笔报「用户不存在」。</p>
    <div id="bulkTagErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="bulkTagSubmit()">确认打标 ${ids.length} 人</button>`)
}
window.bulkTagSubmit = async () => {
  const tag = ($('#bulkTagSel')?.value || '').trim()
  if (!tag) { $('#bulkTagErr').textContent = '请选择标签'; return }
  const ids = [...window.__userSel]
  const btn = event?.target; if (btn) btn.disabled = true
  try {
    const r = await api('POST', '/admin/users/bulk-tags', { userIds: ids, tag, note: ($('#bulkTagNote')?.value || '').trim() })
    window.__userSel = new Set()
    modal('批量打标结果 · ' + esc(tag), `
      <p>完成：<span class="pill ok">成功 ${r.ok}</span> <span class="pill ${r.fail ? 's70' : 'off'}">失败 ${r.fail}</span> / 共 ${r.total}</p>
      <div class="rv-box" style="max-height:320px;overflow:auto"><div class="rv-h">逐笔结果</div>
      ${r.results.map((x) => `<div style="margin:4px 0">用户 #${x.userId}：${x.ok ? '<span class="pill ok">成功</span>' : '<span class="pill s70">' + esc(x.reason || '失败') + '</span>'}</div>`).join('')}</div>
      <p class="td-sub">打标与说明逐笔进入审计日志（action=tag-add, bulk=true）；可在用户画像中查看与移除。</p>`,
      `<button class="btn primary" onclick="closeModal();users()">完成</button>`)
  } catch (e) {
    if (btn) btn.disabled = false
    $('#bulkTagErr').textContent = e.message
  }
}

async function userProfile(id) {
  await levelNames()
  let p
  try { p = await api('GET', '/admin/users/' + id) } catch (e) { return toast(e.message, true) }
  const u = p.user, t = p.trade, c = p.content
  const frozen = u.status === 0
  // T05：运营标签与内部备注（追加式，不与用户自维护资料混淆）；T06：权益调整入口
  let ops = null
  if (adminCan('user.manage')) { try { ops = await api('GET', '/admin/users/' + id + '/ops') } catch (e) { ops = null } }
  const opsHtml = ops ? `
  <h3 style="margin:16px 0 8px">运营标签 <span class="td-sub">词表：参数中心 user.ops_tags · 内部口径，不下发游客端</span></h3>
  <div>${ops.tags.length ? ops.tags.map((tg) => `<span class="pill s20" style="margin:0 6px 6px 0">${esc(tg.tag)}${tg.note ? ' <span class="td-sub">' + esc(tg.note) + '</span>' : ''} <a href="javascript:void(0)" style="color:var(--red)" onclick="removeUserTag(${u.id}, ${tg.id})">✕</a></span>`).join('') : '<span class="muted">暂无标签</span>'}</div>
  ${ops.words.length ? `<div class="row" style="margin:8px 0"><select id="uTagSel" class="inp" style="width:160px">${ops.words.filter((w) => !ops.tags.some((tg) => tg.tag === w)).map((w) => `<option>${esc(w)}</option>`).join('')}</select>
    <input id="uTagNote" class="inp" placeholder="打标说明（可选）" style="width:200px" maxlength="200">
    <button class="btn ghost sm" onclick="addUserTag(${u.id})">打标</button></div>` : ''}
  <h3 style="margin:16px 0 8px">内部备注 <span class="td-sub">追加式：只能新增，不能修改或删除历史</span></h3>
  ${(ops.notes || []).slice(0, 5).map((n) => `<div class="rv-box"><p>${esc(n.note)}</p><span class="td-sub">${esc(n.actor)} · ${esc(String(n.created_at).slice(0, 16).replace('T', ' '))}</span></div>`).join('') || '<p class="muted">暂无内部备注</p>'}
  <div class="row" style="margin:8px 0"><input id="uOpsNote" class="inp" style="flex:1" placeholder="2–500 字内部备注（勿录手机号/证件号）" maxlength="500">
    <button class="btn ghost sm" onclick="addUserOpsNote(${u.id})">追加备注</button></div>
  <div class="row" style="margin:8px 0"><button class="btn primary sm" onclick="entitlementModal(${u.id}, '${esc(u.nickname || '')}', ${PN(u.growth_value)}, ${PN(p.beans.balance)})">发起权益调整申请</button><span class="td-sub">旅豆/成长值/徽章走申请→他人审批→账本执行，无直接改余额</span></div>` : ''
  reviewDrawer(`用户画像 · ${esc(u.nickname || 'ID ' + u.id)}`, `
  <div class="pprofile-head">
    ${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : `<i>${esc(String(u.nickname || '?').slice(0, 1))}</i>`}
    <div><h2>${esc(u.nickname || '未命名')} ${frozen ? '<span class="pill s70">已冻结</span>' : ''}${u.risk_flag ? ' <span class="pill warn">风险标记</span>' : ''}</h2>
      <div class="td-sub">ID ${u.id} · ${LEVEL_CN[u.member_level] || 'Lv' + u.member_level} · 成长值 ${PN(u.growth_value)} · 注册于 ${dt(u.created_at)}</div></div>
    <div class="pprofile-act">${adminCan('user.manage') ? `
      <button class="btn ${frozen ? 'primary' : 'danger'} sm" onclick="userSetStatus(${u.id}, ${frozen ? 1 : 0})">${frozen ? '解除冻结' : '冻结账号'}</button>
      <button class="btn ghost sm" onclick="userSetRisk(${u.id}, ${u.risk_flag ? 0 : 1})">${u.risk_flag ? '取消风险标记' : '标记风险'}</button>` : '<span class="muted">账号状态与风险管理需运营或风控权限</span>'}</div>
  </div>
  ${opsHtml}
  <div class="pstats">${stat('订单', PN(t.orders), `已完成 ${PN(t.completed)} · 退款 ${PN(t.refunded)}`)}${stat('消费金额', fen(t.gmv), `客单价 ${fen(t.aov)}`)}
    ${stat('旅豆余额', PN(p.beans.balance), `累计获得 ${PN(p.beans.lifetime)} · 已抵扣 ${PN(t.beans_used)}`)}${stat('内容', PN(c.notes.total) + ' 篇', `发布 ${PN(c.notes.published)} · 获赞 ${PN(c.notes.likes)}`)}</div>
  <div class="rv-grid">
    <div>
      <div class="rv-box"><div class="rv-h">注册与身份</div>
        ${kv('手机号', esc(u.mobile) || '未绑定')}${kv('小程序绑定', [u.bind.miniA ? '游客端' : '', u.bind.miniB ? '商户端' : '', u.bind.unionid ? 'UnionID' : ''].filter(Boolean).join(' · '))}
        ${kv('实名认证', p.kyc ? `${KYC_CN[p.kyc.status] || ''} ${esc(p.kyc.real_name)} ${esc(p.kyc.id_no_mask || '')}` : '未提交')}
        ${p.kyc && p.kyc.reject_note ? kv('驳回原因', esc(p.kyc.reject_note)) : ''}
        ${kv('数字身份', u.did ? `<code>${esc(u.did)}</code>` : '未签发')}${kv('最近更新', dt(u.updated_at))}</div>
      <div class="rv-box"><div class="rv-h">交易</div>
        ${kv('首单 / 最近', `${dt(t.first_at, 10)} / ${dt(t.last_at, 10)}`)}${kv('退款金额', fen(t.refund_amount) + (t.refund_fee ? `（扣手续费 ${fen(t.refund_fee)}）` : ''))}
        ${kv('常去城市', (p.favCities || []).map((x) => `${esc(CITY_CN[x.city_code] || x.city_code)} ${x.n}`).join(' · '))}
        ${p.orders.length ? `<table class="ptable"><tbody>${p.orders.map((o) => `<tr><td><button class="order-link" onclick="orderDrawer('${esc(o.order_no)}')">${esc(o.order_no)}</button><div class="td-sub">${esc(o.title)} · ${o.qty} 人</div></td>
          <td class="money num">${fen(o.amount_pay)}</td><td><span class="pill s${o.status}">${ST[o.status] || ''}</span></td><td class="td-sub">${dt(o.created_at, 10)}</td></tr>`).join('')}</tbody></table>` : '<div class="td-sub">暂无订单</div>'}</div>
      <div class="rv-box"><div class="rv-h">旅豆流水（最近 10 条）</div>
        ${p.beans.ledger.length ? p.beans.ledger.map((l) => `<div class="pkv"><span>${dt(l.created_at)} · ${esc(l.biz_ref || '')}</span><b style="color:${PN(l.direction) === 1 ? '#0b7a45' : '#b42318'}">${PN(l.direction) === 1 ? '+' : '−'}${PN(l.amount)}</b></div>`).join('') : '<div class="td-sub">暂无流水</div>'}</div>
    </div>
    <div>
      <div class="rv-box"><div class="rv-h">内容与创作</div>
        ${kv('创作者标签', u.creator_tag && u.creator_tag !== 'none' ? esc(CREATOR_TAG[u.creator_tag] || u.creator_tag) : '普通')}
        ${kv('笔记', `共 ${PN(c.notes.total)} · 发布 ${PN(c.notes.published)} · 驳回 ${PN(c.notes.rejected)}`)}
        ${kv('约稿', `参与 ${PN(c.tasks.joined)} · 通过 ${PN(c.tasks.passed)} · 待审 ${PN(c.tasks.reviewing)}`)}
        ${kv('约稿奖励', `${PN(c.tasks.beans)} 旅豆${PN(c.tasks.cash_paid) ? ' · 已打款 ' + fen(c.tasks.cash_paid) : ''}${PN(c.tasks.cash_pending) ? ' · 待打款 ' + fen(c.tasks.cash_pending) : ''}`)}
        ${c.recentNotes.length ? c.recentNotes.map((n) => `<div class="pkv"><span><button class="order-link" onclick="reviewNote(${n.id})">${esc(n.title || '（无题）')}</button></span><b>${NOTE_ST[n.status] || ''} · ♥ ${PN(n.like_count)}</b></div>`).join('') : ''}
        ${c.badges.length ? `<div class="rv-chips" style="margin-top:6px">勋章：${c.badges.map((b) => `<span class="pill s30">${esc(b.name)}</span>`).join('')}</div>` : ''}</div>
      ${p.promoter ? `<div class="rv-box"><div class="rv-h">推广服务商</div>${kv('档位 / 费率', `${p.promoter.tier} 档 · ${PN(p.promoter.rate_bp) / 100}%`)}${kv('近 90 日有效 GMV', fen(p.promoter.valid_gmv_90d))}
        ${kv('累计佣金', `${PN(p.promoter.commission?.n)} 笔 · ${fen(p.promoter.commission?.amt)}`)}${kv('状态', PN(p.promoter.status) === 1 ? '正常' : '冻结')}</div>` : ''}
      ${p.staff.length ? `<div class="rv-box"><div class="rv-h">商户身份</div>${p.staff.map((s) => kv(`<button class="order-link" onclick="merchantProfile(${s.id})">${esc(s.name)}</button>`, (STAFF_ROLE[s.role] || '员工') + (PN(s.status) ? '' : '（已停用）'))).join('')}</div>` : ''}
      <div class="rv-box"><div class="rv-h">成长记录</div>${p.growth.length ? p.growth.map((g) => kv(dt(g.created_at), `${PN(g.delta) > 0 ? '+' : ''}${PN(g.delta)} → ${PN(g.after_val)}`)).join('') : '<div class="td-sub">暂无</div>'}</div>
      <div class="rv-box"><div class="rv-h">后台操作记录</div>${p.ops.length ? p.ops.map((o) => kv(dt(o.created_at), `${esc(o.actor)} · ${esc(o.action)}`)).join('') : '<div class="td-sub">无</div>'}</div>
    </div>
  </div>`, '')
}
async function userSetStatus(id, status) {
  const reason = status === 0 ? prompt('冻结原因（必填，会记入审计；冻结后该用户小程序所有操作被拒）：') : (confirm('确定解除冻结？') ? '解除冻结' : null)
  if (reason == null) return
  try { await api('POST', `/admin/users/${id}/status`, { status, reason }); toast(status ? '已解除冻结' : '已冻结'); userProfile(id); if (typeof users === 'function' && location.hash === '#users') users() } catch (e) { toast(e.message, true) }
}
async function userSetRisk(id, flag) {
  const reason = flag ? prompt('风险标记原因（必填，会记入审计）：') : '取消风险标记'
  if (reason == null) return
  try { await api('POST', `/admin/users/${id}/risk`, { flag: !!flag, reason }); toast(flag ? '已标记风险' : '已取消风险标记'); userProfile(id) } catch (e) { toast(e.message, true) }
}

/* ============ 商户全景 ============ */
async function merchantProfile(id) {
  let p
  try { p = await api('GET', `/admin/merchants/${id}/overview`) } catch (e) { return toast(e.message, true) }
  const m = p.merchant, k = p.kpi, s = p.settle
  reviewDrawer(`商户全景 · ${esc(m.name)}`, `
  <div class="pprofile-head"><i>${esc(String(m.name).slice(0, 1))}</i>
    <div><h2>${esc(m.name)} ${MERCHANT_ST[m.status] || ''}</h2><div class="td-sub">${esc(MERCHANT_KIND[m.kind] || m.kind || '')} · ${esc(CITY_CN[m.city_code] || m.city_code || '')} · 商户号 ${esc(m.merchant_no || '—')}</div></div>
    <div class="pprofile-act">${adminCan('entity.merchant.edit') ? `<button class="btn ghost sm" onclick="editMerchant(${m.id})">编辑资料</button>` : '<span class="td-sub">商户资料由运营/超管维护</span>'}</div></div>
  <div class="pstats">${stat('累计 GMV', fen(k.gmv), `近 30 日 ${fen(k.gmv30)}`)}${stat('订单', PN(k.orders), `核销 ${PN(k.verified)} · 客单价 ${fen(k.aov)}`)}
    ${stat('退款率', pct(k.refund_rate), `退款 ${PN(k.refunded)} 单`)}${stat('评分', k.rating != null ? k.rating.toFixed(1) + ' ★' : '—', `${k.reviews} 条评价 · 复购用户 ${k.repeat_buyers}`)}</div>
  ${p.level ? `<div class="card" style="margin:0 0 12px"><div class="card-head"><h2>经营等级</h2><span class="muted">按订单、评价、退款率评定；门槛在参数中心 merchant.levels</span></div>
    <div class="row" style="gap:16px;align-items:center"><img src="/badge-art/mlevel/${p.level.lv}.svg" width="84" height="84" alt=""><div><b style="font-size:16px">Lv${p.level.lv} ${esc(p.level.name)}</b>
      <div class="td-sub">完成订单 ${PN(p.level.metrics.orders)} · 评价 ${PN(p.level.metrics.reviews)}${p.level.metrics.reviews ? ' · 评分 ' + p.level.metrics.rating10 / 10 : ''} · 退款率 ${p.level.metrics.refundPct}%</div>
      <div class="td-sub">${p.level.next ? '距「' + esc(p.level.next.name) + '」：' + p.level.next.criteria.map((c) => esc(c.label) + ' ' + c.cur + '/' + c.need + c.unit + (c.ok ? ' ✓' : '')).join(' · ') : '已是最高等级'}</div></div></div>
    <div class="row" style="gap:8px;margin-top:8px">${(p.badges || []).map((b) => '<span class="pill ok">' + esc(b.name) + '</span>').join('') || '<span class="muted">暂无商户徽章</span>'}</div></div>` : ''}
  <div class="card" style="margin:0 0 12px"><div class="card-head"><h2>近 14 日成交额</h2></div>${dayBars(p.daily, { key: 'gmv', fmt: (v) => fen(v), label: '成交额' })}</div>
  <div class="rv-grid"><div>
    <div class="rv-box"><div class="rv-h">商品与线路（${p.products.length}）</div>
      ${p.products.length ? `<table class="ptable"><thead><tr><th>商品</th><th>售出</th><th>GMV</th><th>评分</th><th>近期团期</th></tr></thead><tbody>${p.products.map((x) => `<tr>
        <td><button class="order-link" onclick="productProfile(${x.id})">${esc(x.title)}</button><div class="td-sub">${PN(x.status) === 1 ? '在架' : '下架'} · 起价 ${fen(x.price_from)}</div></td>
        <td class="num">${PN(x.sold)} 人</td><td class="money num">${fen(x.gmv)}</td><td>${x.rating != null ? Number(x.rating).toFixed(1) : '—'}</td><td class="num">${PN(x.upcoming)}</td></tr>`).join('')}</tbody></table>` : '<div class="td-sub">暂无商品</div>'}</div>
    <div class="rv-box"><div class="rv-h">最新评价</div>${p.reviews.length ? p.reviews.map((r) => `<div class="pkv"><span>${esc(r.nickname)} · ${esc(r.title)}<br><span class="td-sub">${esc(r.content || '')}</span></span><b>${r.rating} ★</b></div>`).join('') : '<div class="td-sub">暂无评价</div>'}</div>
  </div><div>
    <div class="rv-box"><div class="rv-h">入驻与进件</div>
      ${kv('申请人', m.applicant ? `<button class="order-link" onclick="userProfile(${m.applicant.id})">${esc(m.applicant.nickname)}</button>` : '后台创建')}
      ${kv('联系人 / 电话', `${esc(m.apply_contact || '—')} / ${esc(m.apply_mobile || '—')}`)}${kv('营业执照', esc(m.biz_license || ''))}${kv('微信支付子商户', esc(m.sub_mchid || '未配置'))}
      ${kv('邀请码', m.invite_code ? `<code>${esc(m.invite_code)}</code>` : '')}${kv('申请时间 / 通过时间', `${dt(m.created_at, 10)} / ${dt(m.approved_at, 10)}`)}
      ${m.apply_note ? kv('申请说明', esc(m.apply_note)) : ''}</div>
    <div class="rv-box"><div class="rv-h">员工（${p.staff.length}）</div>${p.staff.length ? p.staff.map((x) => kv(`<button class="order-link" onclick="userProfile(${x.user_id})">${esc(x.nickname)}</button>`, (STAFF_ROLE[x.role] || '员工') + (PN(x.status) ? '' : '（已停用）'))).join('') : '<div class="td-sub">暂无员工</div>'}</div>
    <div class="rv-box"><div class="rv-h">结算</div>${kv('待商户确认', fen(s.to_confirm))}${kv('待打款', fen(s.to_pay))}${kv('已打款', fen(s.paid))}${PN(s.disputed) ? kv('异议中', PN(s.disputed) + ' 张') : ''}
      ${p.settlements.map((x) => kv(esc(x.period), `${fen(PN(x.amt_fulfill) + PN(x.fee_merchant))} · ${['待确认', '待复核', '待打款', '已打款', '异议'][x.status] || ''}`)).join('')}</div>
    <div class="rv-box"><div class="rv-h">后台操作记录</div>${p.ops.length ? p.ops.map((o) => kv(dt(o.created_at), `${esc(o.actor)} · ${esc(o.action)}`)).join('') : '<div class="td-sub">无</div>'}</div>
  </div></div>`, '')
}

/* ============ 商品 / 线路数据 ============ */
async function productProfile(id) {
  let p
  try { p = await api('GET', `/admin/products/${id}/overview`) } catch (e) { return toast(e.message, true) }
  const x = p.product, k = p.kpi
  reviewDrawer(`商品数据 · ${esc(x.title)}`, `
  <div class="pprofile-head"><i>${esc(String(x.title).slice(0, 1))}</i><div><h2>${esc(x.title)} ${PN(x.status) === 1 ? '<span class="pill ok">在架</span>' : '<span class="pill off">下架</span>'}</h2>
    <div class="td-sub">${esc(CITY_CN[x.city_code] || x.city_code || '')} · ${esc(x.merchant_name || '')} · 起价 ${fen(x.price_from)}</div></div>
    <div class="pprofile-act"><button class="btn ghost sm" onclick="entityEditor('product', ${x.id})">编辑资料</button></div></div>
  <div class="pstats">${stat('成交额', fen(k.gmv), `${PN(k.orders)} 单 · ${PN(k.buyers)} 位用户`)}${stat('出行人数', PN(k.travelers), `旅豆抵扣 ${PN(k.beans_used)}`)}
    ${stat('团期满座率', pct(k.fill_rate), `退款率 ${pct(k.refund_rate)}`)}${stat('评分', k.rating != null ? k.rating.toFixed(1) + ' ★' : '—', `${k.reviews} 条评价 · ${k.notes} 篇游记`)}</div>
  <div class="card" style="margin:0 0 12px"><div class="card-head"><h2>近 14 日订单</h2></div>${dayBars(p.daily, { key: 'n', fmt: (v) => v + ' 单', label: '订单数' })}</div>
  <div class="rv-grid"><div><div class="rv-box"><div class="rv-h">团期</div>
    ${p.sessions.length ? `<table class="ptable"><thead><tr><th>出发日</th><th>已报 / 名额</th><th>成团线</th><th>价格</th></tr></thead><tbody>${p.sessions.map((s) => `<tr><td>${dt(s.depart_date, 10)}</td>
      <td class="num">${PN(s.booked)} / ${PN(s.quota)}</td><td class="num">${PN(s.min_go) || '—'}</td><td class="money num">${fen(s.price_adult)}</td></tr>`).join('')}</tbody></table>` : '<div class="td-sub">暂无团期</div>'}</div></div>
  <div><div class="rv-box"><div class="rv-h">评分分布</div>${p.dist.length ? p.dist.map((d) => kv(d.rating + ' ★', PN(d.n) + ' 条')).join('') : '<div class="td-sub">暂无评价</div>'}</div></div></div>`, '')
}

/* ============ T05/T06：运营标签/备注操作 + 人工权益调整 ============ */
window.addUserTag = async (id) => {
  try { await api('POST', `/admin/users/${id}/tags`, { tag: $('#uTagSel')?.value, note: ($('#uTagNote')?.value || '').trim() }); toast('已打标'); userProfile(id) } catch (e) { toast(e.message, true) }
}
window.removeUserTag = async (id, tagId) => {
  try { await api('DELETE', `/admin/users/${id}/tags/${tagId}`); toast('已移除标签'); userProfile(id) } catch (e) { toast(e.message, true) }
}
window.addUserOpsNote = async (id) => {
  try { await api('POST', `/admin/users/${id}/ops-notes`, { note: ($('#uOpsNote').value || '').trim() }); toast('备注已追加'); userProfile(id) } catch (e) { toast(e.message, true) }
}
// 发起权益调整：展示当前值与预期结果；执行与账本/成长/徽章在审批通过时同事务完成
window.entitlementModal = (userId, nickname, growth, beanBalance) => {
  modal('发起权益调整 · ' + esc(nickname || 'ID ' + userId), `
    <p class="td-sub">当前：旅豆余额 <b>${Number(beanBalance).toLocaleString()}</b> · 成长值 <b>${Number(growth).toLocaleString()}</b>。提交后由超级管理员复核执行（审批人不能是申请人）；旅豆走账本分录（业务号幂等），不足余额的扣回会被拒绝。</p>
    <div class="field"><label>调整类型 *</label><select id="eqKind" onchange="document.getElementById('eqBadgeRow').style.display=['badge_grant','badge_revoke'].includes(this.value)?'block':'none'">
      <option value="bean_grant">旅豆补发</option><option value="bean_deduct">旅豆扣回</option>
      <option value="growth_fix">成长值更正</option><option value="badge_grant">徽章补发</option><option value="badge_revoke">徽章撤回</option></select></div>
    <div class="field" id="eqAmtRow"><label>数量 *（旅豆个数为正整数；成长值可为负用于冲正多记）</label><input id="eqAmount" type="number" step="1"></div>
    <div class="field" id="eqBadgeRow" style="display:none"><label>徽章 *</label><select id="eqBadge"><option value="">加载中…</option></select></div>
    <div class="field"><label>业务依据与原因 *（4–500 字，进入审计）</label><textarea id="eqReason" rows="2" maxlength="500"></textarea></div>
    <div id="eqErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="entitlementSubmit(${userId})">提交申请</button>`)
  document.getElementById('eqKind').onchange = (e) => {
    document.getElementById('eqAmtRow').style.display = ['badge_grant', 'badge_revoke'].includes(e.target.value) ? 'none' : 'block'
    if (['badge_grant', 'badge_revoke'].includes(e.target.value)) {
      api('GET', '/admin/web3/badges').then((d) => { const rows = d.defs || [];
        document.getElementById('eqBadge').innerHTML = rows.filter((b) => !String(b.rule_type || '').startsWith('m_')).map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('') || '<option value="">无可选徽章</option>'
      }).catch(() => { document.getElementById('eqBadge').innerHTML = '<option value="">徽章列表加载失败</option>' })
    }
  }
}
window.entitlementSubmit = async (userId) => {
  try {
    const kind = $('#eqKind').value
    const body = { userId, kind, reason: ($('#eqReason').value || '').trim() }
    if (!['badge_grant', 'badge_revoke'].includes(kind)) body.amount = Math.round(Number($('#eqAmount').value))
    else body.badgeId = Number($('#eqBadge').value)
    const r = await api('POST', '/admin/entitlements', body)
    closeModal(); toast('申请 ' + r.reqNo + ' 已提交，等待超级管理员复核')
    if (typeof entitlements === 'function' && ADMIN_CAPABILITIES.role !== 'city_partner') entitlements()
  } catch (e) { $('#eqErr').textContent = e.message }
}
// 权益调整队列（用户与权益组）：运营/财务查看，超管审批执行
const EQ_ST = { 0: '<span class="pill warn">待审批</span>', 1: '<span class="pill ok">已执行</span>', 2: '<span class="pill s70">已驳回</span>', 3: '<span class="pill off">已撤回</span>' }
const EQ_KIND = { bean_grant: '旅豆补发', bean_deduct: '旅豆扣回', growth_fix: '成长值更正', badge_grant: '徽章补发', badge_revoke: '徽章撤回' }
async function entitlements() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  window.__eqQ = window.__eqQ || { page: 1, status: '' }
  const Q = window.__eqQ
  const data = await api('GET', '/admin/entitlements?' + new URLSearchParams({ page: Q.page, status: Q.status }).toString())
  const rows = data.rows
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const isSuper = ADMIN_CAPABILITIES.role === 'super'
  const me = ME?.displayName || ME?.username || ''
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>人工权益调整</h2><span class="muted">运营/风控从用户画像发起 → 超管复核执行 → 账本分录与审计同事务；无直接改余额接口</span></div>
    <div class="cfg-tabs">${[['', '全部'], [0, '待审批'], [1, '已执行'], [2, '已驳回'], [3, '已撤回']].map(([v, n]) => `<button class="cfg-tab ${String(Q.status) === String(v) ? 'on' : ''}" onclick="window.__eqQ.status='${v}';window.__eqQ.page=1;entitlements()">${n}</button>`).join('')}</div>
    ${rows.length ? `<table><thead><tr><th>申请号</th><th>用户</th><th>类型 / 数量</th><th>依据</th><th>状态</th><th>申请人 / 审批</th><th>操作</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="num">${esc(r.req_no)}</td><td>${esc(r.nickname || 'ID ' + r.user_id)}<div class="td-sub">ID ${r.user_id}</div></td>
      <td>${EQ_KIND[r.kind] || esc(r.kind)}${r.amount != null ? '<div class="num"><b>' + (r.amount > 0 && r.kind !== 'bean_deduct' ? '+' : '') + Number(r.amount).toLocaleString() + '</b></div>' : ''}</td>
      <td class="td-sub" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.reason)}">${esc(r.reason)}</td>
      <td>${EQ_ST[r.status] || r.status}${r.exec_result ? '<div class="td-sub">' + esc(r.exec_result) + '</div>' : ''}</td>
      <td class="td-sub">${esc(r.applicant)}${r.approver ? '<br>复核：' + esc(r.approver) : ''}</td>
      <td><div class="td-actions">
        ${Number(r.status) === 0 && isSuper && r.applicant !== 'admin:' + me ? `<button class="btn primary sm" onclick="eqApprove(${r.id}, true)">通过执行</button><button class="btn danger sm" onclick="eqApprove(${r.id}, false)">驳回</button>` : ''}
        ${Number(r.status) === 0 && r.applicant === 'admin:' + me ? `<button class="btn ghost sm" onclick="eqWithdraw(${r.id})">撤回</button>` : ''}
        ${Number(r.status) === 0 && !isSuper && r.applicant !== 'admin:' + me ? '<span class="td-sub">待超管复核</span>' : ''}
      </div></td></tr>`).join('')}</tbody></table>`
    : emptyBox(Q.status !== '' ? '没有符合条件的申请。' : '暂无申请——从用户画像「发起权益调整申请」创建。')}
    <div class="pagination"><span>共 ${Number(data.total).toLocaleString()} 条 · 第 ${data.page} / ${pages} 页</span><div><button class="btn ghost sm" ${data.page <= 1 ? 'disabled' : ''} onclick="window.__eqQ.page--;entitlements()">上一页</button> <button class="btn ghost sm" ${data.page >= pages ? 'disabled' : ''} onclick="window.__eqQ.page++;entitlements()">下一页</button></div></div>
  </div>`
}
window.eqApprove = (id, pass) => {
  modal((pass ? '通过并执行' : '驳回') + '权益申请 · #' + id, `
    ${pass ? '<p class="td-sub">通过后立即执行：旅豆写账本分录（业务号幂等）、成长值重算等级、徽章入存证队列；与审计同事务，失败整体回滚。</p>' : '<p class="td-sub">驳回后申请人可修改依据重新提交。</p>'}
    <div class="field"><label>${pass ? '复核说明（可选）' : '驳回原因（申请人可见）'}</label><input id="eqNote" maxlength="200"></div>
    <div id="eqAErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn ${pass ? 'primary' : 'danger'}" onclick="eqApproveSubmit(${id}, ${pass})">确认</button>`)
}
window.eqApproveSubmit = async (id, pass) => {
  try {
    const r = await api('POST', '/admin/entitlements/' + id + '/approve', { pass, note: ($('#eqNote').value || '').trim() })
    closeModal(); toast(pass ? '已执行：' + (r.execResult || '') : '已驳回')
    entitlements()
  } catch (e) { $('#eqAErr').textContent = e.message }
}
window.eqWithdraw = async (id) => {
  try { await api('POST', '/admin/entitlements/' + id + '/withdraw'); toast('已撤回'); entitlements() } catch (e) { toast(e.message, true) }
}
