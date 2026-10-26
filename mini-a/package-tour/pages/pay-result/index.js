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
  onUnload() { clearTimeout(this.timer) },
  retry() { this.setData({ tries: 0, error: '' }); this.poll() },
  poll() {
    api.getOrder(this.data.orderNo).then((o) => {
      this.setData({ status: o.status, amount: o.amountPayLabel, error: '', statusText: ({10:'订单待支付',20:'支付成功 · 出票中',30:'报名成功 · 已出票',40:'已核销',50:'行程已完成',60:'退款处理中',70:'已退款',90:'订单已关闭'})[o.status] || '正在查询订单', hasPass: [30,40,50].includes(Number(o.status)) })
      if (o.status === 10 && this.data.tries < 6) {
        this.setData({ tries: this.data.tries + 1 })
        this.timer = setTimeout(() => this.poll(), 2000)
      }
    }).catch(e => {
      this.setData({ tries: this.data.tries + 1, error: e.msg || '暂时无法获取支付结果' })
      if (this.data.tries < 6) this.timer = setTimeout(() => this.poll(), 2000)
    })
  },
  goOrders() { wx.redirectTo({ url: '/package-order/pages/orders/index' }) },
  goHome() { wx.switchTab({ url: '/pages/home/index' }) },
})
