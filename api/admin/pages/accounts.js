// 后台账号与城市授权生命周期（T02）：仅超管。列表不含密码哈希 / MFA 密钥；
// 停用 / 改角色 / 改城市 / 重置密码都会使该账号已登录会话立即失效。
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

const ACCOUNT_ROLE_CN = { super: '超级管理员', ops: '运营管理员', finance: '财务管理员', review: '审核管理员', risk: '风控管理员', city_partner: '城市合伙人', readonly: '只读账号' }
const CITY_DICT_ACCOUNTS = [[310118, '上海·青浦'], [310000, '上海'], [320508, '苏州·姑苏'], [330500, '湖州'], [330523, '湖州·安吉']]
const cityLabelAccounts = (code) => { const hit = CITY_DICT_ACCOUNTS.find(([c]) => String(c) === String(code)); return hit ? hit[1] : (code || '—') }

async function accounts() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  if (window.__accTab === 'rolematrix') return roleMatrixTab()
  return accountsList()
}

// C-05：角色默认权限矩阵（行=模块，列=角色；super 恒全部不可编辑；城市不可授予名单联动禁用）
async function roleMatrixTab() {
  const d = await api('GET', '/admin/role-modules')
  const groups = [...new Set(d.modules.map((m) => m.group))]
  const cell = (m, role) => {
    const on = (d.byRole[role] || []).includes(m.key)
    const cityLocked = role === 'city_partner' && d.cityDeny.includes(m.key)
    return `<td><input type="checkbox" role-cb data-role="${role}" data-modkey="${esc(m.key)}" ${on ? 'checked' : ''} ${cityLocked ? 'disabled title="城市账号不可被授予该模块"' : ''} onchange="roleModuleToggle(this)"></td>`
  }
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>角色默认权限</h2><span class="muted">勾选 = 该角色默认可见/可办；变更后该角色全部有效账号旧会话失效，重新登录生效 · 城市不可授予的模块已禁用</span></div>
    ${tabBar('rolematrix')}
    <p class="td-sub">超级管理员恒为全部模块，不在矩阵内。账号可在「账号」页逐个「权限」三态调整（继承 / 额外授予 / 额外收回）。</p>
    ${groups.map((g) => `<div style="margin:12px 0"><b>${esc(g)}</b><table><thead><tr><th>模块</th>${d.roles.map((r) => `<th>${ACCOUNT_ROLE_CN[r] || esc(r)}</th>`).join('')}</tr></thead><tbody>
      ${d.modules.filter((m) => m.group === g).map((m) => `<tr><td>${esc(m.name)} <code class="td-sub">${esc(m.key)}</code></td>${d.roles.map((r) => cell(m, r)).join('')}</tr>`).join('')}
    </tbody></table></div>`).join('')}
  </div>`
}
window.roleModuleToggle = (cb) => {
  const { role, modkey } = cb.dataset
  const on = cb.checked
  const label = cb.closest('tr')?.querySelector('td')?.textContent.trim() || modkey
  cb.checked = !on // 确认后再落真实状态
  modal((on ? '授予' : '收回') + '角色默认模块 · ' + label, `
    <p>${on ? '该角色所有账号将<b>新增</b>此模块的默认可见/可办。' : '该角色所有账号将<b>失去</b>此模块（未单独授予者）；已有旧会话立即失效。'}</p>
    <div class="field"><label>变更原因 *（4–200 字，进入审计）</label><input id="rmReason" maxlength="200"></div>
    <div id="rmErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="roleModuleSubmit('${role}','${esc(modkey)}',${on ? 1 : 0})">确认${on ? '授予' : '收回'}</button>`)
}
window.roleModuleSubmit = async (role, moduleKey, on) => {
  const reason = ($('#rmReason').value || '').trim()
  if (reason.length < 4 || reason.length > 200) { $('#rmErr').textContent = '请填写 4–200 字变更原因'; return }
  try {
    const r = await api('POST', '/admin/role-modules', { role, moduleKey, on: !!on, reason })
    closeModal(); toast(r.note || '角色默认已更新'); roleMatrixTab()
  } catch (e) { $('#rmErr').textContent = e.message }
}
function tabBar(active) {
  return `<div class="cfg-tabs" style="margin-bottom:12px">
    <button class="cfg-tab ${active === 'list' ? 'on' : ''}" onclick="window.__accTab='list';accounts()">账号</button>
    <button class="cfg-tab ${active === 'rolematrix' ? 'on' : ''}" onclick="window.__accTab='rolematrix';accounts()">角色默认权限</button></div>`
}

