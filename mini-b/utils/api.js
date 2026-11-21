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
  // V94:登录/切换门店即拉取最新权限快照(旧门店的权限快照不再复用)
  refreshPerms(true)
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
// V94 权限快照:PC 平台后台下发的最新权限版本与授权集合;仅更高版本可覆盖本地(乱序响应不能恢复旧授权)。
// 登录/回前台/进入供给与申请页时刷新;请求被 2101(权限已更新)拒绝时刷新后重放。
// 并发刷新串行化:同一时刻只放一个请求在飞;写入前实时重读本地版本并要求"严格更高"——
// 两个响应乱序返回时,后到的旧版本不会覆盖已落库的新版本(退回项1)。
let _permRefreshing = null
function refreshPerms(force) {
  if (!g().token) return Promise.resolve(null)
  const run = () => new Promise((resolve) => {
    wx.request({
      url: g().apiBase + '/m/perm/snapshot', method: 'GET',
      header: { Authorization: 'Bearer ' + (g().token || '') },
      success: (res) => {
        if (res.data && res.data.code === 0 && res.data.data) {
          const snap = res.data.data
          // 写入前实时重读本地(不能用调用时捕获的旧基线,否则并发下旧响应覆盖新版本)
          const cur = wx.getStorageSync('mperm') || null
          if (!cur || Number(snap.version) > Number(cur.version)) {
            wx.setStorageSync('mperm', snap)
            g().permVersion = Number(snap.version); g().perms = snap.perms || {}
          }
        }
        resolve(wx.getStorageSync('mperm') || null)
      },
      fail: () => resolve(wx.getStorageSync('mperm') || null), // 离线时保留上次快照;提交侧服务端始终重新解析
    })
  })
  const chain = _permRefreshing ? _permRefreshing.then(run, run) : run()
  _permRefreshing = chain.then(() => null, () => null)
  return chain
}
/** 读取有效权限(供页面判定入口/字段展示):perms[resKind][action] = {allowed, fields[]} */
function permsFor() {
  return g().perms || (wx.getStorageSync('mperm') || {}).perms || {}
}
function request(path, method = 'GET', data = {}, retried = false) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: g().apiBase + path, method,
      data, header: { Authorization: 'Bearer ' + (g().token || ''), 'X-Perm-Version': String((wx.getStorageSync('mperm') || {}).version || '') },
      success: (res) => {
        if (res.data && res.data.code === 0) return resolve(res.data.data)
        // V94:权限版本落后(2101)→ 刷新权限快照后重放一次;服务端始终按库内最新权限判定,旧会话无法绕过
        if (res.data && res.data.code === 2101 && !retried) {
          return refreshPerms(true).then(() => request(path, method, data, true)).then(resolve, reject)
        }
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
module.exports = { request, login, demoLogin, canDemoLogin, switchStore, refreshPerms, permsFor }
