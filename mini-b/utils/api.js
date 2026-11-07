const g = () => getApp().globalData
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
          return login(undefined, true).then(() => request(path, method, data, true)).then(resolve, reject)
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
        g().token = d.token; g().merchant = d.merchant; g().role = d.role || 0
        wx.setStorageSync('mtoken', d.token); wx.setStorageSync('merchant', d.merchant || null); wx.setStorageSync('mrole', d.role || 0)
        resolve(d)
      }).catch(reject)
    }, fail: reject })
  })
}
module.exports = { request, login }
