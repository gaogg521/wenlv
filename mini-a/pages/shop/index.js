const api = require('../../utils/api')
const siteData = require('../../utils/site')
Page({
  data: { site: siteData.DEFAULT, items: [], fromApi: false, icons: ['🎨', '🍵', '🍙'] },
  retry() { this.onLoad() },
  onReady() { siteData.get().then((site) => this.setData({ site })) },
  onShow() { if (this.data.error) this.retry() }, // A-18：失败后回到本页自动重试
  onLoad() {
    this.setData({ loading: true, error: '' })
    api.getTours('shop').then((items) => {
      // D01：商城同样使用列表同源注价（priceNow 已含早鸟/折扣，无优惠时等于原价）
      this.setData({ items: (items || []).map(t => { const cover = api.coverFor(t); const price = t.priceNow != null ? Number(t.priceNow) : Number(t.price || t.price_from); return { ...t, price, priceText: (price / 100).toFixed(2).replace(/\.?0+$/, ''), cover, sampleCover: api.isReferencePhoto(cover) } }), fromApi: true, loading: false })
    }).catch(e => {
      // A-18：演示兜底仅限开发环境且常驻标识；正式版错误态 + 重试
      if (api.demoAllowed()) {
        const items = api.FALLBACK.shop.map(t => ({ ...t, cover: api.coverFor(t), priceText: (Number(t.price != null ? t.price : t.price_from || 0) / 100).toFixed(2).replace(/\.?0+$/, '') }))
        this.setData({ items, fromApi: false, loading: false, fallback: true, demo: true, error: '' })
        wx.showToast({ title: '演示模式（后端未连接）', icon: 'none' })
      } else {
        this.setData({ items: [], fromApi: false, loading: false, demo: false, error: e.msg || '加载失败，请检查网络后重试' })
      }
    })
  },
  buy(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + id })
  }
})
