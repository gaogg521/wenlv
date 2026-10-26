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
    } catch (e) { this.setData({ loading: false, empty: false, orders: [], error: e.msg || '订单加载失败，请重试' }) }
    if (done) done()
  },
  goDetail(e) { wx.navigateTo({ url: '/package-order/pages/order-detail/index?no=' + e.currentTarget.dataset.no }) },
})
