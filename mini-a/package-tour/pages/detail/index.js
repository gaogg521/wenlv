const api = require('../../../utils/api')
Page({
  data: { p: null, sessions: [], sel: 0, qty: 1, useBean: true, beanBal: 0, loading: true, fallback: false,
    contactName: '', contactPhone: '', gallery: [], gIdx: 0, rich: { intro: '', highlights: [], includes: [] }, rv: { avg: 0, count: 0, list: [] } },
  onLoad(q) {
    this.pid = q.id
    if (q.scene && /^[pm][0-9a-z-]+$/i.test(decodeURIComponent(q.scene))) {
      wx.setStorageSync('promoScene', decodeURIComponent(q.scene))
    }
    api.getTourDetail(q.id).then((d) => {
      const withFallbackSessions = d.sessions || []
      const rich = typeof d.rich_desc === 'string' ? JSON.parse(d.rich_desc || '{}') : (d.rich_desc || {})
      const gallery = (d.images || []).length ? (d.images || []).map(api.img) : [api.coverFor(d)]
      this.setData({ illustrated: !(d.images || []).length })
      const sv = this.sessView(withFallbackSessions[0])
      this.setData({ p: d, sessions: withFallbackSessions, selView: sv, loading: false, fallback: !(d.sessions && d.sessions.length),
        gallery, gIdx: 0, rich: { intro: rich.intro || '', highlights: rich.highlights || [], includes: rich.includes || [] },
        rv: d.rating ? { avg: d.rating.avg, count: d.rating.count, list: [] } : this.data.rv })
      this.fetchReviews()
    }).catch(e => this.setData({ error: e.msg || '线路加载失败，请重试', loading: false }))
    api.getBean().then(b => this.setData({ beanBal: b.balance })).catch(() => {})
    // 推广服务商本人：分享自动带自己的归因 scene（好友下单即归因）
    api.request('/c/promote/scene').then((s) => { if (s.promoter) this.myScene = s.scene }).catch(() => {})
  },
  fetchReviews() {
    api.getReviews(this.pid).then((rv) => this.setData({ rv })).catch(() => {})
  },
  retry() { this.setData({ loading: true, error: '' }); this.onLoad({ id: this.pid }) },
  onSwiper(e) { this.setData({ gIdx: e.detail.current }) },
  onShareAppMessage() {
    const p = this.data.p || {}
    const scene = this.myScene ? '&scene=' + this.myScene : ''
    return { title: p.title || '向往的自由 · 主题游', path: '/package-tour/pages/detail/index?id=' + this.pid + scene }
  },
  onShareTimeline() {
    const p = this.data.p || {}
    return { title: p.title || '向往的自由 · 主题游', query: 'id=' + this.pid + (this.myScene ? '&scene=' + this.myScene : '') }
  },
  // 团期展示预计算（wxml 只做取值，防分包表达式炸编译）
  sessView(s) {
    if (!s) return { label: '', extra: '' }
    const parts = [s.depart_date + ' · 余' + s.left_seats]
    const extra = []
    if (s.isEarly) extra.push('🐦 早鸟价 ¥' + (s.priceNow / 100) + '（提前 ' + s.daysToDepart + ' 天报名）')
    if (s.groupProgress) extra.push(s.groupProgress.reached ? '已成团' : '需 ' + s.groupProgress.minGo + ' 人成团 · 已报 ' + s.groupProgress.booked)
    return { label: parts[0], extra: extra.join(' · ') }
  },

  pick(e) { this.setData({ sel: Number(e.currentTarget.dataset.i), qty: 1, selView: this.sessView(this.data.sessions[Number(e.currentTarget.dataset.i)]) }) },
  addQty() {
    const s = this.data.sessions[this.data.sel]
    const cap = Math.min(9, s && s.left_seats ? Number(s.left_seats) : 9)
    if (this.data.qty >= cap) return wx.showToast({ title: s && s.left_seats ? '已达该团期剩余名额（' + cap + '）' : '单单最多 9 人', icon: 'none' })
    this.setData({ qty: this.data.qty + 1 })
  },
  subQty() {
    if (this.data.qty <= 1) return
    this.setData({ qty: this.data.qty - 1 })
  },
  toggleBean() { this.setData({ useBean: !this.data.useBean }) },
  onName(e) { this.setData({ contactName: e.detail.value }) },
  // 微信官方手机号快速验证组件回调：code 交服务端换号
  async onPhone(e) {
    if (!e.detail || !e.detail.code) return
    try {
      const r = await api.getPhoneNumber(e.detail.code)
      this.setData({ contactPhone: r.phone })
      wx.showToast({ title: '手机号已验证', icon: 'success' })
    } catch (err) { wx.showToast({ title: err.msg || '验证失败', icon: 'none' }) }
  },
  // 手动输入兜底：微信快速验证组件之外的常规途径（11 位格式校验）
  onPhoneInput(e) {
    const v = String(e.detail.value || '').replace(/[^0-9]/g, '').slice(0, 11)
    this.setData({ contactPhone: v })
  },
  goBooking() {
    if (!this.data.sessions.length) return wx.showToast({ title: '近期暂无可预订团期', icon: 'none' })
    wx.navigateTo({ url: '/package-tour/pages/booking/index?id=' + this.pid })
  },
  async submit() {
    const s = this.data.sessions[this.data.sel]
    if (this.data.submitting) return
    if (!s || Number(s.left_seats) < this.data.qty) return wx.showToast({ title: '当前团期名额不足，请选择其他日期', icon: 'none' })
    if (!/^1[3-9]\d{9}$/.test(this.data.contactPhone || '')) return wx.showToast({ title: '请填写 11 位有效手机号', icon: 'none' })
    this.setData({ submitting: true })
    try {
      await api.ensureLogin()
      const beanBal = this.data.beanBal || 0
      const unit = s.priceNow || s.price_adult
      const want = this.data.useBean ? Math.min(beanBal, Math.floor(unit * this.data.qty / 100)) : 0
      const r = await api.createOrder({ sessionId: s.id, qty: this.data.qty, beanDeduct: want,
        promoScene: wx.getStorageSync('promoScene') || undefined,
        contactName: this.data.contactName, contactPhone: this.data.contactPhone })
      try { await api.pay(r.payParams) } catch (err) { wx.showToast({ title: '支付未完成，可在订单中继续支付', icon: 'none' }) }
      wx.redirectTo({ url: '/package-tour/pages/pay-result/index?orderNo=' + r.orderNo + '&mock=' + (r.payParams.mock ? 1 : 0) })
    } catch (e) {
      wx.showToast({ title: e.msg || '下单失败', icon: 'none' })
    } finally { this.setData({ submitting: false }) }
  },
})
