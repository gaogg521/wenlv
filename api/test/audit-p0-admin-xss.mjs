// P0 后台 XSS 回归（全量检查 20261106）：A-05 游客昵称/商户名可在后台 onclick 里执行脚本
// 静态守卫：不依赖数据库与后台服务，进 npm test。
// 原理：事件处理器属性（onclick 等）里的字符串参数必须用 JS 上下文转义（escJs）。
// esc() 只做 HTML 转义；浏览器会先把属性值实体解码再当 JS 编译，所以 &#39; 挡不住 `');` 型逃逸。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

let passN = 0
const t = (name, fn) => { try { fn(); passN++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

const ADMIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'admin')
const adminFile = (p) => fs.readFileSync(path.join(ADMIN_DIR, p), 'utf8')

console.log('== A-05 后台 onclick 单引号逃逸 ==')

t('A05-1 escJs：恶意昵称经 onclick 编译后只是普通字符串，脚本不执行、原文可还原', () => {
  const core = adminFile('core.js')
  const m = core.match(/const escJs = \(s\) =>[^\n]+/)
  assert.ok(m, 'core.js 必须定义 escJs（JS 字符串上下文转义）')
  const sandbox = {}
  vm.runInNewContext(m[0] + '; globalThis.__escJs = escJs', sandbox)
  const escJs = sandbox.__escJs
  assert.equal(typeof escJs, 'function', 'escJs 可提取')
  const payloads = [
    "x');window.__xss=1;//", // 检查报告 T34 的原始探针
    'x", end=`);window.__y=1;`',
    "x\\';window.__z=1;//", // 反斜杠+引号（逃过朴素转义）
    "a\nb';alert(1);//", // 换行
    '<img src=x onerror=alert(1)>', // 普通 HTML 注入形态
    "中文昵称'测试\"",
    "'", '"', '\\', "''''", '\\"',
  ]
  for (const payload of payloads) {
    const attr = `entitlementModal(65, '${escJs(payload)}', 0, 0)`
    // 浏览器语义：属性值先做 HTML 实体解码，再作为 JS 编译
    const decoded = attr.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (s) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" }[s]))
    const sb = { window: {}, __xss: undefined, __y: undefined, __z: undefined, alert: () => { throw new Error('alert executed') }, called: null }
    sb.window = sb
    let args = null
    vm.runInNewContext('var entitlementModal = function(){ args = Array.from(arguments) }; ' + decoded + '; globalThis.__args = args', sb)
    assert.deepEqual([...sb.__args], [65, payload, 0, 0], '参数必须原样到达函数（round-trip）: ' + JSON.stringify(payload))
    assert.equal(sb.__xss, undefined, '脚本不得执行: ' + JSON.stringify(payload))
    assert.equal(sb.__y, undefined); assert.equal(sb.__z, undefined)
  }
})

t('A05-2 esc() 补单引号/反斜线转义（文本与普通属性场景的纵深防御）', () => {
  const core = adminFile('core.js')
  const m = core.match(/const esc = \(s\) =>[^\n]+/)
  assert.ok(m, 'core.js esc 存在')
  const sb = {}
  vm.runInNewContext(m[0] + '; globalThis.__esc = esc', sb)
  const out = sb.__esc("x'\"<y>")
  assert.ok(!out.includes("'") && !out.includes('"') && !out.includes('<'), '单引号/双引号/尖括号都必须被转义: ' + out)
})

t('A05-3 全后台事件处理器属性内禁止嵌入 esc() 输出（必须 escJs 或走数据属性）', () => {
  const offenders = []
  const walk = (dir, rel) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f)
      if (fs.statSync(p).isDirectory()) { walk(p, rel ? rel + '/' + f : f); continue }
      if (!f.endsWith('.js')) continue
      const src = fs.readFileSync(p, 'utf8')
      const re = /\bon[a-z]+\s*=\s*"([^"]*)"/g
      let m
      while ((m = re.exec(src))) {
        if (m[1].includes('${esc(')) offenders.push(`${rel ? rel + '/' : ''}${f}: …${m[1].slice(0, 80)}…`)
      }
    }
  }
  walk(ADMIN_DIR, '')
  assert.deepEqual(offenders, [], `事件处理器内使用 esc() 的位置（应为 0，改用 escJs）：\n  ` + offenders.join('\n  '))
})

t('A05-4 两个已知用户可控点已改用 escJs：用户画像权益调整、商户列表编辑', () => {
  const people = adminFile(path.join('pages', 'people.js'))
  const trade = adminFile(path.join('pages', 'trade.js'))
  assert.ok(/entitlementModal\(\$\{u\.id\}, '\$\{escJs\(/.test(people), 'people.js 权益调整按钮昵称参数需 escJs')
  assert.ok(/editMerchant\(\$\{m\.id\},'?\$\{escJs\(/.test(trade), 'trade.js 商户编辑名称参数需 escJs')
})

console.log(`\n${passN} 项通过`)
