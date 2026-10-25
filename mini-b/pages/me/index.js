const api = require('../../utils/api')
const app = getApp()
Page({
  data: { merchant: null, role: 0, midInput: '', inviteCode: '', inviteInput: '', applyName: '', applyContact: '', applyMobile: '' },
  onShow() {
    this.setData({ merchant: app.globalData.merchant || wx.getStorageSync('merchant') || null, role: app.globalData.role })
    if (this.data.merchant && this.data.role >= 2) this.fetchInvite()
  },
  async fetchInvite() {
    try {
      const r = await api.request('/m/invite')
      this.setData({ inviteCode: r.inviteCode, staff: r.staff })
    } catch (e) {}
  },
  copyInvite() {
    if (!this.data.inviteCode) return
    wx.setClipboardData({ data: this.data.inviteCode })
  },
  onInvite(e) { this.setData({ inviteInput: e.detail.value }) },
  async joinByInvite() {
    const code = String(this.data.inviteInput || '').trim()
    if (!code) return wx.showToast({ title: '输入老板给你的邀请码', icon: 'none' })
    try {
      const r = await api.request('/m/auth/join', 'POST', { inviteCode: code })
      const m = await api.request('/m/workbench').catch(() => null)
      // join 成功后用门店 ID 正常登录拿完整会话
      await api.login(r.merchantId)
      this.setData({ merchant: wx.getStorageSync('merchant') || app.globalData.merchant, role: 1 })
      wx.showToast({ title: '已加入 ' + (m && m.merchant ? m.merchant.name : '门店') })
      this.fetchInvite()
    } catch (e) { wx.showToast({ title: e.msg || '加入失败', icon: 'none' }) }
  },
  onApplyName(e) { this.setData({ applyName: e.detail.value }) },
  onApplyContact(e) { this.setData({ applyContact: e.detail.value }) },
  onApplyMobile(e) { this.setData({ applyMobile: e.detail.value }) },
  async applyMerchant() {
    const { applyName, applyContact, applyMobile } = this.data
    if (!applyName || !applyContact || !applyMobile) return wx.showToast({ title: '门店名/联系人/电话必填', icon: 'none' })
    try {
      const r = await api.request('/m/apply', 'POST', { name: applyName, contact: applyContact, mobile: applyMobile })
      wx.showModal({ title: '申请已提交', content: '编号 ' + r.merchantNo + '，平台审核通过后凭邀请码加入门店', showCancel: false })
      this.setData({ applyName: '', applyContact: '', applyMobile: '' })
    } catch (e) { wx.showToast({ title: e.msg || '提交失败', icon: 'none' }) }
  },
  onMid(e) { this.setData({ midInput: e.detail.value }) },
  doLogin() {
    const mid = Number(this.data.midInput)
    if (!mid) return wx.showToast({ title: '输入门店 ID（联调：见后台商户列表）', icon: 'none' })
    api.login(mid).then((d) => { this.setData({ merchant: d.merchant, role: d.role }); wx.showToast({ title: '已绑定 ' + d.merchant.name }) })
      .catch((e) => wx.showToast({ title: e.msg || '绑定失败', icon: 'none' }))
  },
  logout() { wx.removeStorageSync('mtoken'); wx.removeStorageSync('merchant'); app.globalData.token = ''; app.globalData.merchant = null; this.setData({ merchant: null }) },
  goSettle() { wx.navigateTo({ url: '/pages/settlement/index' }) },
  // 门店码：官方 getUnlimitedQRCode，游客扫码带商户归因进入首页
  async storeQrcode() {
    try {
      const r = await api.request('/m/qrcode')
      if (r.image) {
        const path = `${wx.env.USER_DATA_PATH}/store-qr.png`
        wx.getFileSystemManager().writeFile({ filePath: path, data: r.image, encoding: 'base64',
          success: () => wx.previewImage({ urls: [path] }),
          fail: () => this.setData({ qr: 'data:image/png;base64,' + r.image }) })
      } else {
        wx.showModal({ title: 'MOCK 模式', content: '需在管理后台「集成中心」配置微信小程序凭据后生成真实门店码（scene=' + r.scene + '）', showCancel: false })
      }
    } catch (e) { wx.showToast({ title: e.msg || '生成失败', icon: 'none' }) }
  },
})
