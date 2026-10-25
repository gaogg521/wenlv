const api = require('../../utils/api')
Page({
  data: { cats: api.FALLBACK.cats, active: 'all', tours: [], loading: true, icons: ['🏮', '🧘', '🫖', '🏛️', '🚩'], kw: '' },
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
    this.setData({ loading: true })
    api.request('/c/tours?cat=' + this.data.active + '&kw=' + encodeURIComponent(this.data.kw || '') + (this.city ? '&city=' + this.city : '')).then(list => {
      const tours = (list || []).map(t => ({ ...t, cover: t.images && t.images.length ? api.img(t.images[0]) : '' }))
      this.setData({ tours, loading: false })
    }).catch(() => {
      const fb = (api.FALLBACK.tours || []).filter((t) => this.data.active === 'all' || t.cat === this.data.active)
      this.setData({ tours: fb, loading: false })
    })
  }
})
