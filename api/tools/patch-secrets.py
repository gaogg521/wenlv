# -*- coding: utf-8 -*-
import io

# ============ 1) wxpay.mjs：CFG() 改读 secrets（env 兜底） ============
w = io.open('src/domain/wxpay.mjs', encoding='utf-8').read()
old_cfg = """const CFG = () => ({
  appid: process.env.WX_APPID || '',
  mchid: process.env.WX_MCHID || '',
  serial: process.env.WX_SERIAL || '',
  privateKey: process.env.WX_PRIVATE_KEY || (process.env.WX_PRIVATE_KEY_PATH && (() => {
    try { return fs.readFileSync(process.env.WX_PRIVATE_KEY_PATH, 'utf8') } catch { return '' }
  })()) || '',
  notifyUrl: process.env.WX_NOTIFY_URL || '',
})"""
new_cfg = """// 凭据读取：后台集成中心（加密库）优先，.env 兜底（迁移兼容）—— 每次调用实时取，保存即热生效
let _cfgCache = null, _cfgAt = 0
const CFG = () => {
  if (_cfgCache && Date.now() - _cfgAt < 10_000) return _cfgCache
  const env = (k) => process.env[k] || ''
  _cfgCache = {
    _promise: (async () => {
      const { getSecrets } = await import('../infra/secrets.mjs')
      const s = await getSecrets(['WX_APPID', 'WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY', 'WX_NOTIFY_URL'])
      return {
        appid: s.WX_APPID || env('WX_APPID'),
        mchid: s.WX_MCHID || env('WX_MCHID'),
        serial: s.WX_SERIAL || env('WX_SERIAL'),
        privateKey: s.WX_PRIVATE_KEY || env('WX_PRIVATE_KEY') || (env('WX_PRIVATE_KEY_PATH') && (() => { try { return fs.readFileSync(env('WX_PRIVATE_KEY_PATH'), 'utf8') } catch { return '' } })()) || '',
        notifyUrl: s.WX_NOTIFY_URL || env('WX_NOTIFY_URL'),
      }
    })(),
  }
  _cfgAt = Date.now()
  return _cfgCache
}
const CFG_SYNC_FALLBACK = { appid: '', mchid: '', serial: '', privateKey: '', notifyUrl: '' }
// 同步判定用（isLive）：10 秒缓存 + env 兜底，避免 async 泄漏
let _liveCache = null, _liveAt = 0"""
assert old_cfg in w
w = w.replace(old_cfg, new_cfg)

old_live = """export const isLive = () => { const c = CFG(); return !!(c.appid && c.mchid && c.serial && c.privateKey) }"""
new_live = """export const isLive = () => {
  const envLive = !!(process.env.WX_APPID && process.env.WX_MCHID && process.env.WX_SERIAL && (process.env.WX_PRIVATE_KEY || process.env.WX_PRIVATE_KEY_PATH))
  if (envLive) return true
  if (_liveCache !== null && Date.now() - _liveAt < 10_000) return _liveCache
  import('../infra/secrets.mjs').then(async (sec) => {
    const s = await sec.getSecrets(['WX_APPID', 'WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY'])
    _liveCache = !!(s.WX_APPID && s.WX_MCHID && s.WX_SERIAL && s.WX_PRIVATE_KEY)
    _liveAt = Date.now()
  }).catch(() => { _liveCache = false; _liveAt = Date.now() })
  return false // 异步预热首轮保守返回，10 秒缓存后生效
}"""
assert old_live in w
w = w.replace(old_live, new_live)

# async 方法里 CFG() 的用法改 await
w = w.replace("export async function jsapiOrder({ orderNo, amountFen, openid, description }) {\n  if (!isLive()) {",
              "export async function jsapiOrder({ orderNo, amountFen, openid, description }) {\n  const C = await CFG()._promise\n  if (!isLive()) {")
w = w.replace("  const r = await httpJson('POST', '/v3/pay/transactions/jsapi', {\n    appid: CFG().appid, mchid: CFG().mchid,",
              "  const r = await httpJson('POST', '/v3/pay/transactions/jsapi', {\n    appid: C.appid, mchid: C.mchid,")
