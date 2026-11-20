const api = require('../../utils/api')
const siteData = require('../../utils/site')
Page({
  data: { site: siteData.DEFAULT, items: [], fromApi: false, icons: ['🎨', '🍵', '🍙'] },
  retry() { this.loadItems() },
  onReady() {
    siteData.get().then(site => this.setData({
      site,
      shopCaption: site.shop_caption === siteData.DEFAULT.shop_caption ? '' : site.shop_caption,
      shopNote: site.shop_note === siteData.DEFAULT.shop_note ? '' : site.shop_note,
    }))
  },
  onShow() { this.loadItems() },
  loadItems() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    return api.getTours('shop').then((items) => {
      // D01：商城同样使用列表同源注价（priceNow 已含早鸟/折扣，无优惠时等于原价）
      this.setData({ items: (items || []).map(t => {
        const cover = api.coverFor(t)
        const price = Number(t.priceNow ?? t.price ?? t.price_from)
        const direct = t.stock != null
        const available = direct && Number(t.stock) > 0
        return { ...t, direct, available, cover, sampleCover: api.isReferencePhoto(cover),
          priceText: (price / 100).toFixed(2).replace(/\.?0+$/, ''),
          stateLabel: direct ? (available ? '有库存' : '已售罄') : '到店预约',
          buyLabel: direct ? (available ? '立即购买' : '查看商品') : '查看时段' }
      }), fromApi: true, demo: false, loading: false })
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
  },
  // T-02：下拉刷新复用商品加载逻辑，加载完成后收起转圈
  onPullDownRefresh() {
    Promise.resolve(this.loadItems()).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },
  // T-05：分享
  onShareAppMessage() { return { title: '向往的自由 · 心意好物', path: '/pages/shop/index' } },
  onShareTimeline() { return { title: '向往的自由 · 心意好物' } }
})
