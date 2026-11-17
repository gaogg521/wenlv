const api = require('../../../utils/api')
const dict = require('../../../utils/dict')
const BUCKETS = { waitPay: [10], waitTravel: [30], waitReview: [50], refunding: [60, 70] }
Page({
  data: { orders: [], visibleOrders: [], filter: 'all', filters: [{ k: 'all', n: '全部' }, { k: 'waitPay', n: '待付款' }, { k: 'waitTravel', n: '待出行' }, { k: 'waitReview', n: '待评价' }, { k: 'refunding', n: '退款/售后' }], loading: true, empty: false },
  onShow() {
    // A-02：快捷入口带筛选预设（一次性消费），与「我的」计数同一口径
    const preset = wx.getStorageSync('orderFilter') || ''
    if (preset) { wx.removeStorageSync('orderFilter'); this.setData({ filter: preset }) }
    this.fetch()
  },
  onPullDownRefresh() { this.fetch(() => wx.stopPullDownRefresh()) },
  filterTap(e) { this.setData({ filter: e.currentTarget.dataset.k }); this.applyFilters() },
  applyFilters() {
    const bucket = BUCKETS[this.data.filter]
    const f = this.data.filter
    const visible = !bucket ? this.data.orders : this.data.orders.filter((o) => bucket.includes(Number(o.status)) && (f !== 'waitReview' || !o.reviewed))
    this.setData({ visibleOrders: visible, empty: visible.length === 0 })
  },
  async fetch(done) {
    if (typeof done !== 'function') done = undefined
    this.setData({ error: '', loading: true })
    try {
      await api.ensureLogin()
      const orders = await api.getOrders()
      // X-01：状态文案由服务端字典下发（statusText），本地仅兜底
      this.setData({ orders: orders.map(o => ({ ...o, statusText: o.statusText || dict.statusText(o.status), amountText: (Number(o.amount_pay || 0) / 100).toFixed(2) })), loading: false, demoMode: false })
      this.applyFilters()
    } catch (e) {
      // A-18 红线：演示假订单只允许在开发环境出现；体验版/正式版一律显示错误态，绝不展示假价格
      if (!api.demoAllowed()) {
        this.setData({ loading: false, empty: false, orders: [], visibleOrders: [], error: '订单加载失败：' + (e.msg || '网络异常，请稍后重试') })
        if (done) done()
        return
      }
      // 后端不可达（开发工具/开发版常见）：展示演示订单，避免出现"服务不可达"空屏
      const demo = api.FALLBACK.orders.map(o => ({ ...o, cover: api.coverFor(o), statusText: dict.statusText(o.status), amountText: (Number(o.amount_pay || 0) / 100).toFixed(2) }))
      this.setData({ loading: false, empty: false, orders: demo, visibleOrders: demo, demoMode: true })
      wx.showToast({ title: '演示模式（后端未连接）', icon: 'none' })
    }
    if (done) done()
  },
  goDetail(e) {
    if (this.data.demoMode) return wx.showToast({ title: '演示订单，详情需连接后端', icon: 'none' })
    wx.navigateTo({ url: '/package-order/pages/order-detail/index?no=' + e.currentTarget.dataset.no })
  },
})
