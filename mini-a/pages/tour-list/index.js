const api = require('../../utils/api')
const siteData = require('../../utils/site')
Page({
  data: { site: siteData.DEFAULT, cats: api.FALLBACK.cats, active: 'all', tours: [], loading: true, icons: ['🏮', '🧘', '🫖', '🏛️', '🚩'], kw: '' },
  onShow() { const filter = wx.getStorageSync('tourFilter'); if (filter) { wx.removeStorageSync('tourFilter'); this.city = filter.city || ''; this.setData({ active: filter.cat || 'all', cityName: ({310118:'上海 · 青浦',320508:'苏州 · 姑苏',330523:'湖州 · 安吉'})[this.city] || this.city }); this.fetch() } },
  clearCity() { this.city = ''; this.setData({ cityName: '' }); this.fetch() },
  onReady() { siteData.get().then((site) => this.setData({ site })) },
  onLoad(q) { this.city = (q && q.city) || ''; this.fetch() },
  switchCat(e) {
    const k = e.currentTarget.dataset.k
    this.setData({ active: k })
    this.fetch()
  },
  onKw(e) { this.setData({ kw: e.detail.value }) },
  doSearch() { this.fetch() },
  goDetail(e) { wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + e.currentTarget.dataset.id }) },
  fetch() {
    this.setData({ loading: true, error: '' })
    api.request('/c/tours?cat=' + this.data.active + '&kw=' + encodeURIComponent(this.data.kw || '') + (this.city ? '&city=' + this.city : '')).then(list => {
      const tours = (list || []).map(t => { const cover = api.coverFor(t); return { ...t, cover, sampleCover: api.isReferencePhoto(cover) } })
      this.setData({ tours, loading: false })
    }).catch(e => {
      // A-18：演示兜底仅限开发环境且常驻标识；正式版错误态 + 重试
      if (api.demoAllowed()) {
        const cat = this.data.active
        const src = (cat && cat !== 'all') ? api.FALLBACK.tours.filter(t => t.cat === cat) : api.FALLBACK.tours
        const tours = src.map(t => ({ ...t, cover: api.coverFor(t) }))
        this.setData({ tours, loading: false, fallback: true, demo: true, error: '' })
        wx.showToast({ title: '演示模式（后端未连接）', icon: 'none' })
      } else {
        this.setData({ tours: [], loading: false, demo: false, error: e.msg || '加载失败，请检查网络后重试' })
      }
    })
  }
})
