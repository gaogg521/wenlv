const app = getApp()
const api = require('../../utils/api')
const siteData = require('../../utils/site')
const place = require('../../utils/place')
Page({
  goPromo() { wx.navigateTo({ url: '/package-promo/pages/center/index' }) },
  goCreate() { wx.navigateTo({ url: '/package-content/pages/create/index' }) },
  goIdentity() { wx.navigateTo({ url: '/package-content/pages/identity/index' }) },
  // KYC 实名认证：内联表单（两次弹窗体验差 → 展开卡填写，可粘贴可改）
  async kyc() {
    try { await api.ensureLogin() } catch { return }
    if (this.data.kycOpen) return this.setData({ kycOpen: false })
    const cur = await api.request('/c/kyc/mine').catch(() => ({ status: -1 }))
    if (cur.status === 1) return wx.showToast({ title: '已实名：' + cur.real_name, icon: 'none' })
    if (cur.status === 0) return this.setData({ kycOpen: true, kycStatus: 0, kycMask: cur.id_no_mask, kycNote: '审核中，请耐心等待' })
    this.setData({ kycOpen: true, kycStatus: cur.status === 2 ? 2 : -1, kycMask: cur.id_no_mask || '', kycNote: cur.reject_note || '' })
  },
  onKycName(e) { this.setData({ kycName: e.detail.value }) },
  onKycId(e) { this.setData({ kycId: e.detail.value }) },
  async kycSubmit() {
    const { kycName, kycId } = this.data
    if (!kycName || !kycName.trim()) return wx.showToast({ title: '请填写真实姓名', icon: 'none' })
    if (!/^[0-9Xx]{15}$|^[0-9Xx]{18}$/.test((kycId || '').trim())) return wx.showToast({ title: '身份证号 15/18 位', icon: 'none' })
    try {
      const r = await api.request('/c/kyc/submit', 'POST', { realName: kycName.trim(), idNo: kycId.trim() })
      this.setData({ kycStatus: 0, kycMask: r.masked, kycNote: '已提交，平台人工审核（可用于出行保险等场景）', kycOpen: false })
      wx.showToast({ title: '已提交审核', icon: 'success' })
    } catch (e) { wx.showToast({ title: e.msg || '提交失败', icon: 'none' }) }
  },
  goFaq() { wx.navigateTo({ url: '/pages/faq/index' }) },
  goOrders() { wx.navigateTo({ url: '/package-order/pages/orders/index' }) },
  data: { site: siteData.DEFAULT, kycOpen: false, kycStatus: -1, kycMask: '', kycNote: '', kycName: '', kycId: '', user: null, avatarUrl: '' },
  goDoc(e) { wx.navigateTo({ url: '/package-content/pages/doc/index?type=' + e.currentTarget.dataset.type }) },
  callService() { place.call(this.data.site.service_phone) },
  onShow() {
    siteData.get().then((site) => this.setData({ site }))
    this.setData({ user: app.globalData.user })
    this.loadMe()
  },
  // 等级名与升级进度来自服务端（参数中心「会员等级体系」），页面里不写死
  loadMe() {
    return api.getMe().then((m) => {
      const lv = m.level || {}
      const hint = lv.next ? '再积累 ' + Number(lv.next.gapPoints).toLocaleString() + ' 成长值升级「' + lv.next.name + '」' : '已是最高等级'
      this.setData({ avatarUrl: m.avatarUrl || '', initial: String(m.nickname || '旅').trim().slice(0, 1) || '旅', user: { nickname: m.nickname, levelName: lv.name || '探索者', levelArt: lv.art || '', levelPct: lv.pct || 0, levelHint: hint } })
    }).catch(() => {})
  },
  async login() {
    try {
      const api = require('../../utils/api')
      const d = await api.login()
      this.setData({ user: { nickname: d.user.nickname, levelName: '', levelPct: 0, levelHint: '' } })
      await this.loadMe()
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
