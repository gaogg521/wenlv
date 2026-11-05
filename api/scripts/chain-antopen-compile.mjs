// 编译落根合约 WanderlustRootStore.sol，产物写到 contracts/antchain-root/build/（bin / abi.json / build.json，与源码 sha256 绑定）。
//
//   node scripts/chain-antopen-compile.mjs           # 编译并更新 build/
//   node scripts/chain-antopen-compile.mjs --check   # 只校验：用同一个编译器重编译，结果必须和已提交的产物逐字一致，否则退出码 1
//
// solc 不是项目依赖（体积大、只有改合约时才用），装一次即可，不写进 package.json：
//   cd api && npm install --no-save solc@0.6.12
// 或装在别处并指定目录：SOLC_DIR=<装有 solc 的目录> node scripts/chain-antopen-compile.mjs
//
// 为什么钉死 0.6.12：合约声明 pragma >=0.6.10 <0.9.0，0.6.12 是范围内最老的稳定版，字节码不含新操作码（如 PUSH0），
// 对蚂蚁链这类非主流 EVM 兼容性风险最低。换版本 = 换字节码 = 要重新评审，所以版本写进 build.json 并在这里强校验。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const WANT = '0.6.12'
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'contracts', 'antchain-root')
const check = process.argv.includes('--check')
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

let solc
try { solc = createRequire(import.meta.url)('solc') } catch {
  if (process.env.SOLC_DIR) { try { solc = createRequire(path.join(path.resolve(process.env.SOLC_DIR), 'x.js'))('solc') } catch { /* 下面统一报错 */ } }
}
if (!solc) { console.log(`✗ 找不到 solc。先装：cd api && npm install --no-save solc@${WANT}（或用 SOLC_DIR 指向装有它的目录）`); process.exit(2) }
if (!solc.version().startsWith(WANT)) { console.log(`✗ solc 版本是 ${solc.version()}，这份合约钉死 ${WANT}。换版本=换字节码，要重新评审后再改这里`); process.exit(2) }

const source = fs.readFileSync(path.join(DIR, 'WanderlustRootStore.sol'), 'utf8')
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources: { 'WanderlustRootStore.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
})))
const errors = (out.errors || []).filter((e) => e.severity === 'error')
for (const e of out.errors || []) console.log((e.severity === 'error' ? '✗ ' : '! ') + e.formattedMessage.split('\n')[0])
if (errors.length) process.exit(1)
const c = out.contracts['WanderlustRootStore.sol'].WanderlustRootStore
const bin = c.evm.bytecode.object
const abi = JSON.stringify(c.abi, null, 2) + '\n'
const meta = { contract: 'WanderlustRootStore', solc: solc.version(), optimizer: { enabled: true, runs: 200 }, sourceFile: 'WanderlustRootStore.sol',
  sourceSha256: sha(source), binSha256: sha(bin), binBytes: bin.length / 2,
  note: '部署用 bin（创建字节码，hex，无 0x 前缀）。源码改动后必须重新编译，api/test/antchain-contract.mjs 会校验 sourceSha256。部署不可逆。' }

const BUILD = path.join(DIR, 'build')
if (check) {
  const have = JSON.parse(fs.readFileSync(path.join(BUILD, 'build.json'), 'utf8'))
  const diff = []
  if (have.sourceSha256 !== meta.sourceSha256) diff.push('源码哈希')
  if (have.binSha256 !== meta.binSha256) diff.push('字节码哈希')
  if (fs.readFileSync(path.join(BUILD, 'WanderlustRootStore.bin'), 'utf8').trim() !== bin) diff.push('bin 文件')
  if (fs.readFileSync(path.join(BUILD, 'WanderlustRootStore.abi.json'), 'utf8') !== abi) diff.push('abi 文件')
  if (diff.length) { console.log('✗ 已提交的产物与当前源码重编译的结果不一致：' + diff.join('、') + '。运行不带 --check 的命令更新 build/，并重新评审'); process.exit(1) }
  console.log(`✓ 一致：solc ${solc.version().split('+')[0]} 重编译结果与已提交产物逐字相同（bin sha256 ${meta.binSha256.slice(0, 16)}…，${meta.binBytes} 字节）`)
  process.exit(0)
}
fs.mkdirSync(BUILD, { recursive: true })
fs.writeFileSync(path.join(BUILD, 'WanderlustRootStore.bin'), bin + '\n')
fs.writeFileSync(path.join(BUILD, 'WanderlustRootStore.abi.json'), abi)
fs.writeFileSync(path.join(BUILD, 'build.json'), JSON.stringify(meta, null, 2) + '\n')
console.log(`✓ 已写入 ${path.relative(process.cwd(), BUILD) || BUILD}：bin ${meta.binBytes} 字节，sha256 ${meta.binSha256.slice(0, 16)}…`)
