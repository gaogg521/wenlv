// 工作台公共交互层。与业务页面分离，保留原接口和角色授权。
(() => {
  const app = document.getElementById('app')
  const descriptions = {
    dash: '看清经营变化，照顾好每一段旅程。', orders: '查询订单、追踪履约，核对每一笔交易。',
    products: '从线路草稿到出发团期，让每次出行有据可依。', settlements: '商户确认、财务复核、支付回单，逐步完成结算。',
    merchants: '连接在地伙伴，管理商户资料与入驻申请。', content: '审核旅行故事，让值得分享的体验被看见。',
    tasks: '发布创作邀约，跟进投稿与奖励发放。', config: '调整运营参数，保留变更与复核记录。',
    integrations: '管理外部服务与凭据，核对通道是否就绪。', attest: '核对业务记录、证明路径与锚定状态。',
    security: '管理账号验证与访问安全。', audit: '追踪操作记录，核对关键业务变更。',
  }
  const renderers = { dash, orders, products, merchants, settlements, budgets, promoters, config, risk, audit, system, features, content, withdrawals, agreements, attest, security, integrations, web3dash, pointassets, badges, wallets, contract, faqs, banners, phrases, rateov, kyc, cocreate, terms, tasks, conflicts }
  // 兼容工作区中新增的数字身份页面，不将其后台业务改动纳入本轮提交。
  if (typeof vcPage === 'function') renderers.vc = vcPage
  let current = '', generation = 0, rendering = Promise.resolve(), previousFocus = null
  let orderRows = [], orderQuery = '', orderPage = 1, orderStatus = 0
  const pageSize = 15
  window.productModal = () => {
    const field = document.getElementById('p_title')
    if (!field) return
    field.closest('.row').scrollIntoView({ behavior: 'smooth', block: 'center' })
    field.focus({ preventScroll: true })
  }
  const allowedItems = () => [...document.querySelectorAll('#nav [data-p]')]
  const titleFor = key => key === 'dash' ? '经营概览' : allowedItems().find(el => el.dataset.p === key)?.textContent.trim() || '工作台'
  downloadExport = async function (what) {
    try {
      const result = await api('GET', '/admin/export/' + encodeURIComponent(what))
      if (typeof result.csv !== 'string' || !result.filename) throw new Error('导出文件内容不完整，请重试')
      const url = URL.createObjectURL(new Blob(['\uFEFF' + result.csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = result.filename
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000); toast('已导出 ' + result.filename)
    } catch (error) { toast('导出失败：' + error.message, true) }
  }

  // 所有请求都给出超时与 HTTP 错误反馈；提交期间锁定触发按钮。
  api = async function (method, path, body) {
    const button = method !== 'GET' && document.activeElement?.matches('button') ? document.activeElement : null
    const wasDisabled = button?.disabled
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true') }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch(path, { method, signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: body ? JSON.stringify(body) : undefined })
      let result
      try { result = await response.json() } catch { throw new Error('服务返回异常，请稍后重试') }
      if (result.code === 1002 && TOKEN) {
        localStorage.removeItem('admin_token'); localStorage.removeItem('admin_me'); location.reload()
        throw new Error('登录已过期，请重新登录')
      }
      if (!response.ok || result.code !== 0) throw new Error(result.msg || result.data?.message || '操作失败，请重试')
      return result.data
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时，请检查网络后重试')
      if (error instanceof TypeError) throw new Error('暂时无法连接服务，请检查网络后重试')
      throw error
    } finally {
      clearTimeout(timer)
      if (button) { button.disabled = wasDisabled; button.removeAttribute('aria-busy') }
    }
  }

  go = function (key, options = {}) {
    if (!TOKEN) return Promise.resolve()
    const item = allowedItems().find(el => el.dataset.p === key)
    if (!item) {
      if (key) toast('当前账号没有此功能的访问权限', true)
      key = allowedItems()[0]?.dataset.p
      if (!key) return Promise.resolve()
    }
    const ticket = ++generation
    current = key
    app.classList.toggle('dashboard', key === 'dash')
    closeModal()
    document.body.classList.remove('nav-open')
    document.getElementById('menuToggle').setAttribute('aria-expanded', 'false')
    allowedItems().forEach(el => { el.classList.toggle('on', el.dataset.p === key); el.setAttribute('aria-current', el.dataset.p === key ? 'page' : 'false') })
    const active = allowedItems().find(el => el.dataset.p === key)
    if (active) active.closest('details').open = true
    document.getElementById('crumb').textContent = titleFor(key)
    document.getElementById('pageTitle').textContent = titleFor(key)
    document.getElementById('pageDescription').textContent = descriptions[key] || '集中处理运营事项，让每一步操作清晰可追溯。'
    document.getElementById('pageEyebrow').textContent = 'WANDERLUST / ' + (key === 'dash' ? '经营' : active?.closest('details')?.querySelector('summary')?.textContent || '运营')
    document.title = titleFor(key) + ' · 向往的自由'
    if (options.history !== false && location.hash !== '#' + key) history.pushState(null, '', '#' + key)
    app.setAttribute('aria-busy', 'true')
    // 顺序结束前一次渲染，丢弃中途选择，避免慢请求覆盖最后访问的页面。
    rendering = rendering.catch(() => {}).then(async () => {
      if (ticket !== generation) return
      try {
        await renderers[key]()
        if (key === 'dash') {
          const intro = app.querySelector('.workspace-intro'), kpis = app.querySelector('.kpi-grid')
          if (!intro || !kpis) throw new Error('经营数据暂时无法加载，请稍后重试')
          if (intro && kpis) {
            intro.after(kpis)
            const charts = [...app.querySelectorAll('.chart-box')]
            if (charts.length) kpis.after(...charts)
          }
        }
      } catch (error) {
        if (ticket !== generation) return
        app.innerHTML = `<section class="card error-state"><h2>暂时无法加载${esc(titleFor(key))}</h2><p>${esc(error.message)}</p><button class="btn primary" id="retryWorkspace">重新加载</button></section>`
        document.getElementById('retryWorkspace').onclick = () => go(key, { history: false })
      } finally {
        if (ticket === generation) {
          app.setAttribute('aria-busy', 'false'); enhanceTables(app)
          document.getElementById('refreshPage').disabled = false
        }
      }
    })
    return rendering
  }

  // 订单：完整状态、本次加载数据的搜索与分页，筛选不会反复请求。
  orders = async function () {
    app.innerHTML = `<div class="card">${skel(5)}</div>`
    orderRows = await api('GET', '/admin/orders')
    renderOrders()
  }
  renderers.orders = orders
  function renderOrders() {
    const needle = orderQuery.toLowerCase()
    const filtered = orderRows.filter(o => (!orderStatus || Number(o.status) === orderStatus) && [o.order_no, o.title, o.nickname, o.city_code, o.contact_name].some(value => String(value || '').toLowerCase().includes(needle)))
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); orderPage = Math.min(orderPage, pages)
    const rows = filtered.slice((orderPage - 1) * pageSize, orderPage * pageSize)
    app.innerHTML = `<section class="card orders-card"><div class="card-head"><h2>订单明细</h2>${EXPBTN('orders', '订单 CSV')}</div>
      <p class="muted">搜索与分页作用于本次加载的 ${orderRows.length} 笔订单；导出为后台完整订单数据。</p>
      <form class="orders-search" id="ordersSearch"><label for="orderKeyword" class="muted">搜索订单</label><input id="orderKeyword" type="search" value="${esc(orderQuery)}" placeholder="订单号 / 线路 / 用户 / 城市"><button class="btn primary" type="submit">查询</button><button class="btn ghost" id="clearOrders" type="button">重置</button></form>
      <div class="cfg-tabs" role="tablist" aria-label="订单状态">${[[0, '全部'], ...Object.entries(ST).map(([v, label]) => [Number(v), label])].map(([v, label]) => `<button type="button" class="cfg-tab ${v === orderStatus ? 'on' : ''}" role="tab" aria-selected="${v === orderStatus}" data-order-status="${v}">${label}<span> ${orderRows.filter(o => !v || Number(o.status) === v).length}</span></button>`).join('')}</div>
      ${rows.length ? `<table><thead><tr><th>订单 / 线路</th><th>用户 / 人数</th><th>应付金额</th><th>旅豆抵扣</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${rows.map(o => `<tr><td><button class="order-link" data-order-no="${esc(o.order_no)}">${esc(o.order_no)}</button><div class="td-sub">${esc(o.title)} · ${esc(o.city_code)}</div></td><td>${esc(o.nickname || '—')}<div class="td-sub">${Number(o.qty)} 人</div></td><td class="money num">${fen(o.amount_pay)}</td><td>${o.bean_deducted ? Number(o.bean_deducted) + ' 豆' : '—'}</td><td><span class="pill s${Number(o.status)}">${ST[o.status] || '未知状态'}</span></td><td class="td-sub">${esc(String(o.created_at || '').replace('T', ' ').slice(0, 16))}</td><td><button class="btn ghost sm" data-order-no="${esc(o.order_no)}">详情</button>${[20, 30, 40].includes(Number(o.status)) ? `<button class="btn danger sm" data-refund-no="${esc(o.order_no)}">退款</button>` : ''}</td></tr>`).join('')}</tbody></table>` : `<div class="empty"><div class="e-ico">⌕</div>没有符合条件的订单<p class="muted">试试其他关键词，或重置筛选条件。</p></div>`}
      <div class="pagination"><span>匹配 ${filtered.length} 笔 · 每页 ${pageSize} 笔</span><div class="pagination-actions"><button class="btn ghost sm" id="ordersPrev" ${orderPage === 1 ? 'disabled' : ''}>上一页</button><span>${orderPage} / ${pages}</span><button class="btn ghost sm" id="ordersNext" ${orderPage === pages ? 'disabled' : ''}>下一页</button></div></div></section>`
    document.getElementById('ordersSearch').onsubmit = event => { event.preventDefault(); orderQuery = document.getElementById('orderKeyword').value.trim(); orderPage = 1; renderOrders() }
    document.getElementById('clearOrders').onclick = () => { orderQuery = ''; orderStatus = 0; orderPage = 1; renderOrders() }
    app.querySelectorAll('[data-order-status]').forEach(button => { button.onclick = () => { orderStatus = Number(button.dataset.orderStatus); orderQuery = document.getElementById('orderKeyword').value.trim(); orderPage = 1; renderOrders() } })
    app.querySelectorAll('[data-order-no]').forEach(button => { button.onclick = () => orderDrawer(button.dataset.orderNo).catch(error => toast(error.message, true)) })
    app.querySelectorAll('[data-refund-no]').forEach(button => { button.onclick = () => refundOrder(button.dataset.refundNo) })
    document.getElementById('ordersPrev').onclick = () => { orderPage--; renderOrders() }
    document.getElementById('ordersNext').onclick = () => { orderPage++; renderOrders() }
    enhanceTables(app)
  }

  function enhanceTables(root) {
    root.querySelectorAll('table').forEach(table => {
      if (table.parentElement.classList.contains('table-wrap')) return
      const wrap = document.createElement('div'); wrap.className = 'table-wrap'; wrap.tabIndex = 0
      wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', '数据表格，可横向滚动')
      table.before(wrap); wrap.appendChild(table)
    })
    root.querySelectorAll('.cfg-tab:not(button)').forEach(tab => {
      tab.tabIndex = 0; tab.setAttribute('role', 'button')
      tab.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); tab.click() } }
    })
    root.querySelectorAll('button.modal-x').forEach(button => button.setAttribute('aria-label', '关闭对话框'))
    root.querySelectorAll('.task-link[onclick]').forEach(button => {
      const match = button.getAttribute('onclick').match(/go\('([^']+)'\)/)
      if (match && !allowedItems().some(item => item.dataset.p === match[1])) button.hidden = true
    })
  }
  window.addEventListener('unhandledrejection', event => {
    if (TOKEN && event.reason instanceof Error) { event.preventDefault(); toast(event.reason.message || '操作失败，请重试', true) }
  })
  new MutationObserver(() => enhanceTables(app)).observe(app, { childList: true, subtree: true })

  const originalClose = closeModal
  closeModal = function () {
    originalClose(); document.body.classList.remove('dialog-open')
    if (previousFocus?.isConnected) previousFocus.focus()
    previousFocus = null
  }
  new MutationObserver(() => {
    const dialog = document.querySelector('#modalRoot .modal, #modalRoot .drawer')
    if (!dialog || dialog.hasAttribute('role')) return
    previousFocus = document.activeElement
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.tabIndex = -1
    const heading = dialog.querySelector('h3'); if (heading) { heading.id = 'workspaceDialogTitle'; dialog.setAttribute('aria-labelledby', heading.id) }
    enhanceTables(dialog); document.body.classList.add('dialog-open')
    const field = dialog.querySelector('input:not([disabled]),select,textarea'); (field || dialog).focus()
  }).observe(document.getElementById('modalRoot'), { childList: true, subtree: true })
  document.addEventListener('keydown', event => {
    const dialog = document.querySelector('#modalRoot [role="dialog"]')
    if (event.key === 'Escape') {
      if (dialog) closeModal()
      const menuWasOpen = document.body.classList.contains('nav-open')
      document.body.classList.remove('nav-open'); document.getElementById('menuToggle').setAttribute('aria-expanded', 'false')
      if (menuWasOpen) document.getElementById('menuToggle').focus()
    }
    if (dialog && event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea,a[href],[tabindex="0"]')].filter(el => el.getClientRects().length)
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return }
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus() }
    }
  })
  const search = document.getElementById('navSearch')
  search.oninput = () => {
    const needle = search.value.trim().toLowerCase(); let count = 0
    document.querySelectorAll('#nav details').forEach(section => {
      let visible = 0
      section.querySelectorAll('[data-p]').forEach(button => { button.hidden = !button.textContent.toLowerCase().includes(needle); if (!button.hidden) visible++ })
      section.hidden = !visible; if (needle && visible) section.open = true; count += visible
    })
    document.getElementById('navEmpty').hidden = count > 0
  }
  document.getElementById('menuToggle').onclick = () => {
    const open = document.body.classList.toggle('nav-open')
    document.getElementById('menuToggle').setAttribute('aria-expanded', String(open))
    if (open) search.focus()
  }
  document.addEventListener('click', event => {
    if (document.body.classList.contains('nav-open') && !event.target.closest('.side,#menuToggle')) {
      document.body.classList.remove('nav-open'); document.getElementById('menuToggle').setAttribute('aria-expanded', 'false')
    }
  })
  document.getElementById('refreshPage').onclick = event => { event.currentTarget.disabled = true; go(current, { history: false }) }
  window.addEventListener('popstate', () => go(location.hash.slice(1), { history: false }))
  // 账号登录后 boot() 生成角色菜单；接管其首个页面并恢复合法地址。
  const originalBoot = boot
  boot = function () {
    const requested = location.hash.slice(1)
    originalBoot()
    if (TOKEN) {
      const destination = allowedItems().some(item => item.dataset.p === requested) ? requested : allowedItems()[0]?.dataset.p
      history.replaceState(null, '', '#' + destination)
      go(destination, { history: false })
    }
  }
})()
