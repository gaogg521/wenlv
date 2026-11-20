const api = require('../../utils/api')
const { stockView, businessDay, money } = require('../../utils/catalog-view')
const { confirmChange } = require('../../utils/confirm')
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
    }).catch(e => { if (requestId !== this._requestId) { if (done) done(); return }; this.setData({ loaded: true, list: append ? this.data.list : [], hasMore: false, errCode: Number(e.code) || 0, error: e.msg || '库存加载失败' }); this.applyFilters(); done && done() })
  },
  // 服务端翻页：追加下一页团期（请求量按页）
  loadMoreSessions() { if (this.data.hasMore && !this._loadingMore) { this._loadingMore = true; this.fetch(() => { this._loadingMore = false }, true) } },
  applyFilters() {
    const view = stockView(this.data.list, this.data), limit = this.data.sessionLimit || 6
    view.groups = view.groups.map(g => Object.assign({}, g, { sessions: g.expanded ? g.sessions.slice(0, limit) : [], hasMore: g.expanded && g.sessions.length > limit }))
    // M-07：最近改价展示（谁、几点、旧→新）——金额换算在 JS 预计算（WXML 不做算术，红线）
    for (const g of view.groups) for (const s of g.sessions) {
      s.priceChangeText = s.priceChange && s.priceChange.from != null && s.priceChange.to != null
        ? ('最近改价：' + s.priceChange.by + ' · ' + s.priceChange.at + ' · ¥' + money(s.priceChange.from) + '→¥' + money(s.priceChange.to))
        : ''
    }
    this.setData(view)
  },
  moreSessions() { this.setData({ sessionLimit: (this.data.sessionLimit || 6) + 6 }); this.applyFilters() },
  onSearch(e) { this.setData({ kw: e.detail.value }); clearTimeout(this._kwT); this._kwT = setTimeout(() => this.fetch(), 300) },
  filterStatus(e) { this.setData({ status: e.currentTarget.dataset.k }); this.fetch() },
  filterRange(e) { const i = Number(e.detail.value); this.setData({ rangeIndex: i, range: ['future','week','month','past','all'][i] }); this.fetch() },
  resetFilters() { this.setData({ kw: '', status: 'all', range: 'future', rangeIndex: 0 }); this.fetch() },
  toggleProduct(e) { const key = e.currentTarget.dataset.key; this.setData({ expandedKey: this.data.expandedKey === key ? '' : key, sessionLimit: 6 }); this.applyFilters() },
  // C-02 批量操作：对本商品当前筛选下的团期批量改价/调名额/停售；先输入、再过 M-12 统一确认（旧→新 + 影响范围；批量>5 条或价差超 ±30% 需填原因）
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
        confirmChange({ title: '批量停售确认', target: '「' + (g ? g.title : '') + '」当前筛选下 ' + rows.length + ' 个团期',
          changes: [{ label: '状态', from: '在售', to: '停售' }], impact: '停售后游客无法报名这些团期，可逐团恢复',
          needReason: rows.length > 5, confirmText: '确认停售', danger: true })
          .then(c => { if (c.ok) this.batchSubmit(rows.map(s => s.id), act, null, rows.length, c.reason) })
        return
      }
      wx.showModal({ title: '批量' + (act === 'price' ? '改价' : '调名额'), editable: true, placeholderText: titles[act], success: m => {
        if (!m.confirm || !m.content) return
        // M-01：价格最多两位小数；名额为非负整数
        const raw = String(m.content).trim()
        if (act === 'price' && !/^\d+(\.\d{1,2})?$/.test(raw)) return wx.showToast({ title: '价格最多两位小数', icon: 'none' })
        if (act === 'adjust_quota' && !/^\d+$/.test(raw)) return wx.showToast({ title: '名额须为非负整数', icon: 'none' })
        const val = act === 'price' ? Math.round(Number(raw) * 100) : Math.floor(Number(raw))
        if (!(val > 0)) return wx.showToast({ title: '数值无效', icon: 'none' })
        const avgFrom = rows.reduce((sum, s) => sum + Number(s.price_adult || 0), 0) / rows.length
        const pct = avgFrom > 0 && act === 'price' ? Math.round((val - avgFrom) / avgFrom * 100) : 0
        confirmChange({
          title: '批量' + (act === 'price' ? '改价' : '调名额') + '确认',
          target: '「' + (g ? g.title : '') + '」当前筛选下 ' + rows.length + ' 个团期',
          changes: act === 'price'
            ? [{ label: '价格', from: '均价 ' + money(Math.round(avgFrom)), to: '¥' + (val / 100).toFixed(2) + (pct ? '（' + (pct > 0 ? '涨' : '降') + Math.abs(pct) + '%）' : '') }]
            : [{ label: '名额', from: '各团期现名额', to: String(val) + ' 个' }],
          impact: '影响 ' + rows.length + ' 个团期；被并发改过的团期会提示冲突，不静默覆盖',
          needReason: rows.length > 5 || (act === 'price' && Math.abs(pct) > 30), confirmText: act === 'price' ? '确认改价' : '确认调整', danger: Math.abs(pct) > 30,
        }).then(c => { if (c.ok) this.batchSubmit(rows.map(s => s.id), act, val, rows.length, c.reason) })
      } })
    } })
  },
  batchSubmit(ids, action, value, scope, reason) {
    api.request('/m/supply/batch', 'POST', { ids, action, value, reason }).then(r => {
      // X-03：批量提交时被并发改过的团期不静默覆盖，明确提示冲突数量
      // V94：提交后进入平台审批（不即时生效），重复提交返回既有待审单
      const conflictTail = (r.conflicts && r.conflicts.length) ? ' · ' + r.conflicts.length + ' 个冲突未受理（请刷新后重试）' : ''
      const dupTail = (r.duplicates && r.duplicates.length) ? ' · ' + r.duplicates.length + ' 个已在待审' : ''
      wx.showToast({ title: '已提交 ' + (r.created || 0) + ' 笔申请待平台确认' + dupTail + conflictTail, icon: 'none', duration: 3000 })
      this.fetch()
    }).catch(e => wx.showToast({ title: e.msg || '批量操作失败', icon: 'none' }))
  },
  manageSession(e) {
    if (this.data.role < 2) return
    const s = this.data.list.find(x => Number(x.id) === Number(e.currentTarget.dataset.id))
    if (!s) return
    const event = { currentTarget: { dataset: { id: s.id, price: s.price_adult, early: s.early_price, earlydays: s.early_days, version: s.version } } }
    const actions = ['调整名额','修改价格','早鸟设置']
    const handlers = [this.addQuota,this.changePrice,this.setEarly]
    if (Number(s.status) === 1) { actions.push('停售团期'); handlers.push(this.stopSell) }
    if (Number(s.status) === 3) { actions.push('恢复在售'); handlers.push(this.resumeSell) }
    wx.showActionSheet({ itemList: actions, success: r => { handlers[r.tapIndex].call(this,event) } })
  },
  // A-35：停售恢复通道（免确认：重新上架是低危动作，停售才需要确认）
  // V94：恢复/停售/改价/名额/早鸟均改为「提交审核」——平台确认后才生效，此前继续使用原版本
  resumeSell(e) {
    const id = e.currentTarget.dataset.id
    api.request('/m/supply/' + id, 'POST', { action: 'resume_sell' }).then(() => { wx.showToast({ title: '恢复申请已提交,待平台确认', icon: 'none', duration: 2500 }); this.fetch() }).catch(err => wx.showToast({ title: err.msg || '提交失败', icon: 'none' }))
  },
  // 停售团期（A 级确认；恢复在 manageSession 里）
  stopSell(e) {
    const id = e.currentTarget.dataset.id
    const s = this.data.list.find(x => Number(x.id) === Number(id))
    confirmChange({ title: '停售确认', target: (s ? s.title + ' ' : '') + '团期 ' + (s && s.dateShort ? s.dateShort : id),
      changes: [{ label: '状态', from: '在售', to: '停售' }], impact: '提交平台审批;批准后游客无法再报名该团期,已下单游客仍按原约定履约', confirmText: '提交停售申请', danger: true })
      .then(c => { if (c.ok) api.request('/m/supply/' + id, 'POST', { action: 'stop_sell' }).then(() => { wx.showToast({ title: '停售申请已提交', icon: 'none' }); this.fetch() }).catch(e => wx.showToast({title:e.msg || '提交失败',icon:'none'})) })
  },
  addQuota(e) {
    const id = e.currentTarget.dataset.id
    const version = e.currentTarget.dataset.version != null ? Number(e.currentTarget.dataset.version) : undefined
    const s = this.data.list.find(x => Number(x.id) === Number(id))
    wx.showModal({ title: '调整名额', editable: true, placeholderText: '输入新名额总数' + (s ? '（当前 ' + s.quota + '，已报 ' + s.booked + '）' : ''), success: (r) => {
      if (!r.confirm || !r.content) return
      if (!/^\d+$/.test(String(r.content).trim())) return wx.showToast({ title: '名额须为非负整数', icon: 'none' })
      const val = Number(r.content)
      confirmChange({ title: '调名额确认', target: (s ? s.title + ' ' : '') + '团期 ' + (s && s.dateShort ? s.dateShort : id),
        changes: [{ label: '名额', from: s ? String(s.quota) : '原名额', to: String(val) }],
        impact: '提交平台审批;批准前名额保持原值,已报名人数不受影响', confirmText: '提交调整申请' })
        .then(c => { if (c.ok) api.request('/m/supply/' + id, 'POST', { action: 'adjust_quota', value: val, expectedVersion: version })
          .then(() => { wx.showToast({ title: '名额调整申请已提交', icon: 'none' }); this.fetch() })
          .catch(e => wx.showToast({title:e.msg || '提交失败',icon:'none'})) })
    }})
  },
  // 改价（店长/老板都能改——负责人 2026-11-19 指令；单位分，界面输入元、最多两位小数）。
  // X-03：带乐观锁版本提交，两端并发改价时后者收到明确冲突提示。
  // M-12：输入完成后必须再弹「旧→新」确认；价差超 ±30% 需填原因（A+）。确认步骤拆在 confirmPriceChange，供走查直调。
  changePrice(e) {
    const id = e.currentTarget.dataset.id
    const cur = (Number(e.currentTarget.dataset.price) / 100).toFixed(2)
    const version = e.currentTarget.dataset.version != null ? Number(e.currentTarget.dataset.version) : undefined
    wx.showModal({ title: '修改团期价格', editable: true, placeholderText: '当前 ¥' + cur + '，输入新价格（元，最多两位小数）', success: (r) => {
      if (!r.confirm || !r.content) return
      this.confirmPriceChange(id, version, e.currentTarget.dataset.price, String(r.content).trim())
    }})
  },
  confirmPriceChange(id, version, fromFen, raw) {
    const s = this.data.list.find(x => Number(x.id) === Number(id))
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return wx.showToast({ title: '价格最多两位小数', icon: 'none' })
    const yuan = Number(raw)
    if (!(yuan > 0)) return wx.showToast({ title: '价格非法', icon: 'none' })
    const pct = Number(fromFen) > 0 ? Math.round((yuan * 100 - Number(fromFen)) / Number(fromFen) * 100) : 0
    confirmChange({ title: '改价确认', target: (s ? s.title + ' ' : '') + '团期 ' + (s && s.dateShort ? s.dateShort : id),
      changes: [{ label: '价格', from: '¥' + (Number(fromFen) / 100).toFixed(2), to: '¥' + yuan.toFixed(2) + (pct ? '（' + (pct > 0 ? '涨' : '降') + Math.abs(pct) + '%）' : '') }],
      impact: '提交平台审批;批准前游客端按原价下单,已下单订单保持原价',
      needReason: true, confirmText: '提交改价申请', danger: Math.abs(pct) > 30 })
      .then(c => { if (!c.ok) return
        api.request('/m/supply/' + id, 'POST', { action: 'price', value: Math.round(yuan * 100), expectedVersion: version, reason: c.reason })
          .then(() => { wx.showToast({ title: '改价申请已提交:¥' + (Number(fromFen) / 100).toFixed(2) + '→¥' + yuan.toFixed(2) + ',待平台确认', icon: 'none', duration: 3000 }); this.fetch() })
          .catch((err) => wx.showToast({ title: err.msg || '提交失败', icon: 'none', duration: 3000 }))
      })
  },
  // 早鸟价（旺季武器 §9 P1）：格式「价格(元),提前天数」；留空提交=关闭早鸟；设置后过 M-12 确认
  setEarly(e) {
    const id = e.currentTarget.dataset.id
    const version = e.currentTarget.dataset.version != null ? Number(e.currentTarget.dataset.version) : undefined
    const s = this.data.list.find(x => Number(x.id) === Number(id))
    const cur = e.currentTarget.dataset.early ? (Number(e.currentTarget.dataset.early) / 100).toFixed(0) + ',' + e.currentTarget.dataset.earlydays : ''
    wx.showModal({ title: '早鸟价设置', editable: true, content: cur,
      placeholderText: '早鸟价(元),提前天数 如 238,7 · 清空=关闭', success: (r) => {
        if (!r.confirm) return
        const txt = String(r.content || '').trim()
        if (!txt) {
          confirmChange({ title: '关闭早鸟确认', target: (s ? s.title + ' ' : '') + '团期 ' + (s && s.dateShort ? s.dateShort : id),
            changes: [{ label: '早鸟价', from: cur ? '¥' + cur.split(/[,，]/)[0] : '未设置', to: '关闭' }],
            impact: '提交平台审批;批准后该团期按原价销售', confirmText: '提交申请' })
            .then(c => { if (c.ok) api.request('/m/supply/' + id, 'POST', { action: 'early', value: { price: null }, expectedVersion: version })
              .then(() => { wx.showToast({ title: '关闭早鸟申请已提交', icon: 'none' }); this.fetch() }) })
          return
        }
        const parts = txt.split(/[,，]/)
        const yuan = Number(parts[0]), days = Number(parts[1] || 7)
        if (!yuan || yuan <= 0 || !(days >= 0)) return wx.showToast({ title: '格式：238,7', icon: 'none' })
        if (!/^\d+(\.\d{1,2})?$/.test(String(parts[0]).trim())) return wx.showToast({ title: '早鸟价最多两位小数', icon: 'none' })
        confirmChange({ title: '早鸟设置确认', target: (s ? s.title + ' ' : '') + '团期 ' + (s && s.dateShort ? s.dateShort : id),
          changes: [{ label: '早鸟价', from: cur ? '¥' + cur.split(/[,，]/)[0] : '未设置', to: '¥' + yuan.toFixed(2) + ' · 提前' + days + '天' }],
          impact: '提交平台审批;批准后早鸟窗口内按早鸟价成交', confirmText: '提交申请' })
          .then(c => { if (c.ok) api.request('/m/supply/' + id, 'POST', { action: 'early', value: { price: Math.round(yuan * 100), days }, expectedVersion: version })
            .then(() => { wx.showToast({ title: '早鸟申请已提交:¥' + yuan.toFixed(2) + ' · 提前' + days + '天', icon: 'none', duration: 2500 }); this.fetch() })
            .catch((err) => wx.showToast({ title: err.msg || '提交失败', icon: 'none' })) })
      }})
  },
})
