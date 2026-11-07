// 仅替换明确命名的旧demo占位图；默认只读预览，--apply通过后台API保存并留审计/版本。
// node --env-file=.env scripts/install-demo-photos.mjs --apply（需ADMIN_PASSWORD，API_BASE默认本机8080）
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { q, closeDb } from '../src/db.mjs'
const apply = process.argv.includes('--apply')
const base = process.env.API_BASE || 'http://127.0.0.1:8080'
const root = fileURLToPath(new URL('../../', import.meta.url))
const apiDir = fs.realpathSync(process.env.DEMO_API_DIR || path.join(root, 'api'))
const legacy = u => /\/uploads\/demo-(prod|scenic|mstore|banner|dest)-[^/]+\.svg$/.test(String(u || ''))
const parse = x => typeof x === 'string' ? JSON.parse(x) : x || []
const module = { exports: {} }
vm.runInNewContext(fs.readFileSync(path.join(root, 'mini-a/utils/api.js'), 'utf8'), { module })
const reference = subject => '/uploads/reference-' + path.basename(module.exports.photoFor(subject), '.jpg') + '-20261107.jpg'
try {
  if (apply && (process.env.DB_NAME !== 'wanderlust' || process.env.NODE_ENV === 'production' || base !== 'http://127.0.0.1:8080')) throw new Error('此脚本只允许当前本机wanderlust演示库；不能指向生产')
  if (apply && !apiDir.replaceAll('\\', '/').endsWith('/wanderlust/api')) throw new Error('DEMO_API_DIR必须明确指向主工作区wanderlust/api')
  const [products, scenics, merchants, banners] = await Promise.all([
    q('SELECT id,title,cat,images FROM tour_product'), q('SELECT id,name,profile FROM scenic_spot'), q('SELECT id,name,profile FROM merchant'), q('SELECT id,title,image FROM banner'),
  ])
  const plans = []
  for (const p of products) if (parse(p.images).some(legacy)) plans.push({ kind: 'product', id: p.id, values: { images: [reference(p), ...parse(p.images).filter(x => !legacy(x))] } })
  for (const s of scenics) {
    const p = parse(s.profile), values = {}
    if (legacy(p.cover)) values.cover = reference(s)
    if ((p.gallery || []).some(legacy)) values.gallery = [reference(s), ...(p.gallery || []).filter(x => !legacy(x))]
    if (Object.keys(values).length) plans.push({ kind: 'scenic', id: s.id, values })
  }
  for (const m of merchants) {
    const p = parse(m.profile)
    if ((p.storefront || []).some(legacy)) plans.push({ kind: 'merchant', id: m.id, values: { storefront: [reference(m), ...p.storefront.filter(x => !legacy(x))] } })
  }
  for (const b of banners) if (legacy(b.image)) plans.push({ kind: 'banner', id: b.id, values: { image: reference(b) } })
  if (!apply) { console.log(JSON.stringify({ apply: false, plans }, null, 2)); process.exitCode = 0 }
  else {
    if (!process.env.ADMIN_PASSWORD) throw new Error('缺少ADMIN_PASSWORD；禁止假定生产或演示密码')
    const request = async (method, url, body, token) => {
      const r = await (await fetch(base + url, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (token || '') }, body: body ? JSON.stringify(body) : undefined })).json()
      if (r.code !== 0) throw new Error(r.code + ': ' + r.msg)
      return r.data
    }
    const login = await request('POST', '/admin/login', { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASSWORD })
    const results = []
    for (const plan of plans) {
      try {
        for (const url of Object.values(plan.values).flat()) {
          if (!url.startsWith('/uploads/reference-')) continue
          const name = path.basename(url).replace(/^reference-/, '').replace(/-20261107\.jpg$/, '.jpg')
          const bytes = fs.readFileSync(path.join(root, 'mini-a/assets/photos', name))
          const target = path.join(apiDir, 'static', url)
          if (fs.existsSync(target) && !fs.readFileSync(target).equals(bytes)) throw new Error('已有参考图内容不同，拒绝覆盖')
          if (!fs.existsSync(target)) fs.writeFileSync(target, bytes)
        }
        const current = await request('GET', '/admin/entities/' + plan.kind + '/' + plan.id, null, login.token)
        await request('PUT', '/admin/entities/' + plan.kind + '/' + plan.id, { values: plan.values, expectedVersion: current.version, versionReason: '演示摄影参考图替换，保留原业务数据及旧素材文件' }, login.token)
        results.push({ kind: plan.kind, id: plan.id, applied: true })
      } catch (e) { results.push({ kind: plan.kind, id: plan.id, applied: false, reason: e.message }) }
    }
    console.log(JSON.stringify({ results, success: results.filter(x => x.applied).length, failed: results.filter(x => !x.applied).length }, null, 2))
    if (results.some(x => !x.applied)) process.exitCode = 1
  }
} finally { await closeDb() }
