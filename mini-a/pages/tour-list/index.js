const api = require('../../utils/api')
const siteData = require('../../utils/site')
const dict = require('../../utils/dict')
Page({
  // X-02：频道筛选走统一字典（服务端 /c/dicts 缓存 + 兜底），不再用 FALLBACK 里的第二份清单
  data: { site: siteData.DEFAULT, cats: [{ k: 'all', n: '全部' }, ...dict.catList()], active: 'all', tours: [], loading: true, icons: ['🏮', '🧘', '🫖', '🏛️', '🚩'], kw: '' },
  onShow() { const filter = wx.getStorageSync('tourFilter'); if (filter) { wx.removeStorageSync('tourFilter'); this.city = filter.city || ''; this.setData({ active: filter.cat || 'all', cityName: dict.cityText(this.city) || this.city }); this.fetch() } },
  clearCity() { this.city = ''; this.setData({ cityName: '' }); this.fetch() },
  onReady() { siteData.get().then((site) => this.setData({ site })) },
  onLoad(q) { this.city = (q && q.city) || ''; this.fetch() },
  switchCat(e) {
    const k = e.currentTarget.dataset.k
    this.setData({ active: k })
    this.fetch()
  },
  onKw(e) { this.setData({ kw: e.detail.value, emptyText: e.detail.value ? '没找到「' + e.detail.value + '」相关线路' : '该分类暂无线路' }) },
  doSearch() { this.fetch() },
  goDetail(e) { wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + e.currentTarget.dataset.id }) },
  fetch() {
    this.setData({ loading: true, error: '' })
    return api.request('/c/tours?cat=' + this.data.active + '&kw=' + encodeURIComponent(this.data.kw || '') + (this.city ? '&city=' + this.city : '')).then(list => {
      // D01：列表同源价格——priceNow 为折扣/早鸟后最低有效单价；priceText/showPromo 预计算（wxml 只做取值）
      const tours = (list || []).map(t => {
        const cover = api.coverFor(t)
        const nowFen = t.priceNow != null ? Number(t.priceNow) : Number(t.price || t.price_from)
        return { ...t, cover, sampleCover: api.isReferencePhoto(cover),
          priceText: (nowFen / 100).toFixed(2).replace(/\.?0+$/, ''),
          priceOriginalText: t.hasPromo ? (Number(t.price_from) / 100).toFixed(2).replace(/\.?0+$/, '') : '' }
      })
      this.setData({ tours, loading: false })
    }).catch(e => {
      // A-18：演示兜底仅限开发环境且常驻标识；正式版错误态 + 重试
      if (api.demoAllowed()) {
        const cat = this.data.active
        const src = (cat && cat !== 'all') ? api.FALLBACK.tours.filter(t => t.cat === cat) : api.FALLBACK.tours
        const tours = src.map(t => ({ ...t, cover: api.coverFor(t), priceText: (Number(t.price || t.price_from) / 100).toFixed(2).replace(/\.?0+$/, '') }))
        this.setData({ tours, loading: false, fallback: true, demo: true, error: '' })
        wx.showToast({ title: '演示模式（后端未连接）', icon: 'none' })
      } else {
        this.setData({ tours: [], loading: false, demo: false, error: e.msg || '加载失败，请检查网络后重试' })
      }
    })
  },
  // T-02：下拉刷新复用列表加载逻辑，加载完成后收起转圈
  onPullDownRefresh() {
    Promise.resolve(this.fetch()).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },
  // T-05：分享（标题带当前筛选主题）
  onShareAppMessage() {
    const cat = (this.data.cats || []).find((c) => c.k === this.data.active)
    const label = cat && cat.k !== 'all' && cat.n ? ' · ' + cat.n : ''
    return { title: '向往的自由 · 主题游' + label, path: '/pages/tour-list/index' }
  },
  onShareTimeline() { return { title: '向往的自由 · 主题游' } }
})
