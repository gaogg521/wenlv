const api = require('../../utils/api')
const siteData = require('../../utils/site')
Page({
  data: { site: siteData.DEFAULT, items: [], fromApi: false, icons: ['🎨', '🍵', '🍙'] },
  retry() { this.onLoad() },
  onReady() { siteData.get().then((site) => this.setData({ site })) },
  onLoad() {
    this.setData({ loading: true, error: '' })
    api.getTours('shop').then((items) => {
      this.setData({ items: (items || []).map(t => ({ ...t, price: t.price || t.price_from, cover: api.coverFor(t) })), fromApi: true, loading: false })
    }).catch(e => {
      // 演示兜底：内置演示商品
      const items = api.FALLBACK.shop.map(t => ({ ...t, cover: api.coverFor(t) }))
      this.setData({ items, fromApi: false, loading: false, fallback: true })
      wx.showToast({ title: '演示模式（后端未连接）', icon: 'none' })
    })
  },
  buy(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + id })
  }
})
