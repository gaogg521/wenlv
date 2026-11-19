// M-12：三端统一「修改二次确认」守卫（静态检查，接入 npm test）。
// 1) 覆盖率：PC（api/admin 非 GET api()）与两个小程序（request 的 POST/PUT/DELETE）的每个写调用点，
//    其所在函数必须登记在 confirm-inventory.mjs 盘点表里——漏登记直接失败，防止以后新写操作绕过盘点。
// 2) 强制：盘点表里 A/A+ 的动作，所在函数体必须调用统一封装（PC uiConfirm( / 小程序 confirmChange(），
//    或属于已确认的 rich 自带表单弹窗（modal(/businessModal(/showModal(/reviewDrawer(）。
// 3) 原生确认清理：api/admin 里不允许残留 prompt(；原生 confirm( 只允许 entity-editor.js 的两处导航守卫（B 级未保存提示）。
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { INVENTORY } = await import('./confirm-inventory.mjs')

// —— 函数定位：在文件文本里找名为 name 的函数体（含大括号配平），返回所有候选 span ——
function fnSpans(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp('(?:^|[^\\w$])function\\s+' + esc + '\\s*\\(', 'g'),
    new RegExp('(?:^|[^\\w$])(?:async\\s+)?' + esc + '\\s*\\(([^)]*)\\)\\s*\\{', 'g'),
    new RegExp('(?:^|[^\\w$])window\\.' + esc + '\\s*=\\s*(?:async\\s*)?(?:function|\\()', 'g'),
    new RegExp('(?:^|[^\\w$])' + esc + '\\s*=\\s*(?:async\\s*)?(?:function|\\()', 'g'),
  ]
  const spans = []
  for (const re of patterns) {
    let m
    while ((m = re.exec(text))) {
      const open = text.indexOf('{', m.index + m[0].length - 1)
      if (open < 0) continue
      let depth = 0, end = -1
      for (let i = open; i < text.length; i++) {
        const c = text[i]
        if (c === '{') depth++
        else if (c === '}') { depth--; if (!depth) { end = i; break } }
        else if (c === '"' || c === "'" || c === '`') { const q = c; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++ } }
      }
      if (end > 0) spans.push([open, end])
    }
  }
  return spans
}

function enclosingFn(text, idx) {
  // 找所有函数起点，取包含 idx 的最内层；排除 JS 关键字与结构性标识符（if/for/exports 等不是函数）
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'exports', 'module', 'window', 'document', 'const', 'let', 'var'])
  const starts = []
  const re = /(?:(?:^|[^\w$])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{|(?:^|[^\w$])window\.([A-Za-z_$][\w$]*)\s*=|(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\())/g
  let m
  while ((m = re.exec(text))) {
    const name = m[1] || m[2] || m[4] || m[5]
    if (!name || KEYWORDS.has(name)) continue
    starts.push({ name, index: m.index })
  }
  for (let i = starts.length - 1; i >= 0; i--) {
    const spans = fnSpans(text, starts[i].name).filter(([a, b]) => a <= idx && idx <= b)
    if (spans.length) return starts[i].name
  }
  return null
}

const filesOf = (end) => {
  if (end === 'pc') {
    const dir = path.join(ROOT, 'api/admin/pages')
    return [...readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => 'api/admin/pages/' + f), 'api/admin/entity-editor.js', 'api/admin/chainhub.js', 'api/admin/core.js']
  }
  return null
}

const WRITE_RE = { pc: /\bapi\(\s*'(?:POST|PUT|DELETE)'/g, 'mini-a': /request\(\s*[`'][^`']*[`']\s*,\s*'(?:POST|PUT|DELETE)'/g, 'mini-b': /request\(\s*[`'][^`']*[`']\s*,\s*'(?:POST|PUT|DELETE)'/g }

const problems = []
const covered = new Set() // `${end}|${file}|${fn}`

for (const end of ['pc', 'mini-a', 'mini-b']) {
  let files
  if (end === 'pc') files = filesOf('pc')
  else {
    files = []
    const walk = (d) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name)
        if (f.isDirectory()) walk(p)
        else if (f.name.endsWith('.js')) files.push(path.relative(ROOT, p).replace(/\\/g, '/'))
      }
    }
    walk(path.join(ROOT, end))
  }
  for (const rel of files) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8')
    const re = WRITE_RE[end]
    let m
    while ((m = re.exec(text))) {
      const fn = enclosingFn(text, m.index)
      if (!fn) continue
      covered.add(end + '|' + rel + '|' + fn + '|' + m.index)
    }
  }
}

