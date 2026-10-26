// 向往的自由 · 运营后台 SPA（零依赖，设计系统见 app.css）
const $ = (s) => document.querySelector(s)
let TOKEN = localStorage.getItem('admin_token') || ''
let ME = JSON.parse(localStorage.getItem('admin_me') || 'null')

const ICONS = {
  sys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V4c4-2 8 2 12 0v9c-4 2-8-2-12 0"/></svg>',
  content: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16v14H4zM8 9h8M8 13h5"/></svg>',
  eco: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3c3 3.5 3 14.5 0 18M3.5 9h17M3.5 15h17"/></svg>',
  withdraw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5h.01M18 14.5h.01"/></svg>',
  sys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V4c4-2 8 2 12 0v9c-4 2-8-2-12 0"/></svg>',
  content: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16v14H4zM8 9h8M8 13h5"/></svg>',
  eco: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3c3 3.5 3 14.5 0 18M3.5 9h17M3.5 15h17"/></svg>',
  withdraw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5h.01M18 14.5h.01"/></svg>',
  dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-4H4z"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/></svg>',
  products: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 2 12h3v8h6v-6h2v6h6v-8h3z"/></svg>',
  merchants: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h16l-1.5 11h-13zM8 9V6a4 4 0 0 1 8 0v3"/></svg>',
  settlements: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16M4 4v16M8 16v-5M12 16V8M16 16v-3M20 16V6"/></svg>',
  budgets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10c.5-1 4.5-1 4.5 1s-4.5 1-4.5 3 4.5 2 5 1"/></svg>',
  promoters: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6M16 4a3.5 3.5 0 0 1 0 7M17.5 14c2.5.6 3.7 2.5 4 6"/></svg>',
  config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3 1 2-3.5-2-1.5c.06-.4.1-.8.1-1.2z"/></svg>',
  risk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 3 20h18zM12 10v4M12 17.5v.5"/></svg>',
  audit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3"/></svg>',
}
const NAV = [
  ['经营', [['dash', '驾驶舱', 'dash']]],
  ['交易', [['orders', '订单', 'orders'], ['products', '商品与团期', 'products'], ['settlements', '结算', 'settlements']]],
  ['生态', [['merchants', '商户与进件', 'merchants'], ['content', '内容审核', 'content'], ['faqs', '常见问题', 'audit'], ['banners', '轮播管理', 'flag'], ['promoters', '推广服务商', 'promoters'], ['withdrawals', '提现审批', 'withdraw'], ['agreements', '协议变更', 'eco'], ['budgets', '旅豆预算', 'budgets']]],
  ['治理', [['config', '参数中心', 'config'], ['attest', '存证中心', 'eco'], ['risk', '风控', 'risk'], ['audit', '审计日志', 'audit'], ['phrases', '暗号管理', 'flag'], ['rateov', '逐品佣金', 'promoters'], ['kyc', '实名认证', 'audit'], ['cocreate', '共创分润', 'eco']]],
  ['系统', [['system', '运维控制台', 'sys'], ['features', '功能开关', 'flag'], ['security', '安全中心', 'risk'], ['integrations', '集成中心', 'withdraw']]],
  ['WEB3', [['web3dash', '链上总览', 'eco'], ['pointassets', '积分资产发行', 'budgets'], ['badges', '勋章资产发行', 'flag'], ['wallets', '用户数字钱包', 'orders'], ['contract', '合约调用账户', 'sys'], ['terms', '术语映射', 'flag']]],
]

