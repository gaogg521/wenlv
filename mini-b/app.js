// 商户小程序 B · 后端地址按 envVersion 分环境（A-19）
// develop：本机回环 / 局域网真机联调；trial / release：HTTPS 合法域名（提审前由负责人改成真实域名，静态校验兜底）
const LAN_IP = '172.29.128.120'
const API_BASE_DEV = 'http://127.0.0.1:8080'
const API_BASE_LAN = 'http://' + LAN_IP + ':8080'
const API_BASE_RELEASE = 'https://api.wenlv.example'

function apiBaseForEnv() {
  let env = 'develop'
  try { env = wx.getAccountInfoSync().miniProgram.envVersion || 'develop' } catch (e) { /* 老基础库兜底 */ }
  if (env === 'trial' || env === 'release') return API_BASE_RELEASE
  try { return wx.getDeviceInfo().platform === 'devtools' ? API_BASE_DEV : API_BASE_LAN } catch (e) { return API_BASE_DEV }
}

App({
  globalData: { apiBase: apiBaseForEnv(), token: '', merchant: null, role: 0 },
  onLaunch() { const t = wx.getStorageSync('mtoken'); if (t) this.globalData.token = t; this.globalData.merchant = wx.getStorageSync('merchant') || null; this.globalData.role = wx.getStorageSync('mrole') || 0 },
})
