// 核销页：在线扫码/输码 + 离线兜底（总方案 §10：本地队列 + 黄条提示 + 恢复上传二次校验，冲突进人工队列）
const api = require('../../utils/api')

const LIST_KEY = 'wl_offline_list'   // { syncedAt, passes, codes }
const QUEUE_KEY = 'wl_offline_queue' // [{ payload, offlineAt }]

Page({
  data: { result: null, lastQr: '', input: '', streak: 0, offline: { pending: 0, syncedAt: '', listReady: false } },

  onShow() {
    this.setData({ result: null })
    this.refreshOfflineBar()
    this.syncList()
    this.watchNetwork()
  },
  onHide() { if (this._watched) { wx.offNetworkStatusChange(this._onNet); this._watched = false } },

  // ── 离线名单：进入页面即同步（在线时）；断网前缓存可覆盖 ~30 分钟窗口 ──
  async syncList() {
    try {
      const list = await api.request('/m/verify/offline-list')
      wx.setStorageSync(LIST_KEY, list)
      this._list = list
    } catch (e) { this._list = wx.getStorageSync(LIST_KEY) || null }
    this.refreshOfflineBar()
  },
  refreshOfflineBar() {
    const q = wx.getStorageSync(QUEUE_KEY) || []
    const l = this._list || wx.getStorageSync(LIST_KEY) || null
    this.setData({ offline: { pending: q.length, syncedAt: l ? l.syncedAt.replace('T', ' ').slice(5, 16) : '', listReady: !!l } })
  },
  watchNetwork() {
    if (this._watched) return
    this._onNet = (res) => { if (res.isConnected && (wx.getStorageSync(QUEUE_KEY) || []).length) this.uploadQueue() }
    wx.onNetworkStatusChange(this._onNet)
    this._watched = true
  },

  // ── 在线核销（连续模式：成功后 800ms 自动重开相机，§10 verify 规格）──
  scan() {
    this._continuous = true
    wx.scanCode({
      success: (r) => this.doVerify(r.result),
      fail: () => { this._continuous = false },
    })
  },
  onInput(e) { this.setData({ input: e.detail.value }) },
  submit() {
    // 手动输码兜底：以 6 位展示码作为 payload（服务端同窗口校验同一 HMAC）
    if (!this.data.input) return wx.showToast({ title: '请输入 6 位码', icon: 'none' })
    this._continuous = false
    this.doVerify(this.data.input)
  },
  doVerify(payload) {
    api.request('/m/verify/scan', 'POST', { payload }).then((r) => {
      const ok = r.ok
      wx.vibrateShort({ type: ok ? 'heavy' : 'light' })
      if (ok) {
        wx.showToast({ title: '核销成功', icon: 'success' })
        this.setData({ result: { ...r, payload }, streak: this.data.streak + 1, lastQr: payload })
        this._continuous && setTimeout(() => { if (this._continuous) this.scan() }, 800)
      } else {
        this._continuous = false
        this.setData({ result: { ...r, payload } })
      }
    }).catch(() => {
      // 网络不通 → 离线兜底（名单内放行 + 本地队列）
      this.offlineVerify(payload)
    })
  },

  // ── 离线核销：仅放行名单内凭证（§10「已出票且可人工比对」），记录进本地队列 ──
  offlineVerify(payload) {
    const list = this._list || wx.getStorageSync(LIST_KEY)
    if (!list) {
      wx.vibrateShort({ type: 'light' })
      return this.setData({ result: { ok: false, payload, offline: true, reason: '离线且无名单缓存，请恢复网络后同步' } })
    }
    let passId = null, how = ''
    if (/^wl:\/\//.test(payload)) {
      passId = Number(String(payload).split('/')[3]) || null
      how = '扫码（凭证号匹配）'
    } else if (/^\d{6}$/.test(payload)) {
      passId = list.codes[payload] || null
      how = '输码（缓存展示码匹配）'
    }
    const hit = passId && (list.passes || []).find((p) => p.pass_id === passId)
    wx.vibrateShort({ type: hit ? 'heavy' : 'light' })
    if (!hit) return this.setData({ result: { ok: false, payload, offline: true, reason: '离线名单无此凭证（或凭证已核销）' } })
    const q = wx.getStorageSync(QUEUE_KEY) || []
    q.push({ payload, offlineAt: new Date().toISOString(), passId })
    wx.setStorageSync(QUEUE_KEY, q)
    this.refreshOfflineBar()
    this.setData({ result: { ok: true, payload, offline: true, reason: how + ' · ' + (hit.contact_name || '游客') + ' · ' + hit.title, passId },
      streak: this.data.streak + 1, lastQr: payload })
    if (this._continuous) setTimeout(() => { if (this._continuous) this.scan() }, 800)
  },

  // ── 恢复上传：逐条重走服务端二次校验；失败条目服务端已进人工队列 ──
  async uploadQueue() {
    const q = wx.getStorageSync(QUEUE_KEY) || []
    if (!q.length) return
    try {
      const r = await api.request('/m/verify/offline-batch', 'POST', { items: q })
      wx.setStorageSync(QUEUE_KEY, [])
      this.refreshOfflineBar()
      this.syncList()
      wx.showModal({
        title: '离线核销已上传',
        content: '成功 ' + r.uploaded + ' 条' + (r.conflicts ? '；' + r.conflicts + ' 条冲突已转人工队列（重复核销/凭证异常）' : ''),
        showCancel: false,
      })
    } catch (e) { wx.showToast({ title: '上传失败，稍后重试', icon: 'none' }) }
  },
})
