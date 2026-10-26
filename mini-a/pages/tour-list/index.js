const api = require('../../utils/api')
Page({
  data: { cats: api.FALLBACK.cats, active: 'all', tours: [], loading: true, icons: ['🏮', '🧘', '🫖', '🏛️', '🚩'], kw: '' },
  onShow() { const filter = wx.getStorageSync('tourFilter'); if (filter) { wx.removeStorageSync('tourFilter'); this.city = filter.city || ''; this.setData({ active: filter.cat || 'all', cityName: ({310118:'上海 · 青浦',320508:'苏州 · 姑苏',330523:'湖州 · 安吉'})[this.city] || this.city }); this.fetch() } },
  clearCity() { this.city = ''; this.setData({ cityName: '' }); this.fetch() },
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
      const tours = (list || []).map(t => ({ ...t, cover: api.coverFor(t) }))
      this.setData({ tours, loading: false })
    }).catch(e => { this.setData({ tours: [], loading: false, error: e.msg || '线路加载失败，请重试' })
    })
  }
})
