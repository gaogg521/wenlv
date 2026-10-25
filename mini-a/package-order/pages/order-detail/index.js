const api = require('../../../utils/api')
Page({
  data: { o: null, passes: [], stName: { 10: '待支付', 20: '已支付', 30: '待出行·待核销', 40: '已核销', 50: '已完成', 70: '已退款', 90: '已关闭' },
    passSt: { 1: '有效 · 待核销', 2: '已核销', 3: '已撤销', 4: '已冲正' },
    rating: 5, rvText: '', reviewDone: false },
  onLoad(q) { this.no = q.no; this.fetch() },
  async fetch() {
    try {
      const o = await api.getOrder(this.no)
      this.setData({ o, passes: o.passes })
    } catch (e) { wx.showToast({ title: e.msg || '加载失败', icon: 'none' }) }
  },
  goCode(e) { wx.navigateTo({ url: '/package-order/pages/pass-code/index?id=' + e.currentTarget.dataset.id }) },
  async refund() {
    const ok = await new Promise(r => wx.showModal({ title: '申请退款', content: '按平台退改梯度执行，确认？', success: r }))
    if (!ok.confirm) return
    try {
      await api.refund(this.no, '用户申请')
      wx.showToast({ title: '退款已受理' })
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
      await api.postReview(this.no, rating || 5, rvText.trim())
      wx.showToast({ title: '评价成功，感谢分享' })
      this.setData({ reviewDone: true })
      this.fetch()
    } catch (e) { wx.showToast({ title: e.msg || '提交失败', icon: 'none' }) }
  },
})
