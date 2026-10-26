const api = require('../../utils/api')
Page({ data: { list: [], loaded: false },
  onShow() {
    if (!getApp().globalData.token) return this.setData({ loaded: true })
    api.request('/m/verify/records').then((l) => this.setData({ list: l, loaded: true })).catch(() => this.setData({ loaded: true }))
  },
  onPullDownRefresh() {
    if (!getApp().globalData.token) return wx.stopPullDownRefresh()
    api.request('/m/verify/records').then((l) => { this.setData({ list: l, loaded: true }); wx.stopPullDownRefresh() })
      .catch(() => { this.setData({ loaded: true }); wx.stopPullDownRefresh() })
  },
})
