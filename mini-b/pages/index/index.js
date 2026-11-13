const api = require('../../utils/api')
const { day, periodQuery } = require('../../utils/period')
Page({
  data: { wb: null, merchant: null, err: '', greet: '', stats: null, bars: [], weekTotal: 0, loading: true, periodIndex: 1, periodNames: ['今日','近7日','近30日','指定日期'], customDate: day(), today: day(), chartWidth: 560 },
  onShow() {
    const now = new Date(), h = now.getHours(), role = Number(getApp().globalData.role) || 0
    this.setData({ greet: h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好',
      dateLabel: (now.getMonth() + 1) + '月' + now.getDate() + '日 · 周' + '日一二三四五六'[now.getDay()],
      role, roleLabel: role >= 3 ? '门店老板' : role >= 2 ? '门店店长' : '核销员',
      merchant: getApp().globalData.merchant || wx.getStorageSync('merchant') || null, loading: true, wb: null, stats: null, notice: '', err: '' })
    const requestId = this._requestId = (this._requestId || 0) + 1
    if (!getApp().globalData.token || !this.data.merchant) return this.setData({ err: 'login', wb: null, stats: null, bars: [], notice: '', loading: false })
    const query = periodQuery(this.data.periodIndex,this.data.customDate)
    this.setData({periodLabel:this.data.periodIndex === 3 ? this.data.customDate : this.data.periodNames[this.data.periodIndex]})
    api.request('/m/site').then((s) => { if (requestId===this._requestId) this.setData({ notice: s.notice || '' }) }).catch(() => {})
    api.request('/m/workbench?'+query).then((wb) => { if (requestId===this._requestId) this.setData({ wb, wbHint: wb && wb.pendingVerify ? (wb.pendingVerify + ' 张凭证待核销，到店后请引导游客出示动态码') : '有游客到店时，可从上方进入扫码核销', err: '', loading: false }) }).catch((e) => { if (requestId===this._requestId) this.setData({ wb: null, err: e.msg || '数据暂不可用，请重试', loading: false }) })
    api.request('/m/stats?'+query).then((st) => {
      if (requestId!==this._requestId) return
      const max = Math.max(...st.week.map((w) => w.orders), 1)
      const bars = st.week.map((w) => ({ ...w, dLabel: w.d.slice(5), hp: Math.round(w.orders / max * 100) }))
      const weekTotal = st.week.reduce((s, w) => s + w.orders, 0)
      this.setData({ stats: st, bars, weekTotal, chartWidth: Math.max(560,bars.length*72) })
    }).catch(() => {})
  },
  retry() { this.onShow() },
  filterPeriod(e) { this.setData({periodIndex:Number(e.detail.value)}); this.onShow() },
  selectDate(e) { this.setData({customDate:e.detail.value}); this.onShow() },
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
  goCredentials() { wx.navigateTo({ url: '/pages/honor/index?tab=proof' }) },
  goSettle() { wx.navigateTo({ url: '/pages/settlement/index' }) },
})
