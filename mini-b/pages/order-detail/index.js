const api = require('../../utils/api')
Page({
  // X-01：状态文案由服务端字典下发（order.statusText），页面不再自建状态表
  data: { order: null, error: '' },
  onLoad(q) { this.no = q.no; this.fetch() },
  async fetch() {
    try {
      const order = await api.request('/m/orders/' + this.no)
      const cash = '¥' + (Number(order.amount_pay) / 100).toFixed(2)
      const subsidy = '¥' + (Number(order.freedom_subsidy || 0) / 100).toFixed(2)
      const state = { locked: '（待支付）', released: '（已释放）', refunded: '（已冲回）' }
      order.amountText = order.rebook ? '¥0（免费改签单 · 改签成本由本店承担）' : order.paid_at ? cash : '¥0'
      order.subsidyText = subsidy + (state[order.freedom_status] || '')
      this.setData({ order, error: '' })
    } catch (e) {
      this.setData({ error: e.msg || '加载失败' })
    }
  },
  goVerify() { wx.navigateTo({ url: '/pages/verify/index' }) },
})
