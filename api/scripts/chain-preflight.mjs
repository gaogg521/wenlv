// 多链预埋体检（命令行）：与后台「链与资产」页读同一份数据（src/infra/chain/preflight.mjs）
//
//   node scripts/chain-preflight.mjs           # 看全部
//   node scripts/chain-preflight.mjs chaingen  # 只看一家（含详细待确认清单）
//   node scripts/chain-preflight.mjs --strict  # 任一家离线自测失败则退出码 1（可进 CI）
import { runPreflight, preflightSummary } from '../src/infra/chain/preflight.mjs'

const rows = runPreflight()
const sum = preflightSummary(rows)
const only = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null
const list = only ? rows.filter((r) => r.id === only) : rows

console.log('\n=== 多链预埋体检（离线，不联网、不需要凭据）===\n')
console.log(`预埋完成度 ${sum.ready}/${sum.total} 家离线自测通过 · 当前生效 ${sum.active}\n`)

for (const r of list) {
  const mark = r.selfOk ? '✓' : '✗'
  const cred = r.missing.length ? `缺 ${r.missing.length} 项：${r.missing.join(', ')}` : '凭据齐备'
  console.log(`${r.id.padEnd(9)} ${r.label}${r.active ? '  ← 当前生效' : ''}`)
  console.log(`  离线自测  ${mark} ${typeof r.selfDetail === 'string' ? r.selfDetail : JSON.stringify(r.selfDetail)}`)
  console.log(`  凭据状态  ${cred}`)
  console.log(`  能力      ${r.caps.join('/') || '—'}`)
  if (r.ask.length && r.id !== 'noop' && r.id !== 'mock') console.log(`  待对方确认 ${r.ask.length} 条${only ? '（见下）' : '（加参数看明细）'}`)
  if (only) for (const a of r.ask) console.log(`     · ${a}`)
  console.log('')
}

if (only) {
  const r = list[0]
  if (!r) { console.log('未知 provider：' + only); process.exit(2) }
  console.log(r.missing.length
    ? '下一步：把 config/chains/ 下对应模板追加到 api/.env 并填值 → 重启 → node scripts/chain-ready.mjs'
    : '下一步：node scripts/chain-ready.mjs --probe（试锚一枚测试根）→ 后台看批次转「已锚定」')
} else {
  console.log('明细：node scripts/chain-preflight.mjs <chaingen|tbaas|antchain|evm>')
  console.log('后台：WEB3 → 链与资产（同一份数据，含自检与待确认清单）')
}

if (process.argv.includes('--strict') && sum.selfFail.length) {
  console.error('\n[strict] 离线自测失败：' + sum.selfFail.join(', '))
  process.exit(1)
}
