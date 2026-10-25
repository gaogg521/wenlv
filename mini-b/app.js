App({
  globalData: { apiBase: 'http://127.0.0.1:8080', token: '', merchant: null, role: 0 },
  onLaunch() { const t = wx.getStorageSync('mtoken'); if (t) this.globalData.token = t },
})
