// 向往的自由 · 小程序 A（游客主站 · 总方案 V3.1 §9）
// tabBar 5 个（D14 赵老师拍板商城一级位）

// ===== 后端地址：按 envVersion 分环境（A-19）=====
// develop（开发者工具）：模拟器走本机回环 127.0.0.1:8080
// develop（真机）/ trial（体验版）/ release（正式版）：统一走公网 https://api.1work.vip（已备案域名 + Let's Encrypt 证书）
// 静态校验仍保证 trial/release 分支不可能请求 http 或内网地址。
const LAN_IP = '172.29.128.120'
const API_BASE_DEV = 'http://127.0.0.1:8080'
// 真机（开发版/体验版/正式版）统一走公网，任何网络都可用；
// 需要局域网联调时，把 API_BASE_LAN 临时改回 'http://' + LAN_IP + ':8080'
const API_BASE_LAN = 'https://api.1work.vip'
const API_BASE_RELEASE = 'https://api.1work.vip'

function apiBaseForEnv() {
  let env = 'develop'
  try { env = wx.getAccountInfoSync().miniProgram.envVersion || 'develop' } catch (e) { /* 老基础库兜底 */ }
  if (env === 'trial' || env === 'release') return API_BASE_RELEASE
  // develop：真机（android/ios 开发版）走局域网 IP；开发者工具走本机回环
  try { return wx.getDeviceInfo().platform === 'devtools' ? API_BASE_DEV : API_BASE_LAN } catch (e) { return API_BASE_DEV }
}

App({
  globalData: {
    apiBase: apiBaseForEnv(),
    token: '',
    user: null,
    beanBalance: 0
  },
  onLaunch() {
    const token = wx.getStorageSync('token')
    if (token) this.globalData.token = token
    // X-01/X-02：启动时拉取三端统一字典（订单状态文案/城市/品类），失败静默走内置兜底
    require('./utils/dict').warmup()
  }
})
