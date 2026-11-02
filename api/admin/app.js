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
// 按"谁在什么场景下做什么事"分组，而不是按技术模块堆叠
const NAV = [
  ['工作台', [['dash', '驾驶舱', 'dash']]],
  ['交易履约', [['orders', '订单', 'orders'], ['products', '商品与团期', 'products'], ['phrases', '暗号管理', 'flag'], ['conflicts', '离线冲突', 'risk']]],
  ['资金结算', [['settlements', '结算', 'settlements'], ['withdrawals', '提现审批', 'withdraw'], ['agreements', '协议变更', 'eco'], ['budgets', '旅豆预算', 'budgets'], ['rateov', '逐品佣金', 'promoters'], ['cocreate', '共创分润', 'eco']]],
  ['商户与资源', [['merchants', '商户与进件', 'merchants'], ['scenics', '景区资源', 'eco'], ['suppliers', '供应商', 'merchants']]],
  ['用户与内容', [['content', '内容审核', 'content'], ['tasks', '约稿任务', 'flag'], ['creators', '创作者池', 'content'], ['promoters', '推广服务商', 'promoters'], ['kyc', '实名认证', 'audit'], ['banners', '轮播管理', 'flag'], ['faqs', '常见问题', 'audit']]],
  ['可信存证', [['web3dash', '链路总览', 'eco'], ['chainhub', '链接入中心', 'sys'], ['attest', '存证中心', 'eco'], ['chainassets', '链与资产', 'sys'], ['pointassets', '积分发行台账', 'budgets'], ['badges', '勋章发行', 'flag'], ['wallets', '权益账户', 'orders'], ['vc', '数字身份', 'kyc'], ['terms', '术语映射', 'flag']]],
  ['风控与审计', [['risk', '风控事件', 'risk'], ['audit', '审计日志', 'audit']]],
  ['系统设置', [['config', '参数中心', 'config'], ['features', '功能开关', 'flag'], ['integrations', '集成中心', 'withdraw'], ['security', '安全中心', 'risk'], ['system', '运维控制台', 'sys']]],
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
const BIZ_CN = { order: '订单完成', pass_issue: '凭证签发', pass_verify: '到店核销', bean_grant: '旅豆发放', bean_deduct: '旅豆抵扣',
  refund: '退款冲正', settlement: '商户结算', badge: '勋章发放', vc_issue: '身份凭证签发', vc_revoke: '身份凭证吊销', asset_issue: '资产发行' }
/** 审计变更：逐字段对比（JSON 列由驱动解析为对象，不能直接 String()，否则显示 [object Object]） */
function auditDiff(before, after) {
  const obj = (v) => { if (v == null) return {}; if (typeof v === 'string') { try { return JSON.parse(v) } catch { return { value: v } } } return v }
  const b = obj(before), a = obj(after)
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])]
  if (!keys.length) return '—'
  const show = (v) => v === undefined ? '∅' : esc((typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 40))
  return '<div class="audit-diff">' + keys.slice(0, 6).map((k) => b[k] === a[k]
    ? `<div><span class="k">${esc(k)}</span> ${show(a[k])}</div>`
    : `<div><span class="k">${esc(k)}</span> <del>${show(b[k])}</del> → <ins>${show(a[k])}</ins></div>`).join('') + (keys.length > 6 ? `<div class="k">… 共 ${keys.length} 项</div>` : '') + '</div>'
}
const bizTag = (t) => `<span class="biz-tag">${BIZ_CN[t] || t}<small>${t}</small></span>`
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
  const access = { ops: ['dash','orders','products','merchants','content','tasks','faqs','banners','promoters','agreements','kyc','cocreate'], city_partner: ['dash','orders','products','merchants','settlements'], finance: ['dash','orders','settlements','withdrawals','agreements','budgets','audit'], review: ['content','tasks'], risk: ['risk','conflicts','audit'] }
  const allowed = access[ME?.role]
  $('#nav').innerHTML = NAV.map(([g, items]) => {
    items = allowed ? items.filter(([k]) => allowed.includes(k)) : items
    if (!items.length) return ''
    return `<details class="nav-section" ${['工作台','交易履约','资金结算'].includes(g) ? 'open' : ''}><summary class="nav-group">${g}</summary>` + items.map(([k,n,ic]) => `<button class="nav-item" data-p="${k}" onclick="go('${k}')">${ICONS[ic] || ''}<span>${n}</span></button>`).join('') + '</details>'
  }).join('')
  fetch('/c/health').then((r) => r.json()).then((j) => { $('#paymode').textContent = '支付通道：' + (j.data.payMode === 'MOCK' ? '联调 MOCK' : '微信支付 V3 ✓') }).catch(() => {})
  go(allowed ? allowed[0] : 'dash')
}

function go(page) {
  document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('on', a.dataset.p === page))
  const name = { dash: '驾驶舱', orders: '订单', products: '商品与团期', merchants: '商户与进件', settlements: '结算',
    budgets: '旅豆预算', promoters: '推广服务商', config: '参数中心', risk: '风控事件', audit: '审计日志',
    system: '运维控制台', features: '功能开关', content: '内容审核', withdrawals: '提现审批', agreements: '协议变更', attest: '存证中心', security: '安全中心', integrations: '集成中心',
    web3dash: '链路总览', chainhub: '链接入中心', pointassets: '积分发行台账', badges: '勋章发行', wallets: '权益账户', vc: '数字身份', chainassets: '链与资产', contract: '合约调用账户', faqs: '常见问题', banners: '轮播管理', phrases: '暗号管理', rateov: '逐品佣金', kyc: '实名认证', cocreate: '共创分润', terms: '术语映射', tasks: '约稿任务', conflicts: '离线冲突', scenics: '景区资源', suppliers: '供应商', creators: '创作者池' }[page]
  $('#crumb').textContent = name
  const render = ({ dash, orders, products, merchants, settlements, budgets, promoters, config, risk, audit, system, features, content, withdrawals, agreements, attest, security, integrations, web3dash, pointassets, badges, wallets, vc: vcPage, chainassets: chainAssetsPage, contract, faqs, banners, phrases, rateov, kyc, cocreate, terms, tasks, conflicts, scenics, suppliers, creators }[page] || dash)
  Promise.resolve().then(render).catch((e) => { $('#app').innerHTML = `<div class="card error-state"><h2>暂时无法加载${esc(name || '')}</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="go('${page}')">重新加载</button></div>` })
}
const skel = (n = 5) => Array(n).fill('<div class="sk sk-row"></div>').join('')
const emptyBox = (txt) => `<div class="empty"><div class="e-ico">🗂</div>${txt}</div>`