w = w.replace("  const paySign = rsaSign(`${CFG().appid}\\n${ts}\\n${nonce}\\n${pkg}\\n`)",
              "  const paySign = rsaSign(`${C.appid}\\n${ts}\\n${nonce}\\n${pkg}\\n`)")
w = w.replace("function authHeader(method, urlPath, body = '') {", "function authHeaderSync(method, urlPath, body = '') {")
# authHeader 改 async 版（私钥来自 secrets）
old_auth = """function authHeaderSync(method, urlPath, body = '') {
  const ts = Math.floor(Date.now() / 1000)
  const nonce = crypto.randomBytes(16).toString('hex')
  const message = `${method}\\n${urlPath}\\n${ts}\\n${nonce}\\n${body}\\n`
  const signature = rsaSign(message)
  const { mchid, serial } = CFG()
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${ts}",serial_no="${serial}"`
}"""
new_auth = """async function authHeader(method, urlPath, body = '') {
  const ts = Math.floor(Date.now() / 1000)
  const nonce = crypto.randomBytes(16).toString('hex')
  const message = `${method}\\n${urlPath}\\n${ts}\\n${nonce}\\n${body}\\n`
  const signature = rsaSign(message)
  const { mchid, serial } = await CFG()._promise
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${ts}",serial_no="${serial}"`
}"""
assert old_auth in w
w = w.replace(old_auth, new_auth)
w = w.replace("Authorization: authHeader(method, urlPath, body),", "Authorization: await authHeader(method, urlPath, body),")
io.open('src/domain/wxpay.mjs', 'w', encoding='utf-8', newline='\n').write(w)
print('wxpay -> secrets')

# ============ 2) wxsec.mjs / mfa.mjs：SMS/SMTP 检测读 secrets ============
sec = io.open('src/infra/wxsec.mjs', encoding='utf-8').read()
old_at = """  const appid = process.env.WX_APPID, secret = process.env.WX_SECRET
  if (!appid || !secret) return null // MOCK 模式"""
new_at = """  const { getSecrets } = await import('./secrets.mjs')
  const s = await getSecrets(['WX_APPID', 'WX_SECRET'])
  const appid = s.WX_APPID || process.env.WX_APPID, secret = s.WX_SECRET || process.env.WX_SECRET
  if (!appid || !secret) return null // MOCK 模式"""
assert old_at in sec
sec = sec.replace(old_at, new_at)
io.open('src/infra/wxsec.mjs', 'w', encoding='utf-8', newline='\n').write(sec)
print('wxsec -> secrets')

m = io.open('src/infra/mfa.mjs', encoding='utf-8').read()
old_tx = "const TX_SMS = () => process.env.SMS_TENCENT_SECRET_ID && process.env.SMS_TENCENT_SECRET_KEY\nconst SMTP = () => process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS"
new_tx = """// 凭据检测：secrets（后台集成中心）优先，env 兜底
let _det = null, _detAt = 0
async function detect() {
  if (_det && Date.now() - _detAt < 10_000) return _det
  const { getSecrets } = await import('./secrets.mjs')
  const s = await getSecrets(['SMS_TENCENT_SECRET_ID', 'SMS_TENCENT_SECRET_KEY', 'SMS_TENCENT_SDKAPPID', 'SMS_TENCENT_SIGN', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'])
  _det = {
    sms: !!(s.SMS_TENCENT_SECRET_ID && s.SMS_TENCENT_SECRET_KEY) || !!(process.env.SMS_TENCENT_SECRET_ID && process.env.SMS_TENCENT_SECRET_KEY),
    smtp: !!(s.SMTP_HOST && s.SMTP_USER && s.SMTP_PASS) || !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    s,
  }
  _detAt = Date.now()
  return _det
}"""
assert old_tx in m
m = m.replace(old_tx, new_tx)
m = m.replace("if (channel === 'sms') {\n    if (TX_SMS()) await sendSmsReal(target, code).catch(() => {})",
              "if (channel === 'sms') {\n    if ((await detect()).sms) await sendSmsReal(target, code).catch(() => {})")
