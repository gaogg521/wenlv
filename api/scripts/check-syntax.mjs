// 语法检查：src / admin / scripts / test 下全部 .mjs/.js，以及两个小程序的 .js（不执行，只解析）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dirs = ['api/src', 'api/admin', 'api/scripts', 'api/test', 'mini-a', 'mini-b']
const skip = /node_modules|evidence-|automator-shots|miniprogram_npm/
const files = []
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (skip.test(p)) continue
    if (e.isDirectory()) walk(p)
    else if (/\.(mjs|js)$/.test(e.name)) files.push(p)
  }
}
for (const d of dirs) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d))
let bad = 0
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }) }
  catch (e) { bad++; console.log('✗', path.relative(root, f), '\n ', String(e.stderr).split('\n').slice(0, 4).join('\n  ')) }
}
console.log(`${files.length - bad}/${files.length} 个文件语法通过`)
process.exit(bad ? 1 : 0)
