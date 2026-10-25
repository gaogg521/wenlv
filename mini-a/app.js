// 向往的自由 · 小程序 A（游客主站 · 总方案 V3.1 §9）
// tabBar 5 个（D14 赵老师拍板商城一级位）；本骨架 P0 联调后端 http://127.0.0.1:8080
App({
  globalData: {
    apiBase: 'http://127.0.0.1:8080', // 开发联调；上线换 https + 合法域名
    token: '',
    user: null,
    beanBalance: 0
  },
  onLaunch() {
    const token = wx.getStorageSync('token')
    if (token) this.globalData.token = token
  }
})
