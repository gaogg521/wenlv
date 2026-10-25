const g = () => getApp().globalData
function request(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: g().apiBase + path, method,
      data, header: { Authorization: 'Bearer ' + (g().token || '') },
      success: (res) => { res.data && res.data.code === 0 ? resolve(res.data.data) : reject(res.data || { msg: '网络错误' }) },
      fail: (e) => reject({ msg: '服务不可达', detail: e }),
    })
  })
}
function login(merchantId) {
  return new Promise((resolve, reject) => {
    wx.login({ success: (r) => {
      request('/m/auth/login', 'POST', { code: r.code, merchantId }).then((d) => {
        g().token = d.token; g().merchant = d.merchant; g().role = d.role
        wx.setStorageSync('mtoken', d.token); wx.setStorageSync('merchant', d.merchant)
        resolve(d)
      }).catch(reject)
    }, fail: reject })
  })
}
module.exports = { request, login }
