const api = require('../../utils/api')
Page({
  data: { items: [], fromApi: false, icons: ['🎨', '🍵', '🍙'] },
  retry() { this.onLoad() },
  onLoad() {
    this.setData({ loading: true, error: '' })
    api.getTours('shop').then((items) => {
      this.setData({ items: (items || []).map(t => ({ ...t, price: t.price || t.price_from, cover: api.coverFor(t) })), fromApi: true, loading: false })
    }).catch(e => this.setData({ loading: false, error: e.msg || '暂时无法加载商品' }))
  },
  buy(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + id })
  }
})
