const api = require('../../utils/api')
Page({
  data: { orders: [], loaded: false },
  retry() { this.onShow() },
  goDetail(e) { wx.navigateTo({ url: '/pages/order-detail/index?no=' + e.currentTarget.dataset.no }) },
  onShow() {
    if (!getApp().globalData.token) return this.setData({ loaded: true })
    api.request('/m/orders').then((o) => this.setData({ orders: o.map(x => ({ ...x, statusText: ({20:'已支付',30:'待核销',40:'已核销',50:'已完成',60:'退款中',70:'已退款',90:'已关闭'})[x.status] || '处理中' })), loaded: true, error: '' }))
      .catch(e => this.setData({ loaded: true, orders: [], error: e.msg || '订单加载失败' }))
  },
  onPullDownRefresh() {
    if (!getApp().globalData.token) return wx.stopPullDownRefresh()
    api.request('/m/orders').then((o) => { this.setData({ orders: o.map(x => ({ ...x, statusText: ({20:'已支付',30:'待核销',40:'已核销',50:'已完成',60:'退款中',70:'已退款',90:'已关闭'})[x.status] || '处理中' })), loaded: true, error: '' }); wx.stopPullDownRefresh() })
      .catch(() => { this.setData({ loaded: true }); wx.stopPullDownRefresh() })
  },
})
