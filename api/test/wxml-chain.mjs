// 小程序 WXML 静态检查：wx:elif / wx:else 不得与 wx:for 写在同一个节点上。
// 原因：带 wx:for 的节点会被当作循环节点，条件链在这里断开，下一个 wx:else 编译报
// "wx:if not found, then something must be wrong"，整个小程序的页面都起不来（A-03 笔记页曾因此编译失败）。
// 正确写法：外层 <block wx:elif="…"> 内层再放带 wx:for 的节点。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TAG = /<[a-zA-Z][\w-]*(?:\s+[^\s=>]+(?:="[^"]*"|='[^']*')?)*\s*\/?>/g

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.wxml')) out.push(p)
  }
  return out
}

const bad = []
let files = 0
for (const app of ['mini-a', 'mini-b']) {
  for (const f of walk(path.join(root, app))) {
    files++
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(TAG)) {
      if (/\bwx:(elif|else)\b/.test(m[0]) && /\bwx:for\b/.test(m[0])) {
        const line = src.slice(0, m.index).split('\n').length
        bad.push(`${path.relative(root, f)}:${line} ${m[0].slice(0, 90)}`)
      }
    }
  }
}
if (bad.length) {
  console.error('WXML 条件链被 wx:for 打断（elif/else 与 for 不能同节点）：\n  ' + bad.join('\n  '))
  process.exit(1)
}
console.log(`WXML 条件链检查：${files} 个文件，无 elif/else 与 for 同节点`)
