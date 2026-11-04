// 经营驾驶舱
// 设计原则：一个「统计周期」统一驱动所有分析模块（GMV / 订单 / 趋势 / TOP5 / 漏斗 / 订单构成 / 小程序访问），
// 实时存量内容（待办、告警、预算池、最新订单）单独成区并标注「实时」，不再混在同一排里让人分不清是哪个周期。
// 样式见 dashboard.css（作用域 .dx）。普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

const DX_RANGES = [['today', '今日'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['1y', '近一年']]
const DX_CMP = { today: '昨日', '7d': '前 7 天', '30d': '前 30 天', '1y': '前一年' } // 环比对象的叫法
const dxSvg = (p, sw = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`
const DX_ICON = {
  gmv: dxSvg('<path d="M12 3v18M16.5 7.5c-.8-1.5-2.5-2.3-4.5-2.3-2.6 0-4.5 1.4-4.5 3.4 0 4.6 9.5 2.5 9.5 7.2 0 2-2 3.5-4.8 3.5-2.2 0-4-.9-4.8-2.6"/>'),
  order: dxSvg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3"/>'),
  user: dxSvg('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.9-4 3.6-6 7.5-6s6.6 2 7.5 6"/>'),
  trend: dxSvg('<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>'),
  check: dxSvg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.6L16 9.5"/>'),
  repeat: dxSvg('<path d="M17 3l3 3-3 3M20 6H9a5 5 0 0 0-5 5M7 21l-3-3 3-3M4 18h11a5 5 0 0 0 5-5"/>'),
  store: dxSvg('<path d="M4 9h16l-1.5 11h-13zM8 9V6a4 4 0 0 1 8 0v3"/>'),
  wallet: dxSvg('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>'),
  doc: dxSvg('<path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3"/>'),
  pen: dxSvg('<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19zM14 7l3 3"/>'),
  alert: dxSvg('<path d="M12 3 2.5 20h19zM12 10v4.5M12 17.5v.3"/>'),
  bean: dxSvg('<ellipse cx="12" cy="12" rx="6.5" ry="9" transform="rotate(35 12 12)"/><path d="M9 16c2-1.5 3.5-5 6-8"/>'),
  plug: dxSvg('<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>'),
}
// 订单状态 → 构成图分组（状态机见 core.js 的 ST）
const DX_STATUS = [['待支付', [10], '#e0b252'], ['待使用', [20, 30], '#2f8f9d'], ['已核销/完成', [40, 50], '#22916b'], ['退款', [60, 70], '#d14b4b'], ['已关闭', [90], '#b9b4a8']]

/* ---------- 小工具 ---------- */
const dxInt = (n) => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
const dxMoney = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
const dxShort = (v) => v >= 1e8 ? (v / 1e8).toFixed(1) + '亿' : v >= 1e4 ? (v / 1e4).toFixed(v >= 1e5 ? 0 : 1).replace(/\.0$/, '') + '万' : String(Math.round(v))
function dxNice(v) { // 坐标轴上限取"好看"的整数
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p
  return 10 * p
}
function dxDelta(cur, prev, cmp) { // 环比胶囊：对比期为 0 时不给虚高百分比
  cur = Number(cur); prev = Number(prev)
  if (!prev) return cur ? '<span class="dx-delta up" title="对比周期内无数据">新增</span>' : '<span class="dx-delta flat">—</span>'
  const r = (cur - prev) / prev
  if (Math.abs(r) < 0.0005) return '<span class="dx-delta flat">持平</span>'
  const txt = Math.abs(r) > 9.99 ? '999%+' : (Math.abs(r) * 100).toFixed(Math.abs(r) >= 1 ? 0 : 1) + '%'
  return `<span class="dx-delta ${r > 0 ? 'up' : 'down'}" title="较${esc(cmp)}">${r > 0 ? '▲' : '▼'} ${txt}</span>`
}
function dxLabel(date, unit, full) { // 横轴/提示框里的时间文案
  if (unit === 'hour') return full ? date + ' 时段' : date
  if (unit === 'month') return full ? date.slice(0, 4) + ' 年 ' + Number(date.slice(5)) + ' 月' : date.slice(2).replace('-', '/')
  return full ? date + ' ' + new Date(date + 'T00:00:00').toLocaleDateString('zh-CN', { weekday: 'short' }) : date.slice(5)
}
function dxCurve(pts, bottom) { // Catmull-Rom → 三次贝塞尔，平滑且不冲出基线
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  const f = (n) => n.toFixed(1)
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.18
    const c1y = Math.min(p1[1] + (p2[1] - p0[1]) * t, bottom), c2y = Math.min(p2[1] - (p3[1] - p1[1]) * t, bottom)
    d += ` C${f(p1[0] + (p2[0] - p0[0]) * t)},${f(c1y)} ${f(p2[0] - (p3[0] - p1[0]) * t)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`
  }
  return d
}
function dxSpark(vals, w, h, color, id, o = {}) { // 无坐标轴的迷你面积图（卡片/横幅背景用）
  const n = vals.length, max = Math.max(...vals, 0)
  if (n < 2 || max <= 0) return ''
  const pad = 3, pts = vals.map((v, i) => [(i / (n - 1)) * w, h - pad - (v / max) * (h - 2 * pad)])
  const line = dxCurve(pts, h - pad)
  return `<svg class="dx-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${o.top ?? 0.32}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${line} L${w},${h} L0,${h} Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="${o.sw ?? 2}" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`
}

/* ---------- 统计周期切换 ---------- */
function dxSetRange(r) { Object.assign(window.__dashRange, { range: r, from: '', to: '' }); dash() }
function dxToggleCustom() { const x = document.getElementById('dxCustom'); if (x) x.hidden = !x.hidden }
function dxApplyCustom() {
  const f = document.getElementById('dxFrom').value, t = document.getElementById('dxTo').value
  if (!f || !t) return toast('请选择起止日期', true)
  if (f > t) return toast('开始日期不能晚于结束日期', true)
  Object.assign(window.__dashRange, { range: 'custom', from: f, to: t }); dash()
}

const dxLastIdx = (k) => k.unit === 'hour' ? Math.min(k.trend.length - 1, new Date().getHours()) : k.trend.length - 1

/* ---------- 下钻：把当前周期/状态带到明细页 ----------
   订单页启动时从地址栏恢复筛选，所以先把筛选写进 #orders?...，再进页面。数字与明细对得上：
   「已支付以上」= 状态 20,30,40,50 + 按支付时间；转化/核销类按下单时间（与漏斗口径一致）。 */
function dxGo(page, params) {
  const qs = Object.entries(params || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&')
  history.pushState(null, '', '#' + page + (qs ? '?' + qs : ''))
  go(page, { history: false })
}
const DX_ALL_PAID = '20,30,40,50', DX_PAID_EVER = '20,30,40,50,60,70'
function dxDrill(kind, arg) {
  const P = window.__dxPer || {}, paid = { paidFrom: P.from, paidTo: P.to }, created = { createdFrom: P.from, createdTo: P.to }
  if (kind === 'paid') return dxGo('orders', { ...paid, status: DX_ALL_PAID }) // GMV / 订单数 / 客单价
  if (kind === 'created') return dxGo('orders', created) // 下单
  if (kind === 'paidEver') return dxGo('orders', { ...created, status: DX_PAID_EVER }) // 漏斗：已支付
  if (kind === 'status') return dxGo('orders', { ...created, status: arg }) // 核销 / 订单构成
  if (kind === 'tour') { const t = (window.__dxTours || [])[arg]; return t && dxGo('orders', { ...paid, status: DX_ALL_PAID, productId: t.id, pt: t.title }) }
  if (kind === 'users') { window.__userQ = { seg: '', kw: '', sort: arg, page: 1 }; return go('users') } // 用户中心暂无周期筛选，按消费/订单数排序
}
function dxChartClick(ev) { // 点趋势图里某一天/月/今日，看对应的已支付订单
  const D = window.__dx
  if (!D) return
  const r = ev.currentTarget.getBoundingClientRect()
  const i = Math.max(0, Math.min(D.n - 1, Math.floor((((ev.clientX - r.left) / r.width) * D.W - D.PL) / D.pw * D.n)))
  const d = D.T[i].date
  let from = d, to = d
  if (D.unit === 'hour') from = to = (window.__dxPer || {}).to // 今日按小时，订单页只到天
  else if (D.unit === 'month') { const [y, m] = d.split('-').map(Number); from = d + '-01'; to = d + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0') }
  dxGo('orders', { paidFrom: from, paidTo: to, status: DX_ALL_PAID })
}
// 卡片里「3 / 2」这类并排的数：各自是一个状态筛选链接（卡片本身不整体可点，避免歧义）
const dxNumGo = (n, js, tip) => `<button type="button" class="inl-go num-go" title="${tip}" onclick="${js}">${n}</button>`
const dxKey = 'role="link" tabindex="0" onkeydown="if(event.key===\'Enter\')this.click()"' // 可点击的非 button 元素：键盘也能进

/* ---------- 趋势图（GMV 曲线 + 订单柱 + 上一周期虚线，悬停出提示） ---------- */
function dxTrendChart(k) {
  const T = k.trend || [], P = k.trendPrev || [], n = T.length
  const W = 820, H = 300, PL = 52, PR = 14, PT = 14, PB = 30, pw = W - PL - PR, ph = H - PT - PB
  const g = T.map((t) => Number(t.gmv)), pg = P.length === n ? P.map((t) => Number(t.gmv)) : [], od = T.map((t) => t.orders)
  if (!n || Math.max(...g, ...od) <= 0) return emptyBox('该周期内暂无成交——去「商品与团期」上架线路并产生订单后，这里会出现走势')
  const maxY = dxNice(Math.max(...g, ...pg, 1)), maxO = Math.max(...od, 1), base = PT + ph
  const X = (i) => PL + ((i + 0.5) * pw) / n, Y = (v) => PT + ph - (v / maxY) * ph
  const bw = Math.min(20, (pw / n) * 0.52)
  const lastI = dxLastIdx(k) // 今日按小时：当前小时之后还没发生，曲线不往后画
  const pts = g.slice(0, lastI + 1).map((v, i) => [X(i), Y(v)]), line = dxCurve(pts, base)
  const step = Math.ceil(n / 8)
  window.__dx = { T, P: pg.length ? P : [], n, W, PL, PT, pw, ph, maxY, unit: k.unit }
  return `<div class="dx-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="GMV 与订单趋势，点击查看对应订单" onmousemove="dxHover(event)" onmouseleave="dxLeave()" onclick="dxChartClick(event)">
    <defs><linearGradient id="dxG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9622f" stop-opacity=".28"/><stop offset="1" stop-color="#d9622f" stop-opacity="0"/></linearGradient></defs>
    ${[0, 1, 2, 3, 4].map((i) => { const v = (maxY * i) / 4, y = Y(v); return `<line x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}" class="dx-grid${i ? '' : ' base'}"/><text x="${PL - 8}" y="${y + 4}" text-anchor="end" class="dx-axis">${dxShort(v)}</text>` }).join('')}
    ${od.map((v, i) => { const h = Math.max((v / maxO) * ph * 0.34, v ? 2 : 0); return v ? `<rect x="${X(i) - bw / 2}" y="${base - h}" width="${bw}" height="${h}" rx="3" class="dx-bar-o"/>` : '' }).join('')}
    ${pg.length ? `<path d="${dxCurve(pg.map((v, i) => [X(i), Y(v)]), base)}" fill="none" class="dx-line-prev"/>` : ''}
    <path d="${line} L${X(lastI)},${base} L${X(0)},${base} Z" fill="url(#dxG)"/>
    <path d="${line}" fill="none" class="dx-line"/>
    ${n <= 14 ? pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="dx-dot"/>`).join('') : `<circle cx="${pts[lastI][0]}" cy="${pts[lastI][1]}" r="4" class="dx-dot"/>`}
    ${T.map((t, i) => i % step === 0 ? `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" class="dx-axis">${dxLabel(t.date, k.unit)}</text>` : '').join('')}
    <line id="dxGuide" y1="${PT}" y2="${base}" class="dx-guide" style="display:none"/><circle id="dxHot" r="5.5" class="dx-hot" style="display:none"/>
  </svg><div id="dxTip" class="dx-tip"></div></div>`
}
function dxHover(ev) {
  const D = window.__dx, svg = ev.currentTarget
  if (!D || !svg) return
  const r = svg.getBoundingClientRect(), vx = ((ev.clientX - r.left) / r.width) * D.W
  const i = Math.max(0, Math.min(D.n - 1, Math.floor(((vx - D.PL) / D.pw) * D.n)))
  const t = D.T[i], p = D.P[i], x = D.PL + ((i + 0.5) * D.pw) / D.n, y = D.PT + D.ph - (Number(t.gmv) / D.maxY) * D.ph
  const gd = document.getElementById('dxGuide'), hot = document.getElementById('dxHot'), tip = document.getElementById('dxTip')
  gd.setAttribute('x1', x); gd.setAttribute('x2', x); gd.style.display = ''
  hot.setAttribute('cx', x); hot.setAttribute('cy', y); hot.style.display = ''
  tip.innerHTML = `<b>${dxLabel(t.date, D.unit, true)}</b><div><i style="background:#d9622f"></i>GMV<em>${dxMoney(t.gmv)}</em></div><div><i style="background:#2f8f9d"></i>订单<em>${dxInt(t.orders)} 单</em></div>`
    + (p ? `<div class="mut"><i style="background:#b9b4a8"></i>上一周期<em>${dxMoney(p.gmv)}</em></div>` : '')
    + `<div class="foot">点击查看${D.unit === 'hour' ? '今日' : D.unit === 'month' ? '当月' : '当日'}订单 →</div>`
  const px = (x / D.W) * r.width
  tip.style.left = px + 'px'; tip.classList.toggle('flip', px > r.width * 0.6); tip.style.display = 'block'
}
function dxLeave() {
  for (const id of ['dxGuide', 'dxHot', 'dxTip']) { const e = document.getElementById(id); if (e) e.style.display = 'none' }
}

/* ---------- 各区块 ---------- */
function dxHero(k, c) {
  const gmv = Number(k.gmv), peak = (k.trend || []).reduce((m, t) => Number(t.gmv) > Number(m.gmv) ? t : m, k.trend[0] || { gmv: 0, date: '' })
  const facts = []
  if (k.unit === 'day') facts.push(['日均 GMV', dxMoney(gmv / k.days)])
  if (k.unit === 'month') facts.push(['月均 GMV', dxMoney(gmv / Math.max(k.trend.length, 1))])
  if (gmv > 0) facts.push([k.unit === 'hour' ? '峰值时段' : k.unit === 'month' ? '峰值月份' : '峰值日', dxLabel(peak.date, k.unit, k.unit === 'month') + ' · ' + dxMoney(peak.gmv)])
  facts.push(['对比基数（' + c.cmp + '）', dxMoney(k.prev.gmv)])
  const custom = k.range === 'custom'
  return `<section class="dx-hero">
    ${dxSpark((k.trend || []).slice(0, dxLastIdx(k) + 1).map((t) => Number(t.gmv)), 640, 160, '#ffb27a', 'dxHeroG', { top: 0.5, sw: 2.5 })}
    <div class="dx-hero-top">
      <div><div class="dx-eyebrow">${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} · ${esc(c.cityTag)}口径</div>
        <h2>${c.hello}</h2>
        <p>${c.todoTotal ? `此刻有 <b>${c.todoTotal}</b> 项待办${k.alerts ? `、<b>${k.alerts}</b> 条风控告警` : ''}，` : '待办已全部处理完毕，'}<a href="#" onclick="document.getElementById('dxLive').scrollIntoView({behavior:'smooth',block:'start'});return false">查看实时事项 ↓</a></p></div>
      <div class="dx-range-box">
        <div class="dx-range" role="group" aria-label="统计周期">
          ${DX_RANGES.map(([v, l]) => `<button class="dx-chip${k.range === v ? ' on' : ''}" aria-pressed="${k.range === v}" onclick="dxSetRange('${v}')">${l}</button>`).join('')}
          <button class="dx-chip${custom ? ' on' : ''}" aria-pressed="${custom}" onclick="dxToggleCustom()">自定义</button>
        </div>
        <div class="dx-custom" id="dxCustom"${custom ? '' : ' hidden'}>
          <input type="date" id="dxFrom" value="${esc(window.__dashRange.from || '')}" aria-label="开始日期"><span>~</span><input type="date" id="dxTo" value="${esc(window.__dashRange.to || '')}" aria-label="结束日期">
          <button class="btn primary sm" onclick="dxApplyCustom()">应用</button>
        </div>
      </div>
    </div>
    <div class="dx-hero-main">
      <div class="dx-hero-num"><span class="dx-hero-label">${esc(c.rangeCn)} GMV</span><b>${dxMoney(gmv)}</b>
        <div class="dx-hero-cmp">${dxDelta(k.gmv, k.prev.gmv, c.cmp)}<span>较${esc(c.cmp)}</span><button class="dx-link" onclick="dxDrill('paid')">查看订单明细 →</button></div></div>
      <div class="dx-hero-facts">${facts.map(([l, v]) => `<div><span>${l}</span><b>${v}</b></div>`).join('')}</div>
    </div>
    <div class="dx-hero-foot"><span>统计周期 <b>${esc(k.from)}${k.days > 1 ? ' ~ ' + esc(k.to) : ''}</b>${k.days > 1 ? `（${k.days} 天）` : '（按小时）'}</span><span>环比周期 ${esc(k.prevFrom)}${k.days > 1 ? ' ~ ' + esc(k.prevTo) : ''}</span><span>口径：已支付以上订单 · 按支付时间</span></div>
  </section>`
}

function dxLive(k, ins) {
  const P = ins ? ins.pending : null, v = (x) => (P ? x : '—')
  const todos = [['merchants', '商户进件', 'store', P && P.merchants, '去审批'], ['withdrawals', '提现待审', 'wallet', P && P.withdrawals, '去复核'],
    ['conflicts', '核销异常', 'alert', P && P.conflicts, '去处理'], ['content', '内容待审', 'doc', P && P.notes, '去审核'], ['tasks', '约稿待审', 'pen', P && P.tasks, '去处理']]
  const total = P ? todos.reduce((s, t) => s + t[3], 0) : 0
  const first = todos.find((t) => t[3] > 0) // 总数标签点击后去的队列：按卡片顺序第一个有待办的
  const pool = k.globalScope ? parseFloat(k.budgetUsage) : NaN
  return `<section class="dx-card" id="dxLive">
    <div class="dx-hd"><h3>此刻待处理</h3><span class="dx-tag live"><i></i>实时</span><span class="dx-hint">当下的存量，不随统计周期变化</span>
      <span class="dx-right">${first ? `<button class="pill s10 dx-pill-go" title="跳到第一个有待办的队列：${first[1]}" onclick="go('${first[0]}')">共 ${total} 项待办 · 去处理 →</button>` : `<span class="pill s50">${P ? '待办已清空' : '待办数据暂不可用'}</span>`}</span></div>
    <div class="dx-live-grid">
      ${todos.map(([key, l, ic, n, verb]) => `<button class="dx-todo${n ? ' has' : ''}" onclick="go('${key}')"><span class="dx-todo-l"><i>${DX_ICON[ic]}</i>${l}</span><b>${v(n)}</b><span class="dx-todo-go">${!P ? '数据暂不可用' : n ? verb + ' →' : '已清空'}</span></button>`).join('')}
      <span class="dx-sep"></span>
      <button class="dx-stat red${k.alerts ? ' has' : ''}" onclick="go('risk')"><span class="dx-todo-l"><i>${DX_ICON.alert}</i>待处理告警</span><b>${k.globalScope ? k.alerts : '—'}</b><span class="dx-todo-go">${k.globalScope ? (k.alerts ? '去处置 →' : '一切正常') : '全域风控 · 仅总部'}</span></button>
      <button class="dx-stat gold" onclick="go('budgets')"><span class="dx-todo-l"><i>${DX_ICON.bean}</i>旅豆预算池水位</span><b>${k.globalScope ? esc(k.budgetUsage) : '—'}</b>
        ${isNaN(pool) ? '' : `<span class="dx-meter"><i style="width:${Math.min(Math.max(pool, 0.6), 100)}%"></i></span>`}<span class="dx-todo-go">${k.globalScope ? '累计已发放 ÷ 批次总额' : '全域科目 · 仅总部'}</span></button>
    </div></section>`
}

function dxKpis(k, ins, c) {
  const orders = k.orders, gmv = Number(k.gmv), aov = orders ? gmv / orders : 0, pAov = k.prev.orders ? Number(k.prev.gmv) / k.prev.orders : 0
  const F = ins ? ins.funnel : null, pctNum = (s) => (F && parseFloat(s)) || 0
  // 每张卡片都是真链接（go = 点击动作；to = 目的地提示，写在 title 与右上角箭头上）
  const rate = (acc, ic, l, val, sub, go, to) => `<div class="dx-kpi go ${acc}" ${dxKey} title="${to}" onclick="${go}"><i class="dx-arrow">↗</i><div class="dx-kpi-top"><i class="ico">${DX_ICON[ic]}</i><span class="l">${l}</span></div><div class="v">${F ? val : '—'}</div>
    <span class="dx-meter"><i style="width:${F ? Math.min(pctNum(val), 100) : 0}%"></i></span><div class="foot">${sub}</div></div>`
  const card = (acc, ic, l, val, delta, sub, go, to, spark) => `<div class="dx-kpi go ${acc}" ${dxKey} title="${to}" onclick="${go}">${spark || ''}<i class="dx-arrow">↗</i><div class="dx-kpi-top"><i class="ico">${DX_ICON[ic]}</i><span class="l">${l}</span></div><div class="v">${val}</div><div class="foot">${delta}<span>${sub}</span></div></div>`
  return `<div class="dx-kpis kpi-grid">
    ${card('c-blue', 'order', '订单数', dxInt(orders), dxDelta(orders, k.prev.orders, c.cmp), '已支付以上', "dxDrill('paid')", '查看本周期已支付订单', dxSpark(k.trend.map((t) => t.orders), 200, 46, '#2f6fd6', 'dxS1', { top: 0.2, sw: 1.6 }))}
    ${card('c-amber', 'gmv', '客单价', dxMoney(aov), dxDelta(aov, pAov, c.cmp), 'GMV ÷ 订单数', "dxDrill('paid')", '查看本周期已支付订单')}
    ${card('c-violet', 'user', '支付用户', dxInt(k.payers), dxDelta(k.payers, k.prev.payers, c.cmp), '去重用户数', "dxDrill('users','gmv')", '去用户中心（按消费金额排序）')}
    ${rate('c-teal', 'trend', '下单支付转化', F ? F.payRate : '', '按下单时间 · 下单 → 已支付', "dxDrill('created')", '查看本周期下单的订单')}
    ${rate('c-green', 'check', '核销率', F ? F.verifyRate : '', '按下单时间 · 已核销 ÷ 已支付', `dxDrill('status','40,50')`, '查看本周期已核销 / 完成的订单')}
    ${rate('c-gold', 'repeat', '用户复购率', F ? F.rebuyRate : '', '周期内支付 ≥2 单的用户占比', "dxDrill('users','orders')", '去用户中心（按订单数排序）')}
  </div>`
}

function dxTrendCard(k, c) {
  const hasPrev = (k.trendPrev || []).length > 0
  return `<section class="dx-card"><div class="dx-hd"><h3>GMV 与订单趋势</h3><span class="dx-tag period">${esc(c.rangeCn)}</span><span class="dx-hint">按${k.unit === 'hour' ? '小时' : k.unit === 'month' ? '月' : '天'}</span>
      <span class="dx-right dx-legend"><span><i style="background:#d9622f"></i>GMV</span>${hasPrev ? `<span><i class="dash"></i>${esc(c.cmp)}</span>` : ''}<span><i style="background:#2f8f9d;opacity:.45;height:8px;width:8px;border-radius:2px"></i>订单</span></span></div>
    ${dxTrendChart(k)}</section>`
}

function dxTopCard(k, ins, c) {
  const tours = ins ? ins.topTours : [], maxG = Math.max(...tours.map((t) => Number(t.gmv)), 1), total = Number(k.gmv) * 100
  const medal = ['#d9a21b', '#9aa3ab', '#c27b43']
  return `<section class="dx-card"><div class="dx-hd"><h3>热门主题游 TOP5</h3><span class="dx-tag period">${esc(c.rangeCn)}</span><span class="dx-hint">按订单数</span></div>
    ${tours.length ? `<ol class="dx-top">${tours.map((t, i) => `<li class="go" ${dxKey} title="查看这条线路本周期的订单" onclick="dxDrill('tour',${i})"><span class="rk" style="${i < 3 ? `background:${medal[i]}1f;color:${medal[i]}` : ''}">${i + 1}</span>
        <span class="nm" title="${esc(t.title)}">${esc(t.title)}</span><span class="amt">${dxMoney(Number(t.gmv) / 100)}</span>
        <span class="trk"><i style="width:${Math.max((Number(t.gmv) / maxG) * 100, 3)}%"></i></span><span class="sub">${dxInt(t.orders)} 单${total ? ' · 占 ' + ((Number(t.gmv) / total) * 100).toFixed(0) + '%' : ''}</span></li>`).join('')}</ol>`
      : emptyBox('该周期内暂无成交')}</section>`
}

function dxFunnelCard(ins, c) {
  const F = ins ? ins.funnel : null
  if (!F || !F.created) return `<section class="dx-card"><div class="dx-hd"><h3>转化漏斗</h3><span class="dx-tag period">${esc(c.rangeCn)}</span></div>${emptyBox('该周期内暂无下单')}</section>`
  const w = (n) => Math.max((n / F.created) * 100, 6)
  return `<section class="dx-card"><div class="dx-hd"><h3>转化漏斗</h3><span class="dx-tag period">${esc(c.rangeCn)}</span><span class="dx-hint">本周期内下单的订单</span></div>
    <div class="dx-fn">
      <div class="dx-fn-row go" ${dxKey} title="查看本周期下单的订单" onclick="dxDrill('created')"><span>下单</span><div class="dx-fn-bar" style="width:100%"><b>${dxInt(F.created)}</b></div></div>
      <div class="dx-fn-conv">↓ 支付转化 <b>${esc(F.payRate)}</b></div>
      <div class="dx-fn-row go" ${dxKey} title="查看其中已支付的订单" onclick="dxDrill('paidEver')"><span>已支付</span><div class="dx-fn-bar b2" style="width:${w(F.paid)}%"><b>${dxInt(F.paid)}</b></div></div>
      <div class="dx-fn-conv">↓ 核销率 <b>${esc(F.verifyRate)}</b></div>
      <div class="dx-fn-row go" ${dxKey} title="查看其中已核销 / 完成的订单" onclick="dxDrill('status','40,50')"><span>已核销</span><div class="dx-fn-bar b3" style="width:${w(F.verified)}%"><b>${dxInt(F.verified)}</b></div></div>
    </div></section>`
}

function dxDonutCard(ins, c) {
  const mix = ins ? ins.statusMix : []
  const groups = DX_STATUS.map(([name, codes, color]) => ({ name, color, codes: codes.join(','), n: mix.filter((m) => codes.includes(m.status)).reduce((s, m) => s + m.count, 0) }))
  const sum = groups.reduce((s, g) => s + g.n, 0)
  const head = `<div class="dx-hd"><h3>订单构成</h3><span class="dx-tag period">${esc(c.rangeCn)}</span><span class="dx-hint">按下单时间 · 当前状态</span></div>`
  if (!sum) return `<section class="dx-card">${head}${emptyBox('该周期内暂无订单')}</section>`
  const R = 42, C = 2 * Math.PI * R
  let acc = 0
  const segs = groups.filter((g) => g.n).map((g) => {
    const len = (g.n / sum) * C, dash = Math.max(len - 2.5, 0.6), s = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${g.color}" stroke-width="15" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-acc}" transform="rotate(-90 60 60)" class="go" onclick="dxDrill('status','${g.codes}')"><title>${g.name} ${g.n} 单 · 点击查看</title></circle>`
    acc += len; return s
  }).join('')
  return `<section class="dx-card">${head}<div class="dx-donut">
    <svg viewBox="0 0 120 120" role="img" aria-label="订单状态构成"><circle cx="60" cy="60" r="${R}" fill="none" stroke="#f3eee4" stroke-width="15"/>${segs}
      <text x="60" y="58" text-anchor="middle" class="dx-d-n">${dxInt(sum)}</text><text x="60" y="73" text-anchor="middle" class="dx-d-l">订单</text></svg>
    <ul>${groups.map((g) => `<li class="${g.n ? 'go' : 'z'}"${g.n ? ` ${dxKey} title="查看这些订单" onclick="dxDrill('status','${g.codes}')"` : ''}><i style="background:${g.color}"></i><span>${g.name}</span><b>${dxInt(g.n)}</b><em>${((g.n / sum) * 100).toFixed(0)}%</em></li>`).join('')}</ul></div></section>`
}

function dxMiniCard(wxd, c) {
  const list = wxd && wxd.list || [], ok = list.length && !wxd.mock
  const head = `<div class="dx-hd"><h3>小程序访问</h3><span class="dx-tag period" title="微信按日产出数据，最长展示 30 天，当日数据次日可见">${esc(c.rangeCn)}</span>${ok ? `<span class="dx-hint">${list[0].date.slice(5)}${list.length > 1 ? ' ~ ' + list[list.length - 1].date.slice(5) : ''}</span>` : ''}</div>`
  if (!ok) return `<section class="dx-card">${head}<div class="dx-ph"><i>${DX_ICON.plug}</i><p>尚未接入微信数据分析</p><span>在「集成中心」配置小程序 AppSecret 后，这里显示真实 PV / UV（不展示模拟曲线）</span><button class="btn ghost sm" onclick="go('integrations')">去集成中心 →</button></div></section>`
  const pv = list.reduce((s, t) => s + t.visitPv, 0), uv = list.reduce((s, t) => s + t.visitUv, 0)
  return `<section class="dx-card">${head}<div class="dx-mini-n"><div><span>访问次数 PV</span><b>${dxInt(pv)}</b></div><div><span>访客数 UV</span><b>${dxInt(uv)}</b></div></div>
    <div class="dx-mini-chart">${dxSpark(list.map((t) => t.visitPv), 320, 90, '#2f8f9d', 'dxMini', { top: 0.3 })}</div></section>`
}

function dxOrdersCard(recent) {
  return `<section class="dx-card"><div class="dx-hd"><h3>最新订单</h3><span class="dx-tag live"><i></i>实时</span><span class="dx-hint">最近 8 笔，不随统计周期变化</span>
    <span class="dx-right"><button class="btn ghost sm" onclick="go('orders')">全部订单 →</button></span></div>
    ${recent.length ? `<div class="table-wrap"><table><thead><tr><th>单号</th><th>商品</th><th>用户</th><th>金额</th><th>状态</th><th>支付时间</th></tr></thead><tbody>
      ${recent.map((o) => `<tr style="cursor:pointer" onclick="orderDrawer('${esc(o.order_no)}')">
        <td class="num">${esc(o.order_no)}</td><td class="td-main">${esc(o.title)}</td><td>${esc(o.nickname)}</td>
        <td class="money num">${fen(o.amount_pay)}</td><td><span class="pill s${o.status}">${ST[o.status]}</span></td>
        <td class="td-sub">${esc(String(o.paid_at || o.created_at || '').slice(5, 16))}</td></tr>`).join('')}</tbody></table></div>` : emptyBox('还没有订单')}</section>`
}

/* ============ 驾驶舱入口 ============ */
async function dash() {
  const seq = (window.__dashSeq = (window.__dashSeq || 0) + 1) // 连点周期时只认最后一次，避免慢请求覆盖
  const app = $('#app')
  const R = window.__dashRange || (window.__dashRange = { range: '30d', from: '', to: '' })
  try {
    const cur = app.querySelector('.dx')
    if (cur) cur.classList.add('loading') // 切周期时保留现有内容并淡出，不闪骨架屏
    else app.innerHTML = `<div class="dx"><div class="sk" style="height:250px;border-radius:22px"></div><div class="dx-kpis kpi-grid" style="margin-top:18px">${Array(6).fill('<div class="sk" style="height:140px;border-radius:18px"></div>').join('')}</div></div>`
    const qs = new URLSearchParams({ range: R.range })
    if (R.range === 'custom') { qs.set('from', R.from); qs.set('to', R.to) }
    const wxDays = R.range === 'today' ? 1 : R.range === '7d' ? 7 : R.range === 'custom' ? Math.min(30, Math.round((new Date(R.to) - new Date(R.from)) / 86400000) + 1) : 30
    const [k, ins, orders, wxd] = await Promise.all([
      api('GET', '/admin/dash/kpi?' + qs),
      api('GET', '/admin/dash/insights?' + qs).catch(() => null),
      api('GET', '/admin/orders').catch(() => []),
      api('GET', '/admin/wxdata/visit-trend?days=' + wxDays).catch(() => ({ mock: true, list: [] })),
    ])
    if (seq !== window.__dashSeq) return
    const hour = new Date().getHours()
    const c = {
      rangeCn: ({ today: '今日', '7d': '近 7 天', '30d': '近 30 天', '1y': '近一年' })[k.range] || '自定义周期',
      cmp: DX_CMP[k.range] || '上一周期',
      cityTag: k.scopeCity ? `本城 ${k.scopeCity}` : '全域',
      hello: (hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好') + '，' + esc(ME?.displayName || ME?.username || ''),
      todoTotal: ins ? Object.values(ins.pending).reduce((s, n) => s + n, 0) : 0,
    }
    window.__dxPer = { from: k.from, to: k.to } // 下钻用：把当前周期带到明细页
    window.__dxTours = ins ? ins.topTours : []
    app.innerHTML = `<div class="dx">
      ${dxHero(k, c)}
      ${dxLive(k, ins)}
      <div class="dx-zone"><h2>经营分析</h2><span class="dx-tag period">${esc(c.rangeCn)}</span><span class="dx-hint">以下模块统一按上方所选周期统计，标有周期标签的卡片同步变化</span></div>
      ${dxKpis(k, ins, c)}
      <div class="dx-row r-main">${dxTrendCard(k, c)}${dxTopCard(k, ins, c)}</div>
      <div class="dx-row r-three">${dxFunnelCard(ins, c)}${dxDonutCard(ins, c)}${dxMiniCard(wxd, c)}</div>
      ${dxOrdersCard(orders.slice(0, 8))}
    </div>`
  } catch (e) {
    if (seq !== window.__dashSeq) return
    console.error('dash error:', e.message)
    toast(e.message || '驾驶舱加载失败', true)
    const cur = app.querySelector('.dx')
    if (cur && cur.querySelector('.dx-hero')) cur.classList.remove('loading') // 已有内容：保留，只提示
    else app.innerHTML = '<div class="empty"><div class="e-ico">⚠</div>驾驶舱加载失败</div>'
  }
}
