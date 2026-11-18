const api = require('../../../utils/api')
const place = require('../../../utils/place')
const dict = require('../../../utils/dict')
Page({
  // X-01：状态文案来自统一字典（服务端 /c/dicts 缓存），页面不再自建状态表；订单行 statusText 优先
  data: { o: null, passes: [], stName: dict.statusMap(),
    passSt: { 1: '有效 · 待核销', 2: '已核销', 3: '已撤销', 4: '已冲正' },
    rating: 5, rvText: '', reviewDone: false },
  // X-05：模板预取（requestSubscribeMessage 必须在手势栈内同步调用，不能先 await 网络请求）
  async loadNotifyTemplates() {
    try {
      const t = await api.getNotifyTemplates()
      this.notifyIds = { depart: t.departRemind || null, refund: t.refundDone || null }
    } catch (e) { this.notifyIds = {} }
  },
  askDepartRemind() {
    const id = this.notifyIds && this.notifyIds.depart
    if (!id) return wx.showToast({ title: '出行提醒尚未开通', icon: 'none' })
    wx.requestSubscribeMessage({ tmplIds: [id], complete: (r) => {
      const ok = r[id] === 'accept'
      wx.showToast({ title: ok ? '已订阅出行提醒' : '未订阅', icon: ok ? 'success' : 'none' })
    } })
  },
  askRefundDone() {
    const id = this.notifyIds && this.notifyIds.refund
    if (!id) return
    wx.requestSubscribeMessage({ tmplIds: [id], complete: () => {} })
  },
  onLoad(q) { this.no = q.no; this.loadNotifyTemplates(); this.fetch() },
  onShow() { if (this.no) this.fetch() },
  async fetch() {
    try {
      const o = await api.getOrder(this.no)
      if(o.freedom)o.freedom={...o.freedom,discountText:(o.freedom.discount/100).toFixed(2),cashText:(o.freedom.cashPay/100).toFixed(2),thresholdText:(o.freedom.threshold/100).toFixed(2)}
      if (o.trip) o.trip.endTimeText = o.trip.end_time ? '，预计 ' + o.trip.end_time + ' 结束' : ''
      this.setData({ o, passes: o.passes })
    } catch (e) { wx.showToast({ title: e.msg || '加载失败', icon: 'none' }) }
  },
  async retryPay() {
    try { const r = await api.request('/c/orders/' + this.no + '/pay', 'POST'); await api.pay(r.payParams); wx.navigateTo({ url: '/package-tour/pages/pay-result/index?orderNo=' + this.no }) }
    catch (e) { wx.showToast({ title: e.msg || '支付未完成', icon: 'none' }) }
  },
  goCode(e) { wx.navigateTo({ url: '/package-order/pages/pass-code/index?id=' + e.currentTarget.dataset.id }) },
  // 免费改签（未成团取消单）：同频道同价团期列表 → 选中改签
  async rebook() {
    const opts = this.data.o.rebookOptions || []
    if (!opts.length) return wx.showToast({ title: '暂无可改签团期', icon: 'none' })
    const ok = await new Promise((r) => wx.showActionSheet({
      itemList: opts.map((s) => s.depart_date + ' · ¥' + (s.price_adult / 100) + ' · 余' + s.left_seats),
      success: r, fail: () => r(null),
    })).catch(() => null)
    if (ok == null) return
    try {
      const res = await api.request('/c/orders/' + this.no + '/rebook', 'POST', { sessionId: opts[ok.tapIndex].id })
      wx.showToast({ title: '改签成功，已出票', icon: 'success' })
      wx.navigateTo({ url: '/package-order/pages/order-detail/index?no=' + res.orderNo })
    } catch (e) { wx.showToast({ title: e.msg || '改签失败', icon: 'none' }) }
  },

  callLeader() { place.call(this.data.o.trip && this.data.o.trip.leader_phone) },
  callMerchant() { place.call(this.data.o.merchantContact.phone) },
  navMerchant() { const m = this.data.o.merchantContact; place.openGeo(m.geo, m.name, m.address) },
  async refund() {
    const unpaid = this.data.o && this.data.o.status === 10
    let content
    if (unpaid) {
      content = this.data.o.stockOrder ? '订单尚未支付，取消后库存将释放。确认取消？' : '订单尚未支付，取消后名额将释放。确认取消？'
    } else {
      // 先试算：弹窗里的金额就是实际退回金额（与服务端扣费同一函数）
      let qt
      try { qt = await api.refundQuote(this.no) } catch (e) { return wx.showToast({ title: e.msg || '暂时无法试算，请稍后重试', icon: 'none' }) }
      if (!qt.allowed) {
        return wx.showModal({ title: '暂不支持自助退款', content: qt.reason + '\n\n' + (qt.rules || []).join('\n'), showCancel: false, confirmText: '知道了' })
      }
      const beans = qt.beanReturn ? '，抵扣的 ' + qt.beanReturn + ' 旅豆全额返还' : ''
      content = qt.feeFen > 0
        ? '距出发 ' + qt.daysToDepart + ' 天，按退改规则收取 ' + Math.round(qt.rate * 1000) / 10 + '% 手续费 ¥' + qt.feeLabel + '。\n实际退回 ¥' + qt.refundLabel + beans + '。确认申请？'
        : (qt.daysToDepart == null ? '免手续费，¥' : '距出发 ' + qt.daysToDepart + ' 天，免手续费，¥') + qt.refundLabel + ' 全额原路退回' + beans + '。确认申请？'
    }
    const ok = await new Promise(r => wx.showModal({ title: unpaid ? '取消订单' : '申请退款', content, confirmText: unpaid ? '确认取消' : '确认退款', success: r }))
    if (!ok.confirm) return
    this.askRefundDone() // X-05：确认退款的手势内同步请求「退款到账」订阅（模板未配置静默跳过）
    try {
      await api.refund(this.no, '用户申请')
      wx.showToast({ title: unpaid ? '订单已取消' : '退款已受理' })
      this.fetch()
    } catch (e) { wx.showToast({ title: e.msg || '失败', icon: 'none' }) }
  },
  // ---- 写评价（核销完成后一单一评 · 服务端机审）----
  setRating(e) { this.setData({ rating: Number(e.currentTarget.dataset.v) }) },
  onRvText(e) { this.setData({ rvText: e.detail.value }) },
  async submitReview() {
    const { rating, rvText } = this.data
    if (!rvText || rvText.trim().length < 4) return wx.showToast({ title: '至少 4 个字', icon: 'none' })
    try {
      const r = await api.postReview(this.no, rating || 5, rvText.trim())
      const got = (r && r.badges) || []
      if (got.length) wx.showModal({ title: '获得新勋章', content: '恭喜点亮「' + got.join('」「') + '」，可在「我的身份」查看。', showCancel: false, confirmText: '好的' })
      else wx.showToast({ title: '评价成功，感谢分享' })
      this.setData({ reviewDone: true })
      this.fetch()
    } catch (e) { wx.showToast({ title: e.msg || '提交失败', icon: 'none' }) }
  },
})
