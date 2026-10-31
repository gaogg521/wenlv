// 上链对接自检：插上凭据后先跑这个，不用猜哪里没配好
// 用法：
//   node scripts/chain-ready.mjs            检查配置 + 链可达性（不产生真实交易）
//   node scripts/chain-ready.mjs --probe    真实提交一枚测试根（**会产生一笔链上交易/计费**）
//   node scripts/chain-ready.mjs --anchor   把当前"已打包·待锚定"的批次全部补锚（真实上链）
import { q, one } from '../src/db.mjs'
import * as chain from '../src/infra/chain.mjs'
import * as attest from '../src/domain/attest.mjs'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)

const okBox = (b) => (b ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m')
let bad = 0
// soft=true：缺这一项不算"本地有错"，只是还差外部条件（链凭据）
const line = (pass, label, detail = '', soft = false) => {
  if (!pass && !soft) bad++
  console.log(` ${okBox(pass)} ${label}${detail ? '  ' + detail : ''}`)
}

console.log('\n=== 一、环境配置 ===')
const st = chain.chainStatus()
line(!!process.env.CHAIN_ENDPOINT, 'CHAIN_ENDPOINT', st.endpoint || '未配置（等链数根提供）', true)
line(!!process.env.CHAIN_ACCOUNT, 'CHAIN_ACCOUNT', st.account || '未配置（等链数根提供）', true)
line(!!process.env.CHAIN_KEY, 'CHAIN_KEY', st.keyConfigured ? '已配置（值不回显）' : '未配置（等链数根提供）', true)
line(true, '当前模式', st.mode === 'real' ? '\x1b[32mreal（真实锚定）\x1b[0m' : '\x1b[33mnoop（只落库不锚定）\x1b[0m')

if (st.mode !== 'real') {
  console.log('\n  → 补齐以上三项后重启服务，即为真实上链。配置位置：环境变量或 api/.env（见 .env.example）')
  console.log('  → 未配置期间：批次停在「已打包·待锚定」，不会产生任何假交易号。')
}

console.log('\n=== 二、存证队列现状 ===')
const batches = await q(`SELECT status, COUNT(*) n FROM attest_batch GROUP BY status`)
const ev = await one(`SELECT
  SUM(CASE WHEN status=0 THEN 1 ELSE 0 END) pending,
  SUM(CASE WHEN status=1 THEN 1 ELSE 0 END) packed,
  SUM(CASE WHEN status=2 THEN 1 ELSE 0 END) anchored FROM attest_event`)
console.log(`  事件：待打包 ${Number(ev.pending) || 0} · 已打包 ${Number(ev.packed) || 0} · 已锚定 ${Number(ev.anchored) || 0}`)
console.log('  批次：' + (batches.map((b) => `状态${b.status}×${b.n}`).join(' · ') || '无') + '（0待打包 1已打包 2已锚定 3重试 4人工）')
const fake = await one(`SELECT COUNT(*) n FROM attest_batch WHERE status=2 AND (chain_tx_ref IS NULL OR chain_tx_ref LIKE 'NOOP%')`)
line(Number(fake.n) === 0, '无假上链批次', `假上链 ${Number(fake.n)} 个`)

console.log('\n=== 三、链可达性 ===')
if (st.mode === 'real') {
  try {
    const r = await chain.queryByRoot('0'.repeat(64))
    line(true, '链网关应答正常', r ? '（该测试根意外存在，请核对）' : '（按根查询返回 not found，符合预期）')
  } catch (e) {
    line(false, '链网关可达', String(e.message).slice(0, 120))
  }
} else {
  console.log('  跳过：NOOP 模式不发起网络请求')
}

if (has('--probe')) {
  console.log('\n=== 四、试锚一枚测试根（会产生真实链上交易）===')
  const root = 'a1b2c3d4' + Date.now().toString(16).padEnd(56, '0')
  try {
    const r = await chain.submit({ root: root.slice(0, 64), prevRoot: null, leafCount: 0, bizDate: new Date().toISOString().slice(0, 10), merkleKind: 'probe' })
    line(!!r.txRef, '提交成功', 'txRef=' + r.txRef + (r.block ? ' block=' + r.block : ''))
    const again = await chain.queryByRoot(root.slice(0, 64))
    line(!!again && again.txRef === r.txRef, '按根可查回同一交易号（幂等去重可用）')
  } catch (e) {
    line(false, '提交失败', String(e.message).slice(0, 160))
  }
}

if (has('--anchor')) {
  console.log('\n=== 五、补锚（按 seq 升序，真实上链）===')
  if (st.mode !== 'real') {
    line(false, '拒绝执行', 'NOOP 模式下不补锚（不会造假交易号）')
  } else {
    const out = await attest.reanchorPending(200)
    const okN = out.filter((x) => x.anchored).length
    line(okN === out.length, `补锚 ${out.length} 批，成功 ${okN} 批`, out.filter((x) => !x.anchored).map((x) => `#${x.batchId}:${x.err || x.reason}`).join('; '))
  }
}

console.log('\n=== 结论 ===')
if (bad === 0 && st.mode === 'real') {
  console.log(' \x1b[32m配置就绪。\x1b[0m建议顺序：① --probe 试锚 ② --anchor 补锚 ③ 后台「存证中心」核对状态')
} else if (bad === 0) {
  console.log(' \x1b[32m本地侧全部就绪\x1b[0m，只差链凭据（3 个环境变量）。填上后重跑本脚本即可显示 real。')
} else {
  console.log(` \x1b[31m${bad} 项异常\x1b[0m，请先处理上面标 ✗ 的项。`)
}

process.exit(bad ? 1 : 0)
