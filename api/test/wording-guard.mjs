// 小程序用语合规守卫：小程序审核对区块链/虚拟资产类用语敏感，游客端与商户端界面一律用"可信记录/校验码"等 T1 口径。
// 两道检查：
//   1) 静态：扫描 mini-a / mini-b 中会出现在界面上的文本（WXML 文本、JS 字符串字面量；跳过注释与登录 token 变量）
//   2) 运行时（需服务在跑）：以游客、商户身份调用全部 GET /c、/m 接口，扫描返回内容
// PC 后台与对外 H5（复核页等）不在此限。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BANNED } from '../src/domain/wording.mjs'
export { BANNED }
// 白名单：仅生态 H5 / 合作方使用、小程序不调用的接口（下方会同时检查小程序源码确实没有引用它们）
const H5_ONLY = ['/c/vc']
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const hits = []

// ---------- 1) 静态 ----------
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (/node_modules|miniprogram_npm/.test(p)) continue
    if (e.isDirectory()) walk(p)
    else if (/\.(wxml|js|json)$/.test(e.name)) {
      let s = fs.readFileSync(p, 'utf8')
      if (e.name.endsWith('.wxml')) s = s.replace(/<!--[\s\S]*?-->/g, '')
      if (e.name.endsWith('.js')) {
        // 只看字符串字面量里的文本
        s = (stripJs(s).match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || []).join('\n')
      }
      for (const w of BANNED) {
        if (w === 'Token' ? /\bToken\b/.test(s) : s.includes(w)) hits.push(`${path.relative(root, p)} → 「${w}」`)
      }
    }
  }
}
for (const d of ['mini-a', 'mini-b']) walk(path.join(root, d))
function walkRef(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (/node_modules|miniprogram_npm/.test(p)) continue
    if (e.isDirectory()) walkRef(p)
    else if (e.name.endsWith('.js')) for (const r of H5_ONLY) if (fs.readFileSync(p, 'utf8').includes("'" + r)) hits.push(`${path.relative(root, p)} 引用了仅限 H5 的接口 ${r}`)
  }
}
for (const d of ['mini-a', 'mini-b']) walkRef(path.join(root, d))

// ---------- 2) 运行时 ----------
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
let runtime = 'skipped'
let db = null
try {
  // 没明确指定 PORT 就不跑接口扫描：默认端口 8080 是演示服务，测试不该去碰（登录会写库）
  if (!process.env.PORT) throw new Error('没设 PORT，只做静态扫描')
  const call = async (p, t) => (await fetch(BASE + p, { headers: t ? { authorization: 'Bearer ' + t } : {} })).json()
  const login = async (p, b) => (await (await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json()).data
  const cT = (await login('/c/auth/login', { code: 'mock-wording-guard' })).token
  db = await import('../src/db.mjs')
  const { one, q } = db
  const any = await one('SELECT o.order_no, o.user_id, o.product_id FROM orders o WHERE o.status IN (20,30,40,50,70) ORDER BY o.id DESC LIMIT 1')
  const buyer = any ? await one('SELECT mini_a_openid FROM user_account WHERE id = ?', [any.user_id]) : null
  const bT = buyer ? (await login('/c/auth/login', { code: String(buyer.mini_a_openid).replace(/^mock-openid-/, '') })).token : cT
  const staff = await one(`SELECT s.merchant_id, u.mini_b_openid FROM merchant_staff s JOIN user_account u ON u.id = s.user_id
    JOIN merchant m ON m.id = s.merchant_id WHERE s.status = 1 AND m.status = 1 AND u.mini_b_openid IS NOT NULL ORDER BY s.role DESC LIMIT 1`)
  const mT = staff ? (await login('/m/auth/login', { code: String(staff.mini_b_openid).replace(/^mock-openid-b?-?/, ''), merchantId: staff.merchant_id }))?.token : null
  const rdir = path.join(root, 'api/src/routes')
  const src = fs.readdirSync(rdir).filter((f) => f.endsWith('.mjs')).map((f) => fs.readFileSync(path.join(rdir, f), 'utf8')).join('\n')
  const routes = [...src.matchAll(/'GET (\/(?:c|m)\/[^']+)'/g)].map((m) => m[1])
  const fill = (r) => r.replace(':no', any?.order_no || 'X').replace(':id', String(any?.product_id || 1)).replace(':kind', 'merchant')
  let n = 0
  for (const r of routes) {
    if (/qrcode|report|code$/.test(r)) continue // 二进制/图片接口
    if (H5_ONLY.includes(r)) continue
    const tok = r.startsWith('/m/') ? mT : (r.includes(':no') ? bT : cT)
    if (r.startsWith('/m/') && !mT) continue
    const body = JSON.stringify(await call(fill(r), tok).catch(() => ({})))
    n++
    for (const w of BANNED) if (w === 'Token' ? /\bToken\b/.test(body) : body.includes(w)) hits.push(`GET ${r} 返回 → 「${w}」`)
  }
  runtime = `${n} 个接口（商户端${mT ? '已' : '未'}登录）`
} catch (e) { runtime = '未运行（' + e.message + '）' } finally {
  // 异常路径也要关连接池：连接池开着时 process.exit 在 Windows 上会崩（exit 127），后面的测试就被跳过了
  await db?.closeDb().catch(() => {})
}

console.log(`小程序用语检查：静态扫描 mini-a/mini-b；运行时 ${runtime}`)
if (hits.length) { console.log('✗ 发现 ' + hits.length + ' 处敏感用语：\n  ' + [...new Set(hits)].join('\n  ')); process.exit(1) }
console.log('✓ 未发现区块链/虚拟资产类用语')
process.exit(0)
