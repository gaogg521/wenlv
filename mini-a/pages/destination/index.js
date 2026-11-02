// 目的地城市聚合页（P2）：城市维度聚合在架产品
const api = require('../../utils/api')
const siteData = require('../../utils/site')
Page({
  data: { caption: siteData.DEFAULT.dest_caption, list: [], loading: true },
  onShow() { this.fetch() },
  onReady() { siteData.get().then((s) => this.setData({ caption: s.dest_caption || siteData.DEFAULT.dest_caption })) },
  async fetch() {
    try {
      const list = await api.request('/c/destinations')
      this.setData({ list, loading: false })
    } catch (e) { this.setData({ loading: false }) }
  },
  goList(e) {
    const city = e.currentTarget.dataset.city
    wx.setStorageSync('tourFilter', { city, cat: 'all' })
    // 复用主题游列表页并带城市参数（列表页已支持 cat/kw，此处带 city 走同一筛选入口）
    wx.switchTab({ url: '/pages/tour-list/index' })
  },
})
