const api = require('../../../utils/api')
Page({
  data: { p: null, sessions: [], sel: 0, qty: 1, useBean: true, beanBal: 0, loading: true, fallback: false,
    contactName: '', contactPhone: '', phoneTicket: '', agree: false, buyInsurance: false, gallery: [], gIdx: 0, rich: { intro: '', highlights: [], includes: [] }, rv: { avg: 0, count: 0, list: [] } },
  onLoad(q) {
    this.pid = q.id
    if (q.scene && /^[pm][0-9a-z-]+$/i.test(decodeURIComponent(q.scene))) {
      wx.setStorageSync('promoScene', decodeURIComponent(q.scene))
    }
    api.getTourDetail(q.id).then((d) => {
      const withFallbackSessions = d.sessions || []
      const rich = typeof d.rich_desc === 'string' ? JSON.parse(d.rich_desc || '{}') : (d.rich_desc || {})
      const images = api.productImages(d)
      const gallery = images.length ? images.map(api.img) : [api.coverFor(d)]
      this.setData({ illustrated: !images.length })
      const sv = this.sessView(withFallbackSessions[0])
      // 默认选中第一个还有名额的团期
      const firstOpen = Math.max(0, withFallbackSessions.findIndex((x) => Number(x.left_seats) > 0))
      // A-42：分包 wxml 只做取值——保险相关在 JS 预计算（复杂表达式会静默炸分包编译）
      d.hasInsurance = Number(d.insurance_fee) > 0
      d.insuranceFeeYuan = (Number(d.insurance_fee) / 100).toFixed(2)
      this.setData({ p: d, sessions: withFallbackSessions, sel: firstOpen, selView: this.sessView(withFallbackSessions[firstOpen]), loading: false, fallback: !(d.sessions && d.sessions.length),
        gallery, gIdx: 0, rich: { intro: rich.intro || '', highlights: rich.highlights || [], includes: rich.includes || [] },
        rv: d.rating ? { avg: d.rating.avg, count: d.rating.count, list: [] } : this.data.rv }, () => this.updatePrice())
    }).catch(e => this.setData({ error: e.msg || '线路加载失败，请重试', loading: false }))
    api.getBean().then(b => this.setData({ beanBal: b.balance }, () => this.updatePrice())).catch(() => {})
    // 推广服务商本人：分享自动带自己的归因 scene（好友下单即归因）
    api.request('/c/promote/scene').then((s) => { if (s.promoter) this.myScene = s.scene }).catch(() => {})
  },
  fetchReviews() {
    api.getReviews(this.pid).then((rv) => this.setData({ rv })).catch(() => {})
  },
  retry() { this.setData({ loading: true, error: '' }); this.onLoad({ id: this.pid }) },
  onReady() { wx.setNavigationBarTitle({ title: '确认订单' }) },
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
  updatePrice() {
    const s = this.data.sessions[this.data.sel]
    if (!s) return
    const goods = Number(s.priceNow || s.price_adult) * this.data.qty
    const beans = this.data.useBean ? Math.min(Number(this.data.beanBal) || 0, this.beanCap(goods)) : 0
    const unit = Number(s.priceNow || s.price_adult)
    const ins = this.data.buyInsurance ? Math.max(0, Number(this.data.p.insurance_fee) || 0) * this.data.qty : 0
    this.setData({ priceSummary: { unit: (unit / 100).toFixed(2), goods: (goods / 100).toFixed(2), capYuan: (this.beanCap(goods) / 10).toFixed(2),
      insurance: (ins / 100).toFixed(2), showInsRow: ins > 0,
      deduct: (beans / 10).toFixed(2), pay: ((goods - beans * 10 + ins) / 100).toFixed(2) } })
  },
  /** 抵扣上限（豆）：与服务端 order.mjs 同一公式 floor(金额分 × 上限比例 ÷ 10)，比例取参数中心实时值 */
  beanCap(goodsFen) {
    const pct = this.data.p && this.data.p.bookingRules ? Number(this.data.p.bookingRules.beanDeductMaxPct) : 0.1
    return Math.floor(goodsFen * pct / 10)
  },
  // 团期展示预计算（wxml 只做取值，防分包表达式炸编译）
  sessView(s) {
    if (!s) return { label: '', extra: '', info: null }
    const parts = [s.depart_date + ' · 余' + s.left_seats]
    const extra = []
    if (s.isEarly) extra.push('🐦 早鸟价 ¥' + (s.priceNow / 100) + '（提前 ' + s.daysToDepart + ' 天报名）')
    if (s.groupProgress) extra.push(s.groupProgress.reached ? '已成团' : '需 ' + s.groupProgress.minGo + ' 人成团 · 已报 ' + s.groupProgress.booked)
    const info = s.info && Object.keys(s.info).length ? s.info : null
    return { label: parts[0], extra: extra.join(' · '), info }
  },

  pick(e) {
    const s = this.data.sessions[Number(e.currentTarget.dataset.i)]
    if (s && Number(s.left_seats) <= 0) return wx.showToast({ title: '该团期已满，请选择其他日期', icon: 'none' })
    this.setData({ sel: Number(e.currentTarget.dataset.i), qty: 1, selView: this.sessView(this.data.sessions[Number(e.currentTarget.dataset.i)]) }, () => this.updatePrice()) },
  addQty() {
    const s = this.data.sessions[this.data.sel]
    const cap = Math.min(9, s && s.left_seats ? Number(s.left_seats) : 9)
    if (this.data.qty >= cap) return wx.showToast({ title: s && s.left_seats ? '已达该团期剩余名额（' + cap + '）' : '单单最多 9 人', icon: 'none' })
    this.setData({ qty: this.data.qty + 1 }, () => this.updatePrice())
  },
  subQty() {
    if (this.data.qty <= 1) return
    this.setData({ qty: this.data.qty - 1 }, () => this.updatePrice())
  },
  toggleBean(e) { this.setData({ useBean: e && e.detail && typeof e.detail.value === 'boolean' ? e.detail.value : !this.data.useBean }, () => this.updatePrice()) },
  toggleInsurance(e) { this.setData({ buyInsurance: !!e.detail.value }, () => this.updatePrice()) },
  toggleAgree(e) { this.setData({ agree: e.detail.value.includes('agree') }) },
  goDoc(e) { wx.navigateTo({ url: '/package-content/pages/doc/index?type=' + (e.currentTarget.dataset.type === 'terms' ? 'agreement' : 'privacy') }) },
  onName(e) { this.setData({ contactName: e.detail.value }) },
  // 微信官方手机号快速验证组件回调：code 交服务端换号。
  // A-08：服务端不下发明文也不下发打码值（打码值过不了 11 位校验，一键获取后必下单失败），
  // 改为下发短期凭证 phoneTicket——提交订单时随单带上，服务端解封后加密落库
  async onPhone(e) {
    if (!e.detail || !e.detail.code) return
    try {
      const r = await api.getPhoneNumber(e.detail.code)
      this.setData({ phoneTicket: r.ticket || '', contactPhone: r.phoneMasked || '' })
      wx.showToast({ title: '手机号已验证', icon: 'success' })
    } catch (err) { wx.showToast({ title: err.msg || '验证失败', icon: 'none' }) }
  },
  // 手动输入兜底：微信快速验证组件之外的常规途径（11 位格式校验）；手动输入清掉凭证
  onPhoneInput(e) {
    const v = String(e.detail.value || '').replace(/[^0-9]/g, '').slice(0, 11)
    this.setData({ contactPhone: v, phoneTicket: '' })
  },
  async submit() {
    const s = this.data.sessions[this.data.sel]
    if (this.data.submitting) return
    if (!this.data.agree) return wx.showToast({ title: '请先阅读并同意服务条款与隐私政策', icon: 'none' })
    if (!s || Number(s.left_seats) < this.data.qty) return wx.showToast({ title: '当前团期名额不足，请选择其他日期', icon: 'none' })
    if (!String(this.data.contactName || '').trim()) return wx.showToast({ title: '请填写联系人姓名', icon: 'none' })
    // A-08：一键获取（有 phoneTicket）或手输 11 位手机号，二者其一即可下单
    if (!this.data.phoneTicket && !/^1[3-9]\d{9}$/.test(this.data.contactPhone || '')) return wx.showToast({ title: '请填写 11 位有效手机号', icon: 'none' })
    this.setData({ submitting: true })
    try {
      await api.ensureLogin()
      await api.request('/c/consent', 'POST', { scene: 'privacy', granted: true })
      await api.request('/c/consent', 'POST', { scene: 'terms', granted: true })
      const beanBal = this.data.beanBal || 0
      const unit = s.priceNow || s.price_adult
      const want = this.data.useBean ? Math.min(beanBal, this.beanCap(unit * this.data.qty)) : 0
      const r = await api.createOrder({ sessionId: s.id, qty: this.data.qty, beanDeduct: want,
        insurance: this.data.buyInsurance,
        promoScene: wx.getStorageSync('promoScene') || undefined,
        contactName: this.data.contactName,
        phoneTicket: this.data.phoneTicket || undefined,
        contactPhone: this.data.phoneTicket ? undefined : this.data.contactPhone })
      // A-41/A-44：下单成功（tap 回调内）请求出行通知订阅 + 落隐私授权记录
      try {
        const t = await api.getNotifyTemplates()
        const ids = [t.groupCancel, t.payOk].filter(Boolean)
        if (ids.length) wx.requestSubscribeMessage({ tmplIds: ids, fail: () => {} })
      } catch (e) { /* 订阅是增强能力 */ }
      try { await api.pay(r.payParams) } catch (err) { wx.showToast({ title: '支付未完成，可在订单中继续支付', icon: 'none' }) }
      wx.redirectTo({ url: '/package-tour/pages/pay-result/index?orderNo=' + r.orderNo + '&mock=' + (r.payParams.mock ? 1 : 0) })
    } catch (e) {
      wx.showToast({ title: e.msg || '下单失败', icon: 'none' })
    } finally { this.setData({ submitting: false }) }
  },
})