async function accountsList() {
  const rows = await api('GET', '/admin/accounts')
  const active = rows.filter((r) => Number(r.status) === 1)
  const cityAccounts = rows.filter((r) => r.role === 'city_partner')
  const MFA_CH_CN = { totp: '验证器 App', sms: '短信', email: '邮箱' }
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:var(--brand-soft)">🧑‍💼</div><div><div class="l">有效账号</div><div class="v">${active.length}/${rows.length}</div><div class="s">停用后旧会话立即失效</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">🏙</div><div><div class="l">城市合伙人账号</div><div class="v">${cityAccounts.length}</div><div class="s">必绑城市 · 只看本城</div></div></div>
    <div class="kpi go" ${dxKey} title="去安全中心管理全局策略" onclick="go('security')"><i class="go-arrow">↗</i><div class="ico" style="background:#e3f6ec">🔐</div><div><div class="l">MFA 已绑定</div><div class="v">${rows.filter((r) => Number(r.mfa_enabled) === 1).length}</div><div class="s">本页「验证方式」即可绑定；全局策略在安全中心</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>后台账号</h2><span class="muted">创建 / 资料 / 角色 / 城市 / 权限 / 验证方式（MFA）/ 停用恢复 / 重置密码 · 全部操作留审计</span></div>
    ${tabBar('list')}
    <div class="row"><button class="btn primary sm" onclick="accountCreateModal()">＋ 新建账号</button>
      <span class="muted">初始密码只显示一次；不得在列表或聊天中长期展示明文密码</span></div>
    ${rows.length ? `<table><thead><tr><th>账号</th><th>角色</th><th>城市范围</th><th>MFA</th><th>启用</th><th>最近登录</th><th>备注</th><th>操作</th></tr></thead><tbody>
    ${rows.map((u) => {
      const self = Number(u.id) === Number(ME?.uid)
      const lastSuper = u.role === 'super' && rows.filter((r) => r.role === 'super' && Number(r.status) === 1).length <= 1
      const ops = []
      ops.push(`<button class="btn ghost sm" onclick="accountMfaDialog(${u.id}, '${esc(u.username)}')">验证方式</button>`)
      if (u.role !== 'super') ops.push(`<button class="btn ghost sm" onclick="accountPermModal(${u.id}, '${esc(u.username)}')">权限</button>`)
      ops.push(`<button class="btn ghost sm" onclick="accountProfileModal(${u.id}, '${esc(u.display_name)}', '${esc(u.note || '')}')">资料</button>`)
      if (!self) {
        ops.push(`<button class="btn ghost sm" onclick="accountRoleModal(${u.id}, '${esc(u.username)}', '${u.role}', '${esc(u.scope_city || '')}')">角色/城市</button>`)
        ops.push(`<button class="btn ghost sm" onclick="accountResetPwd(${u.id}, '${esc(u.username)}')">重置密码</button>`)
        if (Number(u.mfa_enabled) === 1) ops.push(`<button class="btn ghost sm" onclick="accountMfaReset(${u.id}, '${esc(u.username)}')">重置MFA</button>`)
        // 内置 admin 或最后一个有效超管：停用入口置灰并给原因，不是「看着能点实际不能点」
        if (u.username === 'admin' || lastSuper) ops.push('<span class="td-sub" title="内置管理员或最后一个有效超管，不能停用">停用🔒</span>')
        else ops.push(Number(u.status) === 1
          ? `<button class="btn danger sm" onclick="accountToggle(${u.id}, 0, '${esc(u.username)}')">停用</button>`
          : `<button class="btn primary sm" onclick="accountToggle(${u.id}, 1, '${esc(u.username)}')">恢复</button>`)
      } else ops.push('<span class="td-sub">本人</span>')
      const mfaCell = Number(u.mfa_enabled) === 1
        ? '<span class="pill ok">已绑定</span><div class="td-sub">' + (MFA_CH_CN[u.mfa_channel] || esc(u.mfa_channel || '')) + '</div>'
        : '<span class="td-sub">未绑定</span>'
      const flagCell = (Number(u.mfa_force) === 1 ? ' <span class="pill s70">单账号强制</span>' : '') + (Number(u.mfa_exempt) === 1 ? ' <span class="pill s40">豁免</span>' : '')
      return `<tr><td><div class="td-main">${esc(u.display_name)}${self ? ' <span class="pill ok">本人</span>' : ''}${u.role === 'super' ? ' <span class="pill warn">超管</span>' : ''}</div><div class="td-sub">${esc(u.username)} · #${u.id}</div></td>
        <td><span class="pill ${u.role === 'super' ? 'warn' : 's60'}">${ACCOUNT_ROLE_CN[u.role] || esc(u.role)}</span>${Number(u.must_change_pwd) === 1 ? '<div><span class="pill warn">待改密</span></div>' : ''}</td>
        <td>${u.role === 'city_partner' ? esc(cityLabelAccounts(u.scope_city)) + ' <span class="td-sub">' + esc(u.scope_city || '') + '</span>' : '<span class="td-sub">全域</span>'}</td>
        <td>${mfaCell}${flagCell}</td>
        <td><span class="pill ${Number(u.status) === 1 ? 'ok' : 'off'}">${Number(u.status) === 1 ? '有效' : '停用'}</span></td>
        <td class="td-sub">${esc(String(u.last_login_at || '').slice(0, 16).replace('T', ' ') || '从未登录')}</td>
        <td class="td-sub" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.note || '—')}</td>
        <td><div class="td-actions">${ops.join('')}</div></td></tr>` }).join('')}</tbody></table>`
    : emptyBox('暂无账号')}</div>`
}

// C-01：验证方式弹窗——不离开本页完成绑定 TOTP / 绑手机 / 绑邮箱 / 重置 / 停用，以及豁免与单账号强制；
// 复用安全中心的三通道组件（mfaSetup / bindContact / mfaDisable / mfaChannelPanel），不复制逻辑
window.accountMfaDialog = async (id, username) => {
  const rows = await api('GET', '/admin/accounts')
  const u = rows.find((r) => Number(r.id) === Number(id))
  if (!u) return toast('账号不存在', true)
  const chn = await api('GET', '/admin/security/channels')
  window.__mfaAfter = accounts // 绑定/停用完成后回到账号页（system.js 的组件读这个变量）
  const chCn = { totp: '验证器 App', sms: '短信验证码', email: '邮箱验证码' }
  modal('验证方式 · ' + username, `
    <p>当前状态：<b>${Number(u.mfa_enabled) === 1 ? '已绑定 · ' + (chCn[u.mfa_channel] || esc(u.mfa_channel)) : '未绑定'}</b>
      ${Number(u.mfa_force) === 1 ? ' <span class="pill s70">单账号强制</span>' : ''}${Number(u.mfa_exempt) === 1 ? ' <span class="pill s40">豁免</span>' : ''}</p>
    <div class="row" style="margin:10px 0">
      <button class="btn primary sm" onclick="mfaSetup(${id}, '${esc(username)}')">绑定验证器 App（推荐）</button>
      <button class="btn ghost sm" onclick="bindContact(${id}, 'sms')">绑定手机</button>
      <button class="btn ghost sm" onclick="bindContact(${id}, 'email')">绑定邮箱</button>
      ${Number(u.mfa_enabled) === 1 ? `<button class="btn danger sm" onclick="accountMfaReset(${id}, '${esc(username)}')">重置 MFA</button>` : ''}
    </div>
    ${mfaChannelPanel(chn)}
    <div class="rv-box" style="margin-top:12px"><div class="rv-h">策略调整（单账号）</div>
      <p class="td-sub">优先级：单账号强制 &gt; 豁免 &gt; 全局策略。调整后该账号旧会话立即失效，需重新登录。</p>
      <div class="row" style="margin:6px 0">
        <button class="btn ghost sm" onclick="accountMfaFlags(${id}, { force: ${Number(u.mfa_force) === 1 ? 0 : 1} })">${Number(u.mfa_force) === 1 ? '取消单账号强制' : '设为单账号强制'}</button>
        <button class="btn ghost sm" onclick="accountMfaFlags(${id}, { exempt: ${Number(u.mfa_exempt) === 1 ? 0 : 1} })">${Number(u.mfa_exempt) === 1 ? '取消豁免' : '设为豁免'}</button>
      </div>
      <p class="td-sub">需要 MFA 但未绑定的账号登录时进入绑定引导（受限临时凭证，不能办理业务）；全局三档在安全中心调整（敏感参数，需第二人复核）。</p>
    </div>`,
    `<button class="btn ghost" onclick="closeModal()">关闭</button>`)
}
// C-03：豁免 / 单账号强制（写审计、旧会话失效）；完成后刷新账号页
window.accountMfaFlags = async (id, patch) => {
  try {
    const r = await api('POST', `/admin/accounts/${id}/mfa-flags`, patch)
    toast(r.note || '已调整')
    closeModal(); accounts()
  } catch (e) { toast(e.message, true) }
}

// ===== C-05：账号权限三态弹窗（继承 / 额外授予 / 额外收回）=====
window.accountPermModal = async (id, username) => {
  const d = await api('GET', `/admin/accounts/${id}/modules`)
  const eff = new Set(d.effective)
  const stateOf = (k) => {
    const g = d.grants.find((x) => x.module_key === k)
    return g ? g.effect : 'inherit'
  }
  const groups = [...new Set(d.modules.map((m) => m.group))]
  const sel = (k, m) => {
    const cur = stateOf(k)
    const isCityDeny = d.role === 'city_partner' && d.cityDeny.includes(k)
    const has = eff.has(k)
    return `<tr><td style="width:46%">${esc(m.name)} <code class="td-sub">${esc(k)}</code>${isCityDeny ? ' <span class="pill off">城市不可授予</span>' : ''}</td>
      <td>${has ? '<span class="pill ok">有效</span>' : '<span class="pill off">无</span>'}</td>
      <td><select class="inp" data-modkey="${esc(k)}" data-orig="${cur}" style="width:120px" ${isCityDeny ? 'title="城市账号不可被授予该模块"' : ''}>
        <option value="inherit" ${cur === 'inherit' ? 'selected' : ''}>继承角色</option>
        <option value="allow" ${cur === 'allow' ? 'selected' : ''} ${isCityDeny ? 'disabled' : ''}>额外授予</option>
        <option value="deny" ${cur === 'deny' ? 'selected' : ''}>额外收回</option>
      </select></td></tr>`
  }
  modal('模块权限 · ' + username + ` <span class="td-sub">（角色：${ACCOUNT_ROLE_CN[d.role] || esc(d.role)}）</span>`, `
    <p class="td-sub">有效模块 = 角色默认 ∪ 额外授予 − 额外收回。保存后该账号旧会话立即失效，重新登录按新集合显示；城市账号不可被授予系统级/资金敏感模块；资金动作、双人复核、城市行级隔离等细粒度约束不受模块授权影响。</p>
    <details open><summary class="nav-group">按分组设置</summary>
    ${groups.map((g) => `<div style="margin:10px 0"><b>${esc(g)}</b><table>${d.modules.filter((m) => m.group === g).map((m) => sel(m.key, m)).join('')}</table></div>`).join('')}
    </details>
    <div class="field" style="margin-top:10px"><label>授权/收回原因 *（4–200 字，进入审计）</label><input id="apReason" maxlength="200" placeholder="例如：临时协助风控核查"></div>
    <div id="apErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="accountPermSubmit(${id}, '${esc(username)}')">保存权限</button>`)
}
window.accountPermSubmit = async (id, username) => {
  const reason = ($('#apReason').value || '').trim()
  if (reason.length < 4 || reason.length > 200) { $('#apErr').textContent = '请填写 4–200 字授权原因'; return }
  const grants = []
  document.querySelectorAll('select[data-modkey]').forEach((s) => {
    if (s.value !== 'inherit') grants.push({ moduleKey: s.dataset.modkey, effect: s.value })
    else if (s.dataset.orig && s.dataset.orig !== 'inherit') grants.push({ moduleKey: s.dataset.modkey, effect: null })
  })
  void username
  if (!grants.length) { $('#apErr').textContent = '没有需要保存的调整（全部为继承）'; return }
  try {
    const r = await api('POST', `/admin/accounts/${id}/modules`, { grants, reason })
    closeModal(); toast(r.note || '权限已保存'); accounts()
  } catch (e) { $('#apErr').textContent = e.message }
}

