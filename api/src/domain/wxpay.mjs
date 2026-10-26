// 微信支付 V3 通道（电商收付通/普通商户通用于此层适配）：
// 配置了商户凭据 → 真实 V3 API（RSA-SHA256 签名，node 内置 crypto/https，零额外依赖）；
// 未配置 → MOCK 模式（开发联调：jsapi 返回 mock prepay，回调由测试/后台触发）。
// 上产清单：WX_APPID / WX_MCHID / WX_SERIAL / WX_PRIVATE_KEY_PATH(/内容) / WX_NOTIFY_URL
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'

// 凭据读取：后台集成中心（加密库）优先，.env 兜底（迁移兼容）—— 每次调用实时取，保存即热生效
let _cfgCache = null, _cfgAt = 0
export function invalidateConfig() { _cfgCache = null; _cfgAt = 0; _liveCache = null; _liveAt = 0 }
const CFG = () => {
  if (_cfgCache && Date.now() - _cfgAt < 10_000) return _cfgCache
  const env = (k) => process.env[k] || ''
  _cfgCache = {
    _promise: (async () => {
      const { getSecrets } = await import('../infra/secrets.mjs')
      const s = await getSecrets(['WX_APPID', 'WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY', 'WX_NOTIFY_URL'])
      const config = {
        appid: s.WX_APPID || env('WX_APPID'),
        mchid: s.WX_MCHID || env('WX_MCHID'),
        serial: s.WX_SERIAL || env('WX_SERIAL'),
        privateKey: s.WX_PRIVATE_KEY || env('WX_PRIVATE_KEY') || (env('WX_PRIVATE_KEY_PATH') && (() => { try { return fs.readFileSync(env('WX_PRIVATE_KEY_PATH'), 'utf8') } catch { return '' } })()) || '',
        notifyUrl: s.WX_NOTIFY_URL || env('WX_NOTIFY_URL'),
      }
      _liveCache = !!(config.appid && config.mchid && config.serial && config.privateKey)
      _liveAt = Date.now()
      return config
    })(),
  }
  _cfgAt = Date.now()
  return _cfgCache
}
const CFG_SYNC_FALLBACK = { appid: '', mchid: '', serial: '', privateKey: '', notifyUrl: '' }
// 同步判定用（isLive）：10 秒缓存 + env 兜底，避免 async 泄漏
let _liveCache = null, _liveAt = 0

export const isLive = () => {
  const envLive = !!(process.env.WX_APPID && process.env.WX_MCHID && process.env.WX_SERIAL && (process.env.WX_PRIVATE_KEY || process.env.WX_PRIVATE_KEY_PATH))
  if (envLive) return true
  if (_liveCache !== null && Date.now() - _liveAt < 10_000) return _liveCache
  import('../infra/secrets.mjs').then(async (sec) => {
    const s = await sec.getSecrets(['WX_APPID', 'WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY'])
    _liveCache = !!(s.WX_APPID && s.WX_MCHID && s.WX_SERIAL && s.WX_PRIVATE_KEY)
    _liveAt = Date.now()
  }).catch(() => { _liveCache = false; _liveAt = Date.now() })
  return false // 异步预热首轮保守返回，10 秒缓存后生效
}

async function rsaSign(str) {
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(str)
  return signer.sign((await CFG()._promise).privateKey, 'base64')
}

async function authHeader(method, urlPath, body = '') {
  const ts = Math.floor(Date.now() / 1000)
  const nonce = crypto.randomBytes(16).toString('hex')
  const message = `${method}\n${urlPath}\n${ts}\n${nonce}\n${body}\n`
  const signature = await rsaSign(message)
  const { mchid, serial } = await CFG()._promise
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${ts}",serial_no="${serial}"`
}

async function httpJson(method, urlPath, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : ''
  const auth = await authHeader(method, urlPath, body)
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.mch.weixin.qq.com', path: urlPath, method,
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        Authorization: auth,
        'User-Agent': 'wanderlust/1.0',
      },
    }, (res) => {
      let buf = ''
      res.on('data', (c) => (buf += c))
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf || '{}') }) } catch { resolve({ status: res.statusCode, data: { raw: buf } }) }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/**
 * JSAPI 下单 → 返回小程序 wx.requestPayment 所需 paySign 参数。
 * MOCK 模式返回 mock 参数（前端直接进入待支付态，由测试/后台触发回调）。
 */
export async function jsapiOrder({ orderNo, amountFen, openid, description }) {
  const C = await CFG()._promise
  if (!(C.appid && C.mchid && C.serial && C.privateKey)) {
    if (process.env.NODE_ENV === 'production') throw new Error('微信支付凭据未配置完整')
    // MOCK 通道：模拟真实支付的异步回调——1.2s 后服务端自触发支付成功通知，
    // 小程序端 pay-result 轮询即可看到出票（生产由微信 /callback/wxpay 真实回调）
    setTimeout(async () => {
      try {
        const routes = await import('../routes.mjs')
        await routes.handlePayNotify(orderNo, 'MOCK' + Date.now(), true)
        console.log('[wxpay:mock] 自动回调出票', orderNo)
      } catch (e) { console.error('[wxpay:mock] 自动回调失败', orderNo, e.message) }
    }, 1200)
    return { mock: true, timeStamp: String(Math.floor(Date.now() / 1000)), nonceStr: 'mock' + orderNo,
      package: 'prepay_id=mock_' + orderNo, signType: 'RSA', paySign: 'MOCKSIGN' + orderNo }
  }
  const r = await httpJson('POST', '/v3/pay/transactions/jsapi', {
    appid: C.appid, mchid: C.mchid, description, out_trade_no: orderNo,
    notify_url: C.notifyUrl,
    amount: { total: amountFen, currency: 'CNY' },
    payer: { openid },
  })
  if (r.status !== 200 || !r.data.prepay_id) throw new Error('wxpay jsapi failed: ' + JSON.stringify(r.data))
  const ts = String(Math.floor(Date.now() / 1000))
  const nonce = crypto.randomBytes(16).toString('hex')
  const pkg = 'prepay_id=' + r.data.prepay_id
  const paySign = await rsaSign(`${C.appid}\n${ts}\n${nonce}\n${pkg}\n`)
  return { mock: false, timeStamp: ts, nonceStr: nonce, package: pkg, signType: 'RSA', paySign }
}

