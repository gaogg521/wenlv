const api = require('../../utils/api')
Page({
  data: { orders: [], loaded: false },
  onShow() {
    if (!getApp().globalData.token) return this.setData({ loaded: true })
    api.request('/m/orders').then((o) => this.setData({ orders: o, loaded: true }))
      .catch(() => this.setData({ loaded: true }))
  },
  onPullDownRefresh() {
    if (!getApp().globalData.token) return wx.stopPullDownRefresh()
    api.request('/m/orders').then((o) => { this.setData({ orders: o, loaded: true }); wx.stopPullDownRefresh() })
      .catch(() => { this.setData({ loaded: true }); wx.stopPullDownRefresh() })
  },
})
