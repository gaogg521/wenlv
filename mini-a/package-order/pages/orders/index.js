const api = require('../../../utils/api')
Page({
  data: { orders: [], loading: true, empty: false },
  onShow() { this.fetch() },
  onPullDownRefresh() { this.fetch(() => wx.stopPullDownRefresh()) },
  async fetch(done) {
    try {
      await api.ensureLogin()
      const orders = await api.getOrders()
      this.setData({ orders, loading: false, empty: orders.length === 0 })
    } catch (e) { this.setData({ loading: false, empty: true, orders: [] }) }
    if (done) done()
  },
  goDetail(e) { wx.navigateTo({ url: '/package-order/pages/order-detail/index?no=' + e.currentTarget.dataset.no }) },
})
