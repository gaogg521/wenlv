// 只读就绪核对：不改配置、不发送短信/通知、不支付；只输出存在性与阻塞原因。
// node --env-file=.env scripts/readiness.mjs [--live-wechat]
import { getSecrets, secretsHealth } from '../src/infra/secrets.mjs'
import { legalDocuments, legalVersions } from '../src/domain/legal.mjs'
import { closeDb, q } from '../src/db.mjs'
import { isLegacyPlainId } from '../src/infra/idcard.mjs'
import fs from 'node:fs'

const keys = ['WX_APPID', 'WX_SECRET', 'WX_B_APPID', 'WX_B_SECRET', 'WX_MCHID', 'WX_SERIAL', 'WX_PRIVATE_KEY', 'WX_PRIVATE_KEY_PATH', 'WX_NOTIFY_URL', 'WX_API_V3_KEY', 'WX_PLATFORM_PUBLIC_KEY', 'WX_PLATFORM_SERIAL', 'WX_TMPL_PAY_OK', 'WX_TMPL_GROUP_CANCEL', 'WX_CALLBACK_TOKEN', 'WX_CALLBACK_AES_KEY', 'SMS_TENCENT_SECRET_ID', 'SMS_TENCENT_SECRET_KEY', 'SMS_TENCENT_SDKAPPID', 'SMS_TENCENT_SIGN', 'SMS_TENCENT_TEMPLATE_ID']
try {
  const s = await getSecrets(keys)
  const configured = Object.fromEntries(keys.map(k => [k, !!(s[k] || process.env[k])]))
  if (process.env.WX_PRIVATE_KEY_PATH) configured.WX_PRIVATE_KEY_PATH = fs.existsSync(process.env.WX_PRIVATE_KEY_PATH)
  const blockers = [], requireKeys = (name, list) => { const missing = list.filter(k => !configured[k]); if (missing.length) blockers.push({ item: name, missing }) }
  requireKeys('游客微信登录', ['WX_APPID', 'WX_SECRET'])
  requireKeys('商户微信登录', ['WX_B_APPID', 'WX_B_SECRET'])
  requireKeys('订阅通知', ['WX_TMPL_PAY_OK', 'WX_TMPL_GROUP_CANCEL'])
  requireKeys('图片审核安全回执', ['WX_CALLBACK_TOKEN', 'WX_CALLBACK_AES_KEY'])
  requireKeys('微信支付', ['WX_MCHID', 'WX_SERIAL', 'WX_NOTIFY_URL', 'WX_API_V3_KEY', 'WX_PLATFORM_PUBLIC_KEY', 'WX_PLATFORM_SERIAL'])
  if (!configured.WX_PRIVATE_KEY && !configured.WX_PRIVATE_KEY_PATH) blockers.push({ item: '微信支付', missing: ['商户API私钥或可读私钥文件'] })
  requireKeys('短信验证码', ['SMS_TENCENT_SECRET_ID', 'SMS_TENCENT_SECRET_KEY', 'SMS_TENCENT_SDKAPPID', 'SMS_TENCENT_SIGN', 'SMS_TENCENT_TEMPLATE_ID'])
  const legal = { documents: await legalDocuments(), versions: await legalVersions() }
  if (!legal.documents.privacy || !legal.documents.terms) blockers.push({ item: '正式协议', missing: Object.entries(legal.documents).filter(([, v]) => !v).map(([k]) => k) })
  const httpsPublic = value => { try { const u = new URL(value); return u.protocol === 'https:' && !/(\.example$|localhost|^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) } catch { return false } }
  if (!httpsPublic(process.env.PUBLIC_BASE)) blockers.push({ item: '公网API与图片地址', missing: ['PUBLIC_BASE 的真实公网HTTPS域名、部署和微信合法域名验证'] })
  for (const mini of ['mini-a', 'mini-b']) {
    const source = fs.readFileSync(new URL('../../' + mini + '/app.js', import.meta.url), 'utf8')
    if (!httpsPublic(source.match(/const API_BASE_RELEASE\s*=\s*['"]([^'"]+)/)?.[1])) blockers.push({ item: mini + '正式后端地址', missing: ['API_BASE_RELEASE'] })
  }
  const health = await secretsHealth()
  if (health.undecryptable.length) blockers.push({ item: '既有凭据密钥口径', missing: health.undecryptable, action: '保留现状；统一密钥需专项备份、恢复验算和明确授权' })
  const records = await q('SELECT id_no_enc FROM kyc_application')
  const identity = { total: records.length, legacyPlaintext: records.filter(r => isLegacyPlainId(r.id_no_enc)).length, action: records.length ? '入口保持关闭，保留密文；删除需确认业务保留范围，不擅自不可逆清理' : '当前库无存量实名记录，不需要执行删除；入口保持关闭' }
  const report = { codeAndTestsAreNotBusinessAcceptance: true, configuration: configured, legal, masterKey: health, identityInventory: identity, insurance: { productionSaleEnabled: false, reason: '无承保接口与产品履约，生产入口和收费已拒绝' }, blockers, externalAcceptance: ['真机订阅授权与实际收件', '真实微信支付和退款到账', '真实图片审核回执', '双端真机扫码/选图/卡面', '运营主体确认的正式协议与实名保留/删除要求'] }
  if (process.argv.includes('--live-wechat')) {
    try {
      const { accessToken } = await import('../src/domain/wxapi.mjs')
      const token = await accessToken()
      report.wechat = { tokenVerified: !!token }
      if (token) for (const [name, path] of [['templates', 'gettemplate'], ['categories', 'getcategory']]) {
        const r = await (await fetch('https://api.weixin.qq.com/wxaapi/newtmpl/' + path + '?access_token=' + encodeURIComponent(token), { signal: AbortSignal.timeout(15000) })).json()
        report.wechat[name] = { errcode: r.errcode ?? 0, count: r.data?.length || 0, items: r.data?.map(x => name === 'templates' ? { title: x.title, content: x.content } : { id: x.id, name: x.name }) || [] }
        if (name === 'templates' && !r.errcode) {
          report.wechat.templateFieldMatch = {}
          for (const [key, fields] of Object.entries({ WX_TMPL_PAY_OK: ['character_string1', 'thing2'], WX_TMPL_GROUP_CANCEL: ['thing1', 'thing4'] })) {
            const selected = (r.data || []).find(t => t.priTmplId === s[key])
            const matches = !!selected && fields.every(field => String(selected.content).includes('{{' + field + '.DATA}}'))
            report.wechat.templateFieldMatch[key] = matches
            if (configured[key] && !matches) blockers.push({ item: key + '模板字段不匹配', missing: fields })
          }
        }
      }
    } catch (e) { report.wechat = { failed: true, errorType: e.name }; blockers.push({ item: '微信平台查询', missing: ['网络、IP白名单或账号权限需核对'] }) }
  }
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = blockers.length ? 2 : 0
} finally { await closeDb() }
