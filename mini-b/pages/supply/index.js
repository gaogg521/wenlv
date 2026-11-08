const api = require('../../utils/api')
const { stockView } = require('../../utils/catalog-view')
Page({
  data: { list: [], groups: [], loaded: false, kw: '', status: 'all', range: 'future', rangeIndex: 0, rangeNames: ['未来团期','未来7天','未来30天','历史团期','全部日期'], statusOptions: [{k:'all',n:'全部状态'},{k:'open',n:'可售'},{k:'tight',n:'余量紧张'},{k:'closed',n:'已截止/取消'}] },
  onShow() { this.fetch() },
  onPullDownRefresh() { this.fetch(() => wx.stopPullDownRefresh()) },
  fetch(done) {
    if (typeof done !== 'function') done = undefined
    this.setData({ role: getApp().globalData.role || 0, error: '' })
    if (!getApp().globalData.token) { this.setData({ loaded: true, list: [] }); this.applyFilters(); done && done(); return }
    api.request('/m/supply?history=1').then((l) => { this.setData({ list: l, loaded: true }); this.applyFilters(); done && done() }).catch(e => { this.setData({ loaded: true, list: [], error: e.msg || '库存加载失败' }); this.applyFilters(); done && done() })
  },
  applyFilters() {
    const view = stockView(this.data.list, this.data), limit = this.data.sessionLimit || 6
    view.groups = view.groups.map(g => Object.assign({}, g, { sessions: g.expanded ? g.sessions.slice(0, limit) : [], hasMore: g.expanded && g.sessions.length > limit }))
    this.setData(view)
  },
  moreSessions() { this.setData({ sessionLimit: (this.data.sessionLimit || 6) + 6 }); this.applyFilters() },
  onSearch(e) { this.setData({ kw: e.detail.value }); this.applyFilters() },
  filterStatus(e) { this.setData({ status: e.currentTarget.dataset.k }); this.applyFilters() },
  filterRange(e) { const i = Number(e.detail.value); this.setData({ rangeIndex: i, range: ['future','week','month','past','all'][i] }); this.applyFilters() },
  resetFilters() { this.setData({ kw: '', status: 'all', range: 'future', rangeIndex: 0 }); this.applyFilters() },
  toggleProduct(e) { const key = e.currentTarget.dataset.key; this.setData({ expandedKey: this.data.expandedKey === key ? '' : key, sessionLimit: 6 }); this.applyFilters() },
  manageSession(e) {
    if (this.data.role < 2) return
    const s = this.data.list.find(x => Number(x.id) === Number(e.currentTarget.dataset.id))
    if (!s) return
    const event = { currentTarget: { dataset: { id: s.id, price: s.price_adult, early: s.early_price, earlydays: s.early_days } } }
    const actions = ['调整名额','修改价格','早鸟设置']; if (Number(s.status) === 1) actions.push('停售团期')
    wx.showActionSheet({ itemList: actions, success: r => { [this.addQuota,this.changePrice,this.setEarly,this.stopSell][r.tapIndex].call(this,event) } })
  },
  stopSell(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '停售确认', content: '停售后游客无法再报名该团期', success: (r) => {
      if (r.confirm) api.request('/m/supply/' + id, 'POST', { action: 'stop_sell' }).then(() => this.fetch()).catch(e => wx.showToast({title:e.msg || '停售失败',icon:'none'}))
    }})
  },
  addQuota(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '增加名额', editable: true, placeholderText: '输入新名额总数', success: (r) => {
      if (r.confirm && r.content) api.request('/m/supply/' + id, 'POST', { action: 'adjust_quota', value: Number(r.content) }).then(() => this.fetch()).catch(e => wx.showToast({title:e.msg || '名额调整失败',icon:'none'}))
    }})
  },
  // 改价（店长/老板权限；单位分，界面提示元）
  changePrice(e) {
    const id = e.currentTarget.dataset.id
    const cur = (Number(e.currentTarget.dataset.price) / 100).toFixed(2)
    wx.showModal({ title: '修改团期价格', editable: true, placeholderText: '当前 ¥' + cur + '，输入新价格（元）', success: (r) => {
      if (!r.confirm || !r.content) return
      const yuan = Number(r.content)
      if (!yuan || yuan <= 0) return wx.showToast({ title: '价格非法', icon: 'none' })
      api.request('/m/supply/' + id, 'POST', { action: 'price', value: Math.round(yuan * 100) })
        .then(() => { wx.showToast({ title: '已改价 ¥' + yuan }); this.fetch() })
        .catch((err) => wx.showToast({ title: err.msg || '改价失败', icon: 'none' }))
    }})
  },
  // 早鸟价（旺季武器 §9 P1）：格式「价格(元),提前天数」；留空提交=关闭早鸟
  setEarly(e) {
    const id = e.currentTarget.dataset.id
    const cur = e.currentTarget.dataset.early ? (Number(e.currentTarget.dataset.early) / 100).toFixed(0) + ',' + e.currentTarget.dataset.earlydays : ''
    wx.showModal({ title: '早鸟价设置', editable: true, content: cur,
      placeholderText: '早鸟价(元),提前天数 如 238,7 · 清空=关闭', success: (r) => {
        if (!r.confirm) return
        const txt = String(r.content || '').trim()
        if (!txt) {
          api.request('/m/supply/' + id, 'POST', { action: 'early', value: { price: null } })
            .then(() => { wx.showToast({ title: '早鸟已关闭' }); this.fetch() })
          return
        }
        const parts = txt.split(/[,，]/)
        const yuan = Number(parts[0]), days = Number(parts[1] || 7)
        if (!yuan || yuan <= 0 || !(days >= 0)) return wx.showToast({ title: '格式：238,7', icon: 'none' })
        api.request('/m/supply/' + id, 'POST', { action: 'early', value: { price: Math.round(yuan * 100), days } })
          .then(() => { wx.showToast({ title: '早鸟 ¥' + yuan + ' · 提前' + days + '天' }); this.fetch() })
          .catch((err) => wx.showToast({ title: err.msg || '设置失败', icon: 'none' }))
      }})
  },
})