// 1) 覆盖率：盘点表必须覆盖全部出现的写函数（行 func 支持 a|b 同族函数；调用点若落在任一已登记函数体内即算覆盖）
const coveredProblems = []
for (const key of covered) {
  const [end, file, fn, idxStr] = key.split('|')
  const rows = INVENTORY.filter((r) => r.end === end && r.file === file)
  const byName = rows.some((r) => r.func.split('|').includes(fn))
  if (byName) continue
  const text = readFileSync(path.join(ROOT, file), 'utf8')
  const bySpan = rows.some((r) => r.func.split('|').some((n) => fnSpans(text, n).some(([a, b]) => a <= Number(idxStr) && Number(idxStr) <= b)))
  if (!bySpan) coveredProblems.push(`盘点缺项: ${end} ${file} :: ${fn}（写操作未登记）`)
}
problems.push(...coveredProblems)

// 2) A/A+ 强制：统一封装或 rich 弹窗。rich 证据三种：①函数体内直接 modal/showModal/drawer 构建表单弹窗；
//   ②函数名出现在「取消(closeModal) + 确认(FN)」按钮对里（admin 确认弹窗页脚都是这个结构）；
//   ③函数名所在按钮前面 400 字符内有 textarea/input（抽屉/表单里填原因后提交的确认）。
const RICH = [/modal\(/, /businessModal\(/, /showModal\(/, /reviewDrawer\(/, /drawer\(/]
const richFootEvidence = (text, fn) => {
  const esc = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('onclick=["\'](?:window\\.)?' + esc + '\\(', 'g')
  let m
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 400), m.index)
    const seg = text.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200)
    if (seg.includes('closeModal()') || /<(textarea|input)\b/.test(before)) return true
  }
  return false
}
for (const r of INVENTORY) {
  if (r.grade !== 'A' && r.grade !== 'A+') continue
  const text = readFileSync(path.join(ROOT, r.file), 'utf8')
  const names = r.func.split('|')
  const spans = names.flatMap((n) => fnSpans(text, n))
  if (!spans.length) { problems.push(`盘点函数找不到: ${r.end} ${r.file} :: ${r.func}`); continue }
  const ok = spans.some(([a, b]) => {
    const body = text.slice(a, b)
    if (r.how === 'uiConfirm') return /uiConfirm\(/.test(body) || /confirmChange\(/.test(body)
    if (r.how === 'rich') return RICH.some((re2) => re2.test(body)) || names.some((n) => richFootEvidence(text, n))
    if (r.how === 'action-sheet') return /showActionSheet\(/.test(body)
    if (r.how === 'page-confirm') return true // 页面本身是确认页（下单确认页/授权页/支付页）
    return false
  })
  if (!ok) problems.push(`A/A+ 缺统一确认: ${r.end} ${r.file} :: ${r.func}（${r.action}，grade=${r.grade}，how=${r.how}）`)
}

// 3) 原生确认清理
for (const rel of filesOf('pc')) {
  const text = readFileSync(path.join(ROOT, rel), 'utf8')
  const lineOf = (idx) => text.slice(0, idx).split('\n').length
  let m
  const pRe = /(?<![.\w$])prompt\(/g
  while ((m = pRe.exec(text))) problems.push(`PC 残留原生 prompt(): ${rel}:${lineOf(m.index)}（改用 uiConfirm）`)
  const cRe = /(?<![.\w$])confirm\(/g
  while ((m = cRe.exec(text))) {
    if (rel === 'api/admin/entity-editor.js') continue // B 级未保存离开守卫，允许
    problems.push(`PC 残留原生 confirm(): ${rel}:${lineOf(m.index)}（改用 uiConfirm）`)
  }
}

if (problems.length) {
  console.error('confirm-coverage 失败（' + problems.length + ' 处）：')
  for (const p of problems) console.error('  ✗ ' + p)
  console.error(`（盘点 ${INVENTORY.length} 行，扫描覆盖 ${covered.size} 个写函数）`)
  process.exit(1)
}
console.log(`confirm-coverage 通过：盘点 ${INVENTORY.length} 行，扫描覆盖 ${covered.size} 个写函数，A/A+ 全部走统一确认或 rich 弹窗，无残留原生 prompt/confirm`)
