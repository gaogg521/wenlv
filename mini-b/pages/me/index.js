const api = require('../../utils/api')
const app = getApp()
Page({
  data: { merchant: null, role: 0, midInput: '', inviteCode: '', inviteInput: '', applyName: '', applyContact: '', applyMobile: '' },
  onShow() {
    this.setData({ merchant: app.globalData.merchant || wx.getStorageSync('merchant') || null, role: app.globalData.role })
    if (app.globalData.token) this.fetchApplications()
    if (this.data.merchant && this.data.role >= 2) this.fetchInvite()
    if (this.data.merchant && this.data.role >= 3) this.fetchStaff()
  },
  async fetchApplications() {
    try { const applications = await api.request('/m/applications'); this.setData({ applications: applications.map(a => ({ ...a, statusText: a.status === 1 ? '审核通过 · 请重新登录进入门店' : '平台审核中' })) }) } catch (e) {}
  },
  async fetchStaff() {
    try { const staff = await api.request('/m/staff'); this.setData({ staff: staff.map(s => ({ ...s, roleText: ['','核销员','店长','老板'][s.role] })) }) } catch (e) { wx.showToast({ title: e.msg || '员工加载失败', icon: 'none' }) }
  },
  async changeStaff(e) {
    const s = this.data.staff.find(s => s.id === e.currentTarget.dataset.id)
    if (!s || s.role === 3) return
    const choice = await new Promise(resolve => wx.showActionSheet({ itemList: ['设为核销员','设为店长',s.status ? '停用该员工' : '启用该员工'], success:r => resolve(r.tapIndex), fail:() => resolve(null) }))
    if (choice === null) return
    try { await api.request('/m/staff/' + s.id, 'POST', { role: choice < 2 ? choice + 1 : s.role, status: choice === 2 ? (s.status ? 0 : 1) : s.status }); this.fetchStaff() }
    catch (e) { wx.showToast({ title: e.msg || '操作失败', icon: 'none' }) }
  },
  async fetchInvite() {
    try {
      const r = await api.request('/m/invite')
      this.setData({ inviteCode: r.inviteCode })
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
      if (!app.globalData.token) await api.login()
      const r = await api.request('/m/auth/join', 'POST', { inviteCode: code })
      const m = null
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
      if (!app.globalData.token) await api.login()
      const r = await api.request('/m/apply', 'POST', { name: applyName, contact: applyContact, mobile: applyMobile })
      wx.showModal({ title: '申请已提交', content: '编号 ' + r.merchantNo + '，平台审核通过后凭邀请码加入门店', showCancel: false })
      this.setData({ applyName: '', applyContact: '', applyMobile: '' }); this.fetchApplications()
    } catch (e) { wx.showToast({ title: e.msg || '提交失败', icon: 'none' }) }
  },
  onMid(e) { this.setData({ midInput: e.detail.value }) },
  doLogin() {
    api.login().then((d) => {
      this.setData({ merchant: d.merchant || null, role: d.role || 0 })
      wx.showToast({ title: d.unbound ? '请凭邀请码加入门店' : '登录成功', icon: 'none' }); this.fetchApplications(); if (d.role >= 2) this.fetchInvite(); if (d.role >= 3) this.fetchStaff()
    }).catch((e) => wx.showToast({ title: e.msg || '登录失败', icon: 'none' }))
  },
  logout() { wx.removeStorageSync('mtoken'); wx.removeStorageSync('mrole'); app.globalData.role = 0; wx.removeStorageSync('merchant'); app.globalData.token = ''; app.globalData.merchant = null; this.setData({ merchant: null, role: 0, staff: [], inviteCode: '', applications: [] }) },
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
