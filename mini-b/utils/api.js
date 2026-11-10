const g = () => getApp().globalData
// 只供开发版连接本机/局域网演示API；正式版即使残留存储也不能使用。
function canDemoLogin() {
  try {
    const env = wx.getAccountInfoSync().miniProgram.envVersion
    const host = String(g().apiBase || '').match(/^http:\/\/([^/:]+)(?::\d+)?\/?$/)
    return env === 'develop' && !!host && /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host[1])
  } catch (e) { return false }
}
function saveSession(d, mode) {
  g().token = d.token; g().merchant = d.merchant || null; g().role = d.role || 0
  wx.setStorageSync('mtoken', d.token); wx.setStorageSync('merchant', d.merchant || null); wx.setStorageSync('mrole', d.role || 0)
  if (mode === 'demo') wx.setStorageSync('mloginMode', mode)
  else wx.removeStorageSync('mloginMode')
  const pages = getCurrentPages(), page = pages[pages.length - 1]
  const bar = page && page.getTabBar && page.getTabBar()
  if (bar && bar.sync) bar.sync()
  return d
}
let pendingDemo = null
function demoLogin() {
  if (!canDemoLogin()) return Promise.reject({ msg: '演示登录仅限开发版连接本机或局域网演示环境' })
  if (pendingDemo) return pendingDemo
  pendingDemo = request('/m/auth/login', 'POST', { code: 'mock-chenjie', merchantId: 1 })
    .then(d => {
      if (!d.token || !d.merchant || Number(d.merchant.id) !== 1 || Number(d.role) !== 2) throw { msg: '演示门店或店长账号不可用，请联系维护人员' }
      return saveSession(d, 'demo')
    }).finally(() => { pendingDemo = null })
  return pendingDemo
}
function request(path, method = 'GET', data = {}, retried = false) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: g().apiBase + path, method,
      data, header: { Authorization: 'Bearer ' + (g().token || '') },
      success: (res) => {
        if (res.data && res.data.code === 0) return resolve(res.data.data)
        // A-35：令牌过期（1002）自动重登一次再重放原请求，此前只会报错让用户干瞪眼
        if (res.data && res.data.code === 1002 && path !== '/m/auth/login' && !retried) {
          getApp().globalData.token = ''; wx.removeStorageSync('mtoken')
          const relogin = wx.getStorageSync('mloginMode') === 'demo' ? demoLogin() : login(g().merchant && g().merchant.id, true)
          return relogin.then(() => request(path, method, data, true)).then(resolve, reject)
        }
        reject(res.data || { msg: '网络错误' })
      },
      fail: (e) => reject({ msg: '服务不可达', detail: e, network: true }),
    })
  })
}
function login(merchantId, retried) {
  return new Promise((resolve, reject) => {
    wx.login({ success: (r) => {
      request('/m/auth/login', 'POST', { code: r.code, merchantId }, retried).then((d) => {
        saveSession(d, 'wechat')
        resolve(d)
      }).catch(reject)
    }, fail: reject })
  })
}
async function switchStore(merchantId) {
  const d = await request('/m/auth/switch', 'POST', { merchantId })
  // Replace the session and discard all page state by relaunching the workbench.
  saveSession(d, 'wechat')
  wx.reLaunch({ url: '/pages/index/index' })
  return d
}
module.exports = { request, login, demoLogin, canDemoLogin, switchStore }
