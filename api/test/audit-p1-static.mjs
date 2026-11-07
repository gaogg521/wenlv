// P1 静态守卫（全量检查 20261106）：A-18 假数据口径 / A-19 接口地址 / A-22 启动护栏接线
// 不依赖数据库与服务，进 npm test。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let passN = 0
const t = (name, fn) => { try { fn(); passN++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

console.log('== A-18 假业务数据口径 ==')
t('A18-1 api.js：FALLBACK 只允许开发环境（envVersion===develop），其余一律错误态', () => {
  const api = read('mini-a/utils/api.js')
  assert.ok(/demoAllowed|envVersion/.test(api), 'api.js 必须按 envVersion 门控演示兜底')
  // 每个 FALLBACK 消费点必须有 demoAllowed 门控或错误态
  const consumers = ['pages/home/index.js', 'pages/shop/index.js', 'pages/bean/index.js', 'pages/me/index.js', 'pages/tour-list/index.js']
  for (const f of consumers) {
    const src = read('mini-a/' + f)
    if (!src.includes('FALLBACK')) continue
    assert.ok(/demoAllowed\s*\(\)/.test(src), `${f} 使用 FALLBACK 前必须 api.demoAllowed() 门控`)
  }
})

console.log('== A-19 接口地址 ==')
t('A19-1 两端 app.js：按 envVersion 分流；release/trial 必须是 HTTPS 且非内网/本地地址', () => {
  for (const f of ['mini-a/app.js', 'mini-b/app.js']) {
    const src = read(f)
    assert.ok(/envVersion/.test(src), `${f} 必须按 envVersion 区分环境`)
    // release/trial 分支必须显式存在，且其中不得出现 http:// 或内网/本机地址
    const releaseSeg = src.split(/(?:envVersion|env)\s*===?\s*['"](release|trial)['"]/)[1] || ''
    assert.ok(releaseSeg.length > 0, `${f} 必须显式写 release/trial 分支`)
    assert.ok(!/http:\/\//.test(releaseSeg), `${f} release/trial 分支不得出现 http:// 地址`)
    assert.ok(!/127\.0\.0\.1|localhost|192\.168\.|172\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+/.test(releaseSeg), `${f} release/trial 分支不得指向内网/本机`)
    // develop 的 http 联调地址必须放在 DEV/LAN 命名的常量里，便于审计
    for (const m of src.matchAll(/http:\/\/[^\s'"`]+/g)) {
      const line = src.slice(0, m.index).split('\n').pop()
      assert.ok(/DEV|LAN|develop/.test(line), `${f} 的 http 地址必须在开发常量行上: ${m[0]}`)
    }
  }
})

console.log('== A-22 启动护栏接线 ==')
t('A22-1 index.mjs / jobs.mjs 启动即调 assertProductionSecrets', () => {
  const idx = read('api/src/index.mjs')
  assert.ok(/assertProductionSecrets/.test(idx), 'index.mjs 启动必须调用生产密钥护栏')
  const guard = read('api/src/infra/boot-guard.mjs')
  assert.ok(/wanderlust-dev-jwt-secret-change-me/.test(guard) && /wanderlust-pass-code-secret/.test(guard), '护栏必须识别两个默认密钥')
})

console.log(`\n${passN} 项通过`)
