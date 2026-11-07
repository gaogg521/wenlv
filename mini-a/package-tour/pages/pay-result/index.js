const api = require('../../../utils/api')
Page({
  data: { orderNo: '', status: 0, amount: '', mock: false, tries: 0 },
  onLoad(q) {
    this.setData({ orderNo: q.orderNo, mock: q.mock === '1' })
    this.loadSubscribeTemplates()
    this.poll()
  },
  // 官方订阅消息：出票后可收到「支付成功/出票通知」；未配置模板则跳过
  async loadSubscribeTemplates() {
    try {
      const t = await api.getNotifyTemplates()
      this.subscribeIds = Array.from(new Set([t.payOk, t.groupCancel].filter(Boolean)))
    } catch (e) { this.subscribeIds = null }
  },
  askSubscribe() {
    // 模板在加载阶段预取；点击调用栈中直接调微信，保留真实用户手势。
    const ids = this.subscribeIds
    if (!ids) return wx.showToast({ title: '通知设置暂未就绪，请稍后重试', icon: 'none' })
    if (!ids.length) return wx.showToast({ title: '出行通知尚未开通', icon: 'none' })
    wx.requestSubscribeMessage({ tmplIds: ids, complete: (r) => {
      const ok = ids.some((id) => r[id] === 'accept')
      wx.showToast({ title: ok ? '已订阅出行通知' : '未订阅', icon: ok ? 'success' : 'none' })
    } })
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
  goPay() { wx.redirectTo({ url: '/package-order/pages/order-detail/index?no=' + this.data.orderNo }) }, // A-37：待支付结果页可继续支付
  goOrders() { wx.redirectTo({ url: '/package-order/pages/orders/index' }) },
  goHome() { wx.switchTab({ url: '/pages/home/index' }) },
})
