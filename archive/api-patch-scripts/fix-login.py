# -*- coding: utf-8 -*-
import io

# 1) index.html：一键填充 + hint 更新
h = io.open('admin/index.html', encoding='utf-8').read()
h = h.replace('<button class="btn primary block" onclick="login()">登 录</button>',
'''<div class="quick-accounts">
        <span class="muted" style="font-size:12px">演示账号一键填充：</span>
        <button type="button" class="qa" onclick="fill('admin','admin123')">admin 超管</button>
        <button type="button" class="qa" onclick="fill('finance','admin123')">finance 财务</button>
        <button type="button" class="qa" onclick="fill('city310118','city123')">city310118 城市合伙人</button>
      </div>
      <button class="btn primary block" onclick="login()">登 录</button>''')
h = h.replace('<p class="hint">内置：admin · finance · ops</p>',
              '<p class="hint">密码默认 admin123（city310118 为 city123）· 输入自动去空格并转半角</p>')
io.open('admin/index.html', 'w', encoding='utf-8', newline='\n').write(h)

# 2) CSS
c = io.open('admin/app.css', encoding='utf-8').read()
if '.quick-accounts' not in c:
    c += '''
.quick-accounts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 16px; }
.qa { font-size: 12px; padding: 4px 12px; border-radius: 999px; background: var(--brand-soft); color: var(--brand-deep); border: 1px solid #cfe8e4; }
.qa:hover { background: var(--brand); color: #fff; }
'''
io.open('admin/app.css', 'w', encoding='utf-8', newline='\n').write(c)

# 3) app.js：fill / norm / 过期清理
j = io.open('admin/app.js', encoding='utf-8').read()
if 'window.fill' not in j:
    j = j.replace('function login() {',
'''window.fill = (u, p) => { document.querySelector('#luser').value = u; document.querySelector('#lpass').value = p; document.querySelector('#lerr').textContent = '' }
// 全角→半角 + 去空格（中文输入法防手滑）
const norm = (s) => String(s ?? '').replace(/[\\uFF01-\\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\\u3000/g, ' ').trim()

function login() {''')
j = j.replace("api('POST', '/admin/login', { username: $('#luser').value.trim(), password: $('#lpass').value })",
              "api('POST', '/admin/login', { username: norm($('#luser').value), password: norm($('#lpass').value) })")
old_api = "  const j = await r.json()\n  if (j.code !== 0) throw new Error(j.msg || j.data?.message || '请求失败')\n  return j.data\n}"
new_api = "  const j = await r.json()\n  if (j.code === 1002 && TOKEN) { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_me'); location.reload(); throw new Error('登录已过期，请重新登录') }\n  if (j.code !== 0) throw new Error(j.msg || j.data?.message || '请求失败')\n  return j.data\n}"
assert old_api in j
j = j.replace(old_api, new_api, 1)
io.open('admin/app.js', 'w', encoding='utf-8', newline='\n').write(j)
print('login UX hardened')
