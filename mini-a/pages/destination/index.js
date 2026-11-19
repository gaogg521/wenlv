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
      this.setData({ list: list.map(d => ({ ...d, cover: api.businessImage(d.cover, { name: d.cityName }), samplePhoto: !d.cover || api.isIllustration(d.cover) || api.isReferencePhoto(d.cover) })), loading: false })
    } catch (e) { this.setData({ loading: false }) }
  },
  goList(e) {
    const city = e.currentTarget.dataset.city
    wx.setStorageSync('tourFilter', { city, cat: 'all' })
    // 记为"当前城市"：首页轮播按城市投放时使用（后台轮播「投放城市」）
    const item = (this.data.list || []).find((x) => x.city_code === city)
    wx.setStorageSync('homeCity', { code: city, name: item ? item.cityName : '' })
    // 复用主题游列表页并带城市参数（列表页已支持 cat/kw，此处带 city 走同一筛选入口）
    wx.switchTab({ url: '/pages/tour-list/index' })
  },
  // T-02：下拉刷新复用目的地聚合加载，完成后收起转圈
  onPullDownRefresh() {
    Promise.resolve(this.fetch()).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },
  // T-05：分享（本页为城市聚合列表，无单一当前目的地，标题用页面口径）
  onShareAppMessage() { return { title: '向往的自由 · 目的地', path: '/pages/destination/index' } },
  onShareTimeline() { return { title: '向往的自由 · 目的地' } }
})
