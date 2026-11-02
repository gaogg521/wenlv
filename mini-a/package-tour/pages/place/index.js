// 履约商户 / 合作景区 资料页：内容来自后台资料编辑器（服务端只下发公开字段）
const api = require('../../../utils/api')
const place = require('../../../utils/place')
Page({
  data: { d: null, error: '', gIdx: 0 },
  onLoad(q) { this.kind = q.kind === 'scenic' ? 'scenic' : 'merchant'; this.id = q.id; this.load() },
  load() {
    this.setData({ error: '' })
    api.request(`/c/places/${this.kind}/${this.id}`).then((d) => {
      const gallery = (this.kind === 'merchant' ? d.storefront : d.gallery) || []
      const cover = this.kind === 'merchant' ? d.logo : d.cover
      wx.setNavigationBarTitle({ title: d.short_name || d.name || (this.kind === 'scenic' ? '景区' : '商户') })
      this.setData({ d: {
        ...d, kind: this.kind, gallery: gallery.length ? gallery : (cover ? [cover] : []),
        facilityText: (d.facilities || []).map((f) => place.FACILITY[f]).filter(Boolean),
        aliasText: (d.alias || []).join(' / '),
        tours: (d.tours || []).map((t) => ({ ...t, cover: api.coverFor(t) })),
      } })
    }).catch((e) => this.setData({ error: e.msg || '加载失败' }))
  },
  onSwiper(e) { this.setData({ gIdx: e.detail.current }) },
  preview(e) { wx.previewImage({ urls: this.data.d.gallery, current: this.data.d.gallery[Number(e.currentTarget.dataset.i)] }) },
  nav() { const d = this.data.d; place.openGeo(d.geo, d.short_name || d.name, d.address) },
  call() { place.call(this.data.d.service_phone) },
  goTour(e) { wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + e.currentTarget.dataset.id }) },
})
