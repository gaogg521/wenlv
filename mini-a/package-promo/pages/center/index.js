const api = require('../../../utils/api')
Page({
  data: { seg: 'earn', ov: null, scene: null, qrcode: '', customers: [], nameMap: { 1: '基础 5%', 2: '优选 8%', 3: '金牌 12%' } },
  onShow() { this.fetch() },
  async fetch() {
    try {
      await api.ensureLogin()
      const [ov, sc, customers] = await Promise.all([
        api.request('/c/promote/overview'), api.request('/c/promote/scene'), api.request('/c/promote/customers'),
      ])
      this.setData({ ov, scene: sc.promoter ? sc.scene : null, customers })
    } catch (e) { wx.showToast({ title: e.msg || '加载失败', icon: 'none' }) }
  },
  switchSeg(e) { this.setData({ seg: e.currentTarget.dataset.k }) },
  // 推广者把小程序转发给好友 → 好友进入即带归因 scene（首触唯一，成交计佣）
  onShareAppMessage() {
    const s = this.data.scene ? '?scene=' + this.data.scene : ''
    return { title: '和你分享「向往的自由」· 主题游·预约制', path: '/pages/home/index' + s }
  },
  onShareTimeline() {
    return { title: '和你分享「向往的自由」· 主题游·预约制', query: this.data.scene ? 'scene=' + this.data.scene : '' }
  },
  copy() { wx.setClipboardData({ data: this.data.scene }) },
  // 官方 getUnlimitedQRCode：后端返回 base64 小程序码（未配置凭据时 MOCK 提示）
  async makeQrcode() {
    try {
      const r = await api.getPromoQrcode()
      if (r.image) {
        this.setData({ qrcode: 'data:image/png;base64,' + r.image })
      } else {
        wx.showModal({ title: 'MOCK 模式', content: r.note || '需在管理后台「集成中心」配置微信小程序凭据', showCancel: false })
      }
    } catch (e) { wx.showToast({ title: e.msg || '生成失败', icon: 'none' }) }
  },
  async withdraw() {
    const ok = await new Promise((r) => wx.showModal({ title: '申请提现', content: '可提现金额将全数申请，¥100 起，T+1 到账', success: r }))
    if (!ok.confirm) return
    try { await api.request('/c/promote/withdraw', 'POST', { note: '小程序申请' }); wx.showToast({ title: '已提交，等待财务审批' }); this.fetch() }
    catch (e) { wx.showToast({ title: e.msg || '失败', icon: 'none' }) }
  },
})
