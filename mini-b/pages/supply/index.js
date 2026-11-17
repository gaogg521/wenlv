const api = require('../../utils/api')
const { stockView, businessDay } = require('../../utils/catalog-view')
Page({
  data: { list: [], groups: [], loaded: false, kw: '', status: 'all', range: 'future', rangeIndex: 0, rangeNames: ['未来团期','未来7天','未来30天','历史团期','全部日期'], statusOptions: [{k:'all',n:'全部状态'},{k:'open',n:'可售'},{k:'tight',n:'余量紧张'},{k:'closed',n:'已截止/取消'}], page: 1, hasMore: false, total: 0 },
  onShow() {
    // B2 工作台「临近截止」下钻预设：一次性消费（未来7天）
    const preset = wx.getStorageSync('supplyPreset') || null
    if (preset) { wx.removeStorageSync('supplyPreset'); this.setData({ rangeIndex: 1, range: 'week', status: preset.status || 'all', kw: '' }) }
    this.fetch()
  },
  onPullDownRefresh() { this.fetch(() => wx.stopPullDownRefresh()) },
  // C-02 服务端分页：按日期窗/关键词分页拉取（首屏一页 60 条），本地仍用 stockView 做状态筛选与分组展示
  dateWindow() {
    const today = businessDay(), day = n => new Date(Date.parse(today + 'T00:00:00+08:00') + n * 86400000 + 8 * 3600000).toISOString().slice(0, 10)
    if (this.data.range === 'week') return { from: today, to: day(6) }
    if (this.data.range === 'month') return { from: today, to: day(29) }
    if (this.data.range === 'past') return { from: '', to: day(-1) }
    if (this.data.range === 'all') return { from: '', to: '' }
    return { from: today, to: '' } // future
  },
  fetch(done, append = false) {
    if (typeof done !== 'function') done = undefined
    this.setData({ role: getApp().globalData.role || 0, error: '' })
    if (!getApp().globalData.token) { this.setData({ loaded: true, list: [] }); this.applyFilters(); done && done(); return }
    const requestId = this._requestId = (this._requestId || 0) + 1
    const page = append ? this.data.page + 1 : 1
    const w = this.dateWindow()
    const qs = ['paged=1', 'page=' + page, 'pageSize=60',
      w.from ? 'from=' + w.from : '', w.to ? 'to=' + w.to : '',
      'status=' + this.data.status, 'kw=' + encodeURIComponent(this.data.kw || '')].filter(Boolean).join('&')
    api.request('/m/supply?' + qs).then((d) => {
      if (requestId !== this._requestId) { if (done) done(); return }
      const list = append ? this.data.list.concat(d.items || []) : (d.items || [])
      this.setData({ list, page, total: d.total || list.length, hasMore: !!d.hasMore, loaded: true })
      this.applyFilters(); done && done()
    }).catch(e => { if (requestId !== this._requestId) { if (done) done(); return }; this.setData({ loaded: true, list: append ? this.data.list : [], hasMore: false, error: e.msg || '库存加载失败' }); this.applyFilters(); done && done() })
  },
  // 服务端翻页：追加下一页团期（请求量按页）
  loadMoreSessions() { if (this.data.hasMore && !this._loadingMore) { this._loadingMore = true; this.fetch(() => { this._loadingMore = false }, true) } },
  applyFilters() {
    const view = stockView(this.data.list, this.data), limit = this.data.sessionLimit || 6
    view.groups = view.groups.map(g => Object.assign({}, g, { sessions: g.expanded ? g.sessions.slice(0, limit) : [], hasMore: g.expanded && g.sessions.length > limit }))
    this.setData(view)
  },
  moreSessions() { this.setData({ sessionLimit: (this.data.sessionLimit || 6) + 6 }); this.applyFilters() },
  onSearch(e) { this.setData({ kw: e.detail.value }); clearTimeout(this._kwT); this._kwT = setTimeout(() => this.fetch(), 300) },
  filterStatus(e) { this.setData({ status: e.currentTarget.dataset.k }); this.fetch() },
  filterRange(e) { const i = Number(e.detail.value); this.setData({ rangeIndex: i, range: ['future','week','month','past','all'][i] }); this.fetch() },
  resetFilters() { this.setData({ kw: '', status: 'all', range: 'future', rangeIndex: 0 }); this.fetch() },
  toggleProduct(e) { const key = e.currentTarget.dataset.key; this.setData({ expandedKey: this.data.expandedKey === key ? '' : key, sessionLimit: 6 }); this.applyFilters() },
  // C-02 批量操作：对本商品当前筛选下的团期批量改价/调名额/停售；先展示影响范围再提交
  batchProduct(e) {
    if (this.data.role < 2) return
    const key = e.currentTarget.dataset.key
    const rows = this.data.list.filter(s => String(s.product_id) === String(key))
    if (!rows.length) return
    const g = this.data.groups.find(x => String(x.key) === String(key))
    wx.showActionSheet({ itemList: ['批量改价', '批量调名额', '批量停售'], success: r => {
      const act = ['price', 'adjust_quota', 'stop_sell'][r.tapIndex]
      const titles = { price: '输入新价格（元），应用到所选团期', adjust_quota: '输入新名额总数，应用到所选团期', stop_sell: '' }
      if (act === 'stop_sell') {
        wx.showModal({ title: '批量停售确认', content: '将停售「' + (g ? g.title : '') + '」当前筛选下 ' + rows.length + ' 个团期，停售后游客无法报名', success: m => {
          if (!m.confirm) return
          this.batchSubmit(rows.map(s => s.id), act, null, rows.length)
        } })
        return
      }
      wx.showModal({ title: '批量' + (act === 'price' ? '改价' : '调名额'), editable: true, placeholderText: titles[act], success: m => {
        if (!m.confirm || !m.content) return
        const val = act === 'price' ? Math.round(Number(m.content) * 100) : Math.floor(Number(m.content))
        if (!(val > 0)) return wx.showToast({ title: '数值无效', icon: 'none' })
        wx.showModal({ title: '影响范围确认', content: '将把「' + (g ? g.title : '') + '」当前筛选下 ' + rows.length + ' 个团期' + (act === 'price' ? '价格改为 ¥' + m.content : '名额调整为 ' + m.content), success: c => {
          if (c.confirm) this.batchSubmit(rows.map(s => s.id), act, val, rows.length)
        } })
      } })
    } })
  },
  batchSubmit(ids, action, value, scope) {
    api.request('/m/supply/batch', 'POST', { ids, action, value }).then(r => {
      wx.showToast({ title: '影响 ' + scope + ' 个团期 · 生效 ' + (r.applied || 0) + ' 个', icon: 'none', duration: 2500 })
      this.fetch()
    }).catch(e => wx.showToast({ title: e.msg || '批量操作失败', icon: 'none' }))
  },
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
