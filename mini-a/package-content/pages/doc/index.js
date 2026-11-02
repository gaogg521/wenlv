// 协议与说明页：用户协议 / 隐私政策 / 关于我们，内容来自后台「小程序装修 · 客服与协议」
const site = require('../../../utils/site')
const TITLES = { agreement: '用户协议', privacy: '隐私政策', about: '关于我们' }
const KEYS = { agreement: 'user_agreement', privacy: 'privacy_policy', about: 'about' }
Page({
  data: { html: '', title: '' },
  onLoad(q) {
    const type = TITLES[q.type] ? q.type : 'about'
    wx.setNavigationBarTitle({ title: TITLES[type] })
    site.get(true).then((s) => this.setData({ title: TITLES[type], html: s[KEYS[type]] || '' }))
  },
})
