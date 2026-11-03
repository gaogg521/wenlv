const api = require('../../utils/api')
const siteData = require('../../utils/site')

Page({
  data: { site: siteData.DEFAULT, loading: true, tours: [], greet: '', icons: ['🏮', '🧘', '🫖', '🏛️', '🚩'], banners: [], curBanner: 0, error: '', themes: [{k:'script',n:'剧本探秘',sub:'走进故事现场',icon:'⌕'},{k:'yoga',n:'山野疗愈',sub:'把时间还给自己',icon:'◌'},{k:'family',n:'亲子时光',sub:'一起发现世界',icon:'☼'},{k:'sister',n:'好友出游',sub:'约一场好风景',icon:'✧'}] },  // 扫码/分享落地：scene=推广码 p* / 门店码 m*（官方 getUnlimitedQRCode 携带，32 字符内）
  onLoad(q) {
    const h = new Date().getHours()
    this.setData({ greet: h < 11 ? '早上好' : h < 18 ? '下午好' : '晚上好' })
    if (q && q.scene) {
      const scene = decodeURIComponent(q.scene)
      if (/^[pm][0-9a-z-]+$/i.test(scene)) {
        wx.setStorageSync('promoScene', scene)
        wx.showToast({ title: '专属邀请已生效', icon: 'none' })
      }
    }
    this.fetchBanners()
    siteData.get().then((site) => this.setData({ site }))
  },
  onShow() {
    // 首次进入 onLoad→onShow 只请求一次；从其他页返回时，超过 60 秒才刷新，避免来回切 tab 反复请求
    if (!this.lastFetch || Date.now() - this.lastFetch > 60000) this.fetch()
    // 从目的地页选了新城市回来：按新城市刷新轮播
    const hc = wx.getStorageSync('homeCity') || null
    if (this.bannerCity !== undefined && (hc ? hc.code : '') !== this.bannerCity) this.fetchBanners()
    // 首页可转发（分享/朋友圈入口）
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
  },
  onPullDownRefresh() { this.fetch(() => wx.stopPullDownRefresh()) },
  goTours(e) { wx.setStorageSync('tourFilter', { cat: e.currentTarget.dataset.cat || 'all', city: '' }); wx.switchTab({ url: '/pages/tour-list/index' }) },
  fetch(done) {
    if (typeof done !== 'function') done = undefined
    this.lastFetch = Date.now()
    if (!this.data.tours.length) this.setData({ loading: true, error: '' })
    api.getTours('all').then(list => {
      // 首页「即将成团」只展示主题游线路；有实拍图用真图，无图回退渐变封面
      const tours = (list || []).filter(t => (t.cat || '') !== 'shop')
        .map(t => ({ ...t, cover: api.coverFor(t) }))
      this.setData({ tours, loading: false }, done)
    }).catch(e => {
      // 后端不可达（真机演示常见）：回退内置演示线路，页面照常可用
      const tours = api.FALLBACK.tours.map(t => ({ ...t, cover: api.coverFor(t) }))
      this.setData({ tours, loading: false, fallback: true }, done)
      wx.showToast({ title: '演示模式（后端未连接）', icon: 'none' })
    })
  },
  goDetail(e) { wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + e.currentTarget.dataset.id }) },
  goDestinations() { wx.navigateTo({ url: '/pages/destination/index' }) },
  async fetchBanners() {
    try {
      // 按当前城市取轮播：后台「轮播管理 · 投放城市」限定了城市的，只在对应城市展示；未限定的全部展示
      const hc = wx.getStorageSync('homeCity') || null
      this.bannerCity = hc ? hc.code : ''
      this.setData({ homeCity: hc })
      const bs = await api.request('/c/banners' + (hc && hc.code ? '?city=' + hc.code : ''))
      this.setData({ banners: bs.map(b => ({ ...b, image: api.img(b.image) })), curBanner: 0 })
    } catch (e) {} // 无轮播静默
  },
  onBannerChange(e) { this.setData({ curBanner: e.detail.current }) },
  tapBanner(e) {
    const b = this.data.banners[e.currentTarget.dataset.i]
    if (b && b.link) wx.navigateTo({ url: b.link, fail: () => wx.showToast({ title: '该入口已下线', icon: 'none' }) })
  },
  onShareAppMessage() {
    const s = this.data.site || {}
    return { title: s.share_title || s.brand_name || '向往的自由', path: '/pages/home/index', imageUrl: s.share_image || '' }
  },
  onShareTimeline() {
    return { title: (this.data.site || {}).share_title || '向往的自由', query: '' }
  },
})
