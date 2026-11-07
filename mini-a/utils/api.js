// API 客户端：token 管理 / wx.login 登录 / 交易链路接口 / 演示兜底（仅开发环境）
const g = () => getApp().globalData

// A-18：假业务数据（FALLBACK）只允许在开发者工具/开发版出现（envVersion==='develop'）。
// 体验版/正式版请求失败一律走错误态 + 重试，绝不展示假线路/假余额/假订单。
function demoAllowed() {
  try {
    const env = wx.getAccountInfoSync().miniProgram.envVersion
    return env === 'develop'
  } catch (e) { return false }
}

function request(path, method = 'GET', data = {}, retried = false) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: g().apiBase + path,
      method,
      data,
      header: { Authorization: 'Bearer ' + (g().token || '') },
      success: (res) => {
        if (res.data && res.data.code === 0) return resolve(res.data.data)
        if (res.data && res.data.code === 1002 && path !== '/c/auth/login' && !retried) {
          g().token = ''; wx.removeStorageSync('token')
          return login().then(() => request(path, method, data, true)).then(resolve, reject)
        }
        // A-18：冻结（1003）等业务错误原样上抛，页面显示明确提示，不落假数据
        reject(res.data || { msg: '网络错误' })
      },
      fail: (e) => reject({ msg: '服务不可达', detail: e }),
    })
  })
}

/** 登录：wx.login → code → POST /c/auth/login → JWT */
let pendingLogin = null
function login() {
  if (!pendingLogin) pendingLogin = performLogin().finally(() => { pendingLogin = null })
  return pendingLogin
}
function performLogin() {
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
  // ===== 以下为「后端不可达」时的演示数据集（真机演示/断网兜底）=====
  bean: { balance: 1268, totalIn: 3268, totalOut: 2000, expiring: 0, expiringDate: '' },
  member: {
    nickname: '旅友 3288', memberLevel: 2, avatarUrl: '',
    level: { name: '旅行家', pct: 64, art: '', points: 3268, next: { name: '城市探索官', gapPoints: 1732 } },
  },
  ledger: [
    { tx_no: 'T2026110101', direction: 1, biz_type: 1, amount: 298, created_at: '2026-11-01 14:26' },
    { tx_no: 'T2026103001', direction: 0, biz_type: 4, amount: 68, created_at: '2026-10-30 10:12' },
    { tx_no: 'T2026102801', direction: 1, biz_type: 1, amount: 688, created_at: '2026-10-28 18:03' },
    { tx_no: 'T2026102601', direction: 1, biz_type: 2, amount: 200, created_at: '2026-10-26 09:41' },
  ],
  orders: [
    { order_no: 'WL20261101001', title: '朱家角剧本游 · 江南谜案', status: 30, days_desc: '1天 · 上海·青浦', qty: 1, amount_pay: 29800, created_at: '2026-11-01 14:26' },
    { order_no: 'WL20261028002', title: '安吉瑜伽谷 · 2天1夜', status: 40, days_desc: '2天1夜 · 湖州·安吉', qty: 2, amount_pay: 137600, created_at: '2026-10-28 09:15' },
  ],
  identity: {
    profile: { nickname: '旅友 3288', memberLevel: 2, levelName: '旅行家', growth: 3268 },
    passes: [
      { id: 1, name: '朱家角剧本游 · 通行凭证', status: 2, statusText: '已核销' },
      { id: 2, name: '安吉瑜伽谷 · 山野通行', status: 1, statusText: '待使用' },
    ],
    attestations: [
      { orderNo: 'WL20261028002', hash: '0x8f2c…a91d', anchored: true },
      { orderNo: 'WL20261101001', hash: '0x3e71…c04b', anchored: true },
    ],
  },
  notes: [],
  promoter: { promoter: false, scene: '', customers: [] },
}

async function getTours(cat) {
  return request('/c/tours?cat=' + (cat || 'all'))
}

async function getTourDetail(id) {
  return await request('/c/tours/' + id)
}

async function getBean() {
  await ensureLogin()
  return request('/c/bean/account')
}

/** 下单 → 支付参数（真实 V3 或 MOCK）；phoneTicket = 一键获取手机号的短期凭证（A-08） */
async function createOrder({ sessionId, qty, beanDeduct, promoScene, contactName, contactPhone, phoneTicket }) {
  return await request('/c/orders', 'POST', { sessionId, qty, beanDeduct, promoScene, contactName, contactPhone, phoneTicket })
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
/** 退款试算：与服务端实际扣费同一规则 */
async function refundQuote(no) { return await request('/c/orders/' + no + '/refund-quote') }
async function getPhoneNumber(code) { return await request('/c/auth/phone', 'POST', { code }) }
async function getPromoQrcode() { return await request('/c/promote/qrcode') }
async function getNotifyTemplates() { return await request('/c/notify/templates') }
async function getReviews(productId) { return await request('/c/tours/' + productId + '/reviews') }
async function postReview(orderNo, rating, content) { return await request('/c/orders/' + orderNo + '/review', 'POST', { rating, content }) }
function img(url) {
  if (!url) return ''
  return /^https?:\/\//.test(url) ? url : g().apiBase + url
}

function productImages(product) {
  let images = product.images || []
  if (typeof images === 'string') { try { images = JSON.parse(images) } catch { images = [] } }
  return Array.isArray(images) ? images.filter(u => !isIllustration(u)) : []
}
function isIllustration(url) { return /\.svg(?:[?#]|$)|\/assets\/scenes\//i.test(String(url || '')) }
function isReferencePhoto(url) { return /\/assets\/photos\/|\/uploads\/reference-[a-z-]+-20261107\.jpg(?:[?#]|$)/.test(String(url || '')) }
function photoFor(subject = {}) {
  const name = String(subject.title || subject.name || subject.cityName || '')
  let photo = 'water-town'
  if (subject.cat === 'family' || subject.cat === 'single') photo = 'camp'
  if (subject.cat === 'yoga' || /安吉|竹/.test(name)) photo = 'bamboo'
  if (subject.cat === 'sister' || /苏州|园林|茶会/.test(name)) photo = 'garden'
  if (/方巾|扎染|蓝染|花布/.test(name)) photo = 'cloth'
  else if (/粽/.test(name)) photo = 'zongzi'
  else if (subject.cat === 'shop' || /白茶|茶叶/.test(name)) photo = 'tea'
  return '/assets/photos/' + photo + '.jpg'
}
function businessImage(url, subject) { return !url || isIllustration(url) ? photoFor(subject) : String(url).startsWith('/assets/') ? url : img(url) }
function coverFor(product) {
  const images = productImages(product)
  return images.length ? businessImage(images[0], product) : photoFor(product)
}

module.exports = {
  request, login, ensureLogin, getTours, getTourDetail, getBean,
  createOrder, pay, getOrders, getOrder, getPassCode, getMe, refund, refundQuote,
  getPhoneNumber, getPromoQrcode, getNotifyTemplates, getReviews, postReview, img, coverFor, productImages, businessImage, photoFor, isIllustration, isReferencePhoto, FALLBACK, demoAllowed,
}
