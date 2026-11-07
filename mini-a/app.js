// 向往的自由 · 小程序 A（游客主站 · 总方案 V3.1 §9）
// tabBar 5 个（D14 赵老师拍板商城一级位）

// ===== 后端地址：按 envVersion 分环境（A-19）=====
// develop（开发者工具/开发版）：模拟器走本机回环；真机走电脑局域网 IP（ipconfig 查看 WLAN IPv4，变了只改 LAN_IP）
// trial（体验版）/ release（正式版）：必须是 HTTPS 合法域名（小程序后台「服务器域名」已备案配置的地址）。
// 注意：正式域名为占位常量，提审前由负责人改成真实 HTTPS 域名；静态校验保证 trial/release 分支不可能请求 http 或内网地址。
const LAN_IP = '172.29.128.120'
const API_BASE_DEV = 'http://127.0.0.1:8080'
const API_BASE_LAN = 'http://' + LAN_IP + ':8080'
const API_BASE_RELEASE = 'https://api.wenlv.example'

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
  }
})
