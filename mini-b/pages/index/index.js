const api = require('../../utils/api')
Page({
  data: { wb: null, merchant: null, err: '', greet: '', stats: null, bars: [], weekTotal: 0, loading: true },
  onShow() {
    const now = new Date(), h = now.getHours(), role = Number(getApp().globalData.role) || 0
    this.setData({ greet: h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好',
      dateLabel: (now.getMonth() + 1) + '月' + now.getDate() + '日 · 周' + '日一二三四五六'[now.getDay()],
      role, roleLabel: role >= 3 ? '门店老板' : role >= 2 ? '门店店长' : '核销员',
      merchant: getApp().globalData.merchant || wx.getStorageSync('merchant') || null, loading: true, wb: null, stats: null, notice: '', err: '' })
    if (!getApp().globalData.token || !this.data.merchant) return this.setData({ err: 'login', wb: null, stats: null, bars: [], notice: '', loading: false })
    api.request('/m/site').then((s) => this.setData({ notice: s.notice || '' })).catch(() => {})
    api.request('/m/workbench').then((wb) => this.setData({ wb, err: '', loading: false })).catch((e) => this.setData({ wb: null, err: e.msg || '数据暂不可用，请重试', loading: false }))
    api.request('/m/stats').then((st) => {
      const max = Math.max(...st.week.map((w) => w.orders), 1)
      const bars = st.week.map((w) => ({ ...w, dLabel: w.d.slice(5), hp: Math.round(w.orders / max * 100) }))
      const weekTotal = st.week.reduce((s, w) => s + w.orders, 0)
      this.setData({ stats: st, bars, weekTotal })
    }).catch(() => {})
  },
  retry() { this.onShow() },
  toggleNotice() { this.setData({ noticeExpanded: !this.data.noticeExpanded }) },
  goLogin() { wx.switchTab({ url: '/pages/me/index' }) },
  goVerify() {
    if (!getApp().globalData.token) return this.goLogin()
    wx.navigateTo({ url: '/pages/verify/index' })
  },
  goRecords() { wx.navigateTo({ url: '/pages/records/index' }) },
  goOrders() { wx.switchTab({ url: '/pages/orders/index' }) },
  goSupply() { wx.switchTab({ url: '/pages/supply/index' }) },
  goHonor() { wx.navigateTo({ url: '/pages/honor/index' }) },
  goSettle() { wx.navigateTo({ url: '/pages/settlement/index' }) },
})
