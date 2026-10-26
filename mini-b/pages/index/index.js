const api = require('../../utils/api')
Page({
  data: { wb: null, merchant: null, err: '', greet: '', stats: null, bars: [], weekTotal: 0 },
  onShow() {
    const h = new Date().getHours()
    this.setData({ greet: h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好',
      role: getApp().globalData.role || 0, merchant: getApp().globalData.merchant || wx.getStorageSync('merchant') || null })
    if (!getApp().globalData.token) return this.setData({ err: 'login' })
    api.request('/m/workbench').then((wb) => this.setData({ wb, err: '' })).catch((e) => this.setData({ err: e.msg || 'error' }))
    api.request('/m/stats').then((st) => {
      const max = Math.max(...st.week.map((w) => w.orders), 1)
      const bars = st.week.map((w) => ({ ...w, dLabel: w.d.slice(5), hp: Math.round(w.orders / max * 100) }))
      const weekTotal = st.week.reduce((s, w) => s + w.orders, 0)
      this.setData({ stats: st, bars, weekTotal })
    }).catch(() => {})
  },
  goLogin() { wx.switchTab({ url: '/pages/me/index' }) },
  goVerify() {
    if (!getApp().globalData.token) return this.goLogin()
    wx.navigateTo({ url: '/pages/verify/index' })
  },
  goRecords() { wx.navigateTo({ url: '/pages/records/index' }) },
  goOrders() { wx.switchTab({ url: '/pages/orders/index' }) },
  goSupply() { wx.switchTab({ url: '/pages/supply/index' }) },
  goSettle() { wx.navigateTo({ url: '/pages/settlement/index' }) },
})
