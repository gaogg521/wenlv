# -*- coding: utf-8 -*-
import io

# ============ app.js：两步登录流程 + 安全中心页 ============
j = io.open('admin/app.js', encoding='utf-8').read()

# 1) login() 改造：支持 mfaRequired → step2
old_login_fn = """function login() {
  $('#lerr').textContent = ''
  api('POST', '/admin/login', { username: norm(document.querySelector('#luser').value), password: norm(document.querySelector('#lpass').value) }).then((d) => {
    TOKEN = d.token; ME = d.user
    localStorage.setItem('admin_token', TOKEN); localStorage.setItem('admin_me', JSON.stringify(ME))
    boot()
  }).catch((e) => { $('#lerr').textContent = e.message })
}"""
new_login_fn = """let MFA_CHALLENGE = null
function login() {
  $('#lerr').textContent = ''
  api('POST', '/admin/login', { username: norm(document.querySelector('#luser').value), password: norm(document.querySelector('#lpass').value) }).then((d) => {
    if (d.mfaRequired) {
      MFA_CHALLENGE = d.challenge
      const chName = { totp: '验证器 App 动态码', sms: '短信验证码', email: '邮箱验证码' }[d.channel] || '验证码'
      $('#mfaTip').textContent = (d.target ? '已发送至 ' + d.target + '（' : ('请输入' + chName + (d.channel === 'totp' ? '' : '（MOCK 通道码在后台安全中心可见'))) + (d.target ? '）' : '')
      $('#step1').style.display = 'none'
      $('#step2').style.display = 'block'
      document.querySelector('#mfacode')?.focus()
      return
    }
    TOKEN = d.token; ME = d.user
    localStorage.setItem('admin_token', TOKEN); localStorage.setItem('admin_me', JSON.stringify(ME))
    boot()
  }).catch((e) => { $('#lerr').textContent = e.message })
}
async function mfaSubmit() {
  $('#lerr2').textContent = ''
  try {
    const d = await api('POST', '/admin/login/mfa', { challenge: MFA_CHALLENGE, code: norm(document.querySelector('#mfacode').value) })
    TOKEN = d.token; ME = d.user
    localStorage.setItem('admin_token', TOKEN); localStorage.setItem('admin_me', JSON.stringify(ME))
    MFA_CHALLENGE = null
    boot()
  } catch (e) { $('#lerr2').textContent = e.message }
}
async function mfaResend() {
  try { await api('POST', '/admin/login/mfa', { challenge: MFA_CHALLENGE, resend: true }); toast('验证码已重新发送') } catch (e) { toast(e.message, true) }
}
function backToStep1() { $('#step2').style.display = 'none'; $('#step1').style.display = 'block'; MFA_CHALLENGE = null }"""
assert old_login_fn in j, 'login fn not found'
j = j.replace(old_login_fn, new_login_fn)

# 2) nav：系统组加 安全中心
j = j.replace("  ['系统', [['system', '运维控制台', 'sys'], ['features', '功能开关', 'flag']]],",
              "  ['系统', [['system', '运维控制台', 'sys'], ['features', '功能开关', 'flag'], ['security', '安全中心', 'risk']]],")
j = j.replace("system: '运维控制台', features: '功能开关', content: '内容审核', withdrawals: '提现审批', agreements: '协议变更', attest: '存证中心' }[page]",
              "system: '运维控制台', features: '功能开关', content: '内容审核', withdrawals: '提现审批', agreements: '协议变更', attest: '存证中心', security: '安全中心' }[page]")
j = j.replace("agreements, attest }[page] || dash)()", "agreements, attest, security }[page] || dash)()")

