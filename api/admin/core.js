// 向往的自由 · 运营后台 SPA（零依赖，设计系统见 app.css）
const $ = (s) => document.querySelector(s)
let TOKEN = localStorage.getItem('admin_token') || ''
let ME = JSON.parse(localStorage.getItem('admin_me') || 'null')
let ADMIN_CAPABILITIES = { actions: {} }
const adminCan = action => ADMIN_CAPABILITIES.actions[action]?.allowed === true
const adminWhy = action => ADMIN_CAPABILITIES.actions[action]?.reason || '当前账号无此操作权限'

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
  kyc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5 16.5c.6-1.6 2-2.4 3.5-2.4s2.9.8 3.5 2.4M14.5 10h4M14.5 14h4"/></svg>',
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
// 按"谁在什么场景下做什么事"分组，而不是按技术模块堆叠。
// C-04：模块清单与角色默认集合的唯一数据源在后端（src/domain/modules.mjs，经 GET /admin/capabilities
// 下发 allModules + modules）。前端不再写死 access 表；NAV 在 boot() 里由接口数据组装。
let NAV = []

const BIZ_CN = { order: '订单完成', pass_issue: '凭证签发', pass_verify: '到店核销', bean_grant: '旅豆发放', bean_deduct: '旅豆抵扣',
  refund: '退款冲正', settlement: '商户结算', badge: '勋章发放', vc_issue: '身份凭证签发', vc_revoke: '身份凭证吊销', asset_issue: '资产发行',
  // C-08：生命周期/整改新增事件类型中文化（未登记类型仍显示原码，语义不变）
  kyc: '实名认证通过', merchant_join: '商户准入', content_review: '内容审核结论', withdraw: '提现申请',
  did_issue: '数字身份签发', consent: '协议签署', commission: '佣金计提', co_profit: '共创分润计提', product_change: '商品价格/状态变更' }
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
        $('#mfaTip').textContent = d.mfaSetupRequired
          ? '该账号要求两步验证但尚未绑定：请先绑定验证方式（此阶段不能进入后台办理业务）'
          : (d.target ? '已发送至 ' + d.target + '（' : ('请输入' + chName + (d.channel === 'totp' ? '' : '（MOCK 通道码在后台安全中心可见'))) + (d.target ? '）' : '')
        $('#mfaSetupRow').style.display = d.mfaSetupRequired && d.channel === 'totp' ? 'block' : 'none'
        $('#step1').style.display = 'none'
        $('#step2').style.display = 'block'
        document.querySelector('#mfacode')?.focus()
        return
      }
      TOKEN = d.token; ME = d.user
      localStorage.setItem('admin_token', TOKEN); localStorage.setItem('admin_me', JSON.stringify(ME))
      if (ME?.mustChangePassword) showForcedPwdChange(); else boot() // T02/U-02：临时密码先改密（接口层已锁定其他路由），改完重新登录才进入后台
    }).catch((e) => { $('#lerr').textContent = e.message })
  }
async function mfaSubmit() {
  $('#lerr2').textContent = ''
  try {
    const d = await api('POST', '/admin/login/mfa', { challenge: MFA_CHALLENGE, code: norm(document.querySelector('#mfacode').value) })
    TOKEN = d.token; ME = d.user
    localStorage.setItem('admin_token', TOKEN); localStorage.setItem('admin_me', JSON.stringify(ME))
    MFA_CHALLENGE = null
    if (ME?.mustChangePassword) showForcedPwdChange(); else boot() // T02/U-02：临时密码先改密（接口层已锁定其他路由），改完重新登录才进入后台
  } catch (e) { $('#lerr2').textContent = e.message }
}
async function mfaResend() {
  try { await api('POST', '/admin/login/mfa', { challenge: MFA_CHALLENGE, resend: true }); toast('验证码已重新发送') } catch (e) { toast(e.message, true) }
}
// C-03：登录受限态（challenge，非通行令牌）下的 TOTP 绑定引导——验证通过前拿不到后台会话
window.mfaGuidedSetup = async () => {
  try {
    const r = await api('POST', '/admin/login/mfa/setup', { challenge: MFA_CHALLENGE })
    modal('绑定验证器 App', `
      <p>在验证器 App（Microsoft/Google Authenticator 等）中添加账户：</p>
      <div class="row" style="margin:14px 0"><input readonly value="${esc(r.secret)}" style="width:100%"></div>
      <p class="muted" style="word-break:break-all">otpauth URI：<code>${esc(r.uri)}</code></p>
      <div class="card" style="background:#f0faf7;margin-top:14px"><p><b>当前动态码：${r.current}</b>（30 秒轮换；演示直通码，正式账号请以验证器 App 为准）</p></div>
      <p class="td-sub">录入后回到本页输入 6 位动态码即可完成登录。</p>`,
      `<button class="btn primary" onclick="closeModal()">我已录入，返回输入动态码</button>`)
  } catch (e) { toast(e.message, true) }
}
function backToStep1() { $('#step2').style.display = 'none'; $('#step1').style.display = 'block'; MFA_CHALLENGE = null }
function logout() { TOKEN = ''; ME = null; localStorage.clear(); location.reload() }

