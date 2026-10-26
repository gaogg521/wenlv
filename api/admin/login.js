// 仅负责登录表单交互；认证和 MFA 沿用 app.js。
(() => {
  const form = document.getElementById('step1')
  const submit = document.getElementById('loginSubmit')
  const password = document.getElementById('lpass')
  const toggle = document.getElementById('passwordToggle')
  const reset = () => { submit.disabled = false; submit.firstElementChild.textContent = '登录工作台'; form.removeAttribute('aria-busy') }
  form.addEventListener('submit', event => {
    event.preventDefault()
    if (submit.disabled || !form.reportValidity()) return
    if (!document.getElementById('luser').value.trim()) {
      document.getElementById('lerr').textContent = '请输入运营账号'
      document.getElementById('luser').focus()
      return
    }
    submit.disabled = true
    submit.firstElementChild.textContent = '正在登录…'
    form.setAttribute('aria-busy', 'true')
    login()
  })
  new MutationObserver(() => {
    if (submit.disabled && (document.getElementById('lerr').textContent || form.style.display === 'none' || document.getElementById('login').style.display === 'none')) reset()
  }).observe(document.getElementById('login'), { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] })
  form.addEventListener('input', () => { document.getElementById('lerr').textContent = '' })
  toggle.addEventListener('click', () => {
    const show = password.type === 'password'
    password.type = show ? 'text' : 'password'
    toggle.textContent = show ? '隐藏' : '显示'
    toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码')
    toggle.setAttribute('aria-pressed', String(show))
  })
  document.getElementById('loginHelp').addEventListener('click', () => {
    const help = document.getElementById('loginHelpText')
    help.hidden = !help.hidden
    document.getElementById('loginHelp').setAttribute('aria-expanded', String(!help.hidden))
  })
  document.getElementById('step2').addEventListener('submit', async event => {
    event.preventDefault()
    const button = event.currentTarget.querySelector('[type="submit"]')
    if (button.disabled) return
    button.disabled = true
    try { await mfaSubmit() } finally { button.disabled = false }
  })
  // 演示快捷填充只在本机入口展示，公开入口不暴露默认凭据。
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) document.getElementById('demoAccounts').hidden = false
})()