m = m.replace("  } else {\n    if (SMTP()) await sendEmailReal(target, code).catch(() => {})",
              "  } else {\n    if ((await detect()).smtp) await sendEmailReal(target, code).catch(() => {})")
m = m.replace("return { sent: true, mock: !(channel === 'sms' ? TX_SMS() : SMTP()) }",
              "return { sent: true, mock: !(channel === 'sms' ? (await detect()).sms : (await detect()).smtp) }")
io.open('src/infra/mfa.mjs', 'w', encoding='utf-8', newline='\n').write(m)
print('mfa -> secrets')

# ============ 3) routes：集成中心 ============
r = io.open('src/routes.mjs', encoding='utf-8').read()
anchor = "// ---------- 存证中心 / 公开验证 / 用户数字身份 ----------"
add = '''// ---------- 集成中心（第三方凭据后台化：.env 仅自举）----------
const integrations = {
  'GET /admin/integrations': async (req) => {
    await requireAdmin(req, ['super'])
    const { listSecretMeta } = await import('./infra/secrets.mjs')
    const { getSecrets } = await import('./infra/secrets.mjs')
    const stored = Object.fromEntries((await listSecretMeta()).map((r2) => [r2.k, r2.hint]))
    const s = await getSecrets(['WX_APPID', 'WX_SECRET', 'WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY', 'WX_NOTIFY_URL',
      'SMS_TENCENT_SECRET_ID', 'SMS_TENCENT_SECRET_KEY', 'SMS_TENCENT_SDKAPPID', 'SMS_TENCENT_SIGN',
      'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'])
    const ch = (keys, name, desc) => ({ name, desc, ready: keys.every((k) => !!s[k]),
      fields: keys.map((k) => ({ key: k, envFallback: !!process.env[k], stored: stored[k] || null })) })
    return {
      envNote: '.env 只保留自举：DB 连接、JWT_SECRET、ADMIN_INIT_PASSWORD；其余凭据在本页保存（AES-256-GCM 加密落库）',
      channels: [
        ch(['WX_APPID', 'WX_SECRET'], '微信小程序登录', 'code2Session（未配置=mock openid 联调）'),
        ch(['WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY', 'WX_NOTIFY_URL'], '微信支付 V3', '未配置=MOCK 通道（不真实收款）'),
        ch(['SMS_TENCENT_SECRET_ID', 'SMS_TENCENT_SECRET_KEY'], '腾讯云短信', 'MFA/通知短信（未配置=MOCK 后台可见）'),
        ch(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'], '邮箱 SMTP', 'MFA/通知邮件（未配置=MOCK）'),
      ],
    }
  },
  'POST /admin/integrations/:key': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { value } = req.body
    if (!value || String(value).length < 4) throw new BizError(1001, '凭据长度至少 4 位')
    const { setSecret } = await import('./infra/secrets.mjs')
    await setSecret(req.params.key, String(value), 'admin:' + a.name)
    await tx(async (c) => audit(c, 'admin:' + a.name, 'integration', 'set', req.params.key, null, { len: String(value).length }))
    return { key: req.params.key, saved: true }
  },
  'DELETE /admin/integrations/:key': async (req) => {
    const a = await requireAdmin(req, ['super'])
    const { delSecret } = await import('./infra/secrets.mjs')
    await delSecret(req.params.key)
    await tx(async (c) => audit(c, 'admin:' + a.name, 'integration', 'delete', req.params.key, null, null))
    return { deleted: true }
  },
}

''' + anchor
assert anchor in r
r = r.replace(anchor, add, 1)
old_exp = "...cWithdraw, ...cPromo, ...web3, ...open, ...cIdentity, ...cNotes, ...callback }"
new_exp = "...cWithdraw, ...cPromo, ...integrations, ...web3, ...open, ...cIdentity, ...cNotes, ...callback }"
assert old_exp in r
r = r.replace(old_exp, new_exp)
io.open('src/routes.mjs', 'w', encoding='utf-8', newline='\n').write(r)
print('routes: integration center')