async function boot() {
  if (!TOKEN) { $('#login').style.display = 'flex'; $('#frame').style.display = 'none'; return }
  $('#login').style.display = 'none'; $('#frame').style.display = 'flex'
  try {
    ADMIN_CAPABILITIES = await api('GET', '/admin/capabilities')
    ME = { ...ME, role: ADMIN_CAPABILITIES.role, scopeCity: ADMIN_CAPABILITIES.scopeCity }
  } catch (e) {
    $('#app').innerHTML = `<div class="card error-state"><h2>操作权限加载失败</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="boot()">重试</button></div>`
    return
  }
  const roleCn = { super: '超级管理员', finance: '财务', ops: '运营', review: '审核', risk: '风控' }[ME?.role] || ME?.role || ''
  const nameCn = ME?.displayName || ME?.username || ''
  $('#who').textContent = nameCn === roleCn ? roleCn : `${nameCn} · ${roleCn}`
  // C-04：菜单由接口驱动——allModules 是唯一模块清单（分组/中文名/图标），modules 是本人有效集合；
  // 城市合伙人「风控案件」入口等角色差异全部在后端默认集合里（V54 种子与 V-09 修复）。
  NAV = (ADMIN_CAPABILITIES.allModules || []).reduce((acc, m) => {
    let g = acc.find(([name]) => name === m.group)
    if (!g) { g = [m.group, []]; acc.push(g) }
    g[1].push([m.key, m.name, m.icon])
    return acc
  }, [])
  const allowed = new Set(ADMIN_CAPABILITIES.modules || [])
  // 合并入口：子页（attest / pointassets / chainassets）作为页签并入父页，侧栏只留父级；父级无权限时子页仍单独显示。
  // 隐藏的子页按钮仍留在 DOM 里（深链接、标题、权限判断都照旧），只是不占侧栏位置。
  const mergedUnder = (k) => (typeof TRUST_MERGE !== 'undefined' && TRUST_MERGE[k] && allowed.has(TRUST_MERGE[k]) ? TRUST_MERGE[k] : '')
  $('#nav').innerHTML = NAV.map(([g, items]) => {
    items = items.filter(([k]) => allowed.has(k))
    if (!items.length) return ''
    return `<details class="nav-section" ${g === '经营总览' ? 'open' : ''}><summary class="nav-group">${g}<small class="nav-count">${items.filter(([k]) => !mergedUnder(k)).length}</small></summary>` + items.map(([k,n,ic]) => { const m = mergedUnder(k); const label = (typeof TRUST_LABEL !== 'undefined' && TRUST_LABEL[k]) || n; const alias = (typeof TRUST_ALIAS !== 'undefined' && TRUST_ALIAS[k]) || ''; return `<button class="nav-item${m ? ' nav-merged' : ''}" ${m ? 'hidden' : ''} data-p="${k}" data-alias="${alias}" onclick="go('${k}')">${ICONS[ic] || ''}<span>${label}</span></button>` }).join('') + '</details>'
  }).join('')
  fetch('/c/health').then((r) => r.json()).then((j) => { window.PAY_MOCK = j.data.payMode === 'MOCK'; $('#paymode').textContent = '支付通道：' + (j.data.payMode === 'MOCK' ? '联调 MOCK' : '微信支付 V3 ✓') }).catch(() => {})
  // 恢复地址栏里的页面（无权限或无效时回到第一个可见栏目）；hash 可带查询串（如 #orders?kw=x&page=2，T03 筛选恢复）
  const keys = [...document.querySelectorAll('#nav [data-p]')].map((el) => el.dataset.p)
  if (!keys.length) {
    history.replaceState(null, '', location.pathname)
    $('#app').innerHTML = '<div class="card"><h2>当前账号暂无可用栏目</h2><p>请联系超级管理员调整模块权限，重新登录后生效。</p></div>'
    $('#pageTitle').textContent = '暂无可用栏目'
    return
  }
  const requested = location.hash.slice(1).split('?')[0]
  const destination = keys.includes(requested) ? requested : keys[0]
  history.replaceState(null, '', location.hash || '#' + destination) // 保留 hash 查询串（T03 筛选恢复）
  go(destination, { history: false })
}

const skel = (n = 5) => Array(n).fill('<div class="sk sk-row"></div>').join('')
const emptyBox = (txt) => `<div class="empty"><div class="e-ico">🗂</div>${txt}</div>`


// ---- 资源池：景区资源（G端合作台账）/ 供应商（资源供给方）----
const RESOURCE_ST = { 1: '<span class="pill ok">合作中</span>', 0: '<span class="pill warn">暂缓</span>', 2: '<span class="pill s70">清退</span>' }
const CAT_CN = { script: '剧本闯关', yoga: '瑜伽之旅', sister: '姐姐系列', single: '单身社交', sport: '体育竞技', family: '亲子主题', red: '红色文旅', shop: '商城 SKU' }
const CITY_CN = { 310118: '上海·青浦', 310000: '上海', 320508: '苏州·姑苏', 330500: '湖州', 330523: '湖州·安吉' }
const SUP_KIND = { ticket: '门票', hotel: '住宿', transport: '交通', ground: '地接', catering: '餐饮', other: '其他' }
const MERCHANT_KIND = { catering: '餐饮', hotel: '住宿', ticket: '门票', transport: '交通', experience: '体验', other: '其他' }
const SETTLE_MODE = { monthly: '月结', per_order: '单结', prepaid: '预付' }


/* ============ CSV 导出（下载逻辑见 workspace.js 的 downloadExport）============ */
const EXPBTN = (what, label) => `<button class="btn ghost sm" style="margin-left:auto" onclick="downloadExport('${what}')">⬇ 导出${label || ''}</button>`


document.addEventListener('DOMContentLoaded', () => boot(), { once: true })