/* ============ 驾驶舱 ============ */
async function dash() {
  try {
  $('#app').innerHTML = `<div class="kpi-grid">${Array(6).fill('<div class="kpi"><div class="sk" style="width:44px;height:44px;border-radius:12px"></div><div style="flex:1"><div class="sk" style="height:12px;width:60%;margin-bottom:8px"></div><div class="sk" style="height:22px;width:40%"></div></div></div>').join('')}</div>
    <div class="card"><div class="sk" style="height:220px"></div></div>`
  const k = await api('GET', '/admin/dash/kpi')
  const orders = await api('GET', '/admin/orders')
  const wxd = await api('GET', '/admin/wxdata/visit-trend').catch(() => ({ mock: true, list: [] }))
  const recent = orders.slice(0, 8)
  const cityTag = k.scopeCity ? `本城 ${k.scopeCity} 口径` : '全域口径'
  const kpis = [
    ['💰', 'var(--brand-soft)', '今日 GMV', '¥' + k.gmvToday, cityTag],
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
  const P_ = ins ? ins.pending : null
  const todoTotal = P_ ? P_.notes + P_.merchants + P_.withdrawals + P_.conflicts + P_.tasks : 0
  const todo = (k, label, n, verb) => `<button class="task-link${n ? ' has' : ''}" onclick="go('${k}')"><span>${label}</span><b>${n}</b>${n ? verb + ' →' : '已清空'}</button>`
  $('#app').innerHTML = `
  ${P_ ? `<div class="card todo-card"><div class="card-head"><h3>今日待办 <span class="muted">· ${cityTag}</span></h3>
      <span class="${todoTotal ? 'pill s10' : 'pill s50'}">${todoTotal ? '共 ' + todoTotal + ' 项待处理' : '全部处理完毕'}</span></div>
    <div class="todo-row">
      ${todo('merchants', '商户进件', P_.merchants, '去审批')}
      ${todo('withdrawals', '提现待审', P_.withdrawals, '去复核')}
      ${todo('conflicts', '核销异常', P_.conflicts, '去处理')}
      ${todo('content', '内容待审', P_.notes, '去审核')}
      ${todo('tasks', '约稿待审', P_.tasks, '去处理')}
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
  ${wxd.list && wxd.list.length && !wxd.mock ? miniVisitCard(wxd) : `<div class="card chart-box"><div class="card-head"><h3>小程序访问趋势</h3></div>
    ${emptyBox('尚未接入微信数据分析：在「集成中心」配置小程序 AppSecret 后显示真实 PV/UV（不展示模拟曲线）')}</div>`}
  ${ins ? `<div class="card"><div class="card-head"><h3>热门主题游 TOP5 <span class="muted">· 已支付口径</span></h3>
      <div class="row" style="gap:20px;margin:0">
        <span class="muted">报名→支付 <b>${ins.funnel.payRate}</b></span>
        <span class="muted">复购线索 <b>${ins.funnel.rebuyRate}</b></span>
        <span class="muted" title="累计抵扣旅豆 ÷ 累计发放旅豆">旅豆使用率 <b>${ins.funnel.beanUseRate}</b></span>
      </div></div>
    <table><thead><tr><th>#</th><th>主题游</th><th>订单</th><th>GMV</th></tr></thead><tbody>
    ${ins.topTours.map((t, i) => `<tr><td class="num">${i + 1}</td><td>${esc(t.title)}</td><td class="num">${Number(t.orders)}</td><td class="num">¥${(Number(t.gmv) / 100).toFixed(0)}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无数据</td></tr>'}
    </tbody></table></div>` : ''}
  <div class="card">
    <div class="card-head"><h3>最近订单</h3><button class="btn ghost sm" onclick="go('orders')">全部订单 →</button></div>
    ${recent.length ? `<table><thead><tr><th>单号</th><th>商品</th><th>用户</th><th>金额</th><th>状态</th><th>支付时间</th></tr></thead><tbody>
      ${recent.map((o) => `<tr style="cursor:pointer" onclick="orderDrawer('${o.order_no}')">
        <td class="num">${esc(o.order_no)}</td><td class="td-main">${esc(o.title)}</td><td>${esc(o.nickname)}</td>
        <td class="money num">${fen(o.amount_pay)}</td><td><span class="pill s${o.status}">${ST[o.status]}</span></td>
        <td class="td-sub">${esc(String(o.paid_at || o.created_at || '').slice(5, 16))}</td></tr>`).join('')}</tbody></table>` : emptyBox('还没有订单')}
  </div>`
  } catch (e) {
    console.error('dash error:', e.message)
    toast(e.message || '驾驶舱加载失败', true)
    $('#app').innerHTML = '<div class="empty"><div class="e-ico">⚠</div>驾驶舱加载失败</div>'
  }
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
    ${o.refunds?.length ? `<h3 style="margin:16px 0 8px">退款单</h3><table>
      ${o.refunds.map((r) => `<tr><td class="num">${esc(r.refund_no)}<div class="td-sub">${esc(r.operator || '')} · ${esc(r.reason || '')}</div></td>
        <td>实退 <b>${fen(r.amount)}</b>${Number(r.fee_amount) ? `<div class="td-sub">手续费 ${fen(r.fee_amount)}（${Math.round(Number(r.fee_rate) * 1000) / 10}% · 距出发 ${r.days_to_depart} 天）</div>` : '<div class="td-sub">全额</div>'}</td>
        <td><span class="pill ${Number(r.status) === 2 ? 's50' : 's60'}">${['申请', '处理中', '已退款', '已拒绝'][r.status] || r.status}</span></td></tr>`).join('')}</table>` : ''}
    <h3 style="margin:16px 0 10px">状态机时间线（order_event 审计）</h3>
    <ul class="tl">${(o.events || []).map((e) => `<li>
      <div class="t">${ST[e.from_st] || e.from_st} → ${ST[e.to_st] || e.to_st}</div>
      <div class="d">${esc(String(e.detail || '').replace(/"/g, ''))} · ${esc(e.actor)} · ${esc(String(e.created_at).slice(5, 19))}</div></li>`).join('')}</ul>`)
}
async function refundOrder(no) {
  let qt = null
  try { qt = (await api('GET', '/admin/orders/' + no)).refundQuote } catch (e) { /* 试算失败不阻断客服全额处理 */ }
  const policyLine = !qt ? '<p class="muted">该订单已核销或状态不适用退改梯度，只能由客服全额处理。</p>'
    : qt.allowed ? `<p>按退改规则：距出发 <b>${qt.daysToDepart}</b> 天，手续费 <b>${fen(qt.feeFen)}</b>（${Math.round(qt.rate * 1000) / 10}%），实退 <b>${fen(qt.refundFen)}</b>。</p>`
    : `<p class="muted">按退改规则不可自助退款：${esc(qt.reason)}</p>`
  modal('退款处理', `<p>订单 <code>${esc(no)}</code></p>${policyLine}
    <label>处理原因（写入审计与存证）</label><textarea id="rf_reason" placeholder="如：游客行程变更 / 已核销售后，经核实服务未履约"></textarea>
    <p class="muted" style="margin-top:8px">两种方式都会执行全量冲正：原路退款 · 退回抵扣旅豆 · 入园凭证作废 · 关联佣金置无效。</p>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button>
     ${qt && qt.allowed ? `<button class="btn ghost" onclick="doRefund('${no}','policy')">按规则退 ${fen(qt.refundFen)}</button>` : ''}
     <button class="btn danger" onclick="doRefund('${no}','full')">全额退款（客服特批）</button>`)
}
async function doRefund(no, mode) {
  const reason = ($('#rf_reason')?.value || '').trim()
  if (mode === 'full' && !reason) return toast('全额特批请填写处理原因', true)
  try {
    const r = await api('POST', '/admin/orders/' + no + '/refund', { mode, reason })
    closeModal()
    toast(r.refunded ? `退款完成：实退 ${fen(r.refundFen)}${r.feeFen ? '，手续费 ' + fen(r.feeFen) : ''}` : '退款已受理，待支付通道确认')
    orders()
  } catch (e) { toast(e.message, true) }
}
async function completeOrder(no) {
  try { await api('POST', '/admin/dev/complete', { orderNo: no }); toast('观察期结束：返豆与佣金已入账'); orders() }
  catch (e) { toast(e.message, true) }
}

/* ============ 商品与团期 ============ */
async function products() {
  $('#app').innerHTML = `<div class="card">${skel(5)}</div>`
  const [rows, merchantRows, supRows, scenRows, info] = await Promise.all([api('GET', '/admin/products'), api('GET', '/admin/merchants'),
    api('GET', '/admin/suppliers').catch(() => []), api('GET', '/admin/scenics').catch(() => []), eeCompleteness('product')])
  const supOpts = supRows.filter((s) => s.status === 1).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
  const scenOpts = scenRows.filter((s) => s.status === 1).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
  const F = window.__fprod || (window.__fprod = { sup: '', scn: '' })
  const frs = rows.filter((p) => (!F.sup || String(p.supplier_id || '') === F.sup) && (!F.scn || String(p.scenic_id || '') === F.scn))
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商品与团期</h2>${EXPBTN('products', '商品 CSV')}<button class="btn primary sm" onclick="entityEditor('product', null, { onSaved: (id) => products().then(() => sessionsDrawer(id)) })">＋ 新增线路</button></div>
    <p class="muted" style="margin-bottom:6px">新建线路会打开完整编辑器：基本信息 → 图文 → 行程节点 → 费用须知 → 履约资源 → 分享设置；保存后添加团期，检查无误再上架。</p>
    <div class="row" style="margin:10px 0 0">
      <select id="f_supplier" onchange="window.__fprod={sup:this.value,scn:document.getElementById('f_scenic').value};products()">
        <option value="">全部供应商</option>${supRows.map((s) => `<option value="${s.id}" ${F.sup === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <select id="f_scenic" onchange="window.__fprod={sup:document.getElementById('f_supplier').value,scn:this.value};products()">
        <option value="">全部景区</option>${scenRows.map((s) => `<option value="${s.id}" ${F.scn === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <span class="muted">筛选出 ${frs.length}/${rows.length} 条线路</span>
    </div>
    ${frs.length ? `<table><thead><tr><th></th><th>商品</th><th>分类</th><th>城市</th><th>价格</th><th>履约商户</th><th>供给链</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${frs.map((p) => `<tr>
      <td>${eeThumb(info[p.id])}</td>
      <td><div class="td-main">${esc(p.title)}</div><div class="td-sub">${esc(p.days_desc || '')}${p.bean_gift ? ' · 完成得 ' + p.bean_gift + ' 豆' : ''}</div>${eeBar(info[p.id])}</td>
      <td><span class="pill off">${esc(CAT_CN[p.cat] || p.cat)}</span></td><td>${esc(CITY_CN[p.city_code] || p.city_code)}</td>
      <td class="money num">${fen(p.price_from)}</td><td class="td-sub">${esc(p.merchant_name || p.merchant_id)}</td>
      <td class="td-sub">${p.supplier_name ? '供:' + esc(p.supplier_name) : ''}${p.supplier_name && p.scenic_name ? '<br>' : ''}${p.scenic_name ? '景:' + esc(p.scenic_name) : ''}${!p.supplier_name && !p.scenic_name ? '—' : ''}</td>
      <td><span class="pill ${p.status === 1 ? 'ok' : 'off'}">${p.status === 1 ? '上架' : '下架'}</span></td>
      <td><button class="btn ghost sm" onclick="toggleProduct(${p.id}, ${p.status === 1 ? 0 : 1})">${p.status === 1 ? '下架' : '上架'}</button>
          <button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="sessionsDrawer(${p.id})">团期</button>
          <button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="editProduct(${p.id})">编辑资料</button></td>
    </tr>`).join('')}</tbody></table>` : emptyBox(F.sup || F.scn ? '筛选条件下暂无线路：清一下筛选再试' : '还没有商品——点右上「新增线路」录入第一条')}
  </div>`
}

/* 商品编辑 + 素材（P0 宣传力：实拍图集/行程/费用包含/集合点/安全告知） */
let EDIT_P = null
async function editProduct(id) { return entityEditor('product', id, { onSaved: () => products() }) }
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
      intro: $('#e_intro').innerHTML || '', highlights: lines($('#e_highlights').value), includes: lines($('#e_includes').value), excludes: lines($('#e_excludes').value),
      meetingPoint: $('#e_meeting').value || null, safetyNote: $('#e_safety').value || null,
      supplierId: Number($('#e_supplier')?.value) || null, scenicId: Number($('#e_scenic')?.value) || null,
    })
    toast('已保存'); closeModal(); products()
  } catch (e) { toast(e.message, true) }
}
function productModal() { return entityEditor('product', null, { onSaved: () => products() }) }
async function addProduct() { return entityEditor('product', null, { onSaved: () => products() }) }
async function toggleProduct(id, status) { try { await api('POST', `/admin/products/${id}/status`, { status }); products() } catch (e) { toast(e.message, true) } }
function sessionModal(pid, priceFen) { return entityEditor('session', null, { parentId: pid, defaults: priceFen ? { price_adult: priceFen / 100 } : {}, onSaved: () => sessionsDrawer(pid) }) }
/** 团期管理：列出某线路全部团期，逐个用完整编辑器维护 */
async function sessionsDrawer(pid) {
  const d = await api('GET', '/admin/products/' + pid + '/sessions')
  const STS = { 1: '报名中', 2: '已成团', 3: '已截止', 4: '已取消', 5: '未成团' }
  drawer('团期管理 · ' + esc(d.title), `
    <div class="row" style="margin:0 0 12px"><button class="btn primary sm" onclick="sessionModal(${pid}, ${d.priceFrom})">＋ 新增团期</button><span class="muted">${d.sessions.length} 个团期</span></div>
    ${d.sessions.length ? `<table><thead><tr><th>出发日</th><th>价格</th><th>报名/名额</th><th>状态</th><th></th></tr></thead><tbody>
    ${d.sessions.map((x) => `<tr><td class="num">${esc(String(x.depart_date).slice(0, 10))}</td><td class="money num">${fen(x.price_adult)}${x.early_price ? `<div class="td-sub">早鸟 ${fen(x.early_price)}</div>` : ''}</td>
      <td class="num">${x.booked}/${x.quota}<div class="td-sub">${x.min_go} 人成团</div></td><td><span class="pill ${x.status === 1 ? 's30' : 'off'}">${STS[x.status] || x.status}</span></td>
      <td><button class="btn ghost sm" onclick="entityEditor('session', ${x.id}, { onSaved: () => sessionsDrawer(${pid}) })">编辑</button></td></tr>`).join('')}</tbody></table>` : emptyBox('还没有团期：点「新增团期」')}`)
}
async function addSession(pid) {
  try {
    if (!$('#s_date').value || !Number($('#s_quota').value) || !Number($('#s_price').value)) return toast('日期、名额、价格必填', true)
    await api('POST', '/admin/sessions', { productId: pid, departDate: $('#s_date').value, quota: Number($('#s_quota').value),
      minGo: Number($('#s_mingo').value) || 10, priceAdult: Math.round(Number($('#s_price').value) * 100),
      earlyPrice: Number($('#s_early').value) ? Math.round(Number($('#s_early').value) * 100) : null,
      earlyDays: Number($('#s_early').value) ? Number($('#s_earlydays').value) || 7 : null })
    closeModal(); toast('团期已添加'); products()
  } catch (e) { toast(e.message, true) }
}

/* ============ 商户 ============ */
async function merchants() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const [rows, info] = await Promise.all([api('GET', '/admin/merchants'), eeCompleteness('merchant')])
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商户（履约方）</h2>${EXPBTN('merchants', '商户 CSV')}<span class="muted">收付通二级商户进件后填入子商户号</span></div>
    <div class="row" style="margin-top:0"><button class="btn primary sm" onclick="addMerchant()">＋ 新增商户</button><span class="muted">品牌门店 · 营业信息 · 资质证照 · 结算账户 · 联系人与合作，新建后进入"进件中"，审核通过方可履约</span></div>
    ${rows.length ? `<table><thead><tr><th></th><th>商户号</th><th>名称</th><th>类目</th><th>城市</th><th>收付通子商户</th><th>评分</th><th>状态</th></tr></thead><tbody>
    ${rows.map((m) => `<tr><td>${eeThumb(info[m.id])}</td><td class="num">${esc(m.merchant_no)}</td><td><div class="td-main">${esc(m.name)}</div>${eeBar(info[m.id])}</td><td><span class="pill off">${esc(MERCHANT_KIND[m.kind] || '其他')}</span></td><td>${esc(CITY_CN[m.city_code] || m.city_code)}</td>
      <td class="num">${esc(m.wxpay_sub_mchid || '—')}</td><td>⭐ ${m.score}</td>
      <td><span class="pill ${m.status === 1 ? 'ok' : 'warn'}">${m.status === 1 ? '生效' : '进件中'}</span><div style="margin-top:4px"><button class="btn ghost sm" onclick="editMerchant(${m.id},'${esc(m.name)}','${esc(m.city_code)}','${esc(m.wxpay_sub_mchid || '')}','${esc(m.kind || 'other')}')">编辑</button></div><div style="margin-top:4px">${m.status === 0 ? `<button class="btn primary sm" onclick="approveMerchant(${m.id})">审批通过</button>` : ''}</div></td></tr>`).join('')}</tbody></table>` : emptyBox('暂无商户')}
  </div>`
}
async function addMerchant() { return entityEditor('merchant', null, { onSaved: () => merchants() }) }
/* ============ 结算 ============ */
async function settlements() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const rows = await api('GET', '/admin/settlements')
  const COLORS = ['#2563eb', '#0ea5e9', '#d97706', '#7c3aed', '#64748b']
  const NAMES = ['履约结算', '平台服务费', '推广服务费', '权益预算', '留存毛利']
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商户周结算</h2>${EXPBTN('settlements', '结算 CSV')}
      <button class="btn primary sm" onclick="genSettlements()">生成本周结算单</button></div>
    <p class="muted" style="margin:-8px 0 14px">商户确认 → 财务复核 → 实际支付 → 回单登记。当前为人工回单模式，复核不会自动划款。</p>
    ${rows.length ? rows.map((s) => {
      const parts = [Number(s.amt_fulfill), Number(s.amt_service), Number(s.amt_promoter), Number(s.amt_beanbudget), Number(s.amt_retained)]
      const total = Number(s.total_amount) || 1
      return `<div style="padding:14px 0;border-bottom:1px solid #f1f4f8">
      <div class="row" style="justify-content:space-between;margin:0 0 10px">
        <div><b>${esc(s.merchant_name)}</b> <span class="muted">${esc(s.period)} · ${s.order_count} 单</span></div>
        <div><span class="money" style="font-size:16px">${fen(s.total_amount)}</span>
          <span class="pill ${s.status === 3 ? 'ok' : s.status === 4 ? 'warn' : 'off'}" style="margin-left:10px">${['待商户确认', '待财务复核', '待实际支付', '已登记支付回单', '异议处理中'][s.status]}</span>
          ${s.status === 1 ? `<button class="btn primary sm" style="margin-left:10px" onclick="confirmSettle(${s.id})">财务复核</button>` : ''}${s.status === 2 ? `<button class="btn primary sm" onclick="paymentReceipt(${s.id})">登记支付回单</button>` : ''}${s.status === 4 ? `<button class="btn ghost sm" style="margin-left:10px" onclick="resolveDispute(${s.id})">处理异议</button>` : ''}</div>
      </div>
      <div class="split-bar">${parts.map((v, i) => `<span style="background:${COLORS[i]};flex:${Math.max(v, 1)}">${v ? Math.round(v / total * 100) + '%' : ''}</span>`).join('')}</div>
      ${s.payment_ref ? `<p class="muted">支付流水 ${esc(s.payment_ref)} · ${esc(s.paid_at || '')} · ${esc(s.payment_note || '')}</p>` : ''}
      <div class="split-legend">${NAMES.map((n, i) => `<span><em style="width:9px;height:9px;border-radius:3px;display:inline-block;background:${COLORS[i]};margin-right:5px"></em>${n} ${fen(parts[i])}</span>`).join('')}</div>
    </div>` }).join('') : emptyBox('暂无结算单——有已完成订单后点右上角生成')}
  </div>`
}
async function genSettlements() {
  try { const r = await api('POST', '/admin/settlements/generate', {}); toast('已生成 ' + r.settlementIds.length + ' 份结算单'); settlements() } catch (e) { toast(e.message, true) }
}
async function resolveDispute(id) {
  const note = prompt('异议处理说明（处理后交回商户重新确认）：', '')
  if (!note || !note.trim()) return
  try { await api('POST', '/admin/settlements/' + id + '/dispute', { note }); toast('异议已处理'); settlements() } catch (e) { toast(e.message, true) }
}
async function confirmSettle(id) {
  try { await api('POST', `/admin/settlements/${id}/confirm`, {}); toast('复核通过，待实际支付并登记回单'); settlements() } catch (e) { toast(e.message, true) }
}

