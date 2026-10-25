const api = require('../../utils/api')
Page({
  data: { list: [], loaded: false },
  onShow() { this.fetch() },
  fetch() {
    if (!getApp().globalData.token) return this.setData({ loaded: true })
    api.request('/m/supply').then((l) => this.setData({ list: l, loaded: true })).catch(() => this.setData({ loaded: true }))
  },
  stopSell(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '停售确认', content: '停售后游客无法再报名该团期', success: (r) => {
      if (r.confirm) api.request('/m/supply/' + id, 'POST', { action: 'stop_sell' }).then(() => this.fetch())
    }})
  },
  addQuota(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '增加名额', editable: true, placeholderText: '输入新名额总数', success: (r) => {
      if (r.confirm && r.content) api.request('/m/supply/' + id, 'POST', { action: 'adjust_quota', value: Number(r.content) }).then(() => this.fetch())
    }})
  },
  // 改价（店长/老板权限；单位分，界面提示元）
  changePrice(e) {
    const id = e.currentTarget.dataset.id
    const cur = (Number(e.currentTarget.dataset.price) / 100).toFixed(0)
    wx.showModal({ title: '修改团期价格', editable: true, placeholderText: '当前 ¥' + cur + '，输入新价格（元）', success: (r) => {
      if (!r.confirm || !r.content) return
      const yuan = Number(r.content)
      if (!yuan || yuan <= 0) return wx.showToast({ title: '价格非法', icon: 'none' })
      api.request('/m/supply/' + id, 'POST', { action: 'price', value: Math.round(yuan * 100) })
        .then(() => { wx.showToast({ title: '已改价 ¥' + yuan }); this.fetch() })
        .catch((err) => wx.showToast({ title: err.msg || '改价失败', icon: 'none' }))
    }})
  },
})
