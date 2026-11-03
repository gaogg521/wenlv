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
      this.setData({ orders: orders.map(o => ({ ...o, statusText: ({10:'待支付',20:'出票中',30:'待出行 · 待核销',40:'已核销',50:'已完成',60:'退款处理中',70:'已退款',90:'已关闭'})[o.status] || '处理中' })), loading: false, empty: orders.length === 0 })
    } catch (e) {
      // 后端不可达（真机演示常见）：展示演示订单，避免出现"服务不可达"空屏
      const ST = { 10: '待支付', 20: '出票中', 30: '待出行 · 待核销', 40: '已核销', 50: '已完成', 60: '退款处理中', 70: '已退款', 90: '已关闭' }
      const demo = api.FALLBACK.orders.map(o => ({ ...o, cover: api.coverFor(o), statusText: ST[o.status] || '处理中' }))
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