function paymentReceipt(id) {
  modal('登记实际支付回单', `<p class="muted">请先核对收款商户、应结金额与实际银行/支付平台回单。本操作只登记支付证据。</p><label>支付流水号</label><input id="receiptRef" maxlength="128" placeholder="填写回单中的真实流水号"><label>核对说明</label><textarea id="receiptNote" maxlength="500" placeholder="收款方、金额、支付日期与核对说明"></textarea><div id="receiptError" class="lerr"></div>`, `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="savePaymentReceipt(${id})">确认登记</button>`)
}
async function savePaymentReceipt(id) {
  try {
    await api('POST', '/admin/settlements/' + id + '/payment', { paymentRef: $('#receiptRef').value.trim(), note: $('#receiptNote').value.trim() })
    closeModal(); toast('回单已登记，可在审计日志追溯'); settlements()
  } catch (e) { $('#receiptError').textContent = e.message }
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
    <div class="row"><button class="btn primary sm" onclick="budgetModal()">＋ 新建批次</button><span class="muted">批次 = 发放双闸的第一道闸：批次余额与全局哨兵双重校验</span></div>
    ${rows.length ? `<table><thead><tr><th>批次</th><th>总额</th><th>已发放</th><th>回流</th><th>余量</th><th>状态</th><th>周期</th></tr></thead><tbody>
    ${rows.map((b) => { const left = Number(b.total) + Number(b.returned) - Number(b.granted); const pct = Number(b.granted) / Math.max(Number(b.total), 1) * 100
      return `<tr><td class="td-main">${esc(b.name)}</td><td class="num">${Number(b.total).toLocaleString()}</td>
      <td><div class="num">${Number(b.granted).toLocaleString()}</div><div style="background:#eef1f5;border-radius:4px;height:5px;width:90px;margin-top:4px"><div style="background:${pct > 80 ? 'var(--red)' : 'var(--brand)'};height:5px;border-radius:4px;width:${Math.min(pct, 100)}%"></div></div></td>
      <td class="num">${Number(b.returned).toLocaleString()}</td><td class="num">${left.toLocaleString()}</td>
      <td><span class="pill ${b.status === 1 ? 'ok' : 'off'}">${b.status === 1 ? '生效' : '停用'}</span><div style="margin-top:4px"><button class="btn ghost sm" onclick="entityEditor('budget', ${b.id}, { onSaved: () => budgets() })">编辑</button> <button class="btn ghost sm" onclick="toggleBudget(${b.id}, ${b.status})">${b.status === 1 ? '停用' : '启用'}</button></div></td>
      <td class="td-sub">${esc(String(b.period_start || '').slice(0, 10))} ~ ${esc(String(b.period_end || '').slice(0, 10))}</td></tr>` }).join('')}</tbody></table>` : emptyBox('暂无预算批次')}
  </div>`
}
function budgetModal() { return entityEditor('budget', null, { onSaved: () => budgets() }) }
async function addBudget() {
  try {
    if (!$('#b_name').value.trim() || !Number($('#b_total').value)) return toast('批次名与总额必填', true)
    await api('POST', '/admin/budgets', { name: $('#b_name').value.trim(), total: Number($('#b_total').value),
      bizOwner: $('#b_owner').value, remark: $('#b_remark').value.trim() || null,
      periodStart: $('#b_start').value || null, periodEnd: $('#b_end').value || null })
    toast('批次已创建并生效'); closeModal(); budgets()
  } catch (e) { toast(e.message, true) }
}

/* ============ 推广服务商 ============ */
async function promoters() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/promoters')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>推广服务商</h2><span class="muted">一级 CPS · 三档 5% / 8% / 12% 封顶（数据库 CHECK 焊死，无层级字段）</span></div>
    <div class="row"><button class="btn primary sm" onclick="promoterModal()">＋ 开通推广资格</button>
      <span class="muted">开通后推广员在小程序 A「推广中心」生成专属海报码 · 一级 CPS 无层级</span></div>
    ${rows.length ? `<table><thead><tr><th>用户</th><th>档位</th><th>费率</th><th>90 天有效成交</th><th>评分</th><th>状态</th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td><div class="td-main">${esc(p.nickname || '')}</div><div class="td-sub">ID ${p.user_id}</div></td>
      <td>${['', '基础', '优选', '金牌'][p.tier]}</td><td><b>${p.rate_bp / 100}%</b></td>
      <td class="money num">${fen(p.valid_gmv_90d)}</td><td>⭐ ${p.service_score}</td>
      <td><span class="pill ${p.status === 1 ? 'ok' : 'off'}">${p.status === 1 ? '生效' : '冻结'}</span><div style="margin-top:4px"><button class="btn ghost sm" onclick="entityEditor('promoter', ${p.user_id}, { onSaved: () => promoters() })">资料</button> <button class="btn ghost sm" onclick="togglePromoter(${p.user_id}, ${p.status})">${p.status === 1 ? '冻结' : '解冻'}</button> <button class="btn ghost sm" onclick="changePromoterTier(${p.user_id}, ${p.tier})">调档</button></div></td></tr>`).join('')}</tbody></table>` : emptyBox('还没有推广员')}
  </div>`
}
function promoterModal() {
  modal('开通推广服务商', `
    <div class="field"><label>用户 ID *</label><input id="pr_uid" type="number" placeholder="在「权益账户」按昵称搜索用户后取其 ID"></div>
    <div class="field"><label>合作档位 *</label><select id="pr_tier">
      <option value="1">基础档 · 5%（按 90 天有效成交口径计佣）</option>
      <option value="2">优选档 · 8%</option>
      <option value="3">金牌档 · 12%（平台封顶，数据库 CHECK 焊死）</option></select></div>
    <p class="muted">规则：一级 CPS、无层级裂变；费率写入后由订单结算自动分账；后续可在列表「调档/冻结」。</p>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="addPromoter()">确认开通</button>`)
}
async function addPromoter() {
  try {
    if (!Number($('#pr_uid').value)) return toast('请填写用户 ID', true)
    const uidVal = Number($('#pr_uid').value)
    const r = { ...(await api('POST', '/admin/promoters/register', { userId: Number($('#pr_uid').value), tier: Number($('#pr_tier').value) })), userId: uidVal }
    toast('已开通，费率 ' + r.rateBp / 100 + '%，请补全服务商资料'); closeModal()
    const uid = Number($('#pr_uid')?.value) || null
    await promoters()
    if (r.userId || uid) entityEditor('promoter', r.userId || uid, { onSaved: () => promoters() })
  } catch (e) { toast(e.message, true) }
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
      <td>${r.handled ? '<span class="pill ok">已处理</span>' : `<button class="btn ghost sm" onclick="handleRisk(${r.id})">标记已处理</button>`}</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无风控事件 🎉')}
  </div>`
}
async function audit() {
  $('#app').innerHTML = `<div class="card">${skel(6)}</div>`
  const rows = await api('GET', '/admin/audit-logs')
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h2>操作审计</h2><span class="muted">只增不改 · 每次写操作前后快照</span></div>
    ${rows.length ? `<table><thead><tr><th>时间</th><th>操作人</th><th>模块 / 动作</th><th>对象</th><th>变更</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="td-sub num">${esc(String(a.created_at).slice(5, 19))}</td><td>${esc(a.actor)}</td>
      <td><b>${esc(a.module)}</b> · ${esc(a.action)}</td><td class="td-sub">${esc(a.biz_ref || '')}</td>
      <td>${auditDiff(a.before_val, a.after_val)}</td></tr>`).join('')}</tbody></table>` : emptyBox('暂无操作记录')}
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
        <button class="btn ghost sm" onclick="runJob('attest-pack','attest')">存证打包</button>
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
async function runJob(name, thenPage) {
  try {
    const r = await api('POST', '/admin/system/jobs/' + name + '/run', {})
    toast('已执行，影响 ' + r.affected + ' 条')
    // 跑完停在原地更符合直觉：存证中心点的按钮，回到存证中心而不是跳到运维控制台
    const back = thenPage || 'system'
    if (typeof window[back] === 'function') window[back](); else system()
  } catch (e) { toast(e.message, true) }
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
    ${rows.map((n) => `<tr><td>${esc(n.nickname)}${n.creator_tag && n.creator_tag !== 'none' ? ` <span class="pill ${n.creator_tag === 'star' ? 'ok' : (n.creator_tag === 'limited' ? 's70' : 's40')}">${CREATOR_TAG[n.creator_tag] || ''}</span>` : ''}</td><td class="td-main">${esc(n.title || '（无题）')}</td>
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
      <td>${w.status === 0 ? `<button class="btn primary sm" onclick="approveWithdraw(${w.id}, true)">登记实际打款</button>
        <button class="btn danger sm" onclick="approveWithdraw(${w.id}, false)">驳回</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('暂无提现申请（推广员在小程序 A「推广中心」发起）')}
  </div>`
}
async function approveWithdraw(id, pass) {
  const payRef = pass ? prompt('请先完成实际支付，填写回单中的真实打款流水号：', '') : null
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
  // 语义分档（NOOP 期绝不显示"已上链"）：1 已打包·待锚定 / 2 已锚定 / 3 重试 / 4 人工
  const STMAP = ['<span class="pill warn">待打包</span>', '<span class="pill s20">已打包·待锚定</span>',
    '<span class="pill ok">已锚定</span>', '<span class="pill s70">锚定失败重试</span>', '<span class="pill s70">人工处理</span>']
  const real = (d.chain && d.chain.mode) === 'real'
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>存证中心</h2><span class="muted">${esc(d.chainMode)}</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      ${(d.queue || []).map((qq) => `<div class="kpi"><div class="ico" style="background:var(--brand-soft)">⛓</div>
        <div><div class="l">${BIZ_CN[qq.biz_type] || esc(qq.biz_type)}</div><div class="v" style="font-size:18px">${Number(qq.pending)} 待打包</div>
        <div class="s">已打包 ${Number(qq.packed || 0)} · 已锚定 ${Number(qq.anchored)} · 累计 ${Number(qq.total)}</div></div></div>`).join('') || '<div class="kpi"><div class="s">暂无事件</div></div>'}
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn ghost sm" onclick="runJob('attest-pack','attest')">① 打包（出 Merkle 根）</button>
      <button class="btn ghost sm" onclick="runJob('attest-anchor','attest')">② 补锚（按 seq 升序）</button>
      <button class="btn ghost sm" onclick="runJob('bean-day-close','attest')">③ 封存昨日旅豆账本</button>
      <button class="btn ghost sm" onclick="runJob('attest-reconcile','attest')">④ 六条不变式对账</button>
      <span class="muted">${real ? '已接入链数根：补锚将真实上链' : 'NOOP：①后停留在「已打包·待锚定」，②不会产生假交易号'}</span>
    </div>
    <div class="row" style="margin-top:6px"><input id="vref" placeholder="输入订单号验证（如 WL20261024…）" style="width:320px">
      <button class="btn primary sm" onclick="verifyAttest()">验证</button>
      <span class="muted">公开验证口（无登录只读）：/open/verify/order/{单号} · /open/verify/bean-day/{日期} —— 给景区 / 政府 / 投资人的「一网可信」窗口</span></div>
    <div id="vout"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>存证批次（Merkle 根 · 链式前根）</h3><span class="muted">prev_root 指向上批根：改任一批必须改其后所有批次，而最新根在链上</span></div>
    ${(d.batches || []).length ? `<table><thead><tr><th>seq</th><th>业务日</th><th>Merkle 根</th><th>前根</th><th>叶数</th><th>尝试</th><th>链上编号</th><th>状态</th></tr></thead><tbody>
      ${d.batches.map((b) => `<tr><td class="num">#${b.seq}${Number(b.is_day_close) ? ' <span class="pill off">账本日终</span>' : ''}</td>
        <td>${esc(String(b.biz_date).slice(0, 10))}</td>
        <td><code>${esc(String(b.merkle_root).slice(0, 20))}…</code></td>
        <td class="td-sub">${b.prev_root ? '<code>' + esc(String(b.prev_root).slice(0, 12)) + '…</code>' : '链起点'}</td>
        <td class="num">${Number(b.leaf_count)}</td>
        <td class="td-sub">${Number(b.attempt) || 0}${b.last_err ? '<br><span class="pill s70">' + esc(String(b.last_err).slice(0, 24)) + '</span>' : ''}</td>
        <td class="td-sub">${b.chain_tx_ref ? esc(b.chain_tx_ref) : '—'}</td>
        <td>${STMAP[b.status] || ''}</td></tr>`).join('')}</tbody></table>` : emptyBox('尚无批次：点上方「① 打包」即可出根')}
  </div>
  <div class="card">
    <div class="card-head"><h3>旅豆账本日终封存</h3><span class="muted">借贷恒等（Σ借=Σ贷）才允许封存 —— 「严禁超发」的唯一外部证明</span></div>
    ${(d.dayRoots || []).length ? `<table><thead><tr><th>业务日</th><th>叶数</th><th>Σ贷（发放）</th><th>Σ借（消耗）</th><th>恒等</th><th>Merkle 根</th><th>对外</th></tr></thead><tbody>
      ${d.dayRoots.map((r) => `<tr><td class="num">${esc(String(r.biz_date).slice(0, 10))}</td><td class="num">${Number(r.leaf_count)}</td>
        <td class="num">${Number(r.credit_sum)}</td><td class="num">${Number(r.debit_sum)}</td>
        <td>${Number(r.debit_sum) === Number(r.credit_sum) ? '<span class="pill ok">恒等</span>' : '<span class="pill s70">不平</span>'}</td>
        <td><code>${esc(String(r.merkle_root).slice(0, 20))}…</code></td>
        <td><a class="btn ghost sm" target="_blank" rel="noopener" href="/open/report/bean-day/${String(r.biz_date).slice(0, 10)}">证明 PDF</a>
            <a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?date=${String(r.biz_date).slice(0, 10)}">公开复核</a></td></tr>`).join('')}</tbody></table>` : emptyBox('尚无封存记录：点上方「③ 封存昨日旅豆账本」')}
  </div>
  <div class="card">
    <div class="card-head"><h3>最近事件</h3></div>
    <table><thead><tr><th>类型</th><th>业务单号</th><th>版本</th><th>状态</th><th>批次</th><th>Merkle 根</th><th>时间</th></tr></thead><tbody>
    ${(d.recent || []).map((e) => `<tr><td>${bizTag(esc(e.biz_type))}</td><td class="num">${esc(e.biz_ref)}</td>
      <td class="num">v${Number(e.version_no ?? 1)}</td>
      <td>${STMAP[e.status]}</td><td class="td-sub">${e.seq ? '#' + e.seq : '—'}</td>
      <td class="td-sub">${e.merkle_root ? '<code>' + esc(String(e.merkle_root).slice(0, 16)) + '…</code>' : '—'}</td>
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
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#f1e9fd">🎭</div><div><div class="l">已配暗号产品</div><div class="v">${list.length}</div><div class="s">剧本游入戏凭证</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">📦</div><div><div class="l">待配置产品</div><div class="v">${noPhrase.length}</div><div class="s">可选配暗号</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>暗号管理</h2><span class="muted">剧本游「入戏」凭证 · 用户暗号给游客 · 商家暗号核销员对答</span></div>
    ${list.length ? `<table><thead><tr><th>产品</th><th>用户暗号</th><th>商家暗号</th><th>频道</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td class="td-main">${esc(x.title)}</td>
      <td><code style="background:#f1e9fd;color:#6d28d9">${esc(x.phrase_user)}</code></td>
      <td><code style="background:#e8effd;color:#1d4ed8">${esc(x.phrase_merchant || '—')}</code></td>
      <td><span class="pill off">${esc(x.channel || 'main')}</span></td>
      <td><div class="td-actions">
        <button class="btn ghost sm" onclick="entityEditor('phrase', ${x.id}, { onSaved: () => phrases() })">编辑</button>
        <button class="btn danger sm" onclick="clearPhrase(${x.id})">清除</button>
      </div></td></tr>`).join('')}</tbody></table>`
    : emptyBox('还没有产品配暗号——下方选择线路开始配置')}
    <div class="card-head" style="margin-top:16px"><h3>为线路配置暗号</h3></div>
    <div class="row">
      <select id="phProd" class="inp" style="width:320px">${noPhrase.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('') || '<option value="">全部线路均已配置</option>'}</select>
      <button class="btn primary sm" onclick="savePhrase()">配置暗号与剧情 →</button>
      <span class="muted">上下半句、NPC 角色、对暗号地点、启停日期、剧情背景、可接受变体</span>
    </div></div>`
}
window.clearPhrase = async (id) => {
  if (!confirm('清除后该线路不再使用暗号核销，确定？')) return
  try { await api('PUT', '/admin/entities/phrase/' + id, { values: { phrase_user: '', phrase_merchant: '' } }); toast('暗号已清除'); phrases() } catch (e) { toast(e.message, true) }
}
// 选择未配置的线路 → 打开完整编辑器
window.savePhrase = () => {
  const pid = $('#phProd')?.value
  if (!pid) return toast('请先选择线路', true)
  entityEditor('phrase', pid, { onSaved: () => phrases() })
}
async function rateov() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const prods = await api('GET', '/admin/products')
  const ov = await api('GET', '/admin/rate-overrides').catch(() => [])
  const avgRate = ov.length ? (ov.reduce((s, x) => s + Number(x.promo_rate_bp), 0) / ov.length / 100).toFixed(1) : '—'
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">📊</div><div><div class="l">已设覆盖</div><div class="v">${ov.length}</div><div class="s">单品费率覆盖</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">📈</div><div><div class="l">平均覆盖费率</div><div class="v">${avgRate}%</div><div class="s">上限 12% · 留空=恢复档位</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>逐品佣金覆盖</h2><span class="muted">D2 扩展 · 单品费率优先于推广商档位 5/8/12%</span></div>
    <div class="row">
      <select id="roProd" class="inp" style="width:320px">${prods.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <button class="btn primary sm" onclick="saveRate()">设置覆盖 →</button>
      <span class="muted">需填写费率、生效期、调整原因与审批人；原因写入审计</span>
    </div>
    ${ov.length ? `<table><thead><tr><th>产品</th><th>单品费率</th><th>生效期</th><th>原因</th><th>操作</th></tr></thead><tbody>
    ${ov.map((x) => `<tr><td class="td-main">${esc(x.title)}</td>
      <td class="money num"><b>${(Number(x.promo_rate_bp) / 100).toFixed(2)}%</b></td>
      <td class="td-sub">${esc(x.rate_start || '—')} ~ ${esc(x.rate_end || '—')}</td><td class="td-sub">${esc(x.rate_reason || '—')}</td>
      <td><button class="btn ghost sm" onclick="entityEditor('rateov', ${x.id}, { onSaved: () => rateov() })">编辑</button></td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无单品覆盖，全部走推广商档位 5/8/12%')}</div>`
}
window.saveRate = () => entityEditor('rateov', $('#roProd').value, { onSaved: () => rateov() })
async function kyc() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/kyc')
  const st = { 0: '<span class="pill warn">待审</span>', 1: '<span class="pill ok">已通过</span>', 2: '<span class="pill s70">已驳回</span>' }
  const pending = list.filter((x) => x.status === 0).length
  const passed = list.filter((x) => x.status === 1).length
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">📋</div><div><div class="l">待审</div><div class="v">${pending}</div><div class="s">等待人工审核</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e3f6ec">✓</div><div><div class="l">已通过</div><div class="v">${passed}</div><div class="s">实名认证成功</div></div></div>
    <div class="kpi"><div class="ico" style="background:#fdecec">✗</div><div><div class="l">已驳回</div><div class="v">${list.filter((x) => x.status === 2).length}</div><div class="s">资料不符</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>实名认证审核</h2><span class="muted">身份证号加密落库 · 仅展示脱敏号</span></div>
    ${list.length ? `<table><thead><tr><th>用户</th><th>姓名</th><th>证件号（脱敏）</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td>${esc(x.nickname || ('用户' + x.user_id))}</td><td>${esc(x.real_name)}</td><td class="num">${esc(x.id_no_mask)}</td>
      <td>${st[x.status] || x.status}</td><td class="td-sub">${String(x.created_at).slice(0, 16)}</td>
      <td>${x.status === 0 ? `<button class="btn primary sm" onclick="kycResolve(${x.id},'pass')">通过</button>
        <button class="btn danger sm" onclick="kycResolve(${x.id},'reject')">驳回</button>` : (x.reject_note ? `<span class="td-sub">${esc(x.reject_note)}</span>` : '')}</td></tr>`).join('')}</tbody></table>`
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
  const totalInvest = list.reduce((s, c) => s + Number(c.invest_amount), 0)
  const totalProfit = profits.reduce((s, c) => s + Number(c.amount), 0)
  const activeCount = list.filter((c) => Number(c.status) === 1).length
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">💰</div><div><div class="l">累计投资额</div><div class="v">¥${(totalInvest / 100).toLocaleString()}</div><div class="s">共创人投入</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e3f6ec">🏦</div><div><div class="l">累计分润</div><div class="v">¥${(totalProfit / 100).toLocaleString()}</div><div class="s">已入账待打款</div></div></div>
    <div class="kpi"><div class="ico" style="background:var(--brand-soft)">👥</div><div><div class="l">活跃共创人</div><div class="v">${activeCount}/${list.length}</div><div class="s">生效中</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>共创人管理</h2><span class="muted">资金商/商品商 · 按产品投资分润 · 结算期自动入账</span></div>
    <div class="row"><button class="btn primary sm" onclick="entityEditor('cocreator', null, { onSaved: () => cocreate() })">＋ 登记共创人</button>
      <span class="muted">身份 · 投资与分润 · 协议与收款账户</span></div>
    ${list.length ? `<table><thead><tr><th>编号</th><th>产品</th><th>姓名</th><th>角色</th><th>投资额</th><th>分润比例</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td class="num">${esc(x.co_no)}</td><td>${esc(x.title)}</td><td>${esc(x.name)}</td>
      <td>${Number(x.role) === 1 ? '<span class="pill s60">资金商</span>' : '<span class="pill s20">商品商</span>'}</td>
      <td class="num">¥${(Number(x.invest_amount) / 100).toLocaleString()}</td>
      <td class="num"><b>${(Number(x.share_pct) / 100).toFixed(1)}%</b></td>
      <td>${Number(x.status) === 1 ? '<span class="pill ok">生效</span>' : '<span class="pill off">停用</span>'}</td>
      <td><div class="td-actions"><button class="btn ghost sm" onclick="entityEditor('cocreator', ${x.id}, { onSaved: () => cocreate() })">资料</button>${Number(x.status) === 1 ? `<button class="btn ghost sm" onclick="toggleCo(${x.id},${x.status})">停用</button>` : `<button class="btn primary sm" onclick="toggleCo(${x.id},${x.status})">启用</button>`}</div></td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无共创人——点「登记共创人」')}</div>
  <div class="card">
    <div class="card-head"><h3>共创分润台账</h3><span class="muted">链上分润凭证 · 结算期自动入账</span></div>
    ${profits.length ? `<table><thead><tr><th>期</th><th>共创人</th><th>产品</th><th>基数</th><th>分润额</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${profits.map((x) => `<tr><td>${esc(x.period)}</td><td>${esc(x.name)}</td><td>${esc(x.title)}</td>
      <td class="num">¥${(Number(x.base_amount) / 100).toFixed(2)}</td><td class="money num"><b>¥${(Number(x.amount) / 100).toFixed(2)}</b></td>
      <td>${Number(x.status) === 1 ? '<span class="pill ok">已打款</span>' : '<span class="pill warn">待打款</span>'}</td>
      <td>${Number(x.status) === 0 ? `<button class="btn primary sm" onclick="payCo(${x.id})">标记打款</button>` : '<span class="td-sub">✓</span>'}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty"><div class="e-ico">📊</div>暂无分润记录——生成结算单后自动入账</div>'}</div>`
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
  ['积分发行台账', '按预算批次发行', '发行即 mint 语义，但受 global_cap 哨兵约束，严禁超发'],
  ['勋章', '链上数字勋章（Badge SBT 语义）', '不可转让（SBT）；小程序端叫「勋章」'],
  ['权益账户', '用户旅豆账户 + 权益视图', '仅后台可见链词；小程序端无「钱包/资产」概念'],
  ['共创分润', '链上分润凭证（Revenue Share）', '分润台账每期上链锚定；小程序端不出现'],
  ['推广服务商', '分销合约节点（Affiliate Node）', 'D2 定稿禁止层级计酬；链词仅内部运营语境'],
]
async function terms() {
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>术语映射</h2><span class="muted">后台 Web3 口径 ↔ 小程序合规口径 · D6 双层口径总表</span></div>
    <div class="muted" style="margin-bottom:12px">后台不上小程序审核，可用 Web3 真实词汇；两个小程序端一律走合规词。改动任何界面文案前先对照本表，避免口径串台。</div>
    <table><thead><tr><th style="width:160px">小程序合规词（用户可见）</th><th style="width:220px">后台/存证链词（内部运营）</th><th>使用边界</th></tr></thead><tbody>
    ${TERM_MAP.map((t) => `<tr><td><b style="color:var(--brand-deep)">${t[0]}</b></td><td><code>${t[1]}</code></td><td class="td-sub">${t[2]}</td></tr>`).join('')}</tbody></table>
    <div class="note" style="margin-top:14px;padding:12px;background:#fdf3e0;border-radius:8px;color:#92400e">
      <b>⚠ D6 红线：</b>不对应股权/Token 收益权、不按层级计酬、境内外隔离。链词仅出现在本后台与存证报告，<b>绝不回灌小程序</b>。
    </div></div>`
}

/* ============ 约稿任务管理 ============ */
// ---- 富表单共享组件：富文本编辑器 / 单图上传（各页复用）----
window.rtExec = (cmd, val, e) => {
  e.preventDefault()
  document.execCommand(cmd, false, val || null)
  const w = e.target.closest('.rt-wrap')
  if (w) w.querySelector('.rt-edit').focus()
}
function rtBtn(cmd, val, label, title) {
  return `<button type="button" title="${title}" onmousedown="rtExec('${cmd}','${val || ''}',event)">${label}</button>`
}
function richEdit(id, html) {
  return `<div class="rt-wrap"><div class="rt-toolbar">
    ${rtBtn('bold', '', '<b>B</b>', '加粗')}${rtBtn('italic', '', '<i>I</i>', '斜体')}${rtBtn('underline', '', '<u>U</u>', '下划线')}
    ${rtBtn('strikeThrough', '', '<s>S</s>', '删除线')}${rtBtn('formatBlock', 'H2', '<b>H2</b>', '大标题')}${rtBtn('formatBlock', 'H3', 'H3', '小标题')}
    ${rtBtn('formatBlock', 'BLOCKQUOTE', '❝', '引用块')}${rtBtn('insertUnorderedList', '', '•—', '无序列表')}${rtBtn('insertOrderedList', '', '1.', '有序列表')}
    ${rtBtn('removeFormat', '', '✕清除', '清除格式')}</div>
    <div id="${id}" class="rt-edit" contenteditable="true">${html || ''}</div></div>`
}
window.uploadTo = (id, input) => {
  const f = input.files && input.files[0]
  if (!f) return
  if (f.size > 2 * 1024 * 1024) return toast('图片需在 2MB 内', true)
  const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
  const rd = new FileReader()
  rd.onload = async () => {
    try {
      const r = await api('POST', '/admin/uploads', { data: String(rd.result).split(',')[1], ext })
      const box = document.getElementById(id + '_wrap')
      document.getElementById(id).value = r.url
      const img = box.querySelector('img')
      img.src = r.url; img.style.display = 'block'
      const empty = box.querySelector('.imgpick-empty')
      if (empty) empty.style.display = 'none'
      toast('图片已上传')
    } catch (e) { toast(e.message, true) }
  }
  rd.readAsDataURL(f)
}
function imgPicker(id, url, hint) {
  return `<div class="imgpick" id="${id}_wrap" onclick="document.getElementById('${id}_file').click()" title="点击上传（2MB 内）">
    <img src="${url || ''}" style="${url ? '' : 'display:none'}">
    <div class="imgpick-empty" style="${url ? 'display:none' : ''}">＋<small>${hint || '上传图片'}</small></div>
    <input type="hidden" id="${id}" value="${url || ''}">
    <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none" id="${id}_file" onchange="uploadTo('${id}',this)">
  </div>`
}

async function tasks() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const [list, prods] = await Promise.all([api('GET', '/admin/content-tasks'), api('GET', '/admin/products')])
  const ST = { 0: '<span class="pill warn">待领取</span>', 1: '<span class="pill s20">进行中</span>', 2: '<span class="pill s30">审核中</span>', 3: '<span class="pill ok">已完成</span>' }
  const cnt = (s) => list.filter((t) => t.status === s).length
  const beans = list.reduce((s, t) => s + Number(t.reward_beans) || 0, 0)
  const cash = list.reduce((s, t) => s + Number(t.cash_reward) || 0, 0)
  window.__taskSt = window.__taskSt === undefined ? '' : window.__taskSt
  const frs = window.__taskSt === '' ? list : list.filter((t) => String(t.status) === window.__taskSt)
  const TABS = [['', '全部'], ['0', '待领取'], ['1', '进行中'], ['2', '审核中'], ['3', '已完成']]
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">📢</div><div><div class="l">待领取</div><div class="v" style="font-size:20px">${cnt(0)}</div><div class="s">游客可在小程序领取</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">✍️</div><div><div class="l">进行中</div><div class="v" style="font-size:20px">${cnt(1)}</div><div class="s">创作进行中</div></div></div>
    <div class="kpi"><div class="ico" style="background:#f1e9fd">🔎</div><div><div class="l">审核中</div><div class="v" style="font-size:20px">${cnt(2)}</div><div class="s">等待人工判定</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e3f6ec">✅</div><div><div class="l">已完成</div><div class="v" style="font-size:20px">${cnt(3)}</div><div class="s">奖励已发放</div></div></div>
    <div class="kpi"><div class="ico" style="background:var(--brand-soft)">💰</div><div><div class="l">悬赏总额</div><div class="v" style="font-size:20px">${beans.toLocaleString()} 豆</div><div class="s">${cash ? '含现金 ' + fen(cash) : '纯旅豆激励'}</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>约稿任务</h2>
      <div class="cfg-tabs" style="margin:0">${TABS.map(([v, n]) => `<div class="cfg-tab ${String(window.__taskSt) === v ? 'on' : ''}" onclick="window.__taskSt='${v}';tasks()">${n} ${v !== '' ? cnt(Number(v)) : ''}</div>`).join('')}</div>
      <button class="btn primary sm" onclick="taskModal()">＋ 新建任务</button></div>
    ${frs.length ? `<table><thead><tr><th>任务</th><th>类型</th><th>报酬</th><th>交付要求</th><th>领取</th><th>截止</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${list.map((t) => `<tr>
      <td><div style="display:flex;gap:8px;align-items:center">${t.cover_img ? `<img src="${esc(t.cover_img)}" style="width:56px;height:38px;object-fit:cover;border-radius:6px;flex:none">` : ''}
        <div><div class="td-main">${esc(t.title)}</div><div class="td-sub">${esc((t.tags || '').split(',').filter(Boolean).map((x) => '#' + x.trim()).join(' ') || (t.product_title ? '目标：' + t.product_title : String(t.brief || '').slice(0, 26)))}</div></div></div></td>
      <td><span class="pill off">${TASK_CAT[t.category] || esc(t.category)}</span></td>
      <td class="num"><b>${Number(t.reward_beans)}</b> 豆${Number(t.cash_reward) ? '<br>+' + fen(t.cash_reward) : ''}</td>
      <td class="td-sub">${[t.min_words ? Number(t.min_words) + ' 字' : '', t.min_images ? Number(t.min_images) + ' 图' : '', t.max_participants ? '限 ' + t.max_participants + ' 人' : ''].filter(Boolean).join(' · ') || '不限'}</td>
      <td class="num">${t.claimed_by ? esc(t.claimer || '用户#' + t.claimed_by) : '待领取'}</td>
      <td class="td-sub">${t.deadline ? esc(String(t.deadline).slice(0, 10)) : '长期'}</td>
      <td>${ST[t.status] || ''}</td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap">
        ${t.status === 2 ? `<button class="btn primary sm" onclick="taskVerdict(${t.id},true)">通过</button><button class="btn danger sm" onclick="taskVerdict(${t.id},false)">驳回</button>` : ''}
        ${t.status <= 1 ? `<button class="btn ghost sm" onclick="taskModal(${t.id})">编辑</button>` : ''}
        ${t.rich_brief ? `<button class="btn ghost sm" onclick="taskDetail(${t.id})">说明</button>` : ''}
        <button class="btn ghost sm" onclick="deleteTask(${t.id})">删除</button></div></td></tr>`).join('')}</tbody></table>`
    : emptyBox(window.__taskSt === '' ? '暂无约稿任务：点右上「新建任务」发布第一单' : '该状态下暂无任务')}</div>`
}
const TASK_CAT = { note: '图文笔记', video: '短视频', strategy: '攻略长文', review: '体验点评' }
async function taskModal(id) { return entityEditor('task', id || null, { onSaved: () => tasks() }) }
async function saveTask(id) {
  try {
    const body = { title: $('#tk_title').value.trim(), brief: $('#tk_brief').value.trim(), category: $('#tk_cat').value,
      coverImg: $('#tk_cover').value || null, richBrief: $('#tk_rich').innerHTML || null,
      rewardBeans: Number($('#tk_beans').value) || 200, cashReward: Math.round(Number($('#tk_cash').value) * 100) || 0,
      minWords: Number($('#tk_words').value) || 0, minImages: Number($('#tk_imgs').value) || 0,
      maxParticipants: Number($('#tk_max').value) || 0, deadline: $('#tk_deadline').value || null,
      productId: Number($('#tk_prod').value) || null, tags: $('#tk_tags').value.trim() || null }
    if (!body.title || !body.brief) return toast('标题与一句话简介必填', true)
    if (id) { await api('PUT', '/admin/content-tasks/' + id, body); toast('任务已更新') } else { await api('POST', '/admin/content-tasks', body); toast('任务已发布') }
    closeModal(); tasks()
  } catch (e) { toast(e.message, true) }
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
async function taskVerdict(id, pass) {
  try { await api('POST', '/admin/content-tasks/' + id + '/verdict', { pass }); toast(pass ? '任务已通过' : '任务已驳回'); tasks() } catch (e) { toast(e.message, true) }
}
async function deleteTask(id) {
  if (!confirm('删除该任务？')) return
  try { await api('POST', '/admin/content-tasks/' + id + '/delete', {}); toast('任务已删除'); tasks() } catch (e) { toast(e.message, true) }
}

/* ============ 离线核销冲突队列 ============ */
async function conflicts() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/verify/conflicts')
  const ST = { 0: '<span class="pill warn">待处理</span>', 1: '<span class="pill ok">已确认</span>', 2: '<span class="pill s70">已驳回</span>' }
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>离线核销冲突</h2><span class="muted">断网恢复后二次校验失败的凭证 · 需人工确认或驳回</span></div>
    ${list.length ? `<table><thead><tr><th>商户</th><th>凭证</th><th>离线载荷</th><th>原因</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${list.map((c) => `<tr><td class="td-main">商户#${c.merchant_id}</td><td class="num">pass#${c.pass_id || '—'}</td>
      <td class="td-sub" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.payload)}</td>
      <td class="td-sub">${esc(c.reason)}</td><td class="td-sub">${String(c.offline_at || '').slice(0,16)}</td>
      <td>${ST[c.status] || c.status}</td>
      <td>${c.status === 0 ? `<button class="btn primary sm" onclick="conflictResolve(${c.id},'pass')">确认核销</button>
        <button class="btn danger sm" onclick="conflictResolve(${c.id},'reject')">驳回</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无离线冲突——断网核销恢复后自动入队')}</div>`
}
async function conflictResolve(id, action) {
  let note = null
  if (action === 'reject') note = prompt('驳回原因：') || '凭证异常'
  try { await api('POST', '/admin/verify/conflicts/' + id + '/resolve', { action, note }); toast('冲突已处理'); conflicts() } catch (e) { toast(e.message, true) }
}


/* ============ WEB3 工作区 ============ */
/* ============ 数字身份（VC-JWT）============ */
async function vcPage() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/vc')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>数字身份 · 可携出旅行凭证</h2><span class="muted">${esc(d.policy)}</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">🪪</div><div><div class="l">已签发</div><div class="v" style="font-size:18px">${d.total}</div><div class="s">持有人 ${d.holders}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e3f6ec">✅</div><div><div class="l">有效</div><div class="v" style="font-size:18px">${d.active}</div><div class="s">未过期未吊销</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdecea">⛔</div><div><div class="l">已吊销</div><div class="v" style="font-size:18px">${d.revoked}</div><div class="s">吊销即时生效</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">🔑</div><div><div class="l">公钥指纹</div><div class="v mono" style="font-size:12px">${esc(String(d.keyFingerprint).slice(0, 16))}…</div><div class="s">Ed25519</div></div></div>
    </div>
    <div class="row" style="margin-top:10px"><span class="muted">issuer</span><code>${esc(d.issuer)}</code>
      <span class="muted" style="margin-left:12px">kid</span><code>${esc(d.kid)}</code>
      <a class="btn ghost sm" style="margin-left:auto" target="_blank" rel="noopener" href="/vc">打开验签台</a>
      <a class="btn ghost sm" target="_blank" rel="noopener" href="/open/vc/issuer">公钥 JWKS</a></div>
    <div class="muted" style="margin-top:8px">凭证只含旅行事实（等级/成长区间/入会年月/行程数/城市数/徽章名），姓名手机号身份证订单号金额<strong>从不下发</strong>；第三方可凭公钥离线验签。</div>
  </div>

  <div class="card">
    <div class="card-head"><h3>代用户签发（演示 / 客服）</h3><span class="muted">签完可直接复制凭证去验签台验证</span></div>
    <div class="row">
      <input id="vcUid" type="number" placeholder="用户 id" style="width:120px">
      <select id="vcScope"><option value="travel">travel（含行程/城市/徽章）</option><option value="basic">basic（仅等级/入会）</option></select>
      <button class="btn primary sm" onclick="issueVc()">签发</button>
      <button class="btn ghost sm" onclick="openVerifyVc()">用当前凭证打开验签台</button>
    </div>
    <div id="vcOut"></div>
  </div>

  <div class="card">
    <div class="card-head"><h3>最近签发</h3><span class="muted">吊销后验签立即失败</span></div>
    ${(d.recent || []).length ? `<table><thead><tr><th>#</th><th>用户</th><th>DID</th><th>范围</th><th>签发</th><th>到期</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${d.recent.map((v) => `<tr><td class="num">${v.id}</td>
        <td class="td-main">${esc(v.nickname || '用户' + v.user_id)}</td>
        <td class="td-sub mono">${esc(String(v.did).slice(0, 18))}…</td>
        <td><span class="pill off">${esc(v.scope)}</span></td>
        <td class="td-sub">${esc(String(v.issued_at).slice(5, 19))}</td>
        <td class="td-sub">${esc(String(v.expires_at).slice(5, 19))}</td>
        <td>${v.revoked_at ? '<span class="pill s70">已吊销</span>' : (new Date(v.expires_at) > new Date() ? '<span class="pill ok">有效</span>' : '<span class="pill off">已过期</span>')}</td>
        <td>${v.revoked_at ? '—' : `<button class="btn ghost sm" onclick="revokeVc(${v.id})">吊销</button>`}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('尚未签发过凭证：上方选一个用户签发即可')}
  </div>`
  window.__vcLast = ''
}

async function issueVc() {
  const userId = Number(document.getElementById('vcUid').value)
  const scope = document.getElementById('vcScope').value
  if (!userId) return toast('请填用户 id', true)
  try {
    const r = await api('POST', '/admin/web3/vc/issue', { userId, scope })
    window.__vcLast = r.jwt
    document.getElementById('vcOut').innerHTML = `
      <div class="card" style="margin-top:12px;background:#f0faf7">
        <div class="row" style="margin:0"><span class="pill ok">已签发</span>
          <span class="muted">${esc(r.did)} · 有效期至 ${esc(String(r.expiresAt).slice(0, 19))}</span></div>
        <textarea readonly style="width:100%;height:88px;margin-top:10px;font-family:monospace;font-size:11px">${esc(r.jwt)}</textarea>
        <div class="row" style="margin-top:8px"><button class="btn ghost sm" onclick="copyVc()">复制凭证</button>
          <button class="btn primary sm" onclick="openVerifyVc()">去验签</button></div>
      </div>
`
    toast('已签发')
  } catch (e) { toast(e.message, true) }
}

function copyVc() {
  const t = window.__vcLast || ''
  if (!t) return toast('还没有凭证', true)
  navigator.clipboard?.writeText(t).then(() => toast('已复制')).catch(() => toast('复制失败，请手动选择', true))
}

function openVerifyVc() {
  const t = window.__vcLast || ''
  window.open(t ? '/vc?jwt=' + encodeURIComponent(t) : '/vc', '_blank')
}

async function revokeVc(id) {
  const reason = prompt('吊销原因（会写进审计）', '违规或用户申请')
  if (!reason) return
  try { await api('POST', '/admin/web3/vc/' + id + '/revoke', { reason }); toast('已吊销'); vcPage() }
  catch (e) { toast(e.message, true) }
}

/* ============ 链与资产（多链能力矩阵 + 资产发行台账）============ */
async function chainAssetsPage() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/assets')
  const c = await api('GET', '/admin/web3/chain').catch(() => ({}))
  const cur = d.chain || {}
  const cap = cur.capabilities || {}
  const mark = (b) => (b ? '<span class="pill ok">支持</span>' : '<span class="pill off">—</span>')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>链与资产</h2><span class="muted">当前链：<b>${esc(cur.label || cur.provider)}</b> · ${cur.mode === 'real' ? '<span class="pill ok">已接入</span>' : '<span class="pill warn">未接入（NOOP）</span>'}</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">⛓</div><div><div class="l">已发行</div><div class="v" style="font-size:18px">${d.issued}</div><div class="s">累计 ${d.total}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">⏳</div><div><div class="l">待发行</div><div class="v" style="font-size:18px">${d.pending}</div><div class="s">凭据到位后补发</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdecea">⚠️</div><div><div class="l">失败</div><div class="v" style="font-size:18px">${d.failed}</div><div class="s">可重试</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">🧩</div><div><div class="l">支持资产</div><div class="v" style="font-size:15px">${cap.assets ? '是' : '否'}</div><div class="s">${cap.assets ? '可发行徽章/NFT' : '当前链只做存证'}</div></div></div>
    </div>
    <div class="muted" style="margin-top:10px">切换链：改环境变量 <code>CHAIN_PROVIDER=chaingen|tbaas|antchain|evm|noop</code> 后重启，业务与页面零改动。当前缺：${(cur.missing || []).length ? '<b>' + esc(cur.missing.join('、')) + '</b>' : '无'}。</div>
  </div>

  <div class="card">
    <div class="card-head"><h3>多链能力矩阵</h3><span class="muted">不同链能做不同的事：联盟链只存证，公链才发资产</span></div>
    <table><thead><tr><th>链</th><th>存证锚定</th><th>按根反查</th><th>资产发行</th><th>DID</th><th>状态</th><th>说明</th></tr></thead><tbody>
    ${(d.providers || []).map((p) => `<tr>
      <td class="td-main">${esc(p.label)}${p.current ? ' <span class="pill ok">当前</span>' : ''}</td>
      <td>${mark(p.capabilities.anchor)}</td><td>${mark(p.capabilities.queryByRoot)}</td>
      <td>${mark(p.capabilities.assets)}</td><td>${mark(p.capabilities.did)}</td>
      <td>${p.mode === 'real' ? '<span class="pill ok">已配置</span>' : '<span class="pill off">缺凭据</span>'}</td>
      <td class="td-sub">${esc(p.docs || '')}</td></tr>`).join('')}
    </tbody></table>
  </div>

  ${(c.preflight || []).length ? `
  <div class="card">
    <div class="card-head"><h3>预埋体检</h3><span class="muted">离线自检 · 不需要凭据 · ${(c.summary || {}).ready}/${(c.summary || {}).total} 家通过</span></div>
    <table><thead><tr><th>链</th><th>离线自检</th><th>凭据</th><th>必问对方</th></tr></thead><tbody>
    ${(c.preflight || []).filter((p) => p.id !== 'noop' && p.id !== 'mock').map((p) => `<tr>
      <td class="td-main">${esc(p.label)}${p.active ? ' <span class="pill ok">当前</span>' : ''}</td>
      <td>${p.selfOk ? '<span class="pill ok">通过</span>' : '<span class="pill warn">失败</span>'}</td>
      <td class="td-sub">${p.missing.length ? '缺 <b>' + esc(p.missing.join('、')) + '</b>' : '<span class="pill ok">齐备</span>'}</td>
      <td class="td-sub"><details><summary>${p.ask.length} 条</summary><ul style="margin:6px 0 0 16px;padding:0">${p.ask.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></details></td>
    </tr>`).join('')}
    </tbody></table>
    <div class="muted" style="margin-top:10px">填空模板：<code>api/config/chains/</code>（链数根 / 腾讯TBaaS / 蚂蚁链鲸探 / EVM公链），每份含「找谁要、接口约定、必问 4 问」。命令行同源：<code>node scripts/chain-preflight.mjs</code></div>
  </div>` : ''}

  <div class="card">
    <div class="card-head"><h3>发行一件资产</h3><span class="muted">微信渠道被硬禁（D10）；不支持资产的链会明确报错</span></div>
    <div class="row">
      <select id="akKind">${(d.kinds || []).map((k) => `<option value="${k.id}">${esc(k.label)}</option>`).join('')}</select>
      <select id="akChannel">${(d.channels || []).map((c) => `<option value="${c.id}" ${c.allowed ? '' : 'disabled'}>${esc(c.label)}${c.allowed ? '' : '（禁止）'}</option>`).join('')}</select>
      <input id="akUid" type="number" placeholder="用户 id" style="width:110px">
      <input id="akToken" placeholder="tokenId（可空）" style="width:140px">
      <input id="akName" placeholder="名称，如「瑜伽修行者」" style="width:200px">
      <button class="btn primary sm" onclick="issueAsset()">发行</button>
    </div>
    <div id="akOut"></div>
  </div>

  <div class="card">
    <div class="card-head"><h3>发行台账</h3><span class="muted">未发行也留痕：台账先记，链上后补</span></div>
    ${(d.rows || []).length ? `<table><thead><tr><th>#</th><th>类型</th><th>渠道</th><th>链</th><th>用户</th><th>tokenId</th><th>交易号</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td class="num">${r.id}</td>
        <td>${esc(r.kind)}</td><td class="td-sub">${esc(r.channel)}</td><td class="td-sub">${esc(r.provider)}</td>
        <td class="td-sub">${esc(r.nickname || '用户' + r.user_id)}</td>
        <td class="td-sub mono">${esc(r.token_id || '—')}</td>
        <td class="td-sub mono">${r.tx_ref ? esc(String(r.tx_ref).slice(0, 14)) + '…' : '—'}</td>
        <td>${r.status == 1 ? '<span class="pill ok">已发行</span>' : (r.status == 0 ? '<span class="pill warn">待发行</span>' : '<span class="pill s70">失败</span>')}
          ${r.err ? '<div class="td-sub">' + esc(String(r.err).slice(0, 30)) + '</div>' : ''}</td>
        <td>${r.status == 1 ? '—' : `<button class="btn ghost sm" onclick="retryAsset(${r.id})">重试</button>`}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('还没有发行记录：上方选类型与用户发行一件试试')}
  </div>`
}

async function issueAsset() {
  const kind = document.getElementById('akKind').value
  const channel = document.getElementById('akChannel').value
  const userId = Number(document.getElementById('akUid').value)
  const tokenId = document.getElementById('akToken').value.trim() || null
  const name = document.getElementById('akName').value.trim() || '数字徽章'
  if (!userId) return toast('请填用户 id', true)
  try {
    const r = await api('POST', '/admin/web3/assets/issue', { kind, channel, userId, tokenId, meta: { name } })
    document.getElementById('akOut').innerHTML = r.status === 1
      ? `<div class="card" style="margin-top:12px;background:#f0faf7"><span class="pill ok">已发行</span>
         <span class="muted">txRef ${esc(String(r.txRef).slice(0, 18))}… · tokenId ${esc(r.tokenId || '—')}</span></div>`
      : `<div class="card" style="margin-top:12px;background:#fff8ec"><span class="pill warn">${r.status === 0 ? '已入待发行队列' : '发行失败'}</span>
         <span class="muted">${esc(r.note || r.err || '')}</span></div>`
    toast(r.status === 1 ? '已发行' : r.status === 0 ? '已入队' : '未发行')
  } catch (e) { toast(e.message, true) }
}

async function retryAsset(id) {
  try { const r = await api('POST', '/admin/web3/assets/' + id + '/retry'); toast(r.status === 1 ? '已补发' : (r.reason || r.err || '未完成')); chainAssetsPage() }
  catch (e) { toast(e.message, true) }
}

// ---- 资源池：景区资源（G端合作台账）/ 供应商（资源供给方）----
const RESOURCE_ST = { 1: '<span class="pill ok">合作中</span>', 0: '<span class="pill warn">暂缓</span>', 2: '<span class="pill s70">清退</span>' }
const CAT_CN = { script: '剧本闯关', yoga: '瑜伽之旅', sister: '姐姐系列', single: '单身社交', sport: '体育竞技', family: '亲子主题', red: '红色文旅', shop: '商城 SKU' }
const CITY_CN = { 310118: '上海·青浦', 310000: '上海', 320508: '苏州·姑苏', 330500: '湖州', 330523: '湖州·安吉' }
const SUP_KIND = { ticket: '门票', hotel: '住宿', transport: '交通', ground: '地接', catering: '餐饮', other: '其他' }
const MERCHANT_KIND = { catering: '餐饮', hotel: '住宿', ticket: '门票', transport: '交通', experience: '体验', other: '其他' }
const SETTLE_MODE = { monthly: '月结', per_order: '单结', prepaid: '预付' }

async function scenics() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  window.__kw = window.__kw || {}
  const all = await api('GET', '/admin/scenics')
  const K = (window.__kw.scenics || '').trim()
  const rows = K ? all.filter((s) => (s.name + (s.contact_name || '') + (s.city_code || '')).includes(K)) : all
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>景区资源</h2>
      <input id="sc_kw" placeholder="搜名称 / 联系人 / 城市码" style="width:200px" value="${esc(window.__kw.scenics || '')}" onchange="window.__kw.scenics=this.value;scenics()">
      <span class="muted">${K ? '筛出 ' + rows.length + ' / ' + all.length + ' 家' : '共 ' + all.length + ' 家'}</span>
      <span class="muted">G端合作台账 · 可在「商品与团期」把线路关联到景区</span>
      <button class="btn primary sm" onclick="scenicModal()">＋ 新增景区</button></div>
    ${rows.length ? `<table style="margin-top:10px"><thead><tr><th>景区</th><th>城市</th><th>等级</th><th>合作模式</th><th>票务对接</th><th>联系人</th><th>条款摘要</th><th>关联商品</th><th>状态</th><th></th></tr></thead><tbody>
    ${rows.map((s) => `<tr><td class="td-main">${esc(s.name)}</td><td class="num">${esc(s.city_code)}</td><td class="num">${esc(s.scenic_level || '—')}</td>
      <td>${esc(s.coop_mode || '—')}</td><td class="td-sub">${esc(s.ticket_interface || '—')}</td>
      <td class="td-sub">${esc(s.contact_name || '—')}${s.contact_phone ? '<br>' + esc(s.contact_phone) : ''}</td>
      <td class="td-sub">${esc(s.profit_terms || '—')}</td>
      <td class="num">${Number(s.product_count) ? `<a style="cursor:pointer;color:var(--brand)" onclick="resourceProducts('scenic',${s.id},'${esc(s.name)}')">${s.product_count} 条 ›</a>` : '—'}</td>
      <td>${RESOURCE_ST[s.status] || ''}</td>
      <td><button class="btn ghost sm" onclick="editScenic(${s.id})">编辑</button></td></tr>`).join('')}</tbody></table>`
    : emptyBox(K ? '没有匹配的景区：换个关键词试试' : '暂无景区：点右上「新增景区」入库')}
  </div>`
}
function scenicModal() { return entityEditor('scenic', null, { onSaved: () => scenics() }) }
async function addScenic() {
  try {
    if (!$('#sc_name').value.trim()) return toast('请填写景区名称', true)
    await api('POST', '/admin/scenics', { name: $('#sc_name').value.trim(), cityCode: $('#sc_city').value.trim() || '310118',
      level: $('#sc_level').value, coopMode: $('#sc_coop').value, ticketInterface: $('#sc_ticket').value.trim() || null,
      contactName: $('#sc_contact').value.trim() || null, contactPhone: $('#sc_phone').value.trim() || null,
      profitTerms: $('#sc_terms').value.trim() || null })
    toast('景区已入库'); closeModal(); scenics()
  } catch (e) { toast(e.message, true) }
}
async function editScenic(id) { return entityEditor('scenic', id, { onSaved: () => scenics() }) }
async function saveScenicEdit(id) {
  try {
    await api('PUT', '/admin/scenics/' + id, { name: $('#es_name').value.trim(), level: $('#es_level').value,
      coopMode: $('#es_coop').value, ticketInterface: $('#es_ticket').value.trim() || null,
      contactName: $('#es_contact').value.trim() || null, contactPhone: $('#es_phone').value.trim() || null,
      profitTerms: $('#es_terms').value.trim() || null, status: Number($('#es_status').value) })
    toast('已保存'); closeModal(); scenics()
  } catch (e) { toast(e.message, true) }
}

async function suppliers() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  window.__kw = window.__kw || {}
  const all = await api('GET', '/admin/suppliers')
  const K = (window.__kw.suppliers || '').trim()
  const rows = K ? all.filter((s) => (s.name + (s.contact_name || '') + (s.city_code || '') + (s.category || '')).includes(K)) : all
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>供应商</h2>
      <input id="sp_kw" placeholder="搜名称 / 联系人 / 类目" style="width:200px" value="${esc(window.__kw.suppliers || '')}" onchange="window.__kw.suppliers=this.value;suppliers()">
      <span class="muted">${K ? '筛出 ' + rows.length + ' / ' + all.length + ' 家' : '共 ' + all.length + ' 家'}</span>
      <span class="muted">资源供给方（门票/住宿/交通/地接/餐饮）· 与履约商户分账本管理</span>
      <button class="btn primary sm" onclick="supplierModal()">＋ 新增供应商</button></div>
    ${rows.length ? `<table style="margin-top:10px"><thead><tr><th>供应商</th><th>城市</th><th>类目</th><th>资质证照号</th><th>联系人</th><th>结算方式</th><th>备注</th><th>关联商品</th><th>状态</th><th></th></tr></thead><tbody>
    ${rows.map((s) => `<tr><td class="td-main">${esc(s.name)}</td><td class="num">${esc(s.city_code)}</td>
      <td><span class="pill off">${esc(SUP_KIND[s.category] || s.category)}</span></td>
      <td class="td-sub">${esc(s.license_no || '—')}</td>
      <td class="td-sub">${esc(s.contact_name || '—')}${s.contact_phone ? '<br>' + esc(s.contact_phone) : ''}</td>
      <td>${esc(SETTLE_MODE[s.settle_mode] || s.settle_mode)}</td>
      <td class="td-sub">${esc(s.note || '—')}</td>
      <td class="num">${Number(s.product_count) ? `<a style="cursor:pointer;color:var(--brand)" onclick="resourceProducts('supplier',${s.id},'${esc(s.name)}')">${s.product_count} 条 ›</a>` : '—'}</td>
      <td>${RESOURCE_ST[s.status] || ''}</td>
      <td><button class="btn ghost sm" onclick="editSupplier(${s.id})">编辑</button></td></tr>`).join('')}</tbody></table>` : emptyBox('暂无供应商：门票/大巴/酒店等资源方在这里入库，商品可关联')}
  </div>`
}
function supplierModal() { return entityEditor('supplier', null, { onSaved: () => suppliers() }) }
async function addSupplier() {
  try {
    if (!$('#sp_name').value.trim()) return toast('请填写供应商名称', true)
    await api('POST', '/admin/suppliers', { name: $('#sp_name').value.trim(), cityCode: $('#sp_city').value.trim() || '310118',
      category: $('#sp_cat').value, settleMode: $('#sp_settle').value, licenseNo: $('#sp_license').value.trim() || null,
      contactName: $('#sp_contact').value.trim() || null, contactPhone: $('#sp_phone').value.trim() || null,
      note: $('#sp_note').value.trim() || null })
    toast('供应商已入库'); closeModal(); suppliers()
  } catch (e) { toast(e.message, true) }
}
async function editSupplier(id) { return entityEditor('supplier', id, { onSaved: () => suppliers() }) }
async function saveSupplierEdit(id) {
  try {
    await api('PUT', '/admin/suppliers/' + id, { name: $('#ep_name').value.trim(), category: $('#ep_cat').value,
      settleMode: $('#ep_settle').value, licenseNo: $('#ep_license').value.trim() || null,
      contactName: $('#ep_contact').value.trim() || null, contactPhone: $('#ep_phone').value.trim() || null,
      note: $('#ep_note').value.trim() || null, status: Number($('#ep_status').value) })
    toast('已保存'); closeModal(); suppliers()
  } catch (e) { toast(e.message, true) }
}

// 资源关联商品明细（景区/供应商 → 商品）
async function resourceProducts(kind, id, name) {
  const rows = (await api('GET', '/admin/products')).filter((p) => Number(kind === 'scenic' ? p.scenic_id : p.supplier_id) === Number(id))
  modal((kind === 'scenic' ? '景区' : '供应商') + '「' + esc(name) + '」关联商品（' + rows.length + '）', rows.length ? `
    <table><thead><tr><th>商品</th><th>城市</th><th>价格</th><th>状态</th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td class="td-main">${esc(p.title)}</td><td class="num">${esc(p.city_code)}</td>
      <td class="money num">${fen(p.price_from)}</td>
      <td><span class="pill ${p.status === 1 ? 'ok' : 'off'}">${p.status === 1 ? '上架' : '下架'}</span></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">还没有商品关联此资源；到「商品与团期」的创建/编辑表单里选择即可。</p>',
    `<button class="btn primary" onclick="closeModal()">知道了</button>`)
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
      <td><button class="btn ghost sm" onclick="setCreatorTag(${c.id},'${esc(c.creator_tag || 'none')}')">设标签</button></td></tr>`).join('')}</tbody></table>`
    : emptyBox(window.__kw.creators ? '没有匹配的创作者' : '池子还空：用户发布笔记或点评后自动入池')}
  </div>`
}
async function setCreatorTag(id, cur) {
  modal('设置创作者标签 · 用户#' + id, `
    <div class="field"><label>标签</label><select id="ct_tag">${Object.entries(CREATOR_TAG).map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <p class="muted">签约/优质创作者在约稿任务与内容激励中享受加权（运营口径）；限流用于配合风控。</p>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="saveCreatorTag(${id})">保存</button>`)
}
async function saveCreatorTag(id) {
  try { await api('PUT', '/admin/creators/' + id + '/tag', { tag: $('#ct_tag').value }); toast('标签已更新'); closeModal(); creators() }
  catch (e) { toast(e.message, true) }
}

// ---- 链上总览：链路视图（3D 区块链）+ KPI + 事件动态 ----
const BLOCK_ST = ['<span class="dpill warn">待打包</span>', '<span class="dpill info">已打包·待锚定</span>',
  '<span class="dpill ok">已锚定</span>', '<span class="dpill err">锚定重试</span>', '<span class="dpill err">人工处理</span>',
  '<span class="dpill warn">已提交·待确认</span>']
/** 3D 区块：tone = blue | green | gold | gray；sm = 小号；pulse = 等待链上确认中 */
function cube3d(tone, opt = {}) {
  const cls = ['cube-zone', tone && tone !== 'blue' ? 't-' + tone : '', opt.sm ? 'sm' : '', opt.pulse ? 'pulse' : '', opt.ghost ? 'ghost' : ''].filter(Boolean).join(' ')
  // 特效层全部是 .cube3d 的兄弟节点：不参与 preserve-3d，加光晕/滤镜不会把立方体压平
  const fx = opt.ghost ? '' : '<span class="fx-ripple"></span><span class="fx-ripple r2"></span>'
    + '<span class="fx-orbit"><i></i></span>' + (opt.sm ? '' : '<span class="fx-orbit o2"><i></i></span>')
    + '<span class="fx-beam"></span><span class="fx-spark s1"></span><span class="fx-spark s2"></span><span class="fx-spark s3"></span>'
    + '<span class="fx-hud"></span>'
  return `<div class="${cls}"${opt.label ? '' : ' aria-hidden="true"'}>${fx}<div class="cube3d">`
    + '<div class="fc"></div>'.repeat(6) + '<div class="core">' + '<i></i>'.repeat(6) + '</div></div>'
    + (opt.label ? `<div class="ghost-label">${opt.label}</div>` : '') + '</div>'
}
// 演示模式：纯前端模拟一条 8 节点的链（含分支/待打包/已锚定），不动真库，仅供形态预览
function mockChain() {
  const HEX = ['3f9a1c7e5d24b806', '8d02e4b1a97c33f5', '5c77aa190e6db248', 'e21b6d40fa93c715',
    '9b48f0c26d1eab73', '17d5a93e04fb8c62', '4e6c88d2b17a05f3', 'b0f3126a7de948c1']
  const root = (i) => HEX[i % 8] + '9f4c1a2b7de50863'
  const mk = (seq, kind, status, date, leaves) => ({ id: 900 + seq, seq, biz_date: date,
    merkle_root: root(seq - 1), prev_root: seq === 1 ? null : root(seq - 2), leaf_count: leaves,
    is_day_close: kind === 'day' ? 1 : 0, status, attempt: 0,
    chain_tx_ref: status === 2 ? 'DEMO-TX-' + String(seq).padStart(4, '0') : null,
    anchored_at: status === 2 ? date + ' 09:12:00' : null })
  return [
    mk(1, 'mix', 2, '2026-10-27', 9), mk(2, 'day', 2, '2026-10-27', 6), mk(3, 'mix', 2, '2026-10-28', 14),
    mk(4, 'mix', 1, '2026-10-29', 11), mk(5, 'day', 1, '2026-10-30', 7), mk(6, 'mix', 1, '2026-10-30', 12),
    mk(7, 'mix', 0, '2026-10-31', 16), mk(8, 'day', 0, '2026-10-31', 8),
  ]
}
function mockBlockEvents(b) {
  const TYPES = ['order', 'pass_issue', 'bean_grant', 'pass_verify', 'refund', 'settlement', 'bean_deduct']
  const REF = { order: 'WL2026', pass_issue: 'pass-', pass_verify: 'pass-1-', bean_grant: 'bt-BT', bean_deduct: 'bt-BT', refund: 'RF', settlement: 'settle-' }
  return Array.from({ length: Math.min(Number(b.leaf_count), 10) }, (_, i) => {
    const t = TYPES[(b.seq + i) % TYPES.length]
    return { id: i, leaf_index: i, biz_type: t, biz_ref: REF[t] + String(20261020 + b.seq * 7 + i) + (t === 'order' ? '' : ''), version_no: 1,
      payload_hash: String(b.merkle_root).slice(0, 12) + (i * 7 % 100).toString().padStart(2, '0') + 'a1b2c3d4e5f60718', status: Number(b.status), created_at: b.biz_date + ' 1' + (i % 10) + ':1' + (i % 6) + ':00' }
  })
}
function toggleDemoChain() {
  window.__demoChain = !window.__demoChain
  web3dash()
}
function blockNodeHTML(b) {
  const dayClose = Number(b.is_day_close) === 1
  const st = Number(b.status)
  const root8 = String(b.merkle_root).slice(0, 8)
  const tone = st === 0 ? 'gray' : (dayClose ? 'gold' : (st === 2 ? 'green' : 'blue'))
  const cls = 'chain-node' + (dayClose ? ' branch' : '') + (st === 2 ? ' anchored' : '')
  return `<div class="${cls}" id="bnode-${b.id}" onclick="openBlock(${b.id})">
    ${cube3d(tone, { pulse: st === 5 })}
    <div class="blk-title">${dayClose ? '账本日终' : '区块'} #${b.seq}${b.prev_root ? '' : ' <span class="dpill genesis">创世</span>'}</div>
    <div class="blk-line">业务日 ${esc(String(b.biz_date).slice(0, 10))}</div>
    <div class="blk-line">事件 <b>${Number(b.leaf_count)}</b> 条 · ${dayClose ? '账本封存' : '业务存证'}</div>
    <div class="blk-line">根 <code class="dk">${root8}…</code></div>
    <div class="blk-line">${BLOCK_ST[st] || ''}</div>
  </div>`
}
function blockLinkHTML(prevBranch, curBranch) {
  const y = (p) => p ? 133 : 59
  const y1 = y(prevBranch), y2 = y(curBranch)
  // <s> 是沿连线流动的数据包，表示"前一块的根被写进后一块的 prev_root"
  if (y1 === y2) return `<div class="chain-link"><i style="top:${y1 - 1}px"></i><s style="top:${y1 - 2}px"></s><s class="p2" style="top:${y1 - 2}px"></s><u style="top:${y1 - 11}px">»</u></div>`
  const down = y1 < y2
  const top = Math.min(y1, y2) - 1
  const edge = down ? 'border-top:2px dashed var(--cl);border-top-right-radius:12px' : 'border-bottom:2px dashed var(--cl);border-bottom-right-radius:12px'
  return `<div class="chain-link elbow"><i style="top:${top}px;height:${Math.abs(y2 - y1)}px;${edge};border-right:2px dashed var(--cl)"></i>
    <b style="top:${y2 - 1}px"></b><s class="tail" style="top:${y2 - 2}px"></s><u style="top:${y2 - 11}px">▸</u></div>`
}
async function web3dash() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  if (window.__chainTimer) { clearInterval(window.__chainTimer); window.__chainTimer = null }
  const [d, c] = await Promise.all([api('GET', '/admin/web3/overview'), api('GET', '/admin/attest/center')])
  const demo = !!window.__demoChain
  const batches = demo ? mockChain() : (c.batches || []).slice().sort((a, b) => a.seq - b.seq)
  const pendingN = demo ? batches.filter((b) => Number(b.status) === 0).reduce((s, b) => s + Number(b.leaf_count), 0) : Number(d.pendingEvents)
  const anchorN = demo ? batches.filter((b) => Number(b.status) === 2).reduce((s, b) => s + Number(b.leaf_count), 0) : d.anchoredEvents
  const totalN = demo ? batches.reduce((s, b) => s + Number(b.leaf_count), 0) : d.events
  const lastSeq = batches.length ? batches[batches.length - 1].seq : 0
  const nodes = []
  batches.forEach((b, i) => {
    if (i) nodes.push(blockLinkHTML(Number(batches[i - 1].is_day_close) === 1, Number(b.is_day_close) === 1))
    nodes.push(blockNodeHTML(b))
  })
  if (Number(pendingN) > 0) {
    nodes.push(blockLinkHTML(batches.length ? Number(batches[batches.length - 1].is_day_close) === 1 : false, false))
    nodes.push(`<div class="chain-node ghost">${cube3d('gray', { ghost: true, label: '待打包<br><b>' + pendingN + '</b> 条' })}
      <div class="blk-title" style="opacity:.75">下一区块</div>
      <div class="blk-line" style="opacity:.7">小时级打包 · #${lastSeq + 1}</div></div>`)
  }
  const auto = window.__chainAuto === undefined ? (window.__chainAuto = true) : window.__chainAuto
  $('#app').innerHTML = `
  <div class="chain-panel" id="chainViz"><div class="chain-scan-clip" aria-hidden="true"><div class="chain-scan"></div></div>
    <div class="chain-glow"></div>
    <div class="chain-head">
      <span class="chain-name">⛓ 向往自由链 · 链路视图</span><span class="chain-live"><i></i>LIVE</span>
      ${demo ? '<span class="chip demo">演示数据</span>' : ''}
      <span class="chip">适配器 ${esc((d.chain && d.chain.label) || '—')}</span>
      <span class="chip">区块高度 <b>#${lastSeq}</b></span>
      <span class="chip">链上事件 <b>${anchorN}/${totalN}</b></span>
      <span class="chip">待打包 <b>${pendingN}</b></span>
      <span style="flex:1"></span>
      <label class="chain-auto"><input type="checkbox" id="chainAuto" ${auto ? 'checked' : ''} onchange="window.__chainAuto=this.checked;chainTimerSetup()"> 30s 自动刷新</label>
      <button class="chain-btn ${demo ? 'demo-on' : ''}" onclick="toggleDemoChain()">${demo ? '退出演示' : '演示 · 多节点形态'}</button>
      <button class="chain-btn" onclick="web3dash()">刷新 ↻</button>
    </div>
    ${demo ? '<div class="chain-demo-note">演示模式：以下为模拟数据，仅预览多节点链路形态，不代表真实链上状态</div>' : ''}
    <div class="chain-track">${nodes.join('') || '<div class="blk-line" style="padding:30px">尚无区块：到「存证中心」点「① 打包」即可出根</div>'}</div>
    <div class="chain-divider"></div>
    <div class="flow-head">
      <span class="chain-name" style="font-size:13px">🧭 单流程视角 · 一单六锚</span>
      <input id="flowNo" class="flow-input" placeholder="输入订单号（如 WL202610311650904810）" onkeydown="if(event.key==='Enter')loadFlow()">
      <button class="chain-btn" onclick="loadFlow()">追踪此单 ↗</button>
      <button class="chain-btn" onclick="loadFlowDemo()">演示完整流程</button>
      <span id="flowMeta" style="flex:1;font-size:12px;color:#9db1e2"></span>
    </div>
    <div id="flowTrack"></div>
    <div class="chain-legend">
      <span><i class="lg blue"></i>业务存证块</span><span><i class="lg gold"></i>账本日终封存块（分支）</span>
      <span><i class="lg green"></i>已锚定</span><span><i class="lg dash"></i>待打包队列</span>
      <span class="muted" style="margin-left:auto;color:#7f92bd">prev_root 指向上批根 · 点击区块查看批内事件</span>
    </div>
  </div>
  <div id="blockDetail"></div>
  <div class="card">
    <div class="card-head"><h2>链上总览 · 双层口径</h2><span class="muted">${esc(d.chainMode)} · 小程序内=旅豆积分，对外=链上权益凭证</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">⛓</div><div><div class="l">锚定批次</div><div class="v" style="font-size:18px">${d.anchoredBatches}/${d.batches}</div><div class="s">Merkle 小时级打包</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">🔗</div><div><div class="l">链上事件</div><div class="v" style="font-size:18px">${d.anchoredEvents}/${d.events}</div><div class="s">待打包 ${d.pendingEvents}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">🏅</div><div><div class="l">勋章发放</div><div class="v" style="font-size:18px">${d.badgeGrants}</div><div class="s">发放即入存证队列</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e3f6ec">🫘</div><div><div class="l">累计发放</div><div class="v" style="font-size:18px">${d.beanGranted}</div><div class="s">已消耗 ${d.beanConsumed}</div></div></div>
    </div>
    <div class="row" style="margin-top:10px">${(d.trustPath || []).map((t, i) => `<span class="pill ${i ? 'off' : 'ok'}">${esc(t)}</span>`).join('<span class="muted">→</span>')}<span class="muted" style="margin-left:auto">上链的只有哈希指纹+时间戳，业务数据全在 MySQL（数据库是事实来源，链是审计锚点）</span></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>链上事件动态</h3><button class="btn ghost sm" onclick="go('attest')">进入存证中心 ›</button></div>
    <table><thead><tr><th>类型</th><th>业务单号</th><th>状态</th><th>时间</th></tr></thead><tbody>
    ${(d.recentEvents || []).map((e) => `<tr><td>${bizTag(esc(e.biz_type))}</td><td class="num">${esc(e.biz_ref)}</td>
      <td>${e.status === 2 ? '<span class="pill ok">已锚定</span>' : (e.status === 1 ? '<span class="pill s20">已打包·待锚定</span>' : '<span class="pill warn">待打包</span>')}</td>
      <td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无事件</td></tr>'}
    </tbody></table>
  </div>`
  if (window.__flowShown && window.__flowData) renderFlow(window.__flowData)
  chainTimerSetup()
}
function chainTimerSetup() {
  if (window.__chainTimer) { clearInterval(window.__chainTimer); window.__chainTimer = null }
  if (!window.__chainAuto) return
  window.__chainTimer = setInterval(() => {
    if (!document.getElementById('chainViz')) { clearInterval(window.__chainTimer); window.__chainTimer = null; return }
    web3dash()
  }, 30000)
}
async function openBlock(id) {
  document.querySelectorAll('.chain-node.active').forEach((n) => n.classList.remove('active'))
  const el = document.getElementById('bnode-' + id)
  if (el) el.classList.add('active')
  const box = document.getElementById('blockDetail')
  box.innerHTML = `<div class="card">${skel(3)}</div>`
  const demo = !!window.__demoChain && id >= 900
  let b, evs = []
  if (demo) {
    b = mockChain().find((x) => x.id === id)
    if (!b) { box.innerHTML = ''; return }
    evs = mockBlockEvents(b)
  } else {
    const r = await api('GET', '/admin/attest/batch/' + id)
    b = r.batch; evs = r.events || []
  }
  const BST = ['<span class="pill warn">待打包</span>', '<span class="pill s20">已打包·待锚定</span>', '<span class="pill ok">已锚定</span>', '<span class="pill s70">锚定重试</span>', '<span class="pill s70">人工处理</span>']
  box.innerHTML = `
  <div class="card">
    <div class="card-head"><h3>区块 #${b.seq} · 批内事件（${Number(b.leaf_count)}${demo ? '，演示取前 10' : ''}）</h3>
      <span class="muted">${Number(b.is_day_close) ? '旅豆账本日终封存批 · ' : ''}打包于 ${esc(String(b.biz_date).slice(0, 10))}${demo ? ' · 演示数据' : ''}</span></div>
    <div class="row" style="gap:18px;flex-wrap:wrap;font-size:12.5px">
      <span>Merkle 根 <code>${esc(b.merkle_root)}</code></span>
      <span>前根 <code>${b.prev_root ? esc(b.prev_root) : '—（链起点）'}</code></span>
      ${b.chain_tx_ref ? `<span>链上编号 <code>${esc(b.chain_tx_ref)}</code></span>` : ''}
      ${b.anchored_at ? `<span>锚定时间 ${esc(String(b.anchored_at).slice(0, 19))}</span>` : ''}
      <span>尝试 ${Number(b.attempt) || 0} 次</span>
      ${!demo && Number(b.is_day_close) ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="/open/report/bean-day/${esc(String(b.biz_date).slice(0, 10))}">封存证明 PDF</a>
        <a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?date=${esc(String(b.biz_date).slice(0, 10))}">公开复核</a>` : ''}
    </div>
    <table style="margin-top:10px"><thead><tr><th>叶序</th><th>类型</th><th>业务单号</th><th>版本</th><th>payload 指纹</th><th>状态</th><th>时间</th><th></th></tr></thead><tbody>
    ${evs.map((e) => `<tr><td class="num">${Number(e.leaf_index)}</td><td>${bizTag(esc(e.biz_type))}</td>
      <td class="num">${esc(e.biz_ref)}</td><td class="num">v${Number(e.version_no ?? 1)}</td>
      <td class="td-sub"><code>${esc(String(e.payload_hash).slice(0, 16))}…</code></td>
      <td>${BST[e.status] || ''}</td><td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td>
      <td>${!demo && e.biz_type === 'order' ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?no=${encodeURIComponent(e.biz_ref)}">公开复核</a>`
        : (demo ? '' : `<button class="btn ghost sm" onclick="verifyEventInline('${esc(e.biz_type)}','${esc(e.biz_ref)}',${e.id})">验证</button>`)}</td></tr>`).join('') || '<tr><td colspan="8" class="td-sub">空批次</td></tr>'}
    </tbody></table>
  </div>`
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}
async function verifyEventInline(bizType, bizRef, id) {
  const r = await api('GET', '/admin/attest/verify?bizType=' + encodeURIComponent(bizType) + '&bizRef=' + encodeURIComponent(bizRef))
  const ok = r.found && r.proofValid !== false
  toast(r.found ? (ok ? '验证通过 · ' + (r.note || '') : '验证失败：证明路径对不上根') : '未找到该单号', !ok)
}
// ---- 单流程视角：一单六锚（一笔订单的 6 步链上锚点） ----
const FLOW_ST = ['<span class="dpill warn">待打包</span>', '<span class="dpill info">已打包·待锚定</span>', '<span class="dpill ok">已锚定</span>']
function flowStepHTML(s, i) {
  const e = s.ev
  if (!e) return `<div class="chain-node ghost" style="width:150px">
    ${cube3d('gray', { ghost: true, sm: true, label: '待产生' })}
    <div class="blk-title">${s.no} ${esc(s.label)}</div><div class="blk-line">${esc(s.hint)}</div></div>`
  const st = Number(e.status)
  const tone = st === 2 ? 'green' : (st === 0 ? 'gray' : 'blue')
  return `<div class="chain-node" style="width:150px" id="fnode-${i}" onclick="openFlowStep(${i})">
    ${cube3d(tone, { sm: true })}
    <div class="blk-title">${s.no} ${esc(s.label)}</div>
    <div class="blk-line">${esc(String(e.created_at).slice(5, 16))}</div>
    <div class="blk-line">批 #${e.seq != null ? e.seq : '—'} · ${FLOW_ST[st] || ''}</div>
  </div>`
}
function renderFlow(d) {
  const o = d.order || {}
  const yuan = (n) => '¥' + (Number(n) / 100).toFixed(2).replace(/\.00$/, '')
  const doneN = (d.steps || []).filter((s) => s.ev).length
  window.__flowData = d; window.__flowShown = true
  const meta = document.getElementById('flowMeta')
  if (meta) meta.innerHTML = `${d.demo ? '<span class="chip demo">演示数据</span> ' : ''}${esc(o.orderNo || '')} · ${esc(o.productName || '—')} · ${yuan(o.amountPay || 0)}${o.beanDeducted ? '（豆抵' + o.beanDeducted + '）' : ''} · ${esc(o.statusText || '')} · <b style="color:#eaf1ff">${doneN}/6 锚点</b>`
  const parts = []
  ;(d.steps || []).forEach((s, i) => {
    if (i) parts.push('<div class="chain-link flow-link"><i style="top:59px"></i><s style="top:58px"></s><u style="top:49px">»</u></div>')
    parts.push(flowStepHTML(s, i))
  })
  ;(d.refunds || []).forEach((e, j) => {
    parts.push('<div class="chain-link elbow"><i style="top:59px;height:74px;border-top:2px dashed rgba(252,211,77,.5);border-right:2px dashed rgba(252,211,77,.5);border-top-right-radius:12px"></i><b style="top:132px;border-top-color:rgba(252,211,77,.5)"></b><u style="top:122px;color:#fcd34d">▸</u></div>')
    parts.push(`<div class="chain-node branch" id="fnode-r${j}" onclick="openFlowStep('r${j}')">
      ${cube3d('gold', { sm: true })}
      <div class="blk-title">退款冲正</div>
      <div class="blk-line">${esc(e.biz_ref)} · ${yuan(e.amount || 0)}</div>
      <div class="blk-line">${FLOW_ST[Number(e.status)] || ''}</div></div>`)
  })
  const track = document.getElementById('flowTrack')
  if (track) track.innerHTML = `<div class="chain-track flow">${parts.join('')}</div>`
}
async function loadFlow() {
  const no = (document.getElementById('flowNo')?.value || '').trim()
  if (!no) return toast('请输入订单号', true)
  try {
    renderFlow(await api('GET', '/admin/attest/flow/' + encodeURIComponent(no)))
  } catch (e) { toast(e.message, true) }
}
function loadFlowDemo() {
  const mk = (no, label, hint, seq, t, st) => ({ no, label, hint, ev: { biz_type: label, biz_ref: no, version_no: 1, status: st, payload_hash: 'f0' + String(seq).padStart(2, '0') + 'a1b2c3d4e5f60718', created_at: t, seq, merkle_root: '17d5a93e04fb8c629f4c1a2b7de50863' } })
  renderFlow({
    demo: true,
    order: { orderNo: 'WL20261101DEMO01', status: 50, statusText: '已完成', productName: '朱家角水乡沉浸一日（演示）', qty: 2, amountPay: 39800, beanDeducted: 200, createdAt: '2026-10-31 10:02:11', paidAt: '2026-10-31 10:03:05', completedAt: '2026-10-31 15:40:22' },
    steps: [
      mk('bt-DEMO1001', '旅豆抵扣', '下单锁豆', 12, '2026-10-31 10:02:30', 1),
      mk('WL20261101DEMO01', '支付成功', '订单事实入链', 12, '2026-10-31 10:03:05', 2),
      mk('pass-901', '出票', '权益凭证 ×2', 13, '2026-10-31 10:03:40', 2),
      mk('pass-901-1', '核销', '到店扫码', 13, '2026-10-31 11:25:02', 1),
      mk('bt-DEMO1002', '返豆', '消费奖励', 14, '2026-10-31 15:40:22', 1),
      mk('settle-31', '结算', '五口径分账', 20, '2026-11-03 01:00:10', 0),
    ],
    refunds: [],
  })
}
function openFlowStep(i) {
  const d = window.__flowData
  if (!d) return
  document.querySelectorAll('.chain-node.active').forEach((n) => n.classList.remove('active'))
  const el = document.getElementById('fnode-' + i)
  if (el) el.classList.add('active')
  const isRefund = String(i).startsWith('r')
  const s = isRefund ? null : (d.steps || [])[i]
  const e = isRefund ? (d.refunds || [])[Number(String(i).slice(1))] : s.ev
  if (!e) return
  const box = document.getElementById('blockDetail')
  const o = d.order || {}
  const BST = ['<span class="pill warn">待打包</span>', '<span class="pill s20">已打包·待锚定</span>', '<span class="pill ok">已锚定</span>']
  box.innerHTML = `
  <div class="card">
    <div class="card-head"><h3>${isRefund ? '退款冲正' : (s.no + ' ' + esc(s.label))} · 链上锚点${d.demo ? '（演示数据）' : ''}</h3>
      <span class="muted">${esc(o.orderNo || '')} · ${esc(o.statusText || '')}</span></div>
    <div class="row" style="gap:18px;flex-wrap:wrap;font-size:12.5px">
      <span>类型 <code>${esc(e.biz_type)}</code></span>
      <span>业务单号 <code>${esc(e.biz_ref)}</code></span>
      <span>版本 v${Number(e.version_no ?? 1)}</span>
      <span>${BST[Number(e.status)] || ''}</span>
      <span>所在批次 ${e.seq != null ? '#' + e.seq : '待打包'}</span>
      <span>Merkle 根 <code>${e.merkle_root ? esc(String(e.merkle_root).slice(0, 24)) + '…' : '—'}</code></span>
      <span>payload 指纹 <code>${esc(String(e.payload_hash).slice(0, 16))}…</code></span>
      <span>时间 ${esc(String(e.created_at).slice(0, 19))}</span>
    </div>
    <div class="row" style="margin-top:10px">
      ${!d.demo && e.biz_type === 'order' ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?no=${encodeURIComponent(e.biz_ref)}">公开复核页 ↗</a>
        <a class="btn ghost sm" target="_blank" rel="noopener" href="/open/report/order/${encodeURIComponent(e.biz_ref)}">存证报告 PDF ↗</a>` : ''}
      <span class="muted">六步与业务同事务写入 · 小时级打包 · 上链只有哈希指纹+时间戳</span>
    </div>
  </div>`
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

async function pointassets() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/point-assets')
  const BIZ = { 1: '消费返豆', 2: '任务奖励', 3: '内容奖励', 4: '抵扣', 5: '退款冲正', 6: '过期回收', 7: '风控调整' }
  const capPct = d.globalCap ? Math.min(100, Math.round(Number(d.globalCap.granted || 0) / Math.max(Number(d.globalCap.cap_total || d.globalCap.total || 1), 1) * 100)) : 0
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>积分发行台账</h2><span class="muted">旅豆 = 向往自由链积分资产（D6 外层口径）</span></div>
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
    <div class="card-head"><h2>勋章发行</h2><span class="muted">勋章发放即写入链上存证队列（badge 事件）</span></div>
    <div class="row"><button class="btn primary sm" onclick="createBadge()">＋ 新建勋章</button><span class="muted">外观（勋章图/稀有度/故事）与获得规则（类型/阈值/发行上限/有效期）</span></div>
    <table style="margin-top:10px"><thead><tr><th>ID</th><th>名称</th><th>图标键</th><th>授予规则</th><th>已发放</th><th>操作</th></tr></thead><tbody>
    ${(d.defs || []).map((b) => `<tr><td>#${b.id}</td><td>${esc(b.name)}</td><td class="td-sub">${esc(b.icon_key)}</td>
      <td class="td-sub">${esc(b.rule_desc || '—')}</td><td class="num">${Number(b.granted)}</td>
      <td><button class="btn ghost sm" onclick="entityEditor('badge', ${b.id}, { onSaved: () => badges() })">编辑</button> <button class="btn ghost sm" onclick="grantBadge(${b.id})">发放给用户</button></td></tr>`).join('') || '<tr><td colspan="6" class="td-sub">暂无勋章定义（先新建）</td></tr>'}
    </tbody></table>
  </div>
  <div class="card">
    <div class="card-head"><h3>最近发放</h3></div>
    <table><thead><tr><th>用户</th><th>勋章</th><th>时间</th></tr></thead><tbody>
    ${(d.recent || []).map((r) => `<tr><td>${esc(r.nickname || ('用户' + r.user_id))}</td><td>${esc(r.name)}</td><td class="td-sub">${esc(String(r.granted_at).slice(0, 19))}</td></tr>`).join('') || '<tr><td colspan="3" class="td-sub">暂无发放记录</td></tr>'}
    </tbody></table>
  </div>`
}
async function createBadge() { return entityEditor('badge', null, { onSaved: () => badges() }) }
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
    <div class="card-head"><h2>权益账户</h2>
      <div class="row" style="margin:0"><input id="wkw" placeholder="昵称 / 用户ID" style="width:180px" value="${esc(kw)}">
      <button class="btn ghost sm" onclick="wallets()">查询</button></div></div>
    <table><thead><tr><th>用户</th><th>积分余额</th><th>等级</th><th>成长值</th><th>勋章</th><th>存证事件</th><th></th></tr></thead><tbody>
    ${d.map((w) => `<tr><td>${esc(w.nickname || '用户' + w.user_id)}</td><td class="num"><b>${Number(w.balance)}</b></td>
      <td><span class="pill off">Lv${w.member_level}</span></td><td class="num">${Number(w.growth_value)}</td>
      <td class="num">${Number(w.badges)}</td><td class="num">${Number(w.attest_n)}</td>
      <td><button class="btn ghost sm" onclick="walletDetail(${w.user_id})">账户明细 ›</button></td></tr>`).join('') || '<tr><td colspan="7" class="td-sub">暂无账户</td></tr>'}
    </tbody></table>
  </div>
  <div id="wdetail"></div>`
}
async function walletDetail(uid) {
  const d = await api('GET', '/admin/web3/wallets/' + uid)
  $('#wdetail').innerHTML = `
  <div class="card">
    <div class="card-head"><h3>${esc(d.profile.nickname || '用户' + uid)} · 权益账户明细</h3><span class="muted">余额 ${Number(d.balance)} · Lv${d.profile.member_level} · 成长值 ${Number(d.profile.growth_value)}</span></div>
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
async function saveFaq(id) {
  const question = $('#fq_q').value.trim(), answer = $('#fq_a').value.trim()
  if (!question || !answer) return toast('问题与答案必填', true)
  const body = { question, answer, sort: Number($('#fq_sort').value) || 0, category: $('#fq_cat').value, isHot: $('#fq_hot').checked ? 1 : 0, status: Number($('#fq_st').value) }
  if (id) { await api('POST', '/admin/faqs/' + id + '/update', body); toast('已保存') } else { await api('POST', '/admin/faqs', body); toast('已新增') }
  closeModal(); faqs()
}
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
async function saveBanner(id) {
  const title = $('#bn_t').value.trim(), image = $('#bn_img').value
  if (!title || !image) return toast('标题与轮播图必填', true)
  const body = { title, subTitle: $('#bn_st').value.trim() || null, image, link: $('#bn_link').value.trim() || null,
    sort: Number($('#bn_sort').value) || 0, status: Number($('#bn_status').value),
    startAt: $('#bn_start').value || null, endAt: $('#bn_end').value || null }
  if (id) { await api('POST', '/admin/banners/' + id + '/update', body); toast('已保存') } else { await api('POST', '/admin/banners', body); toast('已新增') }
  closeModal(); banners()
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
document.addEventListener('DOMContentLoaded', () => boot(), { once: true })

// ── 后台编辑能力（V14 补齐）──
async function handleRisk(id) {
  try { await api('POST', '/admin/risk/' + id + '/handle', {}); toast('风控事件已标记处理'); risk() } catch (e) { toast(e.message, true) }
}
async function editMerchant(id) { return entityEditor('merchant', id, { onSaved: () => merchants() }) }
async function approveMerchant(id) {
  try { await api('POST', '/admin/merchants/' + id + '/approve', {}); toast('商户进件已通过'); merchants() } catch (e) { toast(e.message, true) }
}
async function saveMerchantEdit(id) {
  try {
    await api('POST', '/admin/merchants/' + id, {
      name: document.getElementById('em_name').value.trim(),
      cityCode: document.getElementById('em_city').value.trim(),
      wxpaySubMchid: document.getElementById('em_wx').value.trim(),
      kind: document.getElementById('em_kind').value
    })
    closeModal(); toast('商户已更新'); merchants()
  } catch (e) { toast(e.message, true) }
}
async function toggleBudget(id, status) {
  try { await api('POST', '/admin/budgets/' + id + '/status', { status: status === 1 ? 0 : 1 }); toast(status === 1 ? '批次已停用' : '批次已启用'); budgets() } catch (e) { toast(e.message, true) }
}
async function togglePromoter(userId, status) {
  try { await api('POST', '/admin/promoters/' + userId + '/status', { status: status === 1 ? 0 : 1 }); toast(status === 1 ? '推广商已冻结' : '推广商已解冻'); promoters() } catch (e) { toast(e.message, true) }
}
async function changePromoterTier(userId, tier) {
  const newTier = prompt('请输入新档位（1=基础 5% / 2=优选 8% / 3=金牌 12%）：', tier)
  if (!newTier) return
  try { await api('POST', '/admin/promoters/' + userId + '/tier', { tier: Number(newTier) }); toast('档位已更新'); promoters() } catch (e) { toast(e.message, true) }
}
