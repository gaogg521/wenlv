// 极简 ABI 编码 + keccak256（零依赖）
//
// 为什么自己写：Node 的 crypto 只有 NIST SHA3-256，**与以太坊用的 keccak256 不同**（padding 不一样），
// 拿 sha3-256 算函数选择器会得到完全错误的 4 字节，交易发出去必然 revert。
// 这里实现 keccak-f[1600] + 以太坊 padding，并用公开已知值自检（见 selfTest）：
//   keccak256('')                                   = c5d24601...a470
//   keccak256('safeTransferFrom(address,address,uint256,uint256,bytes)')[0..4] = f242432a
// 自检不过就不允许发交易 —— 宁可报错，不可发错。
import crypto from 'node:crypto' // 仅用于 randomBytes（nonce），不用于哈希

const MASK = (1n << 64n) - 1n
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]
// r[x + 5y]
const ROTC = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14]

const rotl = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK)

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    const C = new Array(5)
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20]
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1)
      for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D
    }
    const B = new Array(25)
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROTC[x + 5 * y])
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        A[x + 5 * y] = B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK) & B[((x + 2) % 5) + 5 * y])
      }
    }
    A[0] ^= RC[round]
  }
}

/** 以太坊 keccak256（不是 NIST SHA3-256） */
export function keccak256(input) {
  const RATE = 136 // 1088 bit
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input)
  const padLen = RATE - (bytes.length % RATE)
  const padded = Buffer.alloc(bytes.length + padLen)
  bytes.copy(padded)
  padded[bytes.length] ^= 0x01
  padded[padded.length - 1] ^= 0x80
  const A = new Array(25).fill(0n)
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) A[i] ^= padded.readBigUInt64LE(off + i * 8)
    keccakF(A)
  }
  const out = Buffer.alloc(32)
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(A[i] & MASK, i * 8)
  return out
}

const isDynamic = (t) => t === 'bytes' || t === 'string'

function word(hexOrBig) {
  const h = typeof hexOrBig === 'bigint' ? hexOrBig.toString(16) : String(hexOrBig).replace(/^0x/, '')
  if (h.length > 64) throw new Error('ABI 参数超 32 字节')
  return Buffer.from(h.padStart(64, '0'), 'hex')
}

function encStatic(type, v) {
  if (type === 'address') {
    const h = String(v || '').replace(/^0x/, '').toLowerCase()
    if (!/^[0-9a-f]{40}$/.test(h)) throw new Error('ABI address 非法: ' + v)
    return word(h)
  }
  if (type === 'bool') return word(BigInt(v ? 1 : 0))
  if (/^uint\d*$/.test(type)) {
    const n = BigInt(v ?? 0)
    if (n < 0n) throw new Error('uint 不能为负')
    return word(n)
  }
  if (/^int\d*$/.test(type)) {
    const n = BigInt(v ?? 0)
    return word(n < 0n ? (1n << 256n) + n : n)
  }
  if (/^bytes\d+$/.test(type)) return word(v)
  throw new Error('未支持的 ABI 静态类型: ' + type)
}

/** 按函数签名 + 位置参数编码 calldata（支持 address/uintN/intN/bool/bytesN/bytes/string） */
export function encodeCall(signature, args = []) {
  const m = /^([A-Za-z_$][\w$]*)\((.*)\)$/.exec(String(signature).trim())
  if (!m) throw new Error('函数签名非法: ' + signature)
  const types = m[2].trim() ? m[2].split(',').map((s) => s.trim()) : []
  if (types.length !== args.length) throw new Error(`参数个数不符：${signature} 需要 ${types.length}，给了 ${args.length}`)

  const heads = []
  const tails = []
  let tailOffset = types.length * 32
  for (let i = 0; i < types.length; i++) {
    const t = types[i]
    if (!isDynamic(t)) { heads.push(encStatic(t, args[i])); continue }
    heads.push(word(BigInt(tailOffset)))
    let buf
    if (t === 'string') buf = Buffer.from(String(args[i] ?? ''), 'utf8')
    else buf = Buffer.from(String(args[i] ?? '').replace(/^0x/, ''), 'hex')
    const lenWord = word(BigInt(buf.length))
    const paddedLen = Math.ceil(buf.length / 32) * 32
    const body = Buffer.concat([buf, Buffer.alloc(paddedLen - buf.length)])
    const item = Buffer.concat([lenWord, body])
    tails.push(item)
    tailOffset += item.length
  }
  return Buffer.concat([keccak256(signature).subarray(0, 4), ...heads, ...tails])
}

/** 函数选择器（4 字节 hex，含 0x） */
export const selectorOf = (signature) => '0x' + keccak256(signature).subarray(0, 4).toString('hex')

/** 自检：用公开已知值校验 keccak 与 ABI 编码，任一不过即视为库不可用 */
export function selfTest() {
  const empty = keccak256('').toString('hex')
  const emptyOk = empty === 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
  const sel = selectorOf('safeTransferFrom(address,address,uint256,uint256,bytes)')
  const selOk = sel === '0xf242432a'
  const mint = encodeCall('mint(address,uint256,uint256,bytes)', ['0x' + '11'.repeat(20), 7, 1, '0x'])
  const mintOk = mint.length === 4 + 32 * 5 && mint.subarray(0, 4).toString('hex').length === 8
  return {
    ok: emptyOk && selOk && mintOk,
    detail: { keccakEmpty: emptyOk, selector: selOk ? sel : sel + '(≠0xf242432a)', mintCalldata: mint.length + ' bytes' },
  }
}

export const nonce = () => crypto.randomBytes(8).toString('hex')
