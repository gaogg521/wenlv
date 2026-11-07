const api = require('../../utils/api')
const siteData = require('../../utils/site')
const TAB_PAGES = ['home', 'tour-list', 'shop', 'bean', 'me'].map(p => '/pages/' + p + '/index')

Page({
  data: { site: siteData.DEFAULT, loading: true, tours: [], greet: '', icons: ['🏮', '🧘', '🫖', '🏛️', '🚩'], banners: [], curBanner: 0, error: '', themes: [{k:'script',n:'剧本探秘',sub:'走进故事现场',icon:'⌕'},{k:'yoga',n:'山野疗愈',sub:'把时间还给自己',icon:'◌'},{k:'family',n:'亲子时光',sub:'一起发现世界',icon:'☼'},{k:'sister',n:'好友出游',sub:'约一场好风景',icon:'✧'}] },  // 扫码/分享落地：scene=推广码 p* / 门店码 m*（官方 getUnlimitedQRCode 携带，32 字符内）
  onLoad(q) {
    const h = new Date().getHours()
    this.setData({ greet: h < 11 ? '早上好' : h < 18 ? '下午好' : '晚上好', themeEntries: siteData.DEFAULT.themes.map(t => ({ ...t, cover: api.coverFor(t) })) })
    if (q && q.scene) {
      const scene = decodeURIComponent(q.scene)
      if (/^[pm][0-9a-z-]+$/i.test(scene)) {
        wx.setStorageSync('promoScene', scene)
        wx.showToast({ title: '专属邀请已生效', icon: 'none' })
      }
    }
    this.fetchBanners()
    siteData.get().then((site) => this.setData({ site, themeEntries: site.themes.map(t => ({ ...t, cover: api.coverFor(t) })) }))
  },
  onShow() {
    this.checkConsent() // A-44：首次使用同意流程
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
  checkConsent() {
    // A-44：首次使用同意流程——未授权隐私政策时弹窗（同意/拒绝），拒绝不阻断浏览但下单会被服务端拦
    api.request('/c/consent').then((d) => {
      this._privacyV = (d.versions && d.versions.privacy) || 'v1'
      const privacy = (d.items || []).find((x) => x.scene === 'privacy')
      if (privacy && privacy.granted && privacy.version === this._privacyV) return
      if (wx.getStorageSync('consentDeclined') === this._privacyV) return
      wx.showModal({
        title: '隐私政策与服务条款',
        content: '使用本小程序需同意《用户服务条款》与《隐私政策》。我们仅收集订单与出行必需的信息。',
        confirmText: '同意并继续',
        cancelText: '不同意',
        success: (r) => {
          if (r.confirm) {
            api.request('/c/consent', 'POST', { scene: 'privacy', granted: true, version: d.versions.privacy }).catch(() => {})
            api.request('/c/consent', 'POST', { scene: 'terms', granted: true, version: d.versions.terms }).catch(() => {})
          } else {
            wx.setStorageSync('consentDeclined', this._privacyV || 'v1')
            wx.showToast({ title: '未同意隐私政策，下单等功能将受限', icon: 'none', duration: 3000 })
          }
        },
      })
    }).catch(() => {})
  },
  fetch(done) {
    if (typeof done !== 'function') done = undefined
    this.lastFetch = Date.now()
    if (!this.data.tours.length) this.setData({ loading: true, error: '' })
    api.getTours('all').then(list => {
      // 首页「即将成团」只展示主题游线路；有实拍图用真图，无图回退渐变封面
      const tours = (list || []).filter(t => (t.cat || '') !== 'shop')
        .map(t => { const cover = api.coverFor(t); return { ...t, cover, sampleCover: api.isReferencePhoto(cover) } })
      this.setData({ tours, loading: false }, done)
    }).catch(e => {
      // A-18：假数据仅限开发环境（envVersion=develop），且页面常驻"演示模式"标识；
      // 体验版/正式版一律错误态 + 重试，绝不把假线路当真数据展示
      if (api.demoAllowed()) {
        const tours = api.FALLBACK.tours.map(t => ({ ...t, cover: api.coverFor(t) }))
        this.setData({ tours, loading: false, fallback: true, demo: true, error: '' }, done)
        wx.showToast({ title: '演示模式（后端未连接）', icon: 'none' })
      } else {
        this.setData({ tours: [], loading: false, demo: false, error: e.msg || '加载失败，请检查网络后重试' }, done)
      }
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
      this.setData({ banners: bs.map(b => ({ ...b, image: api.businessImage(b.image, b), samplePhoto: !b.image || api.isIllustration(b.image) || api.isReferencePhoto(b.image) })), curBanner: 0 })
    } catch (e) {} // 无轮播静默
  },
  onBannerChange(e) { this.setData({ curBanner: e.detail.current }) },
  tapBanner(e) {
    const b = this.data.banners[e.currentTarget.dataset.i]
    if (b && b.link) {
      const target = b.link.split('?')[0]
      if (TAB_PAGES.includes(target)) wx.switchTab({ url: target })
      else wx.navigateTo({ url: b.link, fail: () => wx.showToast({ title: '该入口已下线', icon: 'none' }) })
    }
  },
  onShareAppMessage() {
    const s = this.data.site || {}
    return { title: s.share_title || s.brand_name || '向往的自由', path: '/pages/home/index', imageUrl: s.share_image || '' }
  },
  onShareTimeline() {
    return { title: (this.data.site || {}).share_title || '向往的自由', query: '' }
  },
})
