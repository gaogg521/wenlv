const api = require('../../../utils/api')
Page({
  data: { orders: [], loading: true, empty: false },
  onShow() { this.fetch() },
  async fetch() {
    try {
      await api.ensureLogin()
      const orders = await api.getOrders()
      this.setData({ orders, loading: false, empty: orders.length === 0 })
    } catch (e) { this.setData({ loading: false, empty: true, orders: [] }) }
  },
  goDetail(e) { wx.navigateTo({ url: '/package-order/pages/order-detail/index?no=' + e.currentTarget.dataset.no }) },
})
