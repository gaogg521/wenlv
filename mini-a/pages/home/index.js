const api = require('../../utils/api')

Page({
  data: { loading: true, tours: [], greet: '', icons: ['🏮', '🧘', '🫖', '🏛️', '🚩'], banners: [], curBanner: 0, error: '', themes: [{k:'script',n:'剧本探秘',sub:'走进故事现场',icon:'⌕'},{k:'yoga',n:'山野疗愈',sub:'把时间还给自己',icon:'◌'},{k:'family',n:'亲子时光',sub:'一起发现世界',icon:'☼'},{k:'sister',n:'好友出游',sub:'约一场好风景',icon:'✧'}] },  // 扫码/分享落地：scene=推广码 p* / 门店码 m*（官方 getUnlimitedQRCode 携带，32 字符内）
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
    this.fetch(); this.fetchBanners()
  },
  onShow() {
    this.fetch()
    // 首页可转发（分享/朋友圈入口）
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
  },
  onPullDownRefresh() { this.fetch(() => wx.stopPullDownRefresh()) },
  goTours(e) { wx.setStorageSync('tourFilter', { cat: e.currentTarget.dataset.cat || 'all', city: '' }); wx.switchTab({ url: '/pages/tour-list/index' }) },
  fetch(done) {
    if (typeof done !== 'function') done = undefined
    this.setData({ loading: true, error: '' })
    api.getTours('all').then(list => {
      // 首页「即将成团」只展示主题游线路；有实拍图用真图，无图回退渐变封面
      const tours = (list || []).filter(t => (t.cat || '') !== 'shop')
        .map(t => ({ ...t, cover: api.coverFor(t) }))
      this.setData({ tours, loading: false }, done)
    }).catch(e => this.setData({ tours: [], loading: false, error: e.msg || '暂时无法加载线路' }, done))
  },
  goDetail(e) { wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + e.currentTarget.dataset.id }) },
  goDestinations() { wx.navigateTo({ url: '/pages/destination/index' }) },
  async fetchBanners() {
    try {
      const bs = await api.request('/c/banners')
      this.setData({ banners: bs.map(b => ({ ...b, image: api.img(b.image) })), curBanner: 0 })
    } catch (e) {} // 无轮播静默
  },
  onBannerChange(e) { this.setData({ curBanner: e.detail.current }) },
  tapBanner(e) {
    const b = this.data.banners[e.currentTarget.dataset.i]
    if (b && b.link) wx.navigateTo({ url: b.link, fail: () => wx.showToast({ title: '该入口已下线', icon: 'none' }) })
  },
  onShareAppMessage() {
    return { title: '向往的自由 · 主题游·预约制', path: '/pages/home/index', imageUrl: '' }
  },
  onShareTimeline() {
    return { title: '向往的自由 · 主题游·预约制', query: '' }
  },
})