# 3) 安全中心页（插到 boot() 前）
sec_page = '''/* ============ 安全中心（MFA / 通知通道）============ */
async function security() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const accounts = await api('GET', '/admin/security/accounts')
  const codes = await api('GET', '/admin/security/recent-codes')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>安全中心 · MFA</h2><span class="muted">TOTP / 短信 / 邮箱三通道 · 全局策略走参数中心 admin.mfa.mode（off/optional/required）</span></div>
    <table><thead><tr><th>账号</th><th>角色</th><th>MFA</th><th>通道</th><th>手机/邮箱</th><th>最近登录</th><th>操作</th></tr></thead><tbody>
    ${accounts.map((a2) => `<tr><td class="td-main">${esc(a2.display_name || a2.username)}<div class="td-sub">${esc(a2.username)}</div></td>
      <td>${esc(a2.role)}</td>
      <td>${Number(a2.mfa_enabled) ? '<span class="pill ok">已启用</span>' : '<span class="pill off">未启用</span>'}</td>
      <td>${Number(a2.mfa_enabled) ? esc(a2.mfa_channel) : '—'}</td>
      <td class="td-sub">${esc(a2.mobile || a2.email || '—')}</td>
      <td class="td-sub">${esc(String(a2.last_login_at || '').slice(5, 16))}</td>
      <td><button class="btn ghost sm" onclick="mfaSetup(${a2.id}, '${esc(a2.username)}')">开 TOTP</button>
          <button class="btn ghost sm" onclick="bindContact(${a2.id}, 'sms')">绑手机</button>
          <button class="btn ghost sm" onclick="bindContact(${a2.id}, 'email')">绑邮箱</button>
          ${Number(a2.mfa_enabled) ? `<button class="btn danger sm" onclick="mfaDisable(${a2.id})">停用</button>` : ''}</td></tr>`).join('')}
    </tbody></table>
  </div>
  <div class="card">
    <div class="card-head"><h3>最近验证码（MOCK 通道演示用）</h3><span class="muted">真实短信/邮箱凭据接入后此表为空，仅日志留痕</span></div>
    ${codes.length ? `<table><thead><tr><th>目标</th><th>通道</th><th>验证码</th><th>用途</th><th>状态</th><th>时间</th></tr></thead><tbody>
    ${codes.map((c3) => `<tr><td>${esc(c3.target)}</td><td>${esc(c3.channel)}</td><td><code>${esc(c3.code)}</code></td><td class="td-sub">${esc(c3.purpose)}</td>
      <td>${c3.used_at ? '<span class="pill off">已用</span>' : (new Date(c3.expires_at) > new Date() ? '<span class="pill ok">有效</span>' : '<span class="pill s70">过期</span>')}</td>
      <td class="td-sub">${esc(String(c3.created_at).slice(5, 19))}</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无验证码记录')}
  </div>`
}
async function mfaSetup(userId, username) {
  const r = await api('POST', '/admin/security/mfa/setup', { userId })
  modal('开启 TOTP · ' + username, `
    <p>在验证器 App（Microsoft/Google Authenticator 等）中添加账户：</p>
    <div class="row" style="margin:14px 0"><input id="mfa_secret_show" readonly value="${esc(r.secret)}" style="width:100%"></div>
    <p class="muted" style="word-break:break-all">otpauth URI：<code>${esc(r.uri)}</code></p>
    <div class="card" style="background:#f0faf7;margin-top:14px">
      <p><b>演示直通码：${r.current}</b>（30 秒轮换，免装 App 即可体验两步登录）</p>
    </div>`,
    `<button class="btn primary" onclick="closeModal();toast('TOTP 已绑定，该账号下次登录需两步验证')">我已录入了</button>`)
}
async function bindContact(userId, channel) {
  const target = prompt(channel === 'sms' ? '输入手机号（MOCK 通道，验证码在安全中心可见）：' : '输入邮箱：')
  if (!target) return
  try { const r = await api('POST', '/admin/security/bind-contact', { userId, channel, target }); toast('已绑定并发送测试验证码' + (r.mock ? '（MOCK）' : '')); security() } catch (e) { toast(e.message, true) }
}
async function mfaDisable(userId) {
  if (!confirm('确认停用该账号 MFA？')) return
  try { await api('POST', '/admin/security/mfa/disable', { userId }); security() } catch (e) { toast(e.message, true) }
}

'''
assert "\nboot()" in j
j = j.replace("\nboot()", "\n" + sec_page + "boot()", 1)
io.open('admin/app.js', 'w', encoding='utf-8', newline='\n').write(j)
print('mfa ui + security page done')
