const api = require('../../utils/api')
const { day, periodQuery } = require('../../utils/period')
Page({
  data: { wb: null, merchant: null, err: '', greet: '', stats: null, bars: [], weekTotal: 0, loading: true, periodIndex: 1, periodNames: ['今日','近7日','近30日','指定日期'], customDate: day(), today: day(), chartWidth: 560, todoItems: [], notifyBar: null, newOrderBanner: null },
  onShow() {
    const now = new Date(), h = now.getHours(), role = Number(getApp().globalData.role) || 0
    this.setData({ greet: h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好',
      dateLabel: (now.getMonth() + 1) + '月' + now.getDate() + '日 · 周' + '日一二三四五六'[now.getDay()],
      role, roleLabel: role >= 3 ? '门店老板' : role >= 2 ? '门店店长' : '核销员',
      merchant: getApp().globalData.merchant || wx.getStorageSync('merchant') || null, loading: true, wb: null, stats: null, notice: '', err: '' })
    const requestId = this._requestId = (this._requestId || 0) + 1
    if (!getApp().globalData.token || !this.data.merchant) { this.stopNotifyPoll(); return this.setData({ err: 'login', wb: null, stats: null, bars: [], notice: '', loading: false }) }
    const query = periodQuery(this.data.periodIndex,this.data.customDate)
    this.setData({periodLabel:this.data.periodIndex === 3 ? this.data.customDate : this.data.periodNames[this.data.periodIndex]})
    const jobs = []
    jobs.push(api.request('/m/site').then((s) => { if (requestId===this._requestId) this.setData({ notice: s.notice || '' }) }).catch(() => {}))
    jobs.push(api.request('/m/workbench?'+query).then((wb) => { if (requestId===this._requestId) this.setData({ wb, todoItems: this.todoItems(wb, role), wbHint: wb && wb.pendingVerify ? (wb.pendingVerify + ' 张凭证待核销，到店后请引导游客出示动态码') : '有游客到店时，可从上方进入扫码核销', err: '', loading: false }) }).catch((e) => { if (requestId===this._requestId) this.setData({ wb: null, errCode: Number(e.code) || 0, err: e.msg || '数据暂不可用，请重试', loading: false }) }))
    jobs.push(api.request('/m/stats?'+query).then((st) => {
      if (requestId!==this._requestId) return
      const max = Math.max(...st.week.map((w) => w.orders), 1)
      const bars = st.week.map((w) => ({ ...w, dLabel: w.d.slice(5), hp: Math.round(w.orders / max * 100) }))
      const weekTotal = st.week.reduce((s, w) => s + w.orders, 0)
      this.setData({ stats: st, bars, weekTotal, chartWidth: Math.max(560,bars.length*72) })
    }).catch(() => {}))
    // M-02/M-09：到单提醒——状态条 + 首次引导 + 30 秒轮询
    jobs.push(this.initNotify())
    // M-05：下拉刷新等主要请求都回来再收起转圈
    this._loadPromise = Promise.all(jobs.map((p) => Promise.resolve(p).catch(() => {})))
  },
  onPullDownRefresh() { this.onShow(); if (this._loadPromise) this._loadPromise.then(() => wx.stopPullDownRefresh()); else wx.stopPullDownRefresh() },
  onHide() { this.stopNotifyPoll() },   // M-02：离开页面停止轮询
  onUnload() { this.stopNotifyPoll() },
  retry() { this.onShow() },
  // ===== M-02/M-09：到单提醒（与「我的」页同源：/m/notify/prefs + /m/notify/templates） =====
  async initNotify() {
    const role = Number(getApp().globalData.role) || 0
    this.stopNotifyPoll()
    if (!getApp().globalData.token || !this.data.merchant) return
    try {
      const prefs = await api.request('/m/notify/prefs')
      const t = await api.request('/m/notify/templates').catch(() => ({}))
      const ids = [t.newOrder, t.refundApply, t.settlementPending].filter(Boolean)
      const allOn = [prefs.newOrder, prefs.refundApply, prefs.settlementPending].every(Boolean)
      if (!ids.length) this.setData({ notifyBar: { key: 'unlinked', label: '到单提醒 · 应用内提示常开' } })
      else this.setData({ notifyBar: { key: allOn ? 'on' : 'off', label: allOn ? '到单提醒 · 已开启' : '到单提醒 · 去开启 ›' } })
      // 老板/店长首次进工作台弹一次引导（可跳过；跳过后「我的」页保留入口）
      if (role >= 2 && !prefs.onboarded) this.showNotifyGuide()
    } catch (e) { this.setData({ notifyBar: null }) }
    this.startNotifyPoll()
  },
  showNotifyGuide() {
    wx.showModal({ title: '开启到单提醒', content: '有新支付订单、退款申请或对账单时提醒你。微信订阅需授权一次；工作台内的到单提示条不依赖微信授权，始终可用。',
      confirmText: '去设置', cancelText: '暂不', success: (r) => {
        api.request('/m/notify/prefs', 'POST', { onboarded: 1 }).catch(() => {})
        if (r.confirm) { wx.setStorageSync('notifyPanelOpen', 1); wx.switchTab({ url: '/pages/me/index' }) }
      } })
  },
  startNotifyPoll() {
    if (this._pollTimer) return
    const tick = async () => {
      try {
        const d = await api.request('/m/notify/poll?after=' + (this._notifyAfter || 0))
        if (this._notifyAfter == null) { this._notifyAfter = d.latestId || 0; return } // 首轮只校准基线，不把历史单当新单
        if (d.newPaid > 0 && d.latestId > (this._notifyAfter || 0)) {
          this._notifyAfter = d.latestId
          this.setData({ newOrderBanner: { count: d.newPaid } })
          try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
          const bar = this.getTabBar && this.getTabBar(); if (bar && bar.setDot) bar.setDot(1, true) // 订单 tab 红点
        } else if (d.latestId) this._notifyAfter = Math.max(this._notifyAfter || 0, d.latestId)
      } catch (e) { /* 断网轮询静默，不打断工作台 */ }
    }
    tick()
    this._pollTimer = setInterval(tick, 30000)
  },
  stopNotifyPoll() { if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null } },
  // 顶部提示条：查看 → 清红点进订单页；忽略 → 只清横幅
  goBannerOrders() { this.setData({ newOrderBanner: null }); const bar = this.getTabBar && this.getTabBar(); if (bar && bar.setDot) bar.setDot(1, false); wx.switchTab({ url: '/pages/orders/index' }) },
  dismissOrderBanner() { this.setData({ newOrderBanner: null }); const bar = this.getTabBar && this.getTabBar(); if (bar && bar.setDot) bar.setDot(1, false) },
  goNotifyBar() {
    const bar = this.data.notifyBar
    if (bar && bar.key === 'off') { wx.setStorageSync('notifyPanelOpen', 1); wx.switchTab({ url: '/pages/me/index' }) }
    else if (bar && bar.key === 'unlinked') wx.showToast({ title: '平台未接入订阅模板，应用内提示常开', icon: 'none' })
  },
  // B2 今日待办：口径与下钻列表一致；核销员仅见待核销（权限以现有配置为准）
  todoItems(wb, role) {
    const t = (wb && wb.todos) || {}
    const items = [{ k: 'verify', label: '待核销', cap: '在店待核销凭证', v: Number(t.verify) || 0 }]
    if (role >= 2) {
      items.unshift({ k: 'arrivals', label: '待接待', cap: '今日出发待服务订单', v: Number(t.arrivals) || 0 })
      items.push({ k: 'closing', label: '临近截止', cap: '7日内出发在售团期', v: Number(t.closing) || 0 },
        { k: 'abnormal', label: '异常待处理', cap: '退款申请中订单', v: Number(t.abnormal) || 0 })
    }
    return items
  },
  // 下钻：待接待/异常→订单页（带筛选预设）；临近截止→库存页（未来7天）；待核销→核销页
  goTodo(e) {
    const k = e.currentTarget.dataset.k
    if (k === 'verify') return this.goVerify()
    if (k === 'arrivals') { wx.setStorageSync('ordersPreset', { status: 'waiting', depart: this.data.today }); wx.showToast({ title: '已按今日出发筛选', icon: 'none' }); return this.goOrders() }
    if (k === 'abnormal') { wx.setStorageSync('ordersPreset', { status: 'refund_pending' }); return this.goOrders() }
    if (k === 'closing') { wx.setStorageSync('supplyPreset', { rangeIndex: 1, status: 'open' }); wx.showToast({ title: '已按未来7天筛选', icon: 'none' }); return this.goSupply() }
  },
  filterPeriod(e) { this.setData({periodIndex:Number(e.detail.value)}); this.onShow() },
  selectDate(e) { this.setData({customDate:e.detail.value}); this.onShow() },
  toggleNotice() { this.setData({ noticeExpanded: !this.data.noticeExpanded }) },
  goLogin() { wx.switchTab({ url: '/pages/me/index' }) },
  goReviews() { wx.navigateTo({ url: '/pages/reviews/index' }) },
  // B-01：工作台首屏一键切换门店/岗位（api.switchStore 后 reLaunch，订单/库存/结算各页 onShow 自动刷新到新门店）
  async chooseStore() {
    try {
      const stores = await api.request('/m/auth/stores')
      if (!stores.length) return wx.showToast({ title: '当前账号仅绑定一家门店', icon: 'none' })
      const choice = await new Promise(resolve => wx.showActionSheet({ itemList: stores.map(s => s.name + ' · ' + ['', '核销员', '店长', '老板'][s.role]), success: r => resolve(r.tapIndex), fail: () => resolve(null) }))
      if (choice !== null) await api.switchStore(stores[choice].id)
    } catch (e) { wx.showToast({ title: e.msg || '切换失败', icon: 'none' }) }
  },
  goVerify() {
    if (!getApp().globalData.token) return this.goLogin()
    wx.navigateTo({ url: '/pages/verify/index' })
  },
  goRecords() { wx.navigateTo({ url: '/pages/records/index' }) },
  goOrders() { wx.switchTab({ url: '/pages/orders/index' }) },
  goSupply() { wx.switchTab({ url: '/pages/supply/index' }) },
  goHonor() { wx.navigateTo({ url: '/pages/honor/index' }) },
  goCredentials() { wx.navigateTo({ url: '/pages/honor/index?tab=proof' }) },
  goSettle() { wx.navigateTo({ url: '/pages/settlement/index' }) },
})