/** V3 退款（真实模式）；MOCK 直接成功 */
export async function refund({ orderNo, refundNo, amountFen, totalFen, reason }) {
  const C = await CFG()._promise
  if (!(C.appid && C.mchid && C.serial && C.privateKey)) {
    if (process.env.NODE_ENV === 'production') throw new Error('微信支付凭据未配置完整')
    return { mock: true, refundNo, status: 'SUCCESS' }
  }
  const r = await httpJson('POST', '/v3/refund/domestic/refunds', {
    out_trade_no: orderNo, out_refund_no: refundNo,
    amount: { refund: amountFen, total: totalFen, currency: 'CNY' }, reason,
  })
  if (r.status < 200 || r.status >= 300) throw new Error('微信退款失败：' + (r.data.message || r.status))
  return { mock: false, status: r.data.status, refundNo }
}

/** 商家转账（V3 /v3/transfer/batches）：提现自动打款。MOCK 返回受理号。 */
export async function queryRefund(refundNo) {
  const r = await httpJson('GET', '/v3/refund/domestic/refunds/' + encodeURIComponent(refundNo))
  if (r.status !== 200) throw new Error('退款查询失败')
  return r.data
}

export async function merchantTransfer({ outBatchNo, totalFen, remark, openid }) {
  const C = await CFG()._promise
  if (!(C.appid && C.mchid && C.serial && C.privateKey)) {
    if (process.env.NODE_ENV === 'production') throw new Error('微信支付凭据未配置完整')
    return { mock: true, batchNo: 'MOCK-' + outBatchNo, status: 'ACCEPTED' }
  }
  if (!openid) throw new Error('缺少真实收款人 openid')
  const r = await httpJson('POST', '/v3/transfer/batches', {
    appid: C.appid, out_batch_no: outBatchNo,
    batch_name: '推广服务费', batch_remark: remark || '推广服务费结算',
    total_amount: totalFen, total_num: 1,
    transfer_detail_list: [{ out_detail_no: outBatchNo + '-D1', transfer_amount: totalFen, transfer_remark: remark || '推广服务费', openid }],
  })
  if (r.status < 200 || r.status >= 300) throw new Error('微信转账失败：' + (r.data.message || r.status))
  return { mock: false, batchNo: r.data.batch_id, status: r.data.batch_status }
}

/** 回调仅接受验签与解密通过的微信交易，开发模式也不接受公开明文通知。 */
export async function verifyCallback(headers, rawBody) {
  // 生产：加载 WX_PLATFORM_CERT（微信支付公钥）验 Wechatpay-Signature
  const sig = headers['wechatpay-signature']
  const ts = headers['wechatpay-timestamp']
  const nonce = headers['wechatpay-nonce']
  const { getSecrets } = await import('../infra/secrets.mjs')
  const s = await getSecrets(['WX_PLATFORM_PUBLIC_KEY', 'WX_API_V3_KEY', 'WX_PLATFORM_SERIAL'])
  let pub = s.WX_PLATFORM_PUBLIC_KEY || ''
  if (pub && !pub.includes('BEGIN')) pub = fs.readFileSync(pub, 'utf8')
  if (!sig || !ts || !nonce || !pub) return { ok: false, reason: 'callback verify not configured' }
  if (!Number.isFinite(Number(ts)) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return { ok: false, reason: 'callback expired' }
  if (s.WX_PLATFORM_SERIAL && headers['wechatpay-serial'] !== s.WX_PLATFORM_SERIAL) return { ok: false, reason: 'unknown platform serial' }
  const verifier = crypto.createVerify('RSA-SHA256')
  verifier.update(`${ts}\n${nonce}\n${rawBody}\n`)
  const ok = verifier.verify(pub, sig, 'base64')
  if (!ok) return { ok: false, reason: 'signature mismatch' }
  const { resource, event_type: eventType } = JSON.parse(rawBody)
  if (eventType !== 'TRANSACTION.SUCCESS' || resource?.algorithm !== 'AEAD_AES_256_GCM') return { ok: false, reason: 'unsupported event' }
  const encrypted = Buffer.from(resource.ciphertext, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(s.WX_API_V3_KEY, 'utf8'), Buffer.from(resource.nonce, 'utf8'))
  decipher.setAuthTag(encrypted.subarray(-16))
  decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'))
  const transaction = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'))
  const C = await CFG()._promise
  if (transaction.appid !== C.appid || transaction.mchid !== C.mchid || transaction.trade_state !== 'SUCCESS') return { ok: false, reason: 'transaction identity mismatch' }
  return { ok: true, transaction }
}
