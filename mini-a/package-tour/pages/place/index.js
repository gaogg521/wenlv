// 履约商户 / 合作景区 资料页：内容来自后台资料编辑器（服务端只下发公开字段）
const api = require('../../../utils/api')
const place = require('../../../utils/place')
Page({
  data: { d: null, error: '', gIdx: 0, placeNotes: [], notesEmpty: false },
  onLoad(q) { this.kind = q.kind === 'scenic' ? 'scenic' : 'merchant'; this.id = q.id; this.load() },
  load() {
    this.setData({ error: '' })
    api.request(`/c/places/${this.kind}/${this.id}`).then((d) => {
      const gallery = ((this.kind === 'merchant' ? d.storefront : d.gallery) || []).filter(u => !api.isIllustration(u))
      const cover = this.kind === 'merchant' ? d.logo : d.cover
      wx.setNavigationBarTitle({ title: d.short_name || d.name || (this.kind === 'scenic' ? '景区' : '商户') })
      this.setData({ d: {
        ...d, kind: this.kind, gallery: gallery.length ? gallery : [api.businessImage(cover, d)], samplePhoto: gallery.length ? gallery.every(api.isReferencePhoto) : !cover || api.isIllustration(cover) || api.isReferencePhoto(cover),
        facilityText: (d.facilities || []).map((f) => place.FACILITY[f]).filter(Boolean),
        aliasText: (d.alias || []).join(' / '),
        tours: (d.tours || []).map((t) => ({ ...t, cover: api.coverFor(t) })),
      } })
      if (this.kind === 'scenic') this.fetchNotes()
    }).catch((e) => this.setData({ error: e.msg || '加载失败' }))
  },
  // A2：景区详情直接展示 2–3 条公开笔记（独立加载——feed 失败不影响资料主体）；卡片进详情，更多进聚合页
  fetchNotes() {
    api.request('/c/notes/feed?scenic=' + this.id + '&pageSize=3').then((d) => {
      const placeNotes = (d.items || []).slice(0, 3).map((x) => ({
        id: x.id, title: x.title || '无标题笔记', cover: x.cover || '', video: !!x.hasVideo,
        place: x.scenicName || '', excerpt: x.excerpt || (x.title || '').slice(0, 30),
      }))
      this.setData({ placeNotes, notesEmpty: !placeNotes.length })
    }).catch(() => this.setData({ placeNotes: [], notesEmpty: true }))
  },
  goNote(e) { wx.navigateTo({ url: '/package-content/pages/note/index?id=' + e.currentTarget.dataset.id }) },
  onSwiper(e) { this.setData({ gIdx: e.detail.current }) },
  preview(e) { wx.previewImage({ urls: this.data.d.gallery, current: this.data.d.gallery[Number(e.currentTarget.dataset.i)] }) },
  nav() { const d = this.data.d; place.openGeo(d.geo, d.short_name || d.name, d.address) },
  call() { place.call(this.data.d.service_phone) },
  goTour(e) { wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + e.currentTarget.dataset.id }) },
  // 三期收尾：景区详情 → 该景区的话题聚合（feed ?scenic=）
  goScenicNotes() {
    if (this.kind !== 'scenic') return
    wx.navigateTo({ url: '/package-content/pages/square/index?scenic=' + this.id + '&scenicName=' + encodeURIComponent(this.data.d.short_name || this.data.d.name || '') })
  },
})
