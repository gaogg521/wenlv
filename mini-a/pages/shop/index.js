const api = require('../../utils/api')
Page({
  data: { items: api.FALLBACK.shop, fromApi: false, icons: ['🎨', '🍵', '🍙'] },
  onLoad() {
    api.getTours('shop').then((items) => {
      if (items && items.length) this.setData({ items, fromApi: true })
    }).catch(() => {})
  },
  buy(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + id })
  }
})
