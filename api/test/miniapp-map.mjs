// 小程序 ↔ 后台映射完整性：两个小程序 app.json 里的每个页面都必须在 admin/miniapp.js 的 MINI_MAP 登记
// （否则就存在"小程序上有、后台找不到在哪改"的页面）。不需要数据库。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const src = fs.readFileSync(path.join(root, 'api/admin/miniapp.js'), 'utf8')
const mapped = { '游客端': new Set(), '商户端': new Set() }
for (const m of src.matchAll(/end: '(游客端|商户端)', path: '([^']+)'/g)) mapped[m[1]].add(m[2])
const missing = []
for (const [dir, end] of [['mini-a', '游客端'], ['mini-b', '商户端']]) {
  const j = JSON.parse(fs.readFileSync(path.join(root, dir, 'app.json'), 'utf8'))
  const pages = [...j.pages, ...(j.subPackages || []).flatMap((s) => s.pages.map((p) => s.root + '/' + p))]
  for (const p of pages) if (!mapped[end].has(p)) missing.push(`${dir}/${p}`)
  for (const p of mapped[end]) if (!pages.includes(p)) missing.push(`映射里登记了不存在的页面：${dir}/${p}`)
}
const n = mapped['游客端'].size + mapped['商户端'].size
if (missing.length) { console.log('✗ 小程序页面未在后台映射中登记：\n  ' + missing.join('\n  ')); process.exit(1) }
console.log(`✓ 小程序 ↔ 后台映射完整：${n} 个页面均可在后台找到修改入口`)
