const api = require('../../utils/api')
Page({
  data: { result: null, lastQr: '', input: '', streak: 0 },
  onShow() { this.setData({ result: null }) },
  scan() {
    // 连续模式：成功后 800ms 自动重开相机（总方案 §10 verify 规格）
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
        if (this._continuous) {
          setTimeout(() => { if (this._continuous) this.scan() }, 800)
          return
        }
      } else {
        this._continuous = false
        this.setData({ result: { ...r, payload } })
      }
    }).catch((e) => {
      this._continuous = false
      this.setData({ result: { ok: false, reason: e.msg || '请求失败', payload } })
    })
  },
})
