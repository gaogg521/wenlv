const api = require('../../utils/api')
const app = getApp()
Page({
  data: { merchant: null, role: 0, midInput: '' },
  onShow() { this.setData({ merchant: app.globalData.merchant || wx.getStorageSync('merchant') || null, role: app.globalData.role }) },
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
