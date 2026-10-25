const api = require('../../utils/api')

Page({
  data: { loading: true, tours: [], greet: '', icons: ['🏮', '🧘', '🫖', '🏛️', '🚩'] },  // 扫码/分享落地：scene=推广码 p* / 门店码 m*（官方 getUnlimitedQRCode 携带，32 字符内）
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
    this.fetch()
  },
  onShow() {
    // 首页可转发（分享/朋友圈入口）
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
  },
  onPullDownRefresh() { this.fetch(() => wx.stopPullDownRefresh()) },
  fetch(done) {
    api.getTours('all').then(list => {
      // 首页「即将成团」只展示主题游线路；有实拍图用真图，无图回退渐变封面
      const tours = (list || []).filter(t => (t.cat || '') !== 'shop')
        .map(t => ({ ...t, cover: t.images && t.images.length ? api.img(t.images[0]) : '' }))
      this.setData({ tours, loading: false }, done)
    })
  },
  goDetail(e) { wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + e.currentTarget.dataset.id }) },
  onShareAppMessage() {
    return { title: '向往的自由 · 主题游·预约制', path: '/pages/home/index', imageUrl: '' }
  },
  onShareTimeline() {
    return { title: '向往的自由 · 主题游·预约制', query: '' }
  },
})
