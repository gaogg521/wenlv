const api = require('../../utils/api')
Page({
  data: { list: [], loaded: false, detail: {} },
  // 展开/收起结算单订单明细（对账逐单可查）
  async toggleDetail(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.detail[id]) return this.setData({ ['detail.' + id]: null })
    try {
      const s = await api.request('/m/settlements/' + id)
      this.setData({ ['detail.' + id]: s.items || [] })
    } catch (err) { wx.showToast({ title: err.msg || '加载失败', icon: 'none' }) }
  },
  onShow() { this.fetch() },
  fetch() {
    if (!getApp().globalData.token) return this.setData({ loaded: true })
    api.request('/m/settlements').then((l) => this.setData({ list: l, loaded: true })).catch(() => this.setData({ loaded: true }))
  },
  // 商户确认结算（待确认 → 已确认，财务复核后完成）
  confirm(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认结算单', content: '确认本期对账无误？确认后进入财务复核打款流程。',
      success: (r) => {
        if (!r.confirm) return
        api.request('/m/settlements/' + id + '/confirm', 'POST', {}).then(() => {
          wx.showToast({ title: '已确认，待财务复核' })
          this.fetch()
        }).catch((err) => wx.showToast({ title: err.msg || '确认失败', icon: 'none' }))
      },
    })
  },
})
