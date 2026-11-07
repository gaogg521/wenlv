// 临时工具：把 create/index.js 截回 Page({...}) 的配平闭合（此前误插方法块到对象外）
import fs from 'node:fs'
const p = new URL('../../mini-a/package-content/pages/create/index.js', import.meta.url)
let s = fs.readFileSync(p, 'utf8')
const start = s.indexOf('Page({')
let depth = 0, end = -1, inStr = null
for (let i = start; i < s.length; i++) {
  const ch = s[i]
  const prev = s[i - 1]
  if (inStr) {
    if (ch === inStr && prev !== String.fromCharCode(92)) inStr = null
    continue
  }
  if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue }
  if (ch === '{' || ch === '(') depth++
  if (ch === '}' || ch === ')') {
    depth--
    if (depth === 0) { end = i + 1; break }
  }
}
console.log('Page ends at char', end, 'of', s.length)
s = s.slice(0, end) + '\n'
fs.writeFileSync(p, s)
console.log('trimmed')
