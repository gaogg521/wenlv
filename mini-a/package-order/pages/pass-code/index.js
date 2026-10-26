// 动态核销码：60s 窗口轮换（HMAC 签名，防截屏重放），倒计时自动刷新
const api = require('../../../utils/api')
const qrcode = require('../../../utils/qrcode')
Page({
  data: { id: 0, code: null, left: 60, total: 60, fail: false },
  onLoad(q) {
    this.setData({ id: Number(q.id), orderNo: q.orderNo || '' })
    this.refresh()
    this.loadPhrase()
  },
  // 剧本游暗号（V14）：出票后显示"入戏"开场白
  async loadPhrase() {
    try {
      const no = this.data.orderNo || (this.data.code && this.data.code.orderNo)
      if (!no) return
      const ph = await api.request('/c/orders/' + no + '/phrase')
      if (ph && ph.enabled) this.setData({ phrase: ph.userPhrase, phraseHint: ph.hint })
    } catch (e) { /* 非剧本游产品无暗号，静默 */ }
  },
  onHide() { this.stop() },
  onShow() { if (this.data.code) this.refresh() },
  onUnload() { this.stop() },
  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null } },
  async refresh() {
    try {
      const code = await api.getPassCode(this.data.id)
      this.setData({ code, ...this.qrCells(code.qr), fail: false, total: code.expiresIn || 60, left: code.expiresIn || 60 })
      this.startTick()
    } catch (e) {
      this.setData({ fail: true })
      wx.showToast({ title: e.msg || '凭证加载失败', icon: 'none' })
    }
  },
  qrCells(payload) {
    const qr = qrcode(0, 'M')
    qr.addData(String(payload))
    qr.make()
    const n = qr.getModuleCount(), size = n + 8, cells = []
    for (let y = -4; y < n + 4; y++) {
      for (let x = -4; x < n + 4; x++) cells.push(y >= 0 && x >= 0 && y < n && x < n && qr.isDark(y, x))
    }
    return { cells, qrSize: size }
  },
  startTick() {
    this.stop()
    this._timer = setInterval(() => {
      const left = this.data.left - 1
      if (left <= 0) { this.refresh() } else { this.setData({ left }) }
    }, 1000)
  },
  markDelivered() { wx.navigateBack() },
})
