const api = require('../../../utils/api')
Page({
  data: { seg: 'earn', ov: null, scene: null, qrcode: '', customers: [], nameMap: { 1: '基础 5%', 2: '优选 8%', 3: '金牌 12%' } },
  onShow() { this.fetch() },
  async fetch() {
    try {
      await api.ensureLogin()
      const [ov0, sc, customers] = await Promise.all([
        api.request('/c/promote/overview'), api.request('/c/promote/scene'), api.request('/c/promote/customers'),
      ])
      // 金额格式化放在 JS 里做：WXML 绑定表达式不支持 (x/100).toFixed(2) 这类方法调用，
      // 一旦写进 wxml 会导致整个分包编译失败（开发者工具只记一条“问题”，运行时表现为页面永远注册不上）
      const yuan = (v) => (Number(v || 0) / 100).toFixed(2)
      const ov = ov0 ? Object.assign({}, ov0, {
        validGmvLabel: '¥' + yuan(ov0.validGmv),
        rateLabel: Number(ov0.rateBp || 0) / 100 + '%',
        canWithdraw: !!ov0.active && Number(ov0.withdrawable) > 0 && Number(ov0.withdrawable) >= Number(ov0.withdrawMin) && !ov0.pendingRequests,
        ruleText: '最低申请 ¥' + yuan(ov0.withdrawMin) + ' · 佣金观察期 ' + Number(ov0.settleDelayDays) + ' 天；放行及实际打款状态分别核对',
        withdrawableYuan: yuan(ov0.withdrawable),
        earnedYuan: yuan(ov0.earned),
        withdrawnYuan: yuan(ov0.withdrawn),
        occupiedYuan:yuan(ov0.occupied),observingYuan:yuan(ov0.observing),debtYuan:yuan(ov0.debt),
      }) : ov0
      this.setData({ ov, scene: sc.promoter ? sc.scene : null, customers, error:'' })
    } catch (e) {
      this.setData({ ov: null, scene: null, customers: [],error:e.msg || '加载失败，请重试' })
      wx.showToast({ title: e.msg || '加载失败，请重试', icon: 'none' })
    }
  },
  switchSeg(e) { this.setData({ seg: e.currentTarget.dataset.k }) },
  products(){wx.navigateTo({url:'/package-promo/pages/products/index'})},
  commissions(){wx.navigateTo({url:'/package-promo/pages/records/index?kind=commissions'})},
  withdrawals(){wx.navigateTo({url:'/package-promo/pages/records/index?kind=withdrawals'})},
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
    if (!this.data.ov || !this.data.ov.canWithdraw) return
    const ok = await new Promise((r) => wx.showModal({ title: '申请提现', content: '可提现金额将全数申请，提交后等待财务核对，实际付款以登记结果为准', success: r }))
    if (!ok.confirm) return
    try { await api.request('/c/promote/withdraw', 'POST', { note: '小程序申请' }); wx.showToast({ title: '已提交，等待财务审批' }); this.fetch() }
    catch (e) { wx.showToast({ title: e.msg || '失败', icon: 'none' }) }
  },
})
