// 合约红线守卫：链上旅豆只能是封闭式积分，绝不能长出"转让"这条路。
// 这些断言不是洁癖 —— 一旦合约里出现 transfer/approve，旅豆性质就从"平台积分"变成"可流通代币"，
// 而且合约部署后不可修改，所以只能在提交前拦住。
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(__dirname, '..', 'contracts', 'antchain-root')
const points = fs.readFileSync(path.join(DIR, 'WanderlustPoints.sol'), 'utf8')
const root = fs.readFileSync(path.join(DIR, 'WanderlustRootStore.sol'), 'utf8')

let pass = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

console.log('== 合约红线 ==')

t('旅豆合约里没有 transfer / transferFrom / approve / allowance（用户间不可互转）', () => {
  const code = stripComments(points)
  for (const bad of [/\btransfer\s*\(/, /\btransferFrom\s*\(/, /\bapprove\s*\(/, /\ballowance\s*\(/]) {
    assert.ok(!bad.test(code), '出现禁止函数：' + bad)
  }
  // 注释里可以提"刻意不实现"，但要确保不是真的实现了
  assert.match(points, /刻意不实现/, '应保留"刻意不实现转让"的说明，避免以后有人以为是漏了')
})

t('发行/消耗/过期/封账四个写操作都只能由托管账户调用', () => {
  const code = stripComments(points)
  for (const fn of ['function mint', 'function consume', 'function expire', 'function writeDayRoot']) {
    const i = code.indexOf(fn)
    assert.ok(i > -1, '缺少函数：' + fn)
    const sig = code.slice(i, code.indexOf('{', i))
    assert.match(sig, /onlyOperator/, fn + ' 缺少 onlyOperator，任何账户都能写')
  }
})

t('日终封账必须与合约内累计对账，对不上直接 revert（挡住"库里改流水、链上照封"）', () => {
  const code = stripComments(points)
  assert.match(code, /debitSum\s*==\s*dayDebit\s*&&\s*creditSum\s*==\s*dayCredit/, '缺少借贷合计对账')
  assert.match(code, /leafCount\s*==\s*dayEntries/, '缺少笔数对账')
  assert.match(code, /prevRoot\s*==\s*lastDayRoot/, '缺少前根衔接校验')
})

t('消耗不允许透支：余额不足必须 revert，不能写成负数或 0 了事', () => {
  const code = stripComments(points)
  assert.match(code, /require\(\s*balances\[accountKey\]\s*>=\s*amount\s*,\s*"insufficient balance"\s*\)/, '缺少余额校验')
})

t('存证合约：序号必须连续 +1、前根必须等于上一批的根（删掉一批立刻暴露）', () => {
  const code = stripComments(root)
  assert.match(code, /seq\s*==\s*lastSeq\s*\+\s*1/, '缺少序号连续性校验')
  assert.match(code, /prevRoot\s*==\s*lastRoot/, '缺少前根衔接校验')
  assert.match(code, /if\s*\(roots\[root\]\.anchoredAt\s*!=\s*0\)\s*return false/, '同根重复写应为幂等返回 false')
})

t('两个合约都不含"发行代币/转账"的语义：没有 ERC20 的 transfer 事件签名', () => {
  for (const [n, code] of [['Points', stripComments(points)], ['RootStore', stripComments(root)]]) {
    assert.ok(!/event\s+Transfer\s*\(/.test(code), n + ' 出现了 Transfer 事件（会被浏览器/钱包识别成代币）')
  }
})

t('三条红线写在合约头部注释里（代码即文档，不依赖外部 doc 不漂移）', () => {
  for (const k of ['用户', '不持私钥', 'transfer', '封闭式']) assert.ok(points.includes(k), '合约头部缺红线说明：' + k)
  assert.match(points, /合规边界/, '缺少合规边界段落')
  assert.ok(points.includes('不是虚拟货币'), '没有给旅豆定性')
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
