const api = require('../../../utils/api')
Page({
  data: { orders: [], loading: true, empty: false },
  onShow() { this.fetch() },
  onPullDownRefresh() { this.fetch(() => wx.stopPullDownRefresh()) },
  async fetch(done) {
    if (typeof done !== 'function') done = undefined
    this.setData({ error: '', loading: true })
    try {
      await api.ensureLogin()
      const orders = await api.getOrders()
      this.setData({ orders: orders.map(o => ({ ...o, statusText: ({10:'待支付',20:'出票中',30:'待出行 · 待核销',40:'已核销',50:'已完成',60:'退款处理中',70:'已退款',90:'已关闭'})[o.status] || '处理中', amountText: (Number(o.amount_pay || 0) / 100).toFixed(2) })), loading: false, empty: orders.length === 0 })
    } catch (e) {
      // A-18 红线：演示假订单只允许在开发环境出现；体验版/正式版一律显示错误态，绝不展示假价格
      if (!api.demoAllowed()) {
        this.setData({ loading: false, empty: false, orders: [], error: '订单加载失败：' + (e.msg || '网络异常，请稍后重试') })
        if (done) done()
        return
      }
      // 后端不可达（开发工具/开发版常见）：展示演示订单，避免出现"服务不可达"空屏
      const ST = { 10: '待支付', 20: '出票中', 30: '待出行 · 待核销', 40: '已核销', 50: '已完成', 60: '退款处理中', 70: '已退款', 90: '已关闭' }
      const demo = api.FALLBACK.orders.map(o => ({ ...o, cover: api.coverFor(o), statusText: ST[o.status] || '处理中', amountText: (Number(o.amount_pay || 0) / 100).toFixed(2) }))
      this.setData({ loading: false, empty: false, orders: demo, demoMode: true })
      wx.showToast({ title: '演示模式（后端未连接）', icon: 'none' })
    }
    if (done) done()
  },
  goDetail(e) {
    if (this.data.demoMode) return wx.showToast({ title: '演示订单，详情需连接后端', icon: 'none' })
    wx.navigateTo({ url: '/package-order/pages/order-detail/index?no=' + e.currentTarget.dataset.no })
  },
})
