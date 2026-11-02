// 相对路径 import 必须能解析到真实文件（含动态 import('...')）。
// 拆分/移动文件后，动态 import 只在运行到那一行才报错，语法检查发现不了。
import fs from 'node:fs'
import path from 'node:path'
const root = path.join(import.meta.dirname, '..', 'src')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.mjs') ? [path.join(d, e.name)] : [])
const bad = []
let n = 0
for (const f of walk(root)) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    n++
    if (!fs.existsSync(path.resolve(path.dirname(f), m[1]))) bad.push(`${path.relative(root, f)} → ${m[1]}`)
  }
}
if (bad.length) { console.log('✗ 无法解析的相对 import：\n  ' + bad.join('\n  ')); process.exit(1) }
console.log(`✓ src 下 ${n} 处相对 import 均可解析`)