window.accountCreateModal = () => {
  modal('新建后台账号', `
    <div class="field"><label>登录名 *（3–32 位字母数字_-，唯一）</label><input id="acUser" maxlength="32"></div>
    <div class="field"><label>显示名 *（列表与审计里显示的名字）</label><input id="acDisplay" maxlength="64"></div>
    <div class="field"><label>角色 *</label><select id="acRole" onchange="document.getElementById('acCityRow').style.display=this.value==='city_partner'?'block':'none'">
      ${Object.entries(ACCOUNT_ROLE_CN).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="field" id="acCityRow" style="display:none"><label>城市范围 *（城市合伙人必填）</label><select id="acCity">${CITY_DICT_ACCOUNTS.map(([c, n]) => `<option value="${c}">${esc(n)}（${c}）</option>`).join('')}</select></div>
    <div class="field"><label>初始密码 *（8–64 位，只显示一次）</label><div class="row"><input id="acPwd" style="flex:1"><button class="btn ghost sm" onclick="document.getElementById('acPwd').value=genTmpPwd()">随机生成</button></div></div>
    <div class="field"><label>备注 / 所属责任人</label><input id="acNote" maxlength="200"></div>
    <div id="acErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="accountCreateSubmit()">创建账号</button>`)
  document.getElementById('acPwd').value = genTmpPwd()
}
const genTmpPwd = () => { const cs = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => cs[b % cs.length]).join('') }
window.accountCreateSubmit = async () => {
  try {
    await api('POST', '/admin/accounts', { username: $('#acUser').value.trim(), displayName: $('#acDisplay').value.trim(), role: $('#acRole').value,
      scopeCity: $('#acCity')?.value, password: $('#acPwd').value, note: $('#acNote').value.trim() })
    closeModal(); toast('账号已创建；初始密码请在交付后勿再展示'); accounts()
  } catch (e) { $('#acErr').textContent = e.message }
}

