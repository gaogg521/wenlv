// 动态核销码：60s 窗口轮换（HMAC 签名，防截屏重放），倒计时自动刷新
const api = require('../../../utils/api')
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
  onUnload() { this.stop() },
  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null } },
  async refresh() {
    try {
      const code = await api.getPassCode(this.data.id)
      this.setData({ code, cells: this.mockCells(code.qr), fail: false, total: code.expiresIn || 60, left: code.expiresIn || 60 })
      this.startTick()
    } catch (e) {
      this.setData({ fail: true })
      wx.showToast({ title: e.msg || '凭证加载失败', icon: 'none' })
    }
  },
  // 由码载荷确定性生成 15×15 点阵（演示渲染；上线用 canvas/weapp-qrcode 渲染真实二维码）
  mockCells(qr) {
    const N = 15, cells = []
    let h = 2166136261
    for (const ch of String(qr)) { h ^= ch.charCodeAt(0); h = (h * 16777619) >>> 0 }
    for (let i = 0; i < N * N; i++) {
      h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0
      const r = Math.floor(i / N), c = i % N
      const corner = (r < 4 && c < 4) || (r < 4 && c > N - 5) || (r > N - 5 && c < 4)
      cells.push(corner ? !(r === 0 && c === 0) : (h % 100) < 46)
    }
    return cells
  },
  startTick() {
    this.stop()
    this._timer = setInterval(() => {
      const left = this.data.left - 1
      if (left <= 0) { this.refresh() } else { this.setData({ left }) }
    }, 1000)
  },
  markDelivered() {
    wx.showModal({ title: '确认出行', content: '确认已向商户出示并完成核销？', success: (r) => {
      if (r.confirm) wx.navigateBack()
    } })
  },
})
