const api = require('../../utils/api')
Page({ data: { order: null, error: '', statuses: {20:'已支付',30:'待核销',40:'已核销',50:'已完成',60:'退款中',70:'已退款',90:'已关闭'} },
  onLoad(q) { this.no = q.no; this.fetch() },
  async fetch() { try { this.setData({ order: await api.request('/m/orders/' + this.no), error: '' }) } catch(e) { this.setData({ error: e.msg || '加载失败' }) } },
  goVerify() { wx.navigateTo({ url: '/pages/verify/index' }) },
})
