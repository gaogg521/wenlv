// 向往的自由 · 小程序 A（游客主站 · 总方案 V3.1 §9）
// tabBar 5 个（D14 赵老师拍板商城一级位）；本骨架 P0 联调后端 http://127.0.0.1:8080

// ===== 后端地址（开发联调用，上线换 https + 合法域名）=====
// 模拟器走本机回环；真机（预览/体验）走电脑的局域网 IP——手机需与电脑同一 WiFi。
// 电脑 IP 变了只改这一行（ipconfig 查看 WLAN 的 IPv4）。
const LAN_IP = '172.29.128.120'
const API_BASE_DEVTOOLS = 'http://127.0.0.1:8080'
const API_BASE_LAN = 'http://' + LAN_IP + ':8080'

App({
  globalData: {
    apiBase: API_BASE_DEVTOOLS, // onLaunch 里按运行环境覆写
    token: '',
    user: null,
    beanBalance: 0
  },
  onLaunch() {
    const token = wx.getStorageSync('token')
    if (token) this.globalData.token = token
    // 真机（android/ios）走局域网 IP；开发者工具走本机回环
    try {
      const plat = wx.getDeviceInfo().platform
      this.globalData.apiBase = plat === 'devtools' ? API_BASE_DEVTOOLS : API_BASE_LAN
    } catch (e) { /* 老基础库兜底：保持本机地址 */ }
  }
})
