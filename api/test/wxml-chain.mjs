// 小程序 WXML 静态检查（两类会让整个分包/小程序编译失败或显示字面反斜杠的写法）：
// 1) wx:elif / wx:else 不得与 wx:for 写在同一个节点上。
//    原因：带 wx:for 的节点会被当作循环节点，条件链在这里断开，下一个 wx:else 编译报
//    "wx:if not found, then something must be wrong"，整个小程序的页面都起不来（A-03 笔记页曾因此编译失败）。
//    正确写法：外层 <block wx:elif="…"> 内层再放带 wx:for 的节点。
// 2) WXML 里不得出现字面反斜杠 n（\n）。
//    原因：WXML 属性串不支持 JS 转义——绑定串里写 '\n' 会把整个分包炸到编译失败（实测
//    2026-11-19 二轮项1：package-promo 分包 reLaunch 全部超时）；普通属性串里则显示成字面
//    「\n」。正确写法：多行文案在 JS 里拼好放进 data，WXML 只做取值和单三元。
//    注：{{map[key]}} 变量键索引在两端的既有页面一直在正常编译运行，不属于炸点，不在此检查。
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
    if (/\\n/.test(src)) {
      const line = src.split('\n').findIndex((l) => /\\n/.test(l)) + 1
      bad.push(`${path.relative(root, f)}:${line} 字面 \\n（WXML 不支持转义，多行文案请放到 JS data）`)
    }
  }
}
if (bad.length) {
  console.error('WXML 静态检查不通过：\n  ' + bad.join('\n  '))
  process.exit(1)
}
console.log(`WXML 条件链与绑定写法检查：${files} 个文件，无 elif/else 与 for 同节点、无字面 \\n`)
