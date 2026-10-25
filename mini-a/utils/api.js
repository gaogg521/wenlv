// API 客户端：token 管理 / wx.login 登录 / 交易链路接口 / 后端不可达时的演示兜底
const g = () => getApp().globalData

function request(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: g().apiBase + path,
      method,
      data,
      header: { Authorization: 'Bearer ' + (g().token || '') },
      success: (res) => {
        if (res.data && res.data.code === 0) return resolve(res.data.data)
        reject(res.data || { msg: '网络错误' })
      },
      fail: (e) => reject({ msg: '服务不可达', detail: e }),
    })
  })
}

/** 登录：wx.login → code → POST /c/auth/login → JWT */
function login() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (r) => {
        request('/c/auth/login', 'POST', { code: r.code }).then((d) => {
          g().token = d.token
          g().user = d.user
          wx.setStorageSync('token', d.token)
          resolve(d)
        }).catch(reject)
      },
      fail: reject,
    })
  })
}

async function ensureLogin() {
  if (g().token) return g().token
  try { await login(); return g().token } catch (e) {
    throw e
  }
}

const FALLBACK = {
  tours: [
    { id: 1, title: '朱家角剧本游 · 江南谜案', cat: 'script', loc: '上海·青浦', days: '1天', price: 29800, beanGift: 298, desc: '实景搜证 · NPC 互动 · 多结局' },
    { id: 2, title: '安吉瑜伽谷 · 2天1夜', cat: 'yoga', loc: '湖州·安吉', days: '2天1夜', price: 68800, beanGift: 688, desc: '竹林冥想 + 晨间流瑜伽 + 山野素食' },
    { id: 3, title: '苏州园林 · 姐姐茶会', cat: 'sister', loc: '苏州·姑苏', days: '1天', price: 39800, beanGift: 398, desc: '旗袍拍摄 + 园林茶会 + 花艺' },
    { id: 4, title: '一大会址 · 红色剧本闯关', cat: 'red', loc: '上海·黄浦', days: '半日', price: 16800, beanGift: 168, desc: '扫码选角色 · 实景解谜' },
  ],
  shop: [
    { id: 11, title: '江南扎染方巾', price: 6800, bean: '可用旅豆抵 10%' },
    { id: 12, title: '安吉白茶 · 明前 50g', price: 12800, bean: '可用旅豆抵 10%' },
    { id: 13, title: '朱家角阿婆粽礼盒', price: 8800, bean: '可用旅豆抵 10%' },
  ],
  cats: [
    { k: 'all', n: '全部' }, { k: 'yoga', n: '瑜伽之旅' }, { k: 'sister', n: '姐姐系列' },
    { k: 'script', n: '剧本闯关' }, { k: 'family', n: '亲子主题' }, { k: 'red', n: '红色文旅' },
  ],
}

async function getTours(cat) {
  try { return await request('/c/tours?cat=' + (cat || 'all')) }
  catch (e) { return cat && cat !== 'all' ? FALLBACK.tours.filter((t) => t.cat === cat) : FALLBACK.tours }
}

async function getTourDetail(id) {
  return await request('/c/tours/' + id)
}

async function getBean() {
  try { return await request('/c/bean/account') }
  catch (e) { return { balance: 1280, lifetime: 4620, rule: '消费返豆 10% · 100 豆≈10 元 · 12 个月有效 · 不可转账' } }
}

/** 下单 → 支付参数（真实 V3 或 MOCK） */
async function createOrder({ sessionId, qty, beanDeduct, promoScene, contactName, contactPhone }) {
  return await request('/c/orders', 'POST', { sessionId, qty, beanDeduct, promoScene, contactName, contactPhone })
}

/** 唤起支付：真实通道走 wx.requestPayment；MOCK 直接轮询订单状态 */
function pay(payParams) {
  return new Promise((resolve, reject) => {
    if (payParams.mock) return resolve({ mock: true }) // 联调：由后台/测试触发回调
    wx.requestPayment({
      timeStamp: payParams.timeStamp, nonceStr: payParams.nonceStr,
      package: payParams.package, signType: payParams.signType, paySign: payParams.paySign,
      success: resolve, fail: reject,
    })
  })
}

async function getOrders() { return await request('/c/orders') }
async function getOrder(no) { return await request('/c/orders/' + no) }
async function getPassCode(passId) { return await request('/c/pass/' + passId + '/code') }
async function getMe() { return await request('/c/me') }
async function refund(no, reason) { return await request('/c/orders/' + no + '/refund', 'POST', { reason }) }
async function getPhoneNumber(code) { return await request('/c/auth/phone', 'POST', { code }) }
async function getPromoQrcode() { return await request('/c/promote/qrcode') }
async function getNotifyTemplates() { return await request('/c/notify/templates') }
async function getReviews(productId) { return await request('/c/tours/' + productId + '/reviews') }
async function postReview(orderNo, rating, content) { return await request('/c/orders/' + orderNo + '/review', 'POST', { rating, content }) }
function img(url) {
  if (!url) return ''
  return /^https?:\/\//.test(url) ? url : g().apiBase + url
}

module.exports = {
  request, login, ensureLogin, getTours, getTourDetail, getBean,
  createOrder, pay, getOrders, getOrder, getPassCode, getMe, refund,
  getPhoneNumber, getPromoQrcode, getNotifyTemplates, getReviews, postReview, img, FALLBACK,
}
