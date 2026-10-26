// 核销页：在线扫码/输码 + 离线兜底（总方案 §10：本地队列 + 黄条提示 + 恢复上传二次校验，冲突进人工队列）
const api = require('../../utils/api')

// 核销语音播报（P2）：打包内合成提示音，随震动双反馈
const voice = wx.createInnerAudioContext()
function say(kind) {
  voice.src = '/assets/voice/' + kind + '.wav'
  voice.play()
}

const listKey = () => 'wl_offline_list_' + ((getApp().globalData.merchant || {}).id || 'unbound')   // { syncedAt, passes, codes }
const queueKey = () => 'wl_offline_queue_' + ((getApp().globalData.merchant || {}).id || 'unbound') // [{ payload, offlineAt }]

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
      wx.setStorageSync(listKey(), list)
      this._list = list
    } catch (e) { this._list = wx.getStorageSync(listKey()) || null }
    this.refreshOfflineBar()
  },
  refreshOfflineBar() {
    const q = wx.getStorageSync(queueKey()) || []
    const l = this._list || wx.getStorageSync(listKey()) || null
    this.setData({ offline: { pending: q.length, syncedAt: l ? l.syncedAt.replace('T', ' ').slice(5, 16) : '', listReady: !!l } })
  },
  watchNetwork() {
    if (this._watched) return
    this._onNet = (res) => { if (res.isConnected && (wx.getStorageSync(queueKey()) || []).length) this.uploadQueue() }
    wx.onNetworkStatusChange(this._onNet)
    this._watched = true
  },

  // ── 对暗号核销（剧本游）：输入游客说出的暗号 → 命中即整单核销 ──
  phraseInput() {
    wx.showModal({ title: '对暗号', editable: true, placeholderText: '输入游客说出的暗号', success: async (r) => {
      if (!r.confirm || !r.content) return
      try {
        const res = await api.request('/m/verify/phrase', 'POST', { phrase: r.content.trim() })
        wx.vibrateShort({ type: res.ok ? 'heavy' : 'light' })
        if (res.ok) {
          this.setData({ streak: this.data.streak + 1, result: { ok: true, payload: '暗号·' + res.orderNo, reason: res.reason + (res.counterPhrase ? ' · 对答：' + res.counterPhrase : '') } })
          // 对答句在结果卡常驻展示，这里只轻提示，避免双弹窗打断连续核销
          wx.showToast({ title: res.counterPhrase ? '对答：' + res.counterPhrase : '已整单核销', icon: 'none', duration: 2500 })
          this.syncList()
        } else {
          this.setData({ result: { ok: false, payload: '暗号', reason: res.reason } })
        }
      } catch (e) { wx.showToast({ title: e.msg || '核销失败', icon: 'none' }) }
    }})
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
        say('ok')
        wx.showToast({ title: '核销成功', icon: 'success' })
        this.setData({ result: { ...r, payload }, streak: this.data.streak + 1, lastQr: payload })
        this._continuous && setTimeout(() => { if (this._continuous) this.scan() }, 800)
      } else {
        say(String(r.reason || '').includes('重复') ? 'dup' : 'fail')
        this._continuous = false
        this.setData({ result: { ...r, payload } })
      }
    }).catch(e => {
      if (!e.network) { this._continuous = false; return this.setData({ result: { ok: false, payload, reason: e.msg || '核销失败' } }) }
      // 网络不通 → 离线兜底（名单内放行 + 本地队列）
      this.offlineVerify(payload)
    })
  },

  // ── 离线核销：仅放行名单内凭证（§10「已出票且可人工比对」），记录进本地队列 ──
  offlineVerify(payload) {
    const list = this._list || wx.getStorageSync(listKey())
    if (!list) {
      wx.vibrateShort({ type: 'light' })
      return this.setData({ result: { ok: false, payload, offline: true, reason: '离线且无名单缓存，请恢复网络后同步' } })
    }
    if (Date.now() - new Date(list.syncedAt).getTime() > 30 * 60000) return this.setData({ result: { ok: false, reason: '离线名单已过期，请恢复网络刷新' } })
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
    const q = wx.getStorageSync(queueKey()) || []
    if (q.some(x => x.passId === passId)) return this.setData({ result: { ok: false, reason: '该凭证已在离线队列，请勿重复放行' } })
    q.push({ payload, offlineAt: new Date().toISOString(), passId })
    wx.setStorageSync(queueKey(), q)
    this.refreshOfflineBar()
    this.setData({ result: { ok: false, pending: true, payload, offline: true, reason: how + ' · ' + (hit.contact_name || '游客') + ' · ' + hit.title, passId },
      streak: this.data.streak + 1, lastQr: payload })
    if (this._continuous) setTimeout(() => { if (this._continuous) this.scan() }, 800)
  },

  // ── 恢复上传：逐条重走服务端二次校验；失败条目服务端已进人工队列 ──
  async uploadQueue() {
    const q = wx.getStorageSync(queueKey()) || []
    if (!q.length) return
    try {
      const r = await api.request('/m/verify/offline-batch', 'POST', { items: q })
      wx.setStorageSync(queueKey(), [])
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
