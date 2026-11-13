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
  data: { result: null, lastQr: '', input: '', streak: 0, svcItems: [], offline: { pending: 0, syncedAt: '', listReady: false } },

  onShow() {
    this.setData({ result: null })
    this.refreshOfflineBar()
    this.loadSvcItems()
    this.syncList()
    this.watchNetwork()
  },
  onHide() { if (this._watched) { wx.offNetworkStatusChange(this._onNet); this._watched = false } },

  // B03：套餐服务项待履约清单（本店范围，跨店隔离由服务端校验）
  async loadSvcItems() {
    try {
      const d = await api.request('/m/items/pending')
      this.setData({ svcItems: (d.rows || []).filter((x) => Number(x.kind) === 2) })
    } catch (e) { /* 未登录/断网保持空态 */ }
  },
  // 服务项履约：幂等键防重放，重复提交返回同一结果
  async redeemSvc(e) {
    const it = this.data.svcItems[Number(e.currentTarget.dataset.i)]
    if (!it) return
    const key = wx.getStorageSync('wl_svc_idem_' + it.id) || ('SVC-' + it.id + '-' + Date.now().toString(36))
    wx.setStorageSync('wl_svc_idem_' + it.id, key)
    try {
      const r = await api.request('/m/items/' + it.id + '/redeem', 'POST', { idemKey: key, note: '' })
      wx.showToast({ title: r.repeated ? '已完成（重复提交已拦截）' : '履约完成', icon: r.repeated ? 'none' : 'success' })
      this.loadSvcItems()
    } catch (err) { wx.showToast({ title: err.msg || '履约失败', icon: 'none' }) }
  },

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
    const syncedAtText = l && l.syncedAt ? String(l.syncedAt).replace('T', ' ').slice(5, 16) : ''
    this.setData({ offline: { pending: q.length, syncedAt: syncedAtText, listReady: !!l } })
  },
  watchNetwork() {
    if (this._watched) return
    this._onNet = (res) => { if (res.isConnected && (wx.getStorageSync(queueKey()) || []).length) this.uploadQueue() }
    wx.onNetworkStatusChange(this._onNet)
    this._watched = true
  },

  // ── 对暗号核销（剧本游）：输入游客说出的暗号 → 命中即整单核销 ──
  // A-04：暗号是商品级的，多张在途订单同码时服务端不下发对答句、要求二次确认；
  // 这里弹出候选订单（联系人 · 出发日 · 单号），店员与游客当面核对后选择再核销
  phraseInput() {
    wx.showModal({ title: '对暗号', editable: true, placeholderText: '输入游客说出的暗号', success: async (r) => {
      if (!r.confirm || !r.content) return
      await this.phraseVerify({ phrase: r.content.trim() })
    }})
  },
  async phraseVerify(body) {
    try {
      const res = await api.request('/m/verify/phrase', 'POST', body)
      wx.vibrateShort({ type: res.ok ? 'heavy' : 'light' })
      if (res.ok) {
        this.setData({ streak: this.data.streak + 1, result: { ok: true, payload: '暗号·' + res.orderNo, reason: res.reason + (res.counterPhrase ? ' · 对答：' + res.counterPhrase : '') } })
        // 对答句在结果卡常驻展示，这里只轻提示，避免双弹窗打断连续核销
        wx.showToast({ title: res.counterPhrase ? '对答：' + res.counterPhrase : '已整单核销', icon: 'none', duration: 2500 })
        this.syncList()
        return
      }
      if (res.needConfirm && Array.isArray(res.candidates) && res.candidates.length) {
        this.setData({ result: { ok: false, payload: '暗号', reason: res.reason } })
        return wx.showActionSheet({
          alertText: res.reason,
          itemList: res.candidates.map((c) => (c.contactName || '未留姓名') + ' · ' + c.departDate + ' · ' + c.orderNo),
          success: (tap) => this.phraseVerify({ phrase: body.phrase, orderNo: res.candidates[tap.tapIndex].orderNo }),
          fail: () => {},
        })
      }
      this.setData({ result: { ok: false, payload: '暗号', reason: res.reason } })
    } catch (e) { wx.showToast({ title: e.msg || '核销失败', icon: 'none' }) }
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
    // fail-closed：时间戳缺失或解析成 NaN 一律视为已过期，绝不放行（此前 NaN 会恒判“未过期”）
    const listTs = new Date(String(list.syncedAt || '').replace(' ', 'T')).getTime()
    if (!listTs || Date.now() - listTs > 30 * 60000) return this.setData({ result: { ok: false, reason: '离线名单已过期，请恢复网络刷新' } })
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
    if (this._uploading) return
    const q = wx.getStorageSync(queueKey()) || []
    if (!q.length) return
    this._uploading = true
    try {
      const r = await api.request('/m/verify/offline-batch', 'POST', { items: q })
      // 只移除本次已上传的条目（按凭证号匹配）：上传飞行期间新扫码进队的记录必须保留，
      // 否则会被整体清空覆盖（此前网络恢复自动上传与手点上传并发还会双跑）
      const sent = new Set(q.map((x) => x.passId || x.payload))
      const rest = (wx.getStorageSync(queueKey()) || []).filter((x) => !sent.has(x.passId || x.payload))
      wx.setStorageSync(queueKey(), rest)
      this.refreshOfflineBar()
      this.syncList()
      wx.showModal({
        title: '离线核销已上传',
        content: '成功 ' + r.uploaded + ' 条' + (r.conflicts ? '；' + r.conflicts + ' 条冲突已转人工队列（重复核销/凭证异常）' : ''),
        showCancel: false,
      })
    } catch (e) { wx.showToast({ title: '上传失败，稍后重试', icon: 'none' }) } finally { this._uploading = false }
  },
})
