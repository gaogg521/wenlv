const api = require('../../../utils/api')
Page({
  data: { d: null, loadTxt: '加载中…' },
  onShow() { this.fetch() },
  async fetch() {
    try {
      await api.ensureLogin()
      this.setData({ d: await api.request('/c/identity'), loadTxt: '' })
    } catch (e) { this.setData({ loadTxt: '后端未连接（演示模式）' }) }
  },
})
