const api = require('../../../utils/api')
Page({
  data: { orderNo: '', status: 0, amount: '', mock: false, tries: 0 },
  onLoad(q) {
    this.setData({ orderNo: q.orderNo, mock: q.mock === '1' })
    this.poll()
    this.askSubscribe()
  },
  // 官方订阅消息：出票后可收到「支付成功/出票通知」；未配置模板则跳过
  async askSubscribe() {
    try {
      const t = await api.getNotifyTemplates()
      if (!t.payOk) return
      wx.requestSubscribeMessage({ tmplIds: [t.payOk], fail: () => {} })
    } catch (e) { /* 静默：订阅是增强能力 */ }
  },
  poll() {
    api.getOrder(this.data.orderNo).then((o) => {
      this.setData({ status: o.status, amount: o.amountPayLabel })
      if (o.status === 10 && this.data.tries < 6) {
        this.setData({ tries: this.data.tries + 1 })
        setTimeout(() => this.poll(), 2000)
      }
    }).catch(() => this.setData({ tries: this.data.tries + 1 }))
  },
  goOrders() { wx.redirectTo({ url: '/package-order/pages/orders/index' }) },
  goHome() { wx.switchTab({ url: '/pages/home/index' }) },
})