async function api(method, path, body) {
  const r = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json()
  if (j.code === 1002 && TOKEN) { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_me'); location.reload(); throw new Error('登录已过期，请重新登录') }
  if (j.code !== 0) throw new Error(j.msg || j.data?.message || '请求失败')
  return j.data
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fen = (f) => '¥' + (Number(f || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
const ST = { 10: '待支付', 20: '已支付', 30: '已确认', 40: '已核销', 50: '已完成', 60: '退款中', 70: '已退款', 90: '已关闭' }

function toast(msg, err) {
  const d = document.createElement('div')
  d.className = 'toast' + (err ? ' err' : '')
  d.textContent = msg
  $('#toastWrap').appendChild(d)
  setTimeout(() => d.remove(), 2600)
}
function modal(title, bodyHtml, foots) {
  const root = $('#modalRoot')
  root.innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal"><div class="modal-head"><h3>${title}</h3><button class="modal-x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-foot">${foots}</div></div></div>`
}
function closeModal() { $('#modalRoot').innerHTML = '' }
function drawer(title, bodyHtml) {
  const root = $('#modalRoot')
  root.innerHTML = `<div class="drawer-overlay" onclick="closeModal()"></div>
    <div class="drawer"><div class="drawer-head"><h3 style="color:#fff">${title}</h3>
    <button class="modal-x" style="color:#fff" onclick="closeModal()">✕</button></div>
    <div class="drawer-body">${bodyHtml}</div></div>`
}

window.fill = (u, p) => { document.querySelector('#luser').value = u; document.querySelector('#lpass').value = p; document.querySelector('#lerr').textContent = '' }
// 全角→半角 + 去空格（中文输入法防手滑）
const norm = (s) => String(s ?? '').replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ').trim()

let MFA_CHALLENGE = null
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
function backToStep1() { $('#step2').style.display = 'none'; $('#step1').style.display = 'block'; MFA_CHALLENGE = null }
function logout() { TOKEN = ''; ME = null; localStorage.clear(); location.reload() }

function boot() {
  if (!TOKEN) { $('#login').style.display = 'flex'; $('#frame').style.display = 'none'; return }
  $('#login').style.display = 'none'; $('#frame').style.display = 'flex'
  const roleCn = { super: '超级管理员', finance: '财务', ops: '运营', review: '审核', risk: '风控' }[ME?.role] || ME?.role || ''
  const nameCn = ME?.displayName || ME?.username || ''
  $('#who').textContent = nameCn === roleCn ? roleCn : `${nameCn} · ${roleCn}`
  $('#nav').innerHTML = NAV.map(([g, items]) => `<div class="nav-group">${g}</div>` +
    items.map(([k, n, ic]) => `<div class="nav-item" data-p="${k}" onclick="go('${k}')">${ICONS[ic]}<span>${n}</span></div>`).join('')).join('')
  fetch('/c/health').then((r) => r.json()).then((j) => { $('#paymode').textContent = '支付通道：' + (j.data.payMode === 'MOCK' ? '联调 MOCK' : '微信支付 V3 ✓') }).catch(() => {})
  go('dash')
}

function go(page) {
  document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('on', a.dataset.p === page))
  const name = { dash: '驾驶舱', orders: '订单', products: '商品与团期', merchants: '商户与进件', settlements: '结算',
    budgets: '旅豆预算', promoters: '推广服务商', config: '参数中心', risk: '风控', audit: '审计日志',
    system: '运维控制台', features: '功能开关', content: '内容审核', withdrawals: '提现审批', agreements: '协议变更', attest: '存证中心', security: '安全中心', integrations: '集成中心',
    web3dash: '链上总览', pointassets: '积分资产发行', badges: '勋章资产发行', wallets: '用户数字钱包', contract: '合约调用账户', faqs: '常见问题', banners: '轮播管理', phrases: '暗号管理', rateov: '逐品佣金', kyc: '实名认证', cocreate: '共创分润', terms: '术语映射' }[page]
  $('#crumb').textContent = name
  ;({ dash, orders, products, merchants, settlements, budgets, promoters, config, risk, audit, system, features, content, withdrawals, agreements, attest, security, integrations, web3dash, pointassets, badges, wallets, contract, faqs, banners, phrases, rateov, kyc, cocreate, terms }[page] || dash)()
}
const skel = (n = 5) => Array(n).fill('<div class="sk sk-row"></div>').join('')
const emptyBox = (txt) => `<div class="empty"><div class="e-ico">🗂</div>${txt}</div>`

/* ============ 驾驶舱 ============ */
async function dash() {
  $('#app').innerHTML = `<div class="kpi-grid">${Array(6).fill('<div class="kpi"><div class="sk" style="width:44px;height:44px;border-radius:12px"></div><div style="flex:1"><div class="sk" style="height:12px;width:60%;margin-bottom:8px"></div><div class="sk" style="height:22px;width:40%"></div></div></div>').join('')}</div>
    <div class="card"><div class="sk" style="height:220px"></div></div>`
  const k = await api('GET', '/admin/dash/kpi')
  const orders = await api('GET', '/admin/orders')
  const wxd = await api('GET', '/admin/wxdata/visit-trend').catch(() => ({ mock: true, list: [] }))
  const recent = orders.slice(0, 8)
  const cityTag = k.scopeCity ? `本城 ${k.scopeCity} 口径` : '全域口径'
  const kpis = [
    ['💰', 'var(--brand-soft)', '今日 GMV', k.gmvToday, cityTag],
    ['🧾', '#e8effd', '今日订单', k.ordersToday, '含已支付以上状态'],
    ['✅', '#e3f6ec', '今日核销率', k.verifyRate, '核销 / 签发凭证'],
    ['🫘', '#fdf3e0', '预算池水位', k.globalScope ? k.budgetUsage : '—', k.globalScope ? '已发放 / 批次总额' : '全域科目 · 仅总部可见'],
    ['⚠️', '#fdecec', '待处理告警', k.globalScope ? k.alerts : '—', k.globalScope ? (k.alerts ? '需要关注' : '一切正常') : '全域风控 · 仅总部'],
    ['📈', '#f1e9fd', '7 日订单', (k.trend || []).reduce((s, t) => s + t.orders, 0), (k.scopeCity ? '本城' : '全域') + '近一周'],
  ]
  const trend = k.trend || []
  const maxG = Math.max(...trend.map((t) => Number(t.gmv)), 1)
  const W = 860, H = 170, P = 26
  const pts = trend.map((t, i) => [P + (i * (W - 2 * P)) / Math.max(trend.length - 1, 1), H - P - (Number(t.gmv) / maxG) * (H - 2 * P)])
  const path = pts.length ? 'M' + pts.map((p) => p.join(',')).join(' L') : ''
  const area = path ? path + ` L${pts[pts.length - 1][0]},${H - P} L${pts[0][0]},${H - P} Z` : ''
  const w3 = await api('GET', '/admin/web3/overview').catch(() => null)
  const ins = await api('GET', '/admin/dash/insights').catch(() => null)
  $('#app').innerHTML = `${w3 ? `<div class="card"><div class="card-head"><h3>链上权益 · 向往自由链</h3><span class="muted">${esc(w3.chainMode)}</span>
    <button class="btn ghost sm" onclick="go('web3dash')" style="margin-left:auto">WEB3 工作区 ›</button></div>
    <div class="row" style="gap:24px;margin:0"><span>锚定批次 <b>${w3.anchoredBatches}/${w3.batches}</b></span>
    <span>链上事件 <b>${w3.anchoredEvents}/${w3.events}</b></span><span>待打包 <b>${w3.pendingEvents}</b></span>
    <span>勋章发放 <b>${w3.badgeGrants}</b></span><span>积分发行 <b>${w3.beanGranted}</b></span></div></div>` : ''}
  ${ins ? `<div class="card"><div class="card-head"><h3>待审核事项（聚合）</h3></div>
    <div class="row" style="gap:18px;margin:0">
      <span>📝 待审笔记 <b>${ins.pending.notes}</b></span>
      <span>🏪 进件申请 <b>${ins.pending.merchants}</b></span>
      <span>💰 提现待审 <b>${ins.pending.withdrawals}</b></span>
      <span>⚠️ 离线冲突 <b>${ins.pending.conflicts}</b></span>
      <span>📋 约稿待判 <b>${ins.pending.tasks}</b></span>
      <span class="muted" style="margin-left:auto">合计 ${ins.pending.notes + ins.pending.merchants + ins.pending.withdrawals + ins.pending.conflicts + ins.pending.tasks} 项</span>
    </div>
    <div class="card-head" style="margin-top:12px"><h3>热门主题游 TOP5（已支付口径）</h3></div>
    <table><thead><tr><th>#</th><th>主题游</th><th>订单</th><th>GMV</th></tr></thead><tbody>
    ${ins.topTours.map((t, i) => `<tr><td class="num">${i + 1}</td><td>${esc(t.title)}</td><td class="num">${Number(t.orders)}</td><td class="num">¥${(Number(t.gmv) / 100).toFixed(0)}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无数据</td></tr>'}
    </tbody></table>
    <div class="card-head" style="margin-top:12px"><h3>活动转化漏斗</h3></div>
    <div class="row" style="gap:24px;margin:0">
      <span>报名→支付 <b>${ins.funnel.payRate}</b></span>
      <span>复购线索 <b>${ins.funnel.rebuyRate}</b></span>
      <span>积分使用率 <b>${ins.funnel.beanUseRate}</b></span>
    </div></div>` : ''}
  <div class="kpi-grid">${kpis.map(([ic, bg, l, v, s]) => `
    <div class="kpi"><div class="ico" style="background:${bg}">${ic}</div>
    <div><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div></div>`).join('')}
  </div>
  <div class="card chart-box">
    <div class="card-head"><h3>近 7 日 GMV 走势</h3><span class="muted">单位：元</span></div>
    <svg viewBox="0 0 ${W} ${H}" height="${H}">
      <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2563eb" stop-opacity=".28"/><stop offset="1" stop-color="#2563eb" stop-opacity=".02"/></linearGradient></defs>
      ${[0.25, 0.5, 0.75].map((r) => `<line x1="${P}" x2="${W - P}" y1="${H * r}" y2="${H * r}" stroke="#eef1f5" stroke-dasharray="4 4"/>`).join('')}
      ${area ? `<path d="${area}" fill="url(#ga)"/><path d="${path}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round"/>` : ''}
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#2563eb" stroke-width="2"><title>${trend[i].date}：¥${trend[i].gmv}（${trend[i].orders} 单）</title></circle>`).join('')}
      ${trend.map((t, i) => `<text x="${pts[i][0]}" y="${H - 6}" font-size="10.5" fill="#8595a8" text-anchor="middle">${t.date.slice(5)}</text>`).join('')}
    </svg>
    ${trend.length ? '' : emptyBox('暂无成交数据——去「商品与团期」上架第一条线路吧')}
  </div>
  ${wxd.list && wxd.list.length ? miniVisitCard(wxd) : ''}
  <div class="card">
    <div class="card-head"><h3>最近订单</h3><button class="btn ghost sm" onclick="go('orders')">全部订单 →</button></div>
    ${recent.length ? `<table><thead><tr><th>单号</th><th>商品</th><th>用户</th><th>金额</th><th>状态</th><th>支付时间</th></tr></thead><tbody>
      ${recent.map((o) => `<tr style="cursor:pointer" onclick="orderDrawer('${o.order_no}')">
        <td class="num">${esc(o.order_no)}</td><td class="td-main">${esc(o.title)}</td><td>${esc(o.nickname)}</td>
        <td class="money num">${fen(o.amount_pay)}</td><td><span class="pill s${o.status}">${ST[o.status]}</span></td>
        <td class="td-sub">${esc(String(o.paid_at || o.created_at || '').slice(5, 16))}</td></tr>`).join('')}</tbody></table>` : emptyBox('还没有订单')}
  </div>`
}

/* ============ 小程序访问趋势（官方数据分析，未配置凭据=MOCK） ============ */
function miniVisitCard(wxd) {
  const list = wxd.list, W = 860, H = 150, P = 26
  const maxV = Math.max(...list.map((t) => t.visitPv), 1)
  const pts = list.map((t, i) => [P + (i * (W - 2 * P)) / Math.max(list.length - 1, 1), H - P - (t.visitPv / maxV) * (H - 2 * P)])
  const path = 'M' + pts.map((p) => p.join(',')).join(' L')
  const area = path + ` L${pts[pts.length - 1][0]},${H - P} L${pts[0][0]},${H - P} Z`
  return `<div class="card chart-box">
    <div class="card-head"><h3>小程序访问趋势</h3><span class="muted">PV/UV · ${wxd.mock ? 'MOCK 演示（集成中心配置小程序凭据后为真实数据）' : '微信官方数据分析'}</span></div>
    <svg viewBox="0 0 ${W} ${H}" height="${H}">
      <defs><linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5b8def" stop-opacity=".25"/><stop offset="1" stop-color="#5b8def" stop-opacity=".02"/></linearGradient></defs>
      ${[0.5].map((r) => `<line x1="${P}" x2="${W - P}" y1="${H * r}" y2="${H * r}" stroke="#eef1f5" stroke-dasharray="4 4"/>`).join('')}
      <path d="${area}" fill="url(#gv)"/><path d="${path}" fill="none" stroke="#5b8def" stroke-width="2.5" stroke-linecap="round"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="#5b8def" stroke-width="2"><title>${list[i].date}：PV ${list[i].visitPv} · UV ${list[i].visitUv}</title></circle>`).join('')}
      ${list.map((t, i) => `<text x="${pts[i][0]}" y="${H - 6}" font-size="10.5" fill="#8595a8" text-anchor="middle">${t.date.slice(5)}</text>`).join('')}
    </svg>
  </div>`
}

/* ============ 订单 ============ */
let orderFilter = 0
async function orders() {
  $('#app').innerHTML = `<div class="card">${skel(6)}</div>`
  const rows = await api('GET', '/admin/orders')
  const chips = [[0, '全部'], [10, '待支付'], [20, '已支付'], [30, '已确认'], [40, '已核销'], [50, '已完成'], [70, '已退款']]
  const list = orderFilter ? rows.filter((o) => o.status === orderFilter) : rows
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>订单</h2>${EXPBTN('orders', '订单 CSV')}<span class="muted">${rows.length} 笔 · 点击行查看全链路时间线</span></div>
    <div class="cfg-tabs">${chips.map(([v, n]) => `<div class="cfg-tab ${orderFilter === v ? 'on' : ''}" onclick="orderFilter=${v};orders()">${n}</div>`).join('')}</div>
    ${list.length ? `<table><thead><tr><th>单号</th><th>商品</th><th>用户</th><th>金额</th><th>旅豆抵扣</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
    ${list.map((o) => `<tr><td class="num" style="cursor:pointer;color:var(--blue)" onclick="orderDrawer('${o.order_no}')">${esc(o.order_no)}</td>
      <td><div class="td-main">${esc(o.title)}</div><div class="td-sub">${esc(o.city_code)} · ${o.qty} 人</div></td>
      <td>${esc(o.nickname)}</td><td class="money num">${fen(o.amount_pay)}</td>
      <td class="num">${o.bean_deducted ? o.bean_deducted + ' 豆' : '—'}</td>
      <td><span class="pill s${o.status}">${ST[o.status]}</span></td>
      <td class="td-sub">${esc(String(o.paid_at || o.created_at || '').slice(5, 16))}</td>
      <td>${[20, 30, 40].includes(o.status) ? `<button class="btn danger sm" onclick="refundOrder('${o.order_no}')">退款</button>` : ''}
          ${o.status === 40 ? `<button class="btn ghost sm" onclick="completeOrder('${o.order_no}')" title="联调：模拟观察期结束">完成</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('该状态下暂无订单')}
  </div>`
}
async function orderDrawer(no) {
  const o = await api('GET', '/admin/orders/' + no)
  drawer(`订单 ${esc(o.order_no)}`, `
    <div class="row" style="gap:8px"><span class="pill s${o.status}">${ST[o.status]}</span>
      <span class="money" style="font-size:18px">${fen(o.amount_pay)}</span>
      ${o.bean_deducted ? `<span class="pill warn">抵扣 ${o.bean_deducted} 豆</span>` : ''}</div>
    <table style="margin-top:10px">
      <tr><td class="td-sub" style="width:90px">商品</td><td class="td-main">${esc(o.title)}</td></tr>
      <tr><td class="td-sub">用户</td><td>${esc(o.nickname)}（ID ${o.user_id}）</td></tr>
      <tr><td class="td-sub">联系人</td><td>${esc(o.contact_name || '—')}</td></tr>
      <tr><td class="td-sub">支付流水</td><td class="num">${esc(o.pay?.wx_trans_no || '—')} ${o.pay ? `<span class="pill ${o.pay.status === 1 ? 'ok' : 'off'}">${['待支付', '成功', '关闭', '退款中', '已退款'][o.pay.status]}</span>` : ''}</td></tr>
    </table>
    ${o.passes?.length ? `<h3 style="margin:16px 0 8px">入园凭证</h3><table>
      ${o.passes.map((p) => `<tr><td>#${p.id} ${esc(p.name)}</td><td><span class="pill ${p.status === 1 ? 's30' : p.status === 2 ? 's50' : 'off'}">${['', '待核销', '已核销', '已过期', '已冲正'][p.status]}</span></td></tr>`).join('')}</table>` : ''}
    <h3 style="margin:16px 0 10px">状态机时间线（order_event 审计）</h3>
    <ul class="tl">${(o.events || []).map((e) => `<li>
      <div class="t">${ST[e.from_st] || e.from_st} → ${ST[e.to_st] || e.to_st}</div>
      <div class="d">${esc(String(e.detail || '').replace(/"/g, ''))} · ${esc(e.actor)} · ${esc(String(e.created_at).slice(5, 19))}</div></li>`).join('')}</ul>`)
}
async function refundOrder(no) {
  modal('退款确认', `<p>确认对 <code>${esc(no)}</code> 发起退款？</p>
    <p class="muted" style="margin-top:8px">将自动执行全量冲正：原路退款 · 退回抵扣旅豆 · 入园凭证作废 · 关联佣金置无效。</p>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button>
     <button class="btn danger" onclick="doRefund('${no}')">确认退款</button>`)
}
async function doRefund(no) {
  try { await api('POST', '/admin/orders/' + no + '/refund', { reason: '后台退款' }); closeModal(); toast('退款完成，冲正已执行'); orders() }
  catch (e) { toast(e.message, true) }
}
async function completeOrder(no) {
  try { await api('POST', '/admin/dev/complete', { orderNo: no }); toast('观察期结束：返豆与佣金已入账'); orders() }
  catch (e) { toast(e.message, true) }
}

/* ============ 商品与团期 ============ */
async function products() {
  $('#app').innerHTML = `<div class="card">${skel(5)}</div>`
  const rows = await api('GET', '/admin/products')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商品与团期</h2>${EXPBTN('products', '商品 CSV')}<button class="btn primary sm" onclick="productModal()">＋ 新增线路</button></div>
    <div class="row" style="margin-top:0">
      <input id="p_title" placeholder="标题，如：朱家角剧本游 · 江南谜案">
      <select id="p_cat"><option value="script">剧本闯关</option><option value="yoga">瑜伽之旅</option><option value="sister">姐姐系列</option>
        <option value="single">单身社交</option><option value="sport">体育竞技</option><option value="family">亲子主题</option>
        <option value="red">红色文旅</option><option value="shop">商城 SKU</option></select>
      <input id="p_price" placeholder="价格（分）如 29800" style="width:150px">
      <select id="p_merchant">${rows.length ? [...new Set(rows.map((r) => `<option value="${r.merchant_id}">${esc(r.merchant_name)}</option>`))].join('') : '<option value="">先建商户</option>'}</select>
      <button class="btn primary sm" onclick="addProduct()">保存</button>
    </div>
    ${rows.length ? `<table><thead><tr><th>商品</th><th>分类</th><th>城市</th><th>价格</th><th>商户</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${rows.map((p) => `<tr>
      <td><div class="td-main">${esc(p.title)}</div><div class="td-sub">${esc(p.days_desc || '')}${p.bean_gift ? ' · 完成得 ' + p.bean_gift + ' 豆' : ''}</div></td>
      <td><span class="pill off">${esc(p.cat)}</span></td><td class="num">${esc(p.city_code)}</td>
      <td class="money num">${fen(p.price_from)}</td><td class="td-sub">${esc(p.merchant_name || p.merchant_id)}</td>
      <td><span class="pill ${p.status === 1 ? 'ok' : 'off'}">${p.status === 1 ? '上架' : '下架'}</span></td>
      <td><button class="btn ghost sm" onclick="toggleProduct(${p.id}, ${p.status === 1 ? 0 : 1})">${p.status === 1 ? '下架' : '上架'}</button>
          <button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="sessionModal(${p.id}, ${p.price_from})">＋团期</button>
          <button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="editProduct(${p.id})">编辑·素材</button></td>
    </tr>`).join('')}</tbody></table>` : emptyBox('还没有商品——用上方表单录入第一条线路')}
  </div>`
}

/* 商品编辑 + 素材（P0 宣传力：实拍图集/行程/费用包含/集合点/安全告知） */
let EDIT_P = null
async function editProduct(id) {
  const p = await api('GET', '/admin/products').then((rs) => rs.find((x) => x.id === id))
  if (!p) return toast('商品不存在', true)
  EDIT_P = p
  const rich = typeof p.rich_desc === 'string' ? JSON.parse(p.rich_desc || '{}') : (p.rich_desc || {})
  const imgs = typeof p.images === 'string' ? JSON.parse(p.images || '[]') : (p.images || [])
  modal(`编辑 · ${esc(p.title)}`, `
    <label class="muted" style="display:block;margin-bottom:4px">实拍图集（首图 = 小程序封面；≤9 张，单张 ≤2MB）</label>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      ${imgs.map((u, i) => `<div style="position:relative"><img src="${u}" style="width:72px;height:54px;object-fit:cover;border-radius:8px;display:block">
        <button onclick="delProductImage(${id},${i})" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:var(--red);color:#fff;font-size:11px;line-height:18px">×</button></div>`).join('')}
      <label style="width:72px;height:54px;border:1.5px dashed var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:20px;color:var(--sub)">
        ＋<input type="file" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="uploadProductImage(${id},this)"></label>
    </div>
    <label class="muted" style="display:block">玩法亮点（每行一条）</label>
    <textarea id="e_highlights" class="ta-full" rows="3">${esc((rich.highlights || []).join('\n'))}</textarea>
    <label class="muted" style="display:block">行程介绍</label>
    <textarea id="e_intro" class="ta-full" rows="4">${esc(rich.intro || '')}</textarea>
    <label class="muted" style="display:block">费用包含（每行一条）</label>
    <textarea id="e_includes" class="ta-full" rows="3">${esc((rich.includes || []).join('\n'))}</textarea>
    <label class="muted" style="display:block">集合地点 / 交通</label>
    <input id="e_meeting" style="width:100%" value="${esc(p.meeting_point || '')}" placeholder="如：地铁17号线朱家角站 2 号口，09:00 集合">
    <label class="muted" style="display:block">安全告知</label>
    <input id="e_safety" style="width:100%" value="${esc(p.safety_note || '')}" placeholder="如：含户外环节，已购公众责任险，请穿着运动鞋">
    <p class="muted">保存后小程序详情页即时可见（图片经 /uploads 静态服务）</p>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="saveProduct(${id})">保存</button>`)
}
function lines(v) { return v.split('\n').map((s) => s.trim()).filter(Boolean) }
async function uploadProductImage(id, input) {
  const f = input.files[0]
  if (!f) return
  if (f.size > 2 * 1024 * 1024) return toast('图片需在 2MB 内', true)
  const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
  const rd = new FileReader()
  rd.onload = async () => {
    try {
      const data = String(rd.result).split(',')[1]
      await api('POST', `/admin/products/${id}/images`, { data, ext })
      toast('图片已上传'); closeModal(); editProduct(id)
    } catch (e) { toast(e.message, true) }
  }
  rd.readAsDataURL(f)
}
async function delProductImage(id, idx) {
  try { await api('DELETE', `/admin/products/${id}/images?idx=${idx}`); closeModal(); editProduct(id) } catch (e) { toast(e.message, true) }
}
async function saveProduct(id) {
  try {
    await api('PUT', '/admin/products/' + id, {
      intro: $('#e_intro').value, highlights: lines($('#e_highlights').value), includes: lines($('#e_includes').value),
      meetingPoint: $('#e_meeting').value || null, safetyNote: $('#e_safety').value || null,
    })
    toast('已保存'); closeModal(); products()
  } catch (e) { toast(e.message, true) }
}
function productModal() { products().then(() => document.getElementById('p_title')?.focus()) }
async function addProduct() {
  try {
    if (!$('#p_title').value.trim()) return toast('请填写标题', true)
    await api('POST', '/admin/products', { title: $('#p_title').value.trim(), cat: $('#p_cat').value,
      priceFrom: Number($('#p_price').value), merchantId: Number($('#p_merchant').value), status: 1 })
    toast('商品已上架'); products()
  } catch (e) { toast(e.message, true) }
}
async function toggleProduct(id, status) { try { await api('POST', `/admin/products/${id}/status`, { status }); products() } catch (e) { toast(e.message, true) } }
function sessionModal(pid, price) {
  modal('新增团期', `<div class="row"><input id="s_date" type="date" style="width:170px"><input id="s_quota" placeholder="名额" value="24" style="width:100px"><input id="s_price" placeholder="价格(分)" value="${price}" style="width:130px"></div>
    <p class="muted">出发日建议选周五/周六；名额售完自动拦截（数据库 CHECK 防超卖）</p>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="addSession(${pid})">保存团期</button>`)
}
async function addSession(pid) {
  try {
    await api('POST', '/admin/sessions', { productId: pid, departDate: $('#s_date').value, quota: Number($('#s_quota').value), priceAdult: Number($('#s_price').value) })
    closeModal(); toast('团期已添加')
  } catch (e) { toast(e.message, true) }
}

/* ============ 商户 ============ */
async function merchants() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const rows = await api('GET', '/admin/merchants')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商户（履约方）</h2>${EXPBTN('merchants', '商户 CSV')}<span class="muted">收付通二级商户进件后填入子商户号</span></div>
    <div class="row" style="margin-top:0"><input id="m_name" placeholder="商户名称"><input id="m_city" placeholder="城市码（310118 青浦 / 320508 姑苏）" style="width:250px">
      <input id="m_wx" placeholder="收付通子商户号（选填）" style="width:200px"><button class="btn primary sm" onclick="addMerchant()">＋ 新增商户</button></div>
    ${rows.length ? `<table><thead><tr><th>商户号</th><th>名称</th><th>城市</th><th>收付通子商户</th><th>评分</th><th>状态</th></tr></thead><tbody>
    ${rows.map((m) => `<tr><td class="num">${esc(m.merchant_no)}</td><td class="td-main">${esc(m.name)}</td><td class="num">${esc(m.city_code)}</td>
      <td class="num">${esc(m.wxpay_sub_mchid || '—')}</td><td>⭐ ${m.score}</td>
      <td><span class="pill ${m.status === 1 ? 'ok' : 'warn'}">${m.status === 1 ? '生效' : '进件中'}</span></td></tr>`).join('')}</tbody></table>` : emptyBox('暂无商户')}
  </div>`
}
async function addMerchant() {
  try { await api('POST', '/admin/merchants', { name: $('#m_name').value.trim(), cityCode: $('#m_city').value.trim(), wxpaySubMchid: $('#m_wx').value.trim() }); toast('商户已创建'); merchants() }
  catch (e) { toast(e.message, true) }
}

/* ============ 结算 ============ */
async function settlements() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const rows = await api('GET', '/admin/settlements')
  const COLORS = ['#2563eb', '#0ea5e9', '#d97706', '#7c3aed', '#64748b']
  const NAMES = ['履约结算', '平台服务费', '推广服务费', '权益预算', '留存毛利']
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商户周结算</h2>${EXPBTN('settlements', '结算 CSV')}
      <button class="btn primary sm" onclick="genSettlements()">生成本周结算单</button></div>
    <p class="muted" style="margin:-8px 0 14px">五口径恒等式在数据库层以 CHECK 约束强制：<code>订单额 = 履约 + 服务费 + 推广 + 权益预算 + 留存毛利</code></p>
    ${rows.length ? rows.map((s) => {
      const parts = [Number(s.amt_fulfill), Number(s.amt_service), Number(s.amt_promoter), Number(s.amt_beanbudget), Number(s.amt_retained)]
      const total = Number(s.total_amount) || 1
      return `<div style="padding:14px 0;border-bottom:1px solid #f1f4f8">
      <div class="row" style="justify-content:space-between;margin:0 0 10px">
        <div><b>${esc(s.merchant_name)}</b> <span class="muted">${esc(s.period)} · ${s.order_count} 单</span></div>
        <div><span class="money" style="font-size:16px">${fen(s.total_amount)}</span>
          <span class="pill ${s.status === 3 ? 'ok' : s.status === 4 ? 'warn' : 'off'}" style="margin-left:10px">${['待确认', '商户确认', '分账执行', '完成', '异议中'][s.status]}</span>
          ${s.status === 0 ? `<button class="btn primary sm" style="margin-left:10px" onclick="confirmSettle(${s.id})">复核通过并分账</button>` : ''}</div>
      </div>
      <div class="split-bar">${parts.map((v, i) => `<span style="background:${COLORS[i]};flex:${Math.max(v, 1)}">${v ? Math.round(v / total * 100) + '%' : ''}</span>`).join('')}</div>
      <div class="split-legend">${NAMES.map((n, i) => `<span><em style="width:9px;height:9px;border-radius:3px;display:inline-block;background:${COLORS[i]};margin-right:5px"></em>${n} ${fen(parts[i])}</span>`).join('')}</div>
    </div>` }).join('') : emptyBox('暂无结算单——有已完成订单后点右上角生成')}
  </div>`
}
async function genSettlements() {
  try { const r = await api('POST', '/admin/settlements/generate', {}); toast('已生成 ' + r.settlementIds.length + ' 份结算单'); settlements() } catch (e) { toast(e.message, true) }
}
async function confirmSettle(id) {
  try { await api('POST', `/admin/settlements/${id}/confirm`, {}); toast('结算完成：分账已执行'); settlements() } catch (e) { toast(e.message, true) }
}

/* ============ 旅豆预算 ============ */
async function budgets() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/budgets')
  const totalSum = rows.reduce((s, b) => s + Number(b.total), 0), grantedSum = rows.reduce((s, b) => s + Number(b.granted), 0)
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>旅豆预算池</h2><span class="muted">发放双闸：批次 ≤ 总额+回流 且 全局 ≤ 600 万豆/年（严禁超发红线）</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">🫘</div><div><div class="l">累计预算</div><div class="v num">${totalSum.toLocaleString()}</div><div class="s">豆</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e3f6ec">✅</div><div><div class="l">累计发放</div><div class="v num">${grantedSum.toLocaleString()}</div><div class="s">豆 · ${(grantedSum / Math.max(totalSum, 1) * 100).toFixed(1)}%</div></div></div>
    </div>
    <div class="row"><input id="b_name" placeholder="批次名，如：12月·消费返豆"><input id="b_total" placeholder="总额（豆）" style="width:150px">
      <button class="btn primary sm" onclick="addBudget()">＋ 新建批次</button></div>
    ${rows.length ? `<table><thead><tr><th>批次</th><th>总额</th><th>已发放</th><th>回流</th><th>余量</th><th>状态</th><th>周期</th></tr></thead><tbody>
    ${rows.map((b) => { const left = Number(b.total) + Number(b.returned) - Number(b.granted); const pct = Number(b.granted) / Math.max(Number(b.total), 1) * 100
      return `<tr><td class="td-main">${esc(b.name)}</td><td class="num">${Number(b.total).toLocaleString()}</td>
      <td><div class="num">${Number(b.granted).toLocaleString()}</div><div style="background:#eef1f5;border-radius:4px;height:5px;width:90px;margin-top:4px"><div style="background:${pct > 80 ? 'var(--red)' : 'var(--brand)'};height:5px;border-radius:4px;width:${Math.min(pct, 100)}%"></div></div></td>
      <td class="num">${Number(b.returned).toLocaleString()}</td><td class="num">${left.toLocaleString()}</td>
      <td><span class="pill ${b.status === 1 ? 'ok' : 'off'}">${b.status === 1 ? '生效' : '停用'}</span></td>
      <td class="td-sub">${esc(String(b.period_start || '').slice(0, 10))} ~ ${esc(String(b.period_end || '').slice(0, 10))}</td></tr>` }).join('')}</tbody></table>` : emptyBox('暂无预算批次')}
  </div>`
}
async function addBudget() {
  try { await api('POST', '/admin/budgets', { name: $('#b_name').value.trim(), total: Number($('#b_total').value) }); toast('批次已创建并生效'); budgets() } catch (e) { toast(e.message, true) }
}

/* ============ 推广服务商 ============ */
async function promoters() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/promoters')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>推广服务商</h2><span class="muted">一级 CPS · 三档 5% / 8% / 12% 封顶（数据库 CHECK 焊死，无层级字段）</span></div>
    <div class="row"><input id="pr_uid" placeholder="用户 ID" style="width:120px">
      <select id="pr_tier" style="width:170px"><option value="1">基础档 5%</option><option value="2">优选档 8%</option><option value="3">金牌档 12%</option></select>
      <button class="btn primary sm" onclick="addPromoter()">开通推广资格</button></div>
    ${rows.length ? `<table><thead><tr><th>用户</th><th>档位</th><th>费率</th><th>90 天有效成交</th><th>评分</th><th>状态</th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td><div class="td-main">${esc(p.nickname || '')}</div><div class="td-sub">ID ${p.user_id}</div></td>
      <td>${['', '基础', '优选', '金牌'][p.tier]}</td><td><b>${p.rate_bp / 100}%</b></td>
      <td class="money num">${fen(p.valid_gmv_90d)}</td><td>⭐ ${p.service_score}</td>
      <td><span class="pill ${p.status === 1 ? 'ok' : 'off'}">${p.status === 1 ? '生效' : '冻结'}</span></td></tr>`).join('')}</tbody></table>` : emptyBox('还没有推广员')}
  </div>`
}
async function addPromoter() {
  try { const r = await api('POST', '/admin/promoters/register', { userId: Number($('#pr_uid').value), tier: Number($('#pr_tier').value) }); toast('已开通，费率 ' + r.rateBp / 100 + '%'); promoters() } catch (e) { toast(e.message, true) }
}

/* ============ 参数中心 ============ */
let cfgGroup = 'bean'
async function config() {
  $('#app').innerHTML = `<div class="card">${skel(6)}</div>`
  const rows = await api('GET', '/admin/config')
  const groups = {}
  rows.forEach((r) => (groups[r.group_name] = groups[r.group_name] || []).push(r))
  const GNAMES = { bean: '旅豆', member: '会员', promoter: '推广', contribution: '贡献分', order: '订单', pass: '核销', settlement: '结算', cost: '成本控制', channel: '城市与频道' }
  const items = groups[cfgGroup] || []
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>参数中心</h2><span class="muted">代码零硬编码 · 敏感参数双人复核 · 版本可回滚</span></div>
    <div class="cfg-tabs">${Object.keys(groups).map((g) => `<div class="cfg-tab ${cfgGroup === g ? 'on' : ''}" onclick="cfgGroup='${g}';config()">${GNAMES[g] || g}</div>`).join('')}</div>
    ${items.length ? `<table><thead><tr><th>参数</th><th>当前值</th><th>说明</th><th>复核</th><th>最近变更</th><th></th></tr></thead><tbody>
    ${items.map((r) => `<tr><td><code>${esc(r.k)}</code></td><td><b>${esc(r.v)}</b></td>
      <td class="td-sub">${esc(r.memo || '')}</td>
      <td>${Number(r.sensitive) ? '<span class="pill warn">双人复核</span>' : '<span class="pill off">直接生效</span>'}</td>
      <td class="td-sub">${esc(String(r.updated_at).slice(5, 16))}${r.updated_by ? ' · ' + esc(r.updated_by) : ''}</td>
      <td><button class="btn ghost sm" onclick="cfgEdit('${esc(r.k)}', '${esc(String(r.v)).replace(/'/g, '')}')">修改</button></td></tr>`).join('')}</tbody></table>` : emptyBox('该分组暂无参数')}
  </div>`
}
function cfgEdit(k, v) {
  modal('修改参数 <code>' + k + '</code>', `
    <div style="margin-bottom:12px">当前值：<code>${esc(v)}</code> → 新值：
    <input id="cfg_new" value="${esc(v)}" style="width:100%;margin-top:8px;padding:9px 12px;border:1.5px solid var(--line);border-radius:9px"></div>
    <input id="cfg_reason" placeholder="修改原因（必填，将写入审计）" style="width:100%;padding:9px 12px;border:1.5px solid var(--line);border-radius:9px">
    <div id="cfg_hint" class="muted" style="margin-top:10px"></div>`,
    `<button class="btn ghost" onclick="cfgHistory('${esc(k)}')">变更历史</button>
     <button class="btn ghost" onclick="closeModal()">取消</button>
     <button class="btn primary" onclick="cfgPropose('${esc(k)}')">提交提案</button>`)
}
async function cfgPropose(k) {
  const reason = $('#cfg_reason').value.trim()
  if (!reason) return toast('必须填写修改原因', true)
  try {
    const r = await api('POST', '/admin/config/proposal', { key: k, newValue: $('#cfg_new').value, reason })
    closeModal()
    toast('提案 #' + r.historyId + ' 已提交' + (r.sensitive ? '，需另一账号审批生效' : '，可由财务/超管审批生效') +
      (r.preview ? `｜近30日 ${r.preview.orders30d} 单：返豆 ${r.preview.beanOld} → ${r.preview.beanNew}` : ''))
    config()
  } catch (e) { toast(e.message, true) }
}
async function cfgHistory(k) {
  const rows = await api('GET', '/admin/config/history?key=' + encodeURIComponent(k))
  modal('变更历史 <code>' + k + '</code>',
    rows.length ? `<table><thead><tr><th>时间</th><th>变更</th><th>提案 → 审批</th><th>状态</th></tr></thead><tbody>
    ${rows.map((h) => `<tr><td class="td-sub">${esc(String(h.created_at).slice(5, 16))}</td>
      <td><span class="diff-old">${esc(h.old_value)}</span> → <span class="diff-new">${esc(h.new_value)}</span></td>
      <td class="td-sub">${esc(h.proposer)} → ${esc(h.approver || '待批')}</td>
      <td>${['<span class="pill warn">待审</span>' + (ME.role !== 'ops' ? ` <button class="btn primary sm" onclick="cfgApprove(${h.id})">审批生效</button>` : ''), '<span class="pill ok">生效</span>', '<span class="pill s70">驳回</span>', '<span class="pill off">回滚</span>'][h.status]}</td></tr>`).join('')}
    </tbody></table>
    <div class="row" style="margin-top:14px"><button class="btn ghost sm" onclick="cfgRollback('${esc(k)}')">↩ 回滚到上一版本</button></div>`
    : emptyBox('无变更记录'),
    `<button class="btn ghost" onclick="closeModal()">关闭</button>`)
}
async function cfgApprove(id) {
  try { await api('POST', '/admin/config/approve', { historyId: id }); toast('参数已生效'); closeModal(); config() } catch (e) { toast(e.message, true) }
}
async function cfgRollback(k) {
  try { const r = await api('POST', '/admin/config/rollback', { key: k }); toast('已回滚，恢复为 ' + r.restored) } catch (e) { toast(e.message, true) }
}

/* ============ 风控 / 审计 ============ */
async function risk() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/risk')
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h2>风控事件</h2><span class="muted">核销重放 / 设备聚集 / 退款滥用 / 佣金异常</span></div>
    ${rows.length ? `<table><thead><tr><th>类型</th><th>级别</th><th>详情</th><th>时间</th><th>状态</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><span class="pill off">${esc(r.kind)}</span></td>
      <td>${r.severity >= 3 ? '<span class="pill s70">高</span>' : r.severity === 2 ? '<span class="pill warn">中</span>' : '<span class="pill off">低</span>'}</td>
      <td><code>${esc(String(r.detail).slice(0, 60))}</code></td>
      <td class="td-sub">${esc(String(r.created_at).slice(5, 16))}</td>
      <td>${r.handled ? '<span class="pill ok">已处理</span>' : '<span class="pill warn">待处理</span>'}</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无风控事件 🎉')}
  </div>`
}
async function audit() {
  $('#app').innerHTML = `<div class="card">${skel(6)}</div>`
  const rows = await api('GET', '/admin/audit-logs')
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h2>操作审计</h2><span class="muted">只增不改 · 每次写操作前后快照</span></div>
    ${rows.length ? `<table><thead><tr><th>时间</th><th>操作人</th><th>模块 / 动作</th><th>对象</th><th>变更</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="td-sub num">${esc(String(a.created_at).slice(5, 19))}</td><td>${esc(a.actor)}</td>
      <td><b>${esc(a.module)}</b> · ${esc(a.action)}</td><td class="td-sub">${esc(a.biz_ref || '')}</td>
      <td>${a.before_val || a.after_val ? `<span class="diff-old">${esc(String(a.before_val || '∅').slice(0, 24))}</span> → <span class="diff-new">${esc(String(a.after_val || '∅').slice(0, 24))}</span>` : '—'}</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无操作记录')}
  </div>`
}

/* ============ 系统工作区：运维控制台 ============ */
async function system() {
  $('#app').innerHTML = `<div class="card">${skel(5)}</div>`
  const o = await api('GET', '/admin/system/overview')
  const sp = (ok, t, b) => ok ? '<span class="pill ok">● ' + t + '</span>' : '<span class="pill s70">● ' + b + '</span>'
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>系统健康</h2><span class="muted">SRE 控制台 · 手动干预均留审计</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="ico" style="background:${o.db.ok ? '#e3f6ec' : '#fdecec'}">🗄</div><div><div class="l">数据库</div><div class="v" style="font-size:18px">${o.db.latencyMs} ms</div><div class="s">${sp(o.db.ok, '正常', '异常')}</div></div></div>
      <div class="kpi"><div class="ico" style="background:${o.jobs.alive ? '#e3f6ec' : '#fdecec'}">⏱</div><div><div class="l">任务进程</div><div class="v" style="font-size:18px">${o.jobs.runCount} 轮</div><div class="s">${sp(o.jobs.alive, '存活', '心跳丢失')}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">⛓</div><div><div class="l">存证队列</div><div class="v" style="font-size:18px">${o.attestQueue.pending}</div><div class="s">已锚 ${o.attestQueue.anchored} · 失败 ${o.attestQueue.failed}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#f1e9fd">🧾</div><div><div class="l">支付单</div><div class="v" style="font-size:18px">${o.payment.ok}/${o.payment.total}</div><div class="s">成功/总数</div></div></div>
      <div class="kpi"><div class="ico" style="background:${o.ledger.perOk ? '#e3f6ec' : '#fdecec'}">⚖️</div><div><div class="l">账本试算</div><div class="v" style="font-size:18px">${o.ledger.credit}</div><div class="s">${sp(o.ledger.perOk && o.ledger.globalOk, '借贷平衡', '不平衡P0')}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">🧯</div><div><div class="l">滞留待付</div><div class="v" style="font-size:18px">${o.ordersHealth.stuckWaitPay30m}</div><div class="s">超30分钟未付</div></div></div>
    </div>
    <div class="row" style="margin-top:6px"><span class="muted">服务运行 ${Math.floor(o.service.uptimeSec / 60)} 分钟 · Node ${esc(o.service.node)} · 支付通道 ${esc(o.service.payMode)} · ${o.tables} 张表 · 幂等键 ${o.idempotencyKeys}</span></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>定时任务</h3>
      <div>
        <button class="btn ghost sm" onclick="runJob('close-timeout')">关单</button>
        <button class="btn ghost sm" onclick="runJob('commission-due')">佣金到期</button>
        <button class="btn ghost sm" onclick="runJob('complete-due')">完成到期单</button>
        <button class="btn ghost sm" onclick="runJob('attest-pack')">存证打包</button>
        <button class="btn ghost sm" onclick="runJob('bean-expire')">豆过期</button>
      </div></div>
    <div class="row" style="margin-top:4px"><span class="muted">迁移脚本：${(o.migrations || []).map((m) => '<code>' + esc(m) + '</code>').join(' ')}</span></div>
    <table><thead><tr><th>任务</th><th>最近执行</th><th>状态</th><th>累计</th></tr></thead><tbody>
    ${(o.jobs.detail || []).map((jb) => `<tr><td class="td-main">${esc(jb.name)}</td>
      <td class="td-sub">${esc(String(jb.last_run_at).slice(0, 19))}</td>
      <td>${jb.last_status === 'ok' ? '<span class="pill ok">ok</span>' : '<span class="pill s70">fail</span>'}</td>
      <td class="num">${jb.run_count}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">任务进程未上报（未启动 jobs.mjs 时属正常）</td></tr>'}
    </tbody></table>
  </div>
  <div class="card">
    <div class="card-head"><h3>日志检索（订单事件 / 审计 / 核销联查）</h3></div>
    <div class="row" style="margin-top:0"><input id="logkw" placeholder="输入订单号 / 操作人 / passId" style="width:320px">
      <button class="btn primary sm" onclick="searchLogs()">检索</button></div>
    <div id="logout2" class="muted">一次输入同时检索订单状态机事件、后台审计与核销流水</div>
  </div>`
}
async function runJob(name) {
  try { const r = await api('POST', '/admin/system/jobs/' + name + '/run', {}); toast('已执行，影响 ' + r.affected + ' 条'); system() } catch (e) { toast(e.message, true) }
}
async function searchLogs() {
  const kw = document.getElementById('logkw').value.trim()
  const r = await api('GET', '/admin/system/logs?q=' + encodeURIComponent(kw))
  document.getElementById('logout2').innerHTML = `
    <h3 style="margin:8px 0">订单事件（${r.orderEvents.length}）</h3>
    ${r.orderEvents.length ? `<ul class="tl">${r.orderEvents.map((e) => `<li><div class="t">${esc(e.order_no)}：${ST[e.from_st] || e.from_st} → ${ST[e.to_st] || e.to_st}</div><div class="d">${esc(String(e.detail || '').replace(/"/g, ''))} · ${esc(e.actor)} · ${esc(String(e.created_at).slice(5, 19))}</div></li>`).join('')}</ul>` : '<p class="muted">无</p>'}
    <h3 style="margin:12px 0 8px">审计（${r.audits.length}）</h3>
    ${r.audits.length ? `<table>${r.audits.map((a) => `<tr><td class="td-sub">${esc(String(a.created_at).slice(5, 19))}</td><td>${esc(a.actor)}</td><td><b>${esc(a.module)}</b>·${esc(a.action)}</td><td class="td-sub">${esc(a.biz_ref || '')}</td></tr>`).join('')}</table>` : '<p class="muted">无</p>'}
    <h3 style="margin:12px 0 8px">核销流水（${r.verifies.length}）</h3>
    ${r.verifies.length ? `<table>${r.verifies.map((v) => `<tr><td>pass#${v.pass_id}</td><td>${['', '扫码', '输码', '补登'][v.method]}</td><td>${v.result === 1 ? '<span class="pill ok">成功</span>' : '<span class="pill s70">异常' + v.result + '</span>'}</td><td class="td-sub">${esc(String(v.created_at).slice(5, 19))}</td></tr>`).join('')}</table>` : '<p class="muted">无</p>'}`
}

/* ============ 功能开关（能力管理）============ */
async function features() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const rows = await api('GET', '/admin/features')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>功能开关</h2><span class="muted">4 角色 × 端 × 城市的能力开关 · SaaS 化与灰度的载体 · 即时生效并留审计</span></div>
    <table><thead><tr><th>能力</th><th>说明</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${rows.map((f) => `<tr><td><code>${esc(f.key)}</code></td><td class="td-sub">${esc(f.memo || '')}</td>
      <td>${f.on ? '<span class="pill ok">开启</span>' : '<span class="pill off">关闭</span>'}</td>
      <td><button class="btn ${f.on ? 'ghost' : 'primary'} sm" onclick="toggleFeature('${esc(f.key)}')">${f.on ? '关闭' : '开启'}</button></td></tr>`).join('')}
    </tbody></table>
    <p class="muted" style="margin-top:12px">扩展维度：feature.city.320508（苏州开城）· feature.promo（推广灰度）· 新主题小程序上线 = 新增 feature.channel.yoga</p>
  </div>`
}
async function toggleFeature(key) {
  try { const r = await api('POST', '/admin/features/' + key + '/toggle', {}); toast(r.key + ' → ' + (r.on ? '开启' : '关闭')); features() } catch (e) { toast(e.message, true) }
}

/* ============ 内容审核（笔记 + 线路评价） ============ */
async function content() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const [rows, rvs] = await Promise.all([api('GET', '/admin/content'), api('GET', '/admin/reviews')])
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>笔记审核</h2><span class="muted">P0 笔记只读 · P1 开放发布后进入此队列（机审+人工）</span></div>
    ${rows.length ? `<table><thead><tr><th>作者</th><th>标题</th><th>内容</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
    ${rows.map((n) => `<tr><td>${esc(n.nickname)}</td><td class="td-main">${esc(n.title || '（无题）')}</td>
      <td class="td-sub" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(String(n.body).slice(0, 50))}</td>
      <td>${['<span class="pill warn">机审中</span>', '<span class="pill s20">人工审核</span>', '<span class="pill ok">已发布</span>', '<span class="pill s70">已驳回</span>', '<span class="pill off">已下架</span>'][n.status]}</td>
      <td class="td-sub">${esc(String(n.created_at).slice(5, 16))}</td>
      <td>${[0, 1].includes(n.status) ? `<button class="btn primary sm" onclick="verdict('content', ${n.id}, true)">通过</button>
        <button class="btn danger sm" onclick="verdict('content', ${n.id}, false)">驳回</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('暂无待审内容（P1 开放笔记发布后进入此队列）')}
  </div>
  <div class="card">
    <div class="card-head"><h2>线路评价管理</h2><span class="muted">游客核销后一单一评 · 文本已过机审 · 可隐藏违规/刷评</span></div>
    ${rvs.length ? `<table><thead><tr><th>用户</th><th>线路</th><th>评分</th><th>内容</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${rvs.map((r) => `<tr><td>${esc(r.nickname)}</td><td class="td-main">${esc(r.title)}</td>
      <td class="num" style="color:var(--brand);font-weight:700">${r.rating} ★</td>
      <td class="td-sub" style="max-width:320px">${esc(r.content)}</td>
      <td><span class="pill ${r.status === 1 ? 'ok' : 'off'}">${r.status === 1 ? '展示中' : '已隐藏'}</span></td>
      <td><button class="btn ${r.status === 1 ? 'danger' : 'primary'} sm" onclick="toggleReview(${r.id}, ${r.status === 1 ? 0 : 1})">${r.status === 1 ? '隐藏' : '恢复展示'}</button></td></tr>`).join('')}
    </tbody></table>` : emptyBox('还没有评价——游客核销完成后可评价')}
  </div>`
}
async function toggleReview(id, show) {
  try { await api('POST', `/admin/reviews/${id}/hide`, { show }); content() } catch (e) { toast(e.message, true) }
}

/* ============ 提现审批（资金出口）============ */
async function withdrawals() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/withdrawals')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>推广服务费提现审批</h2><span class="muted">资金出口 · 财务角色审批 · 打款流水必填留痕</span></div>
    ${rows.length ? `<table><thead><tr><th>申请号</th><th>推广员</th><th>金额</th><th>备注</th><th>状态</th><th>审批</th><th>操作</th></tr></thead><tbody>
    ${rows.map((w) => `<tr><td class="num">#${w.id}</td><td>${esc(w.nickname)}<div class="td-sub">ID ${w.promoter_id}</div></td>
      <td class="money num">${fen(w.amount)}</td><td class="td-sub">${esc(w.proposer_note || '')}</td>
      <td>${['<span class="pill warn">待审</span>', '<span class="pill ok">已打款</span>', '<span class="pill s70">已驳回</span>'][w.status]}</td>
      <td class="td-sub">${esc(w.reviewed_by || '—')}${w.pay_ref ? '<div>' + esc(w.pay_ref) + '</div>' : ''}</td>
      <td>${w.status === 0 ? `<button class="btn primary sm" onclick="approveWithdraw(${w.id}, true)">通过并打款</button>
        <button class="btn danger sm" onclick="approveWithdraw(${w.id}, false)">驳回</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('暂无提现申请（推广员在小程序 A「推广中心」发起）')}
  </div>`
}
async function approveWithdraw(id, pass) {
  const payRef = pass ? prompt('打款流水号（商家转账单号）：', 'BANK-' + Date.now()) : null
  if (pass && !payRef) return
  try { await api('POST', '/admin/withdrawals/' + id + '/verdict', { pass, payRef }); toast(pass ? '已打款并留痕' : '已驳回'); withdrawals() } catch (e) { toast(e.message, true) }
}

/* ============ 协议变更 ============ */
async function agreements() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/agreements')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商户协议变更</h2><span class="muted">生效即重算五口径分账 · 财务审批</span></div>
    ${rows.length ? `<table><thead><tr><th>商户</th><th>科目</th><th>变更</th><th>理由</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="td-main">${esc(a.merchant_name)}</td><td><code>${esc(a.item_code)}</code></td>
      <td><span class="diff-old">${fen(a.old_price)}</span> → <span class="diff-new">${fen(a.new_price)}</span></td>
      <td class="td-sub">${esc(a.reason || '')}</td>
      <td>${['<span class="pill warn">待审</span>', '<span class="pill ok">生效</span>', '<span class="pill s70">驳回</span>'][a.status]}</td>
      <td>${a.status === 0 ? `<button class="btn primary sm" onclick="verdict('agreements', ${a.id}, true)">同意</button>
        <button class="btn danger sm" onclick="verdict('agreements', ${a.id}, false)">驳回</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('暂无协议变更申请（商户端小程序 B 发起）')}
  </div>`
}
async function verdict(kind, id, pass) {
  try { await api('POST', `/admin/${kind}/${id}/verdict`, { pass }); toast(pass ? '已通过' : '已驳回'); kind === 'content' ? content() : agreements() } catch (e) { toast(e.message, true) }
}

/* ============ 存证中心（Web3 对外窗口）============ */
async function attest() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/attest/center')
  const STMAP = ['<span class="pill warn">待打包</span>', '<span class="pill s20">已打包</span>', '<span class="pill ok">已上链</span>', '<span class="pill s70">重试</span>']
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>存证中心</h2><span class="muted">${esc(d.chainMode)}</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      ${(d.queue || []).map((qq) => `<div class="kpi"><div class="ico" style="background:var(--brand-soft)">⛓</div>
        <div><div class="l">${esc(qq.biz_type)}</div><div class="v" style="font-size:18px">${Number(qq.pending)} 待锚</div>
        <div class="s">累计 ${Number(qq.total)} · 已锚 ${Number(qq.anchored)}</div></div></div>`).join('') || '<div class="kpi"><div class="s">暂无事件</div></div>'}
    </div>
    <div class="row" style="margin-top:6px"><input id="vref" placeholder="输入订单号验证（如 WL20261024…）" style="width:320px">
      <button class="btn primary sm" onclick="verifyAttest()">验证</button>
      <span class="muted">公开验证口（无登录只读）：/open/verify/order/{单号} —— 给景区 / 政府 / 投资人的「一网可信」窗口</span></div>
    <div id="vout"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>锚定批次（Merkle 根）</h3></div>
    ${(d.batches || []).length ? `<table><thead><tr><th>批次</th><th>业务日</th><th>Merkle 根</th><th>链上编号</th><th>状态</th></tr></thead><tbody>
      ${d.batches.map((b) => `<tr><td>#${b.id}</td><td>${esc(String(b.biz_date).slice(0, 10))}</td>
        <td><code>${esc(String(b.merkle_root).slice(0, 24))}…</code></td><td class="td-sub">${esc(b.chain_tx_ref || '—')}</td>
        <td>${STMAP[b.status]}</td></tr>`).join('')}</tbody></table>` : emptyBox('尚无锚定批次（Noop 阶段队列实时记哈希，接链数根后按小时出批次）')}
  </div>
  <div class="card">
    <div class="card-head"><h3>最近事件</h3></div>
    <table><thead><tr><th>类型</th><th>业务单号</th><th>状态</th><th>Merkle 根</th><th>时间</th></tr></thead><tbody>
    ${(d.recent || []).map((e) => `<tr><td><span class="pill off">${esc(e.biz_type)}</span></td><td class="num">${esc(e.biz_ref)}</td>
      <td>${STMAP[e.status]}</td><td class="td-sub">${e.merkle_root ? '<code>' + esc(String(e.merkle_root).slice(0, 16)) + '…</code>' : '—'}</td>
      <td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td></tr>`).join('')}
    </tbody></table>
  </div>`
}
/* ============ 暗号 / 逐品佣金 / KYC / 共创 ============ */
async function phrases() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/phrases')
  const prods = await api('GET', '/admin/products')
  const noPhrase = prods.filter((p) => !list.some((x) => x.id === p.id))
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h3>暗号管理（剧本游「入戏」凭证）</h3>
    <span class="muted">用户暗号给游客 · 商家暗号核销员对答 · 命中即核销</span></div>
    ${list.length ? `<table><thead><tr><th>产品</th><th>用户暗号</th><th>商家暗号</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td>${esc(x.title)}</td><td>${esc(x.phrase_user)}</td><td>${esc(x.phrase_merchant || '—')}</td>
      <td><button class="btn sm" onclick="editPhrase(${x.id},'${esc(x.phrase_user)}','${esc(x.phrase_merchant || '')}')">编辑</button>
      <button class="btn ghost sm" onclick="editPhrase(${x.id},'','')">清除</button></td></tr>`).join('')}</tbody></table>`
    : emptyBox('还没有产品配暗号——下方为产品配一对口令')}
    <div class="card-head" style="margin-top:14px"><h3>为产品配置暗号</h3></div>
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <select id="phProd" class="inp" style="max-width:280px">${noPhrase.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <input id="phUser" class="inp" placeholder="用户暗号（如：放生桥边等船否）" style="max-width:260px">
      <input id="phMer" class="inp" placeholder="商家暗号（如：漕港河里载秋来）" style="max-width:260px">
      <button class="btn primary" onclick="savePhrase()">保存</button>
    </div></div>`
}
window.editPhrase = (id, u, m) => {
  editPhrase._id = id
  $('#app').querySelectorAll('input.inp')[0].value = u
  $('#app').querySelectorAll('input.inp')[1].value = m
  editPhrase._editing = true
}
window.savePhrase = async () => {
  const inputs = $('#app').querySelectorAll('input.inp')
  const pid = editPhrase._editing ? editPhrase._id : $('#phProd').value
  await api('POST', '/admin/phrases/' + pid, { userPhrase: inputs[0].value, merchantPhrase: inputs[1].value })
  editPhrase._editing = false
  go('phrases')
}
async function rateov() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const prods = await api('GET', '/admin/products')
  const ov = await api('GET', '/admin/rate-overrides').catch(() => [])
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h3>逐品佣金覆盖（D2 扩展）</h3>
    <span class="muted">单品费率优先于推广商档位 · 上限 12% · 留空=恢复档位费率</span></div>
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <select id="roProd" class="inp" style="max-width:280px">${prods.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <input id="roBp" class="inp" placeholder="费率 %（如 9.5）" style="max-width:160px">
      <button class="btn primary" onclick="saveRate()">设置</button>
      <button class="btn ghost" onclick="saveRate(true)">清除覆盖</button>
    </div>
    ${ov.length ? `<table style="margin-top:12px"><thead><tr><th>产品</th><th>单品费率</th></tr></thead><tbody>
    ${ov.map((x) => `<tr><td>${esc(x.title)}</td><td><b>${(Number(x.promo_rate_bp) / 100).toFixed(2)}%</b></td></tr>`).join('')}</tbody></table>`
    : '<div class="muted" style="margin-top:12px">暂无单品覆盖，全部走推广商档位 5/8/12%</div>'}</div>`
}
window.saveRate = async (clear) => {
  const bp = clear ? null : Math.round(parseFloat($('#roBp').value) * 100)
  await api('POST', '/admin/rate-overrides/' + $('#roProd').value, { rateBp: bp })
  go('rateov')
}
async function kyc() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/kyc')
  const st = { 0: '<span class="pill warn">待审</span>', 1: '<span class="pill ok">已通过</span>', 2: '<span class="pill s70">已驳回</span>' }
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h3>实名认证审核</h3><span class="muted">身份证号加密落库 · 仅展示脱敏号</span></div>
    ${list.length ? `<table><thead><tr><th>用户</th><th>姓名</th><th>证件号（脱敏）</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td>${esc(x.nickname)}</td><td>${esc(x.real_name)}</td><td class="num">${esc(x.id_no_mask)}</td>
      <td>${st[x.status] || x.status}</td><td class="td-sub">${String(x.created_at).slice(0, 16)}</td>
      <td>${x.status === 0 ? `<button class="btn primary sm" onclick="kycResolve(${x.id},'pass')">通过</button>
        <button class="btn ghost sm" onclick="kycResolve(${x.id},'reject')">驳回</button>` : (x.reject_note ? '<span class="td-sub">' + esc(x.reject_note) + '</span>' : '')}</td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无实名认证申请')}</div>`
}
window.kycResolve = async (id, action) => {
  let note = null
  if (action === 'reject') {
    note = prompt('驳回原因：') || '资料不符'
  }
  await api('POST', '/admin/kyc/' + id + '/resolve', { action, note })
  go('kyc')
}
async function cocreate() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const prods = await api('GET', '/admin/products')
  const list = await api('GET', '/admin/co-creators')
  const profits = await api('GET', '/admin/co-profits').catch(() => [])
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h3>共创人（资金商/商品商 · 按产品投资分润）</h3>
    <span class="muted">结算期自动按 产品GMV占比 × 留存毛利 × share_pct 入账</span></div>
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <select id="coProd" class="inp" style="max-width:240px">${prods.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <input id="coName" class="inp" placeholder="姓名" style="max-width:120px">
      <input id="coMobile" class="inp" placeholder="手机号" style="max-width:150px">
      <select id="coRole" class="inp" style="max-width:120px"><option value="1">资金商</option><option value="2">商品商</option></select>
      <input id="coInvest" class="inp" placeholder="投资额(元)" style="max-width:120px">
      <input id="coPct" class="inp" placeholder="分润 %（如 8）" style="max-width:120px">
      <button class="btn primary" onclick="saveCo()">登记</button>
    </div>
    ${list.length ? `<table style="margin-top:12px"><thead><tr><th>编号</th><th>产品</th><th>姓名</th><th>角色</th><th>投资额</th><th>分润</th><th>状态</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td class="num">${esc(x.co_no)}</td><td>${esc(x.title)}</td><td>${esc(x.name)}</td>
      <td>${Number(x.role) === 1 ? '资金商' : '商品商'}</td><td class="num">¥${(Number(x.invest_amount) / 100).toFixed(0)}</td>
      <td class="num">${(Number(x.share_pct) / 100).toFixed(1)}%</td>
      <td>${Number(x.status) === 1 ? '<span class="pill ok">生效</span>' : '<span class="pill off">停用</span>'}
      <button class="btn ghost sm" onclick="toggleCo(${x.id},${x.status})">${Number(x.status) === 1 ? '停用' : '启用'}</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="muted" style="margin-top:12px">暂无共创人</div>'}
    <div class="card-head" style="margin-top:14px"><h3>共创分润台账（链上分润凭证）</h3></div>
    ${profits.length ? `<table><thead><tr><th>期</th><th>共创人</th><th>产品</th><th>基数</th><th>分润额</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${profits.map((x) => `<tr><td>${esc(x.period)}</td><td>${esc(x.name)}（${esc(x.co_no)}）</td><td>${esc(x.title)}</td>
      <td class="num">¥${(Number(x.base_amount) / 100).toFixed(2)}</td><td class="num"><b>¥${(Number(x.amount) / 100).toFixed(2)}</b></td>
      <td>${Number(x.status) === 1 ? '<span class="pill ok">已打款</span>' : '<span class="pill warn">待打款</span>'}</td>
      <td>${Number(x.status) === 0 ? `<button class="btn primary sm" onclick="payCo(${x.id})">标记打款</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="muted">暂无分润记录——生成结算单后自动入账</div>'}</div>`
}
window.saveCo = async () => {
  await api('POST', '/admin/co-creators', { productId: $('#coProd').value, name: $('#coName').value, mobile: $('#coMobile').value,
    role: Number($('#coRole').value), investAmount: Math.round(parseFloat($('#coInvest').value || '0') * 100), sharePct: Math.round(parseFloat($('#coPct').value || '0') * 100) })
  go('cocreate')
}
window.toggleCo = async (id, st) => { await api('POST', '/admin/co-creators/' + id + '/status', { status: st === 1 ? 0 : 1 }); go('cocreate') }
window.payCo = async (id) => { await api('POST', '/admin/co-profits/' + id + '/pay'); go('cocreate') }

/* ============ 术语映射（合规词 ↔ 链词，D6 双层口径） ============ */
const TERM_MAP = [
  ['旅豆', '向往自由链积分（Bean Token）', '小程序端一律叫「旅豆」；后台台账/存证语境可用链上口径'],
  ['入园凭证', '链上权益凭证（Pass NFT 语义）', '凭证编号即链上资产编号；小程序端禁提 NFT'],
  ['存证中心', '上链存证（Merkle Anchor）', '对外讲「一网可信」；后台展示 Merkle 根与锚定批次'],
  ['积分资产发行', 'Token Issuance（按预算批次）', '发行即 mint 语义，但受 global_cap 哨兵约束，严禁超发'],
  ['勋章', '链上数字勋章（Badge SBT 语义）', '不可转让（SBT）；小程序端叫「勋章」'],
  ['用户数字钱包', '用户权益账户（Wallet 视图）', '仅后台可见链词；小程序端无钱包概念'],
  ['共创分润', '链上分润凭证（Revenue Share）', '分润台账每期上链锚定；小程序端不出现'],
  ['推广服务商', '分销合约节点（Affiliate Node）', 'D2 定稿禁止层级计酬；链词仅内部运营语境'],
]
async function terms() {
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h3>术语映射表（后台 Web3 口径 ↔ 小程序合规口径）</h3></div>
    <div class="muted" style="margin-bottom:10px">后台不上小程序审核，可用 Web3 真实词汇；两个小程序端一律走合规词。改动任何界面文案前先对照本表，避免口径串台。</div>
    <table><thead><tr><th>小程序合规词（用户可见）</th><th>后台/存证链词（内部运营）</th><th>使用边界</th></tr></thead><tbody>
    ${TERM_MAP.map((t) => `<tr><td><b>${t[0]}</b></td><td>${t[1]}</td><td class="td-sub">${t[2]}</td></tr>`).join('')}</tbody></table>
    <div class="note" style="margin-top:10px">红线（D6）：不对应股权/Token 收益权、不按层级计酬、境内外隔离。链词仅出现在本后台与存证报告，绝不回灌小程序。</div></div>`
}

/* ============ WEB3 工作区 ============ */
async function web3dash() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/overview')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>链上总览 · 向往自由链</h2><span class="muted">${esc(d.chainMode)} · 双层口径：小程序内=旅豆积分，对外=链上权益凭证</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">⛓</div><div><div class="l">锚定批次</div><div class="v" style="font-size:18px">${d.anchoredBatches}/${d.batches}</div><div class="s">Merkle 小时级打包</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">🔗</div><div><div class="l">链上事件</div><div class="v" style="font-size:18px">${d.anchoredEvents}/${d.events}</div><div class="s">待打包 ${d.pendingEvents}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">🏅</div><div><div class="l">勋章发放</div><div class="v" style="font-size:18px">${d.badgeGrants}</div><div class="s">发放即入存证队列</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e3f6ec">🫘</div><div><div class="l">积分资产</div><div class="v" style="font-size:18px">${d.beanGranted}</div><div class="s">已消耗 ${d.beanConsumed}</div></div></div>
    </div>
    <div class="row" style="margin-top:10px">${(d.trustPath || []).map((t, i) => `<span class="pill ${i ? 'off' : 'ok'}">${esc(t)}</span>`).join('<span class="muted">→</span>')}<span class="muted" style="margin-left:auto">上链的只有哈希指纹+时间戳，业务数据全在 MySQL（数据库是事实来源，链是审计锚点）</span></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>链上事件动态</h3><button class="btn ghost sm" onclick="go('attest')">进入存证中心 ›</button></div>
    <table><thead><tr><th>类型</th><th>业务单号</th><th>状态</th><th>时间</th></tr></thead><tbody>
    ${(d.recentEvents || []).map((e) => `<tr><td><span class="pill off">${esc(e.biz_type)}</span></td><td class="num">${esc(e.biz_ref)}</td>
      <td>${e.status === 2 ? '<span class="pill ok">已上链</span>' : '<span class="pill warn">待打包</span>'}</td>
      <td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无事件</td></tr>'}
    </tbody></table>
  </div>`
}
async function pointassets() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/point-assets')
  const BIZ = { 1: '消费返豆', 2: '任务奖励', 3: '内容奖励', 4: '抵扣', 5: '退款冲正', 6: '过期回收', 7: '风控调整' }
  const capPct = d.globalCap ? Math.min(100, Math.round(Number(d.globalCap.granted || 0) / Math.max(Number(d.globalCap.cap_total || d.globalCap.total || 1), 1) * 100)) : 0
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>积分资产发行台账</h2><span class="muted">旅豆 = 向往自由链积分资产（D6 外层口径）</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="ico" style="background:#fdf3e0">👥</div><div><div class="l">持有人数</div><div class="v" style="font-size:18px">${d.holders}</div><div class="s">一户一账（bean_account）</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">📦</div><div><div class="l">发行批次</div><div class="v" style="font-size:18px">${(d.budgets || []).length}</div><div class="s">按批次预算发行</div></div></div>
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">🛡</div><div><div class="l">年度总量哨兵</div><div class="v" style="font-size:18px">${d.globalCap ? (d.globalCap.cap_total || d.globalCap.total || '—') : '—'}</div><div class="s">严禁超发 · 双分录平衡</div></div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h3>发行批次</h3></div>
    <table><thead><tr><th>批次</th><th>名称</th><th>额度</th><th>已发放</th><th>回流</th><th>状态</th></tr></thead><tbody>
    ${(d.budgets || []).map((b) => `<tr><td>#${b.id}</td><td>${esc(b.name || '—')}</td><td class="num">${Number(b.total)}</td>
      <td class="num">${Number(b.granted)}</td><td class="num">${Number(b.returned)}</td>
      <td>${b.status === 1 ? '<span class="pill ok">启用</span>' : '<span class="pill s70">停用</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="td-sub">暂无批次</td></tr>'}
    </tbody></table>
  </div>
  <div class="card">
    <div class="card-head"><h3>按科目流水汇总（发行/销毁）</h3></div>
    <table><thead><tr><th>科目</th><th>发行（贷）</th><th>消耗/回收（借）</th></tr></thead><tbody>
    ${(d.byBiz || []).map((x) => `<tr><td>${BIZ[x.biz_type] || ('类型' + x.biz_type)}</td><td class="num">${Number(x.issued)}</td><td class="num">${Number(x.burned)}</td></tr>`).join('')}
    </tbody></table>
  </div>`
}
async function badges() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/badges')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>勋章资产发行</h2><span class="muted">勋章发放即写入链上存证队列（badge 事件）</span></div>
    <div class="row">
      <input id="bgName" placeholder="勋章名称（如 朱家角探索者）" style="width:200px">
      <input id="bgIcon" placeholder="图标键（如 badge_zjj）" style="width:160px">
      <input id="bgRule" placeholder="授予规则说明" style="width:220px">
      <button class="btn primary sm" onclick="createBadge()">新建定义</button>
    </div>
    <table style="margin-top:10px"><thead><tr><th>ID</th><th>名称</th><th>图标键</th><th>授予规则</th><th>已发放</th><th>操作</th></tr></thead><tbody>
    ${(d.defs || []).map((b) => `<tr><td>#${b.id}</td><td>${esc(b.name)}</td><td class="td-sub">${esc(b.icon_key)}</td>
      <td class="td-sub">${esc(b.rule_desc || '—')}</td><td class="num">${Number(b.granted)}</td>
      <td><button class="btn ghost sm" onclick="grantBadge(${b.id})">发放给用户</button></td></tr>`).join('') || '<tr><td colspan="6" class="td-sub">暂无勋章定义（先新建）</td></tr>'}
    </tbody></table>
  </div>
  <div class="card">
    <div class="card-head"><h3>最近发放</h3></div>
    <table><thead><tr><th>用户</th><th>勋章</th><th>时间</th></tr></thead><tbody>
    ${(d.recent || []).map((r) => `<tr><td>${esc(r.nickname || ('用户' + r.user_id))}</td><td>${esc(r.name)}</td><td class="td-sub">${esc(String(r.granted_at).slice(0, 19))}</td></tr>`).join('') || '<tr><td colspan="3" class="td-sub">暂无发放记录</td></tr>'}
    </tbody></table>
  </div>`
}
async function createBadge() {
  const name = document.getElementById('bgName').value.trim()
  const iconKey = document.getElementById('bgIcon').value.trim()
  if (!name || !iconKey) return toast('名称与图标键必填', true)
  const ruleDesc = document.getElementById('bgRule').value.trim()
  const r = await api('POST', '/admin/web3/badges', { name, iconKey, ruleDesc })
  toast('勋章定义已创建 #' + r.id); badges()
}
async function grantBadge(id) {
  const userId = prompt('发放给用户 ID：')
  if (!userId) return
  const reason = prompt('授予原因（可选）：') || ''
  try {
    const r = await api('POST', '/admin/web3/badges/' + id + '/grant', { userId: Number(userId), reason })
    toast('已发放「' + r.badge + '」并入存证队列'); badges()
  } catch (e) { toast(e.message, true) }
}
async function wallets() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const kw = (document.getElementById('wkw') && document.getElementById('wkw').value.trim()) || ''
  const d = await api('GET', '/admin/web3/wallets' + (kw ? '?kw=' + encodeURIComponent(kw) : ''))
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>用户数字钱包 / 数字资产</h2>
      <div class="row" style="margin:0"><input id="wkw" placeholder="昵称 / 用户ID" style="width:180px" value="${esc(kw)}">
      <button class="btn ghost sm" onclick="wallets()">查询</button></div></div>
    <table><thead><tr><th>用户</th><th>积分余额</th><th>等级</th><th>成长值</th><th>勋章</th><th>存证事件</th><th></th></tr></thead><tbody>
    ${d.map((w) => `<tr><td>${esc(w.nickname || '用户' + w.user_id)}</td><td class="num"><b>${Number(w.balance)}</b></td>
      <td><span class="pill off">Lv${w.member_level}</span></td><td class="num">${Number(w.growth_value)}</td>
      <td class="num">${Number(w.badges)}</td><td class="num">${Number(w.attest_n)}</td>
      <td><button class="btn ghost sm" onclick="walletDetail(${w.user_id})">资产明细 ›</button></td></tr>`).join('') || '<tr><td colspan="7" class="td-sub">暂无钱包</td></tr>'}
    </tbody></table>
  </div>
  <div id="wdetail"></div>`
}
async function walletDetail(uid) {
  const d = await api('GET', '/admin/web3/wallets/' + uid)
  $('#wdetail').innerHTML = `
  <div class="card">
    <div class="card-head"><h3>${esc(d.profile.nickname || '用户' + uid)} · 数字资产明细</h3><span class="muted">余额 ${Number(d.balance)} · Lv${d.profile.member_level} · 成长值 ${Number(d.profile.growth_value)}</span></div>
    <div class="row" style="gap:8px">${(d.badges || []).map((b) => `<span class="pill ok">🏅 ${esc(b.name)}</span>`).join('') || '<span class="muted">暂无勋章</span>'}</div>
    <table style="margin-top:10px"><thead><tr><th>流水</th><th>方向</th><th>科目</th><th>数量</th><th>关联单号</th><th>时间</th></tr></thead><tbody>
    ${(d.ledger || []).slice(0, 12).map((l) => `<tr><td class="td-sub">${esc(String(l.tx_no).slice(0, 20))}…</td>
      <td>${l.direction === 1 ? '<span class="pill ok">+ 发行</span>' : '<span class="pill s20">- 消耗</span>'}</td>
      <td>${l.biz_type}</td><td class="num">${Number(l.amount)}</td><td class="td-sub">${esc(l.biz_ref || '—')}</td>
      <td class="td-sub">${esc(String(l.created_at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="6" class="td-sub">暂无流水</td></tr>'}
    </tbody></table>
    <div class="card-head" style="margin-top:12px"><h3>存证流水</h3></div>
    <table><thead><tr><th>订单号</th><th>载荷哈希</th><th>状态</th><th>时间</th></tr></thead><tbody>
    ${(d.attestations || []).map((a) => `<tr><td class="num">${esc(a.orderNo)}</td><td><code>${esc(String(a.hash).slice(0, 20))}…</code></td>
      <td>${a.anchored ? '<span class="pill ok">已锚定</span>' : '<span class="pill warn">待打包</span>'}</td><td class="td-sub">${esc(String(a.at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无存证流水</td></tr>'}
    </tbody></table>
    <div class="muted" style="margin-top:8px">${esc(d.statement)}</div>
  </div>`
}
/* ============ CSV 导出（低垂果实 #4）============ */
async function downloadExport(what) {
  try {
    const r = await fetch('/admin/export/' + what, { headers: { Authorization: 'Bearer ' + TOKEN } })
    const j = await r.json()
    const blob = new Blob([j.csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = j.filename; a.click()
    URL.revokeObjectURL(a.href)
    toast('已导出 ' + j.filename)
  } catch (e) { toast('导出失败：' + e.message, true) }
}
const EXPBTN = (what, label) => `<button class="btn ghost sm" style="margin-left:auto" onclick="downloadExport('${what}')">⬇ 导出${label || ''}</button>`

/* ============ 常见问题 / 轮播管理（低垂果实 #5）============ */
async function faqs() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const d = await api('GET', '/admin/faqs')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>常见问题管理</h2><span class="muted">小程序「我的-常见问题」展示位 · 按序号排序</span></div>
    <div class="row">
      <input id="fq" placeholder="问题" style="width:260px">
      <input id="fa" placeholder="答案" style="width:340px">
      <input id="fs" type="number" placeholder="序号" style="width:70px">
      <button class="btn primary sm" onclick="addFaq()">新增</button>
    </div>
    <table style="margin-top:10px"><thead><tr><th>序号</th><th>问题</th><th>答案</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${d.map((f) => `<tr><td class="num">${f.sort}</td><td>${esc(f.question)}</td><td class="td-sub">${esc(String(f.answer).slice(0, 60))}…</td>
      <td>${f.status === 1 ? '<span class="pill ok">上架</span>' : '<span class="pill s70">下架</span>'}</td>
      <td><button class="btn ghost sm" onclick="toggleFaq(${f.id}, ${f.status === 1 ? 0 : 1})">${f.status === 1 ? '下架' : '上架'}</button>
      <button class="btn ghost sm" onclick="delFaq(${f.id})">删除</button></td></tr>`).join('')}
    </tbody></table>
  </div>`
}
async function addFaq() {
  const question = document.getElementById('fq').value.trim(), answer = document.getElementById('fa').value.trim()
  if (!question || !answer) return toast('问题与答案必填', true)
  await api('POST', '/admin/faqs', { question, answer, sort: Number(document.getElementById('fs').value) || 0 })
  toast('已新增'); faqs()
}
async function toggleFaq(id, status) { await api('POST', '/admin/faqs/' + id + '/update', { status }); faqs() }
async function delFaq(id) {
  if (!confirm('确认删除该问题？')) return
  await api('POST', '/admin/faqs/' + id + '/delete', {}); toast('已删除'); faqs()
}
async function banners() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const d = await api('GET', '/admin/banners')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>轮播媒体管理</h2><span class="muted">小程序首页轮播位 · 图片支持外链或 /uploads 路径</span></div>
    <div class="row">
      <input id="bt" placeholder="标题" style="width:160px">
      <input id="bi" placeholder="图片 URL" style="width:260px">
      <input id="bl" placeholder="跳转路径（选填）" style="width:220px">
      <input id="bs" type="number" placeholder="序号" style="width:70px">
      <button class="btn primary sm" onclick="addBanner()">新增</button>
    </div>
    <table style="margin-top:10px"><thead><tr><th>预览</th><th>标题</th><th>跳转</th><th>序号</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${d.map((b) => `<tr><td><img src="${esc(b.image)}" style="width:72px;height:40px;object-fit:cover;border-radius:6px"></td>
      <td>${esc(b.title)}</td><td class="td-sub">${esc(b.link || '—')}</td><td class="num">${b.sort}</td>
      <td>${b.status === 1 ? '<span class="pill ok">上架</span>' : '<span class="pill s70">下架</span>'}</td>
      <td><button class="btn ghost sm" onclick="toggleBanner(${b.id}, ${b.status === 1 ? 0 : 1})">${b.status === 1 ? '下架' : '上架'}</button>
      <button class="btn ghost sm" onclick="delBanner(${b.id})">删除</button></td></tr>`).join('') || '<tr><td colspan="6" class="td-sub">暂无轮播（首页将隐藏轮播位）</td></tr>'}
    </tbody></table>
  </div>`
}
async function addBanner() {
  const title = document.getElementById('bt').value.trim(), image = document.getElementById('bi').value.trim()
  if (!title || !image) return toast('标题与图片必填', true)
  await api('POST', '/admin/banners', { title, image, link: document.getElementById('bl').value.trim(), sort: Number(document.getElementById('bs').value) || 0 })
  toast('已新增'); banners()
}
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
  document.getElementById('vout').innerHTML = r.found
    ? `<div class="card" style="margin-top:14px;background:#f0faf7"><div class="row" style="margin:0">
        <span class="pill ok">✓ 已找到存证记录</span><span>${r.note}</span></div>
       <table style="margin-top:8px"><tr><td class="td-sub">业务单号</td><td class="num">${esc(r.bizRef)}</td></tr>
       <tr><td class="td-sub">载荷哈希</td><td><code>${esc(r.payloadHash)}</code></td></tr>
       ${r.merkleRoot ? `<tr><td class="td-sub">Merkle 根</td><td><code>${esc(r.merkleRoot)}</code></td></tr>` : ''}
       ${r.chainRef ? `<tr><td class="td-sub">链上编号</td><td><code>${esc(r.chainRef)}</code></td></tr>` : ''}</table></div>`
    : `<div class="card" style="margin-top:14px"><span class="pill s70">未找到该单存证记录</span></div>`
}

/* ============ 安全中心（MFA / 通知通道）============ */
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

/* ============ 集成中心（凭据后台化）============ */
async function integrations() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/integrations')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>集成中心</h2><span class="muted">${esc(d.envNote)}</span></div>
    <p class="muted" style="margin:-6px 0 16px">保存即热生效（10 秒缓存刷新）· AES-256-GCM 加密落库 · 仅超管可见可改 · 每次变更审计留痕</p>
    ${d.channels.map((ch) => `
    <div style="padding:16px 0;border-bottom:1px solid #f1f4f8">
      <div class="row" style="margin:0 0 10px;justify-content:space-between">
        <div><b>${esc(ch.name)}</b> <span class="muted" style="margin-left:8px">${esc(ch.desc)}</span></div>
        ${ch.ready ? '<span class="pill ok">● 已配置（生产模式）</span>' : '<span class="pill warn">● 未配置（MOCK 联调）</span>'}
      </div>
      <table>${ch.fields.map((f) => `<tr>
        <td style="width:280px"><code>${esc(f.key)}</code></td>
        <td>${f.stored ? `<span class="pill ok">${esc(f.stored)}</span>` : f.envFallback ? '<span class="pill s20">来自 .env</span>' : '<span class="pill off">未设置</span>'}</td>
        <td style="text-align:right">
          <button class="btn ghost sm" onclick="setCred('${esc(f.key)}')">设置</button>
          ${f.stored ? `<button class="btn danger sm" onclick="delCred('${esc(f.key)}')">清除</button>` : ''}
        </td></tr>`).join('')}</table>
    </div>`).join('')}
  </div>`
}
async function setCred(key) {
  const val = prompt('输入 ' + key + ' 的值（保存后 AES-256-GCM 加密存储）：')
  if (!val) return
  try { await api('POST', '/admin/integrations/' + key, { value: val }); toast(key + ' 已保存，热生效'); integrations() } catch (e) { toast(e.message, true) }
}
async function delCred(key) {
  if (!confirm('清除 ' + key + '？（对应通道将回落到 MOCK 或 .env）')) return
  try { await api('DELETE', '/admin/integrations/' + key); toast('已清除'); integrations() } catch (e) { toast(e.message, true) }
}
boot()
