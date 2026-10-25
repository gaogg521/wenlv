// 目的地城市聚合页（P2）：城市维度聚合在架产品
const api = require('../../utils/api')
Page({
  data: { list: [], loading: true },
  onShow() { this.fetch() },
  async fetch() {
    try {
      const list = await api.request('/c/destinations')
      this.setData({ list, loading: false })
    } catch (e) { this.setData({ loading: false }) }
  },
  goList(e) {
    const city = e.currentTarget.dataset.city
    this.setData({})
    // 复用主题游列表页并带城市参数（列表页已支持 cat/kw，此处带 city 走同一筛选入口）
    wx.navigateTo({ url: '/pages/tour-list/index?city=' + city })
  },
})
