// 工作台外壳：请求封装 api、页面路由 go、订单列表、导出、表格与弹窗无障碍增强。
// 这些全局函数只在这里定义（app.js 不再有同名旧实现）；页面渲染函数在 app.js 等文件中。
(() => {
  const app = document.getElementById('app')
  const descriptions = {
    fund: '四条资金线待办全景：待办金额、异常标记与下钻；登记已付≠外部到账。', cases: '风险案件闭环：研判→处理→补材料/协查→复核→关闭，处置引用冻结/解冻。', entitlements: '人工权益调整：申请→他人复核→账本执行，无直接改余额接口。', tickets: '售后工单队列：发起、认领、转派、等待、办结、关闭与重开，时间线不可改写。', taskcash: '核对已通过投稿的现金奖励，线下实际支付后登记真实打款流水。',
    contentcases: '处理旅行笔记举报，复核作者下架申诉并反馈结果。',
    partnerperf: '按合伙人角色查看累计业绩排行，核对计佣、提现及来源结算明细。',
    contentdash: '查看笔记发布、审核、获赞与关联线路经营数据。',
    partners: '城市经营、推广转化与共创回报；各类身份分别统计，数据遵循城市权限。',
    dash: '看清经营变化，照顾好每一段旅程。', orders: '查询订单、追踪履约，核对每一笔交易。',
    products: '从线路草稿到出发团期，让每次出行有据可依。', settlements: '商户确认、财务复核、支付回单，逐步完成结算。',
    merchants: '连接在地伙伴，管理商户资料与入驻申请。', content: '审核旅行故事，让值得分享的体验被看见。',
    scenics: '维护景区合作台账，查看关联线路的销量、核销人次和评分。', suppliers: '管理门票、住宿、交通等资源供给方。',
    creators: '沉淀内容创作者，管理签约与合作状态。',
    tasks: '发布创作邀约，跟进投稿与奖励发放。', config: '调整运营参数，保留变更与复核记录。',
    integrations: '管理外部服务与凭据，核对通道是否就绪。', attest: '核对业务记录、证明路径与锚定状态。',
    security: '管理账号验证与访问安全。', accounts: '后台账号生命周期：创建、角色/城市授权、停用恢复、重置密码与 MFA；变更后旧会话立即失效。', audit: '追踪操作记录，核对关键业务变更。',
    budgets: '旅豆发放双闸：批次额度与年度总量，严禁超发。', promoters: '一级推广服务商的开通、档位与成交。',
    withdrawals: '推广服务费提现复核，打款流水必须留痕。', agreements: '商户分账协议变更的审批与生效。',
    phrases: '为剧本游配置入戏暗号，店员凭口令核销。', conflicts: '断网核销恢复后校验失败的凭证，人工确认或驳回。',
    rateov: '单品佣金覆盖推广档位，上限 12%。', cocreate: '共创人投资与分润台账：财务或超管按真实回单登记打款，运营核对进度；错单作废、误付冲正全留痕。', kyc: '实名资料人工审核，证件号仅显示脱敏值。',
    banners: '小程序首页轮播位与投放窗口。', faqs: '小程序常见问题的分类与排序。', risk: '核销重放、退款滥用、锚定失败等风险告警。',
    features: '按角色、端与城市灰度开放能力。', system: '服务健康、后台任务与手动干预。',
    web3dash: '每个区块是一批 Merkle 根：本地打包 → 提交上链 → 确认后锚定。',
    miniapp: '小程序的每个页面在后台哪里改：装修文案集中维护，其余内容一键直达对应栏目。',
    chainhub: '联盟链与公链的接入配置、离线自检、连通性探测与热切换；凭据加密保存，不需要重启服务。', chainassets: '当前接入的链、能力边界与资产发行台账。',
    pointassets: '旅豆发行批次、持有人与年度总量哨兵。', badges: '会员等级、会员荣誉、城市、国家、链上勋章等全部徽章的定义、图形预览与发放；发放即进入存证队列。',
    wallets: '用户积分、等级、勋章与存证事件的汇总视图。', vc: '可携出的旅行凭证：签发、验签与吊销。',
    terms: '后台术语与小程序合规用语的对照表。',
    users: '所有注册用户：分群、搜索、消费与内容画像；可冻结账号或标记风险，操作全部留痕。',
  }
  const renderers = { taskcash: taskCash, contentcases: contentCases, partnerperf: partnerPerformancePage, contentdash, partners, dash, users, products, merchants, settlements, budgets, promoters, config, risk, audit, system, features, content, withdrawals, agreements, attest, security, accounts, tickets, entitlements, cases, fund, integrations, web3dash, pointassets, badges, wallets, contract, faqs, banners, phrases, rateov, kyc, cocreate, terms, tasks, conflicts, scenics, suppliers, creators }
  // 兼容工作区中新增的数字身份/链与资产页面，不将其后台业务改动纳入本轮提交。
  if (typeof vcPage === 'function') renderers.vc = vcPage
  if (typeof chainAssetsPage === 'function') renderers.chainassets = chainAssetsPage
  if (typeof window.chainhub === 'function') renderers.chainhub = window.chainhub
  if (typeof window.miniapp === 'function') renderers.miniapp = window.miniapp
  let current = '', generation = 0, rendering = Promise.resolve(), previousFocus = null
  // 订单页状态改由 orderState 管理（服务端检索）；旧本地筛选变量已移除
  const pageSize = 15
  const allowedItems = () => [...document.querySelectorAll('#nav [data-p]')]
  const titleFor = key => key === 'dash' ? '经营概览' : allowedItems().find(el => el.dataset.p === key)?.textContent.trim() || '工作台'
  window.downloadExport = async function (what) {
    // T00：导出与后端 export.* 能力共用规则；城市账号等无权角色不发起请求
    if (ADMIN_CAPABILITIES?.actions && !adminCan('export.' + what)) return toast('当前账号无导出权限：导出仅限超级管理员、运营或财务（按报表类型）', true)
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
  window.api = async function (method, path, body) {
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
      if (!response.ok || result.code !== 0) {
        const error = new Error(result.msg || result.data?.message || '操作失败，请重试')
        error.fieldErrors = result.data?.fieldErrors || null // 表单引擎据此定位到具体字段
        throw error
      }
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

  window.go = function (key, options = {}) {
    if (!TOKEN) return Promise.resolve()
    const item = allowedItems().find(el => el.dataset.p === key)
    if (!item) {
      if (key) toast('当前账号没有此功能的访问权限', true)
      key = allowedItems()[0]?.dataset.p
      if (!key) return Promise.resolve()
    }
    const ticket = ++generation
    if (typeof chainTipHide === 'function') chainTipHide() // 切页时收起链路悬停卡
    current = key
    app.classList.toggle('dashboard', key === 'dash')
    closeModal()
    document.body.classList.remove('nav-open')
    document.getElementById('menuToggle').setAttribute('aria-expanded', 'false')
    allowedItems().forEach(el => { el.classList.toggle('on', el.dataset.p === key); el.setAttribute('aria-current', el.dataset.p === key ? 'page' : 'false') })
    const active = allowedItems().find(el => el.dataset.p === key)
    if (active) active.closest('details').open = true
    document.getElementById('crumb').textContent = (NAV.find(([, items]) => items.some(([k]) => k === key))?.[0] || '工作台') + ' / ' + titleFor(key)
    document.getElementById('pageTitle').textContent = titleFor(key)
    document.getElementById('pageDescription').textContent = descriptions[key] || '集中处理运营事项，让每一步操作清晰可追溯。'
    renderPageOperations(key)
    document.getElementById('pageEyebrow').textContent = 'WANDERLUST / ' + (NAV.find(([, items]) => items.some(([k]) => k === key))?.[0] || '运营')
    document.title = titleFor(key) + ' · 向往的自由'
    if (options.history !== false && location.hash !== '#' + key) history.pushState(null, '', '#' + key)
    app.setAttribute('aria-busy', 'true')
    // 顺序结束前一次渲染，丢弃中途选择，避免慢请求覆盖最后访问的页面。
    rendering = rendering.catch(() => {}).then(async () => {
      if (ticket !== generation) return
      try {
        await renderers[key]()
        if (key === 'dash' && !app.querySelector('.kpi-grid')) throw new Error('经营数据暂时无法加载，请稍后重试')
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

  // 订单：服务端全量检索（T03）——老单可查、翻页不重漏、筛选可从地址栏恢复。
  // 状态计数口径 = 其他筛选不变、去掉状态（countsScope=same-filters-except-status），不是当前页行数。
  let orderState = { kw: '', status: '', createdFrom: '', createdTo: '', page: 1 }
  let orderData = { rows: [], total: 0, page: 1, pageSize: 20, statusCounts: { all: 0 } }
  window.orders = async function () {
    app.innerHTML = `<div class="card">${skel(5)}</div>`
    // 从地址栏恢复筛选：#orders?kw=..&status=20&page=2
    const q = {}
    const hq = (location.hash.split('?')[1] || '')
    hq.split('&').filter(Boolean).forEach((kv) => { const [k, v] = kv.split('='); q[decodeURIComponent(k)] = decodeURIComponent(v || '') })
    orderState = { kw: q.kw || '', status: q.status || '', createdFrom: q.createdFrom || '', createdTo: q.createdTo || '', page: Math.max(1, Number(q.page) || 1) }
    await loadOrders()
  }
  renderers.orders = window.orders
  function orderHash() {
    const parts = []
    if (orderState.kw) parts.push('kw=' + encodeURIComponent(orderState.kw))
    if (orderState.status) parts.push('status=' + orderState.status)
    if (orderState.createdFrom) parts.push('createdFrom=' + orderState.createdFrom)
    if (orderState.createdTo) parts.push('createdTo=' + orderState.createdTo)
    if (orderState.page > 1) parts.push('page=' + orderState.page)
    return '#orders' + (parts.length ? '?' + parts.join('&') : '')
  }
  async function loadOrders() {
    const p = new URLSearchParams()
    if (orderState.kw) p.set('kw', orderState.kw)
    if (orderState.status) p.set('status', orderState.status)
    if (orderState.createdFrom) p.set('createdFrom', orderState.createdFrom)
    if (orderState.createdTo) p.set('createdTo', orderState.createdTo)
    p.set('page', orderState.page); p.set('pageSize', 20)
    orderData = await api('GET', '/admin/orders/search?' + p.toString())
    history.replaceState(null, '', orderHash())
    renderOrders()
  }
  function renderOrders() {
    const d = orderData, counts = d.statusCounts || {}
    const hasFilter = !!(orderState.kw || orderState.status || orderState.createdFrom || orderState.createdTo)
    const pages = Math.max(1, Math.ceil(d.total / d.pageSize))
    app.innerHTML = `<section class="card orders-card"><div class="card-head"><h2>订单明细</h2>${EXPBTN('orders', '订单 CSV')}</div>
      <p class="muted">服务端全量检索：共 ${Number(d.total).toLocaleString()} 笔${hasFilter ? '（含筛选条件）' : ''}；状态计数口径为"其他筛选不变、去掉状态"。100 条以前的老订单可按订单号/买家/完整手机号精确命中。</p>
      <form class="orders-search" id="ordersSearch"><label for="orderKeyword" class="muted">搜索订单</label><input id="orderKeyword" type="search" value="${esc(orderState.kw)}" placeholder="订单号 / 线路 / 用户昵称 / 联系人 / 完整手机号">
        <label class="muted" for="orderCreatedFrom">创建</label><input id="orderCreatedFrom" type="date" value="${esc(orderState.createdFrom)}" style="width:130px"><span class="muted">~</span><input id="orderCreatedTo" type="date" value="${esc(orderState.createdTo)}" style="width:130px">
        <button class="btn primary" type="submit">查询</button><button class="btn ghost" id="clearOrders" type="button">重置</button></form>
      <div class="cfg-tabs" role="tablist" aria-label="订单状态">${[[0, '全部'], ...Object.entries(ST).map(([v, label]) => [Number(v), label])].map(([v, label]) => `<button type="button" class="cfg-tab ${String(v) === String(orderState.status || 0) ? 'on' : ''}" role="tab" aria-selected="${String(v) === String(orderState.status || 0)}" data-order-status="${v}">${label}<span> ${Number(v === 0 ? counts.all : counts[v] || 0).toLocaleString()}</span></button>`).join('')}</div>
      ${d.rows.length ? `<table><thead><tr><th>订单 / 线路</th><th>用户 / 人数</th><th>应付金额</th><th>旅豆抵扣</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${d.rows.map(o => `<tr><td><button class="order-link" data-order-no="${esc(o.order_no)}">${esc(o.order_no)}</button><div class="td-sub">${esc(o.title)} · ${esc(o.city_code)}</div></td><td>${esc(o.nickname || '—')}<div class="td-sub">${Number(o.qty)} 人</div></td><td class="money num">${fen(o.amount_pay)}</td><td>${o.bean_deducted ? Number(o.bean_deducted) + ' 豆' : '—'}</td><td><span class="pill s${Number(o.status)}">${ST[o.status] || '未知状态'}</span></td><td class="td-sub">${esc(String(o.created_at || '').replace('T', ' ').slice(0, 16))}</td><td><button class="btn ghost sm" data-order-no="${esc(o.order_no)}">详情</button>${[20, 30, 40].includes(Number(o.status)) ? `<button class="btn danger sm" data-refund-no="${esc(o.order_no)}">退款</button>` : ''}${window.PAY_MOCK && Number(o.status) === 40 ? `<button class="btn ghost sm" data-complete-no="${esc(o.order_no)}" title="联调：模拟观察期结束，订单进入可结算状态（生产环境禁用）">完成</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty"><div class="e-ico">⌕</div>${hasFilter ? '没有符合条件的订单' : '暂无订单数据'}<p class="muted">${hasFilter ? '试试其他关键词，或点「重置」清空筛选条件。' : '游客下单后会显示在这里。'}</p></div>`}
      <div class="pagination"><span>共 ${Number(d.total).toLocaleString()} 笔 · 第 ${d.page} / ${pages} 页 · 每页 ${d.pageSize} 笔</span><div class="pagination-actions"><button class="btn ghost sm" id="ordersPrev" ${d.page <= 1 ? 'disabled' : ''}>上一页</button><button class="btn ghost sm" id="ordersNext" ${d.page >= pages ? 'disabled' : ''}>下一页</button></div></div></section>`
    let debounce = null
    document.getElementById('orderKeyword').oninput = (e) => { clearTimeout(debounce); debounce = setTimeout(() => { orderState.kw = e.target.value.trim(); orderState.page = 1; loadOrders().catch((er) => toast(er.message, true)) }, 500) }
    document.getElementById('ordersSearch').onsubmit = event => {
      event.preventDefault(); clearTimeout(debounce)
      orderState.kw = document.getElementById('orderKeyword').value.trim()
      orderState.createdFrom = document.getElementById('orderCreatedFrom').value
      orderState.createdTo = document.getElementById('orderCreatedTo').value
      orderState.page = 1; loadOrders().catch((er) => toast(er.message, true))
    }
    document.getElementById('clearOrders').onclick = () => { orderState = { kw: '', status: '', createdFrom: '', createdTo: '', page: 1 }; loadOrders().catch((er) => toast(er.message, true)) }
    app.querySelectorAll('[data-order-status]').forEach(button => { button.onclick = () => { orderState.status = button.dataset.orderStatus === '0' ? '' : button.dataset.orderStatus; orderState.page = 1; loadOrders().catch((er) => toast(er.message, true)) } })
    app.querySelectorAll('[data-order-no]').forEach(button => { button.onclick = () => orderDrawer(button.dataset.orderNo).catch(error => toast(error.message, true)) })
    app.querySelectorAll('[data-refund-no]').forEach(button => { if (!adminCan('order.refund')) button.remove(); else button.onclick = () => refundOrder(button.dataset.refundNo) })
    app.querySelectorAll('button.btn[data-order-no]').forEach(button => { button.textContent = adminCan('order.service') || adminCan('order.refund') ? '查看与处理' : '详情' })
    app.querySelectorAll('[data-complete-no]').forEach(button => { button.onclick = () => completeOrder(button.dataset.completeNo) })
    document.getElementById('ordersPrev').onclick = () => { orderState.page--; loadOrders().catch((er) => toast(er.message, true)) }
    document.getElementById('ordersNext').onclick = () => { orderState.page++; loadOrders().catch((er) => toast(er.message, true)) }
    enhanceTables(app)
  }

  function enhanceTables(root) {
    const editorActions = { editMerchant: 'entity.merchant.edit', addMerchant: 'entity.merchant.create', approveMerchant: 'merchant.approve', editProduct: 'entity.product.edit', sessionModal: 'entity.session.create' }
    root.querySelectorAll('button[onclick]').forEach(button => {
      const handler = button.getAttribute('onclick') || ''
      const named = handler.match(/^\s*(\w+)\(/)?.[1]
      const entity = handler.match(/^\s*entityEditor\('([^']+)',\s*(null|\d+)/)
      const action = entity ? `entity.${entity[1]}.${entity[2] === 'null' ? 'create' : 'edit'}` : editorActions[named]
      if (action && !adminCan(action)) { button.disabled = true; button.title = adminWhy(action); button.setAttribute('aria-label', button.textContent.trim() + '：' + adminWhy(action)) }
    })
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

  // 弹窗打开时补齐 dialog 语义并移入焦点；关闭（#modalRoot 清空）后把焦点还给打开前的元素。
  new MutationObserver(() => {
    const dialog = document.querySelector('#modalRoot .modal, #modalRoot .drawer')
    if (!dialog) {
      if (!document.getElementById('eeRoot')) document.body.classList.remove('dialog-open') // 资料编辑器抽屉自管
      if (previousFocus?.isConnected) previousFocus.focus()
      previousFocus = null
      return
    }
    if (dialog.hasAttribute('role')) return
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
  let navBeforeSearch = null
  search.oninput = () => {
    const needle = search.value.trim().toLowerCase(); let count = 0
    if (needle && !navBeforeSearch) navBeforeSearch = new Map([...document.querySelectorAll('#nav details')].map(section => [section, section.open]))
    document.querySelectorAll('#nav details').forEach(section => {
      let visible = 0
      const group = NAV.find(([g]) => section.querySelector('summary').textContent.startsWith(g))?.[0] || ''
      section.querySelectorAll('[data-p]').forEach(button => { button.hidden = !(group + ' ' + button.textContent).toLowerCase().includes(needle); if (!button.hidden) visible++ })
      section.hidden = !visible; if (needle && visible) section.open = true; count += visible
      if (!needle && navBeforeSearch) section.open = navBeforeSearch.get(section) || !!section.querySelector('[aria-current="page"]')
    })
    if (!needle) navBeforeSearch = null
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
})()
