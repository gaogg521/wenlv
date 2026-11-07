// 协议与说明页：用户协议 / 隐私政策 / 关于我们，内容来自后台「小程序装修 · 客服与协议」
const site = require('../../../utils/site')
const photoCredits = require('../../../utils/photo-credits')
const TITLES = { agreement: '用户协议', privacy: '隐私政策', about: '关于我们', credits: '图片来源与许可' }
const KEYS = { agreement: 'user_agreement', privacy: 'privacy_policy', about: 'about' }
Page({
  data: { html: '', title: '', credits: null, showCredits: false },
  onLoad(q) {
    const type = TITLES[q.type] ? q.type : 'about'
    wx.setNavigationBarTitle({ title: TITLES[type] })
    this.setData({ showCredits: type === 'about' })
    if (type === 'credits') return this.setData({ title: TITLES[type], credits: photoCredits })
    site.get(true).then((s) => this.setData({ title: TITLES[type], html: s[KEYS[type]] || '' }))
  },
  goCredits() { wx.navigateTo({ url: '/package-content/pages/doc/index?type=credits' }) },
})
