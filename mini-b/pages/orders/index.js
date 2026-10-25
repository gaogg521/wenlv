const api = require('../../utils/api')
Page({
  data: { orders: [], loaded: false },
  onShow() {
    if (!getApp().globalData.token) return this.setData({ loaded: true })
    api.request('/m/orders').then((o) => this.setData({ orders: o, loaded: true }))
      .catch(() => this.setData({ loaded: true }))
  },
})