window.accountProfileModal = (id, displayName, note) => {
  modal('账号展示资料 · #' + id, `
    <div class="field"><label>显示名 *</label><input id="acPDisplay" value="${displayName}" maxlength="64"></div>
    <div class="field"><label>备注 / 所属责任人</label><input id="acPNote" value="${note}" maxlength="200"></div>
    <div id="acPErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="accountProfileSubmit(${id})">保存</button>`)
}
window.accountProfileSubmit = async (id) => {
  try { await api('PUT', '/admin/accounts/' + id, { displayName: $('#acPDisplay').value.trim(), note: $('#acPNote').value.trim() }); closeModal(); toast('资料已保存'); accounts() }
  catch (e) { $('#acPErr').textContent = e.message }
}

window.accountRoleModal = (id, username, role, city) => {
  modal('角色 / 城市授权 · ' + username, `
    <p class="td-sub">变更影响：该账号已登录的全部会话<b>立即失效</b>，需重新登录；城市账号的可见数据范围随之变化。变更原因进入审计。</p>
    <div class="field"><label>角色 *</label><select id="acRRole">${Object.entries(ACCOUNT_ROLE_CN).map(([k, v]) => `<option value="${k}" ${k === role ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>城市范围（城市合伙人必填，其他角色清空）</label><select id="acRCity">${CITY_DICT_ACCOUNTS.map(([c, n]) => `<option value="${c}" ${String(c) === String(city) ? 'selected' : ''}>${esc(n)}（${c}）</option>`).join('')}</select></div>
    <div class="field"><label>变更原因 *（4–200 字，进入审计）</label><input id="acRReason" maxlength="200"></div>
    <div id="acRErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="accountRoleSubmit(${id})">确认变更</button>`)
}
window.accountRoleSubmit = async (id) => {
  try {
    const r = await api('POST', '/admin/accounts/' + id + '/role', { role: $('#acRRole').value, scopeCity: $('#acRCity').value, reason: $('#acRReason').value.trim() })
    closeModal(); toast('角色/城市已变更' + (r.sessionsRevoked ? '；该账号旧会话已全部失效' : '')); accounts()
  } catch (e) { $('#acRErr').textContent = e.message }
}

window.accountToggle = async (id, status, username) => {
  if (status === 1) {
    try { await api('POST', '/admin/accounts/' + id + '/status', { status: 1 }); toast('已恢复；需本人重新登录'); accounts() } catch (e) { toast(e.message, true) }
    return
  }
  // 停用必须填原因（不使用原生 prompt：部分环境不支持，且模态框可校验字数）
  modal('停用账号 · ' + username, `
    <p class="td-sub">停用后该账号全部已登录会话<b>立即失效</b>，恢复后也需重新登录。原因进入审计。</p>
    <div class="field"><label>停用原因 *（4–200 字）</label><input id="acDisReason" maxlength="200"></div>
    <div id="acDisErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn danger" onclick="accountDisableSubmit(${id})">确认停用</button>`)
}
window.accountDisableSubmit = async (id) => {
  const reason = ($('#acDisReason').value || '').trim()
  if (reason.length < 4 || reason.length > 200) { $('#acDisErr').textContent = '请填写 4–200 字停用原因'; return }
  try { await api('POST', '/admin/accounts/' + id + '/status', { status: 0, reason }); closeModal(); toast('已停用；旧会话已失效'); accounts() }
  catch (e) { $('#acDisErr').textContent = e.message }
}

window.accountResetPwd = (id, username) => {
  modal('重置密码 · ' + username, `
    <p class="td-sub">重置后生成一次性临时密码（仅显示一次），该账号全部会话立即失效，本人下次登录必须改密。审计不记录密码。</p>
    <div id="acRsErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="accountResetPwdSubmit(${id}, '${esc(username)}')">确认重置</button>`)
}
window.accountResetPwdSubmit = async (id, username) => {
  try {
    const r = await api('POST', '/admin/accounts/' + id + '/password-reset')
    modal('一次性临时密码 · ' + username, `
      <div class="field"><label>临时密码（关闭本窗口后不再显示，审计不记录密码）</label><input readonly value="${esc(r.tempPassword)}" style="font-size:18px;font-weight:700;letter-spacing:1px"></div>
      <p class="td-sub">${esc(r.note)}</p>`,
      `<button class="btn primary" onclick="closeModal()">我已安全保存</button>`)
  } catch (e) { $('#acRsErr').textContent = e.message }
}

window.accountMfaReset = (id, username) => {
  modal('重置 MFA · ' + username, `
    <p class="td-sub">重置后 MFA 绑定清除、该账号全部会话立即失效；操作留审计。本人可在安全中心重新绑定。</p>
    <div id="acMfErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn danger" onclick="accountMfaResetSubmit(${id})">确认重置</button>`)
}
window.accountMfaResetSubmit = async (id) => {
  try { await api('POST', '/admin/accounts/' + id + '/mfa-reset'); closeModal(); toast('MFA 已重置'); accounts() } catch (e) { $('#acMfErr').textContent = e.message }
}

// 城市合伙人中心直达：合伙人页城市行 → 直接打开该账号的角色/城市编辑（不混进合作资料）
window.accountFromPartner = async (adminUserId) => {
  const rows = await api('GET', '/admin/accounts')
  const u = rows.find((x) => Number(x.id) === Number(adminUserId))
  if (!u) return toast('未找到对应后台账号', true)
  accountRoleModal(u.id, u.username, u.role, u.scope_city || '')
}

// 本人强制改密（重置后的临时密码登录时弹出，改完用新密码重新登录）
window.showForcedPwdChange = () => {
  modal('请修改临时密码', `
    <p class="td-sub">当前密码是管理员下发的一次性临时密码。修改成功后需用新密码重新登录。</p>
    <div class="field"><label>当前密码（临时密码）</label><input id="fpOld" type="password"></div>
    <div class="field"><label>新密码（8–64 位）</label><input id="fpNew" type="password"></div>
    <div class="field"><label>确认新密码</label><input id="fpNew2" type="password"></div>
    <div id="fpErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="logout()">返回登录</button><button class="btn primary" onclick="submitForcedPwd()">修改并重新登录</button>`)
}
window.submitForcedPwd = async () => {
  const n1 = $('#fpNew').value, n2 = $('#fpNew2').value
  if (n1 !== n2) { $('#fpErr').textContent = '两次输入的新密码不一致'; return }
  try {
    await api('POST', '/admin/account/password', { oldPassword: $('#fpOld').value, newPassword: n1 })
    toast('密码已修改，请用新密码重新登录'); logout()
  } catch (e) { $('#fpErr').textContent = e.message }
}
