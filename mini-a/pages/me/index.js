const app = getApp()
Page({
  goPromo() { wx.navigateTo({ url: '/package-promo/pages/center/index' }) },
  goCreate() { wx.navigateTo({ url: '/package-content/pages/create/index' }) },
  goIdentity() { wx.navigateTo({ url: '/package-content/pages/identity/index' }) },
  goOrders() { wx.navigateTo({ url: '/package-order/pages/orders/index' }) },
  data: { user: null, avatarUrl: '' },
  onShow() {
    this.setData({ user: app.globalData.user })
    const api = require('../../utils/api')
    api.getMe().then((m) => this.setData({ avatarUrl: m.avatarUrl || '', user: { nickname: m.nickname, levelName: ['探索者', '旅行家', '城市探索官', '环球探索家'][m.memberLevel - 1] || '探索者' } })).catch(() => {})
  },
  async login() {
    try {
      const api = require('../../utils/api')
      const d = await api.login()
      const lv = ['探索者', '旅行家', '城市探索官', '环球探索家'][d.user.memberLevel - 1] || '探索者'
      this.setData({ user: { nickname: d.user.nickname, levelName: lv } })
    } catch (e) { wx.showToast({ title: e.msg || '登录失败（后端未启动时可用演示模式浏览）', icon: 'none' }) }
  },
  // 官方头像填写能力：chooseAvatar 临时文件 → base64 上传 → 服务端存 /uploads
  onChooseAvatar(e) {
    const tp = e.detail && e.detail.avatarUrl
    if (!tp) return
    try {
      const b64 = wx.getFileSystemManager().readFileSync(tp, 'base64')
      const api = require('../../utils/api')
      api.request('/c/upload/avatar', 'POST', { data: b64, ext: 'png' }).then((r) => {
        this.setData({ avatarUrl: r.url })
        api.request('/c/me/profile', 'POST', { avatarUrl: r.url }).catch(() => {})
        wx.showToast({ title: '头像已更新' })
      }).catch(() => wx.showToast({ title: '上传失败', icon: 'none' }))
    } catch (e2) { wx.showToast({ title: '读取头像失败', icon: 'none' }) }
  },
  // 官方昵称填写能力：type=nickname 键盘带微信昵称；服务端过机审
  async onNickname(e) {
    const nickname = (e.detail.value || '').trim()
    if (!nickname) return
    const api = require('../../utils/api')
    try {
      const r = await api.request('/c/me/profile', 'POST', { nickname })
      this.setData({ user: { ...this.data.user, nickname: r.nickname } })
      wx.showToast({ title: '昵称已更新' })
    } catch (err) { wx.showToast({ title: err.msg || '昵称未通过校验', icon: 'none' }) }
  },
  // 隐私协议：官方 wx.openPrivacyContract（平台已配置《用户隐私保护指引》后可用）
  showPrivacy() {
    if (wx.openPrivacyContract) {
      wx.openPrivacyContract({ fail: () => wx.showToast({ title: '隐私协议待平台配置', icon: 'none' }) })
    } else {
      wx.showModal({ title: '设置与隐私', content: '我们仅收集提供服务所必需的信息，详见《用户隐私保护指引》（上线前在公众平台配置）。', showCancel: false })
    }
  },
})
