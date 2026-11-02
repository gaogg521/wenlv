// Merkle 树：纯函数，无 IO。后端打包、后端验证、浏览器复核页（static/verify.html）三处必须同一规则。
//
// 版本说明（attest_batch.merkle_version）
//
// v1（历史批次，只验证不再生成）
//   叶 = payload_hash（十六进制字符串）；节点 = sha256(左hex + 右hex)；奇数层复制末节点补偶
//   两个已知缺陷：
//   ① 叶与内部节点同一种哈希，无域隔离 → 可把一个内部节点当成"叶"伪造 inclusion proof（第二原像）
//   ② 复制末节点 → [a,b,c] 与 [a,b,c,c] 得到同一个根（CVE-2012-2459 同型），批次叶数不能被根唯一约束
//
// v2（新批次默认，对齐 RFC 6962 / Certificate Transparency）
//   叶节点   = sha256(0x00 ‖ payload_hash 32 字节)
//   内部节点 = sha256(0x01 ‖ 左 32 字节 ‖ 右 32 字节)
//   奇数层：末节点原样提升到上一层（不复制、不产生 proof 步骤）
//   proof 步骤：[{ h: 兄弟节点hex, p: 'L'|'R' }]，p 表示兄弟在左/右
import crypto from 'node:crypto'

export const CURRENT_VERSION = 2

const HEX64 = /^[0-9a-f]{64}$/

const shaHex = (s) => crypto.createHash('sha256').update(s).digest('hex')
const shaBuf = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts)).digest()
const LEAF = Buffer.from([0x00])
const NODE = Buffer.from([0x01])

function assertLeaf(h) {
  if (!HEX64.test(String(h))) throw new Error('Merkle 叶必须是 64 位小写十六进制 sha256：' + String(h).slice(0, 20))
}

/* ---------------- v2 ---------------- */

export const leafHashV2 = (payloadHash) => {
  assertLeaf(payloadHash)
  return shaBuf(LEAF, Buffer.from(payloadHash, 'hex')).toString('hex')
}
export const nodeHashV2 = (l, r) => shaBuf(NODE, Buffer.from(l, 'hex'), Buffer.from(r, 'hex')).toString('hex')

function buildV2(payloadHashes) {
  let level = payloadHashes.map(leafHashV2)
  const levels = [level]
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? nodeHashV2(level[i], level[i + 1]) : level[i])
    }
    level = next
    levels.push(level)
  }
  return { root: level[0], levels }
}

function proofV2(levels, leafPos) {
  const path = []
  let pos = leafPos
  for (let i = 0; i < levels.length - 1; i++) {
    const lv = levels[i]
    const sibPos = pos % 2 === 0 ? pos + 1 : pos - 1
    if (sibPos < lv.length) path.push({ h: lv[sibPos], p: pos % 2 === 0 ? 'R' : 'L' })
    pos = Math.floor(pos / 2)
  }
  return path
}

function verifyV2(payloadHash, path, root) {
  let cur = leafHashV2(payloadHash)
  for (const step of path || []) {
    if (!HEX64.test(String(step.h))) return false
    cur = step.p === 'R' ? nodeHashV2(cur, step.h) : nodeHashV2(step.h, cur)
  }
  return cur === root
}

/* ---------------- v1（历史兼容，只读） ---------------- */

function buildV1(leafHashes) {
  let level = leafHashes.map((h, i) => ({ hash: h, pos: i }))
  const levels = [level.slice()]
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]
      const b = level[i + 1]
      next.push({ hash: shaHex(a.hash + (b ? b.hash : a.hash)), pos: next.length })
    }
    level = next
    levels.push(level.slice())
  }
  return { root: level[0].hash, levels: levels.map((lv) => lv.map((n) => n.hash)) }
}

function proofV1(levels, leafPos) {
  const path = []
  let pos = leafPos
  for (let i = 0; i < levels.length - 1; i++) {
    const lv = levels[i]
    const sib = lv[pos % 2 === 0 ? pos + 1 : pos - 1]
    path.push({ h: sib || lv[pos], p: pos % 2 === 0 ? 'R' : 'L', dup: !sib })
    pos = Math.floor(pos / 2)
  }
  return path
}

function verifyV1(payloadHash, path, root) {
  let cur = payloadHash
  for (const step of path || []) cur = step.p === 'R' ? shaHex(cur + step.h) : shaHex(step.h + cur)
  return cur === root
}

/* ---------------- 对外 API ---------------- */

/** 建树。空批次不允许（空根没有证明力，调用方应先判空） */
export function buildTree(payloadHashes, version = CURRENT_VERSION) {
  if (!payloadHashes.length) throw new Error('Merkle 树至少需要 1 片叶子')
  if (Number(version) === 1) return { version: 1, ...buildV1(payloadHashes) }
  return { version: 2, ...buildV2(payloadHashes) }
}

export function proofFor(tree, leafPos) {
  return tree.version === 1 ? proofV1(tree.levels, leafPos) : proofV2(tree.levels, leafPos)
}

/** 任何一方拿 payloadHash + path + root（+ 批次的 merkle_version）即可独立重算 */
export function verifyProof(payloadHash, path, root, version = 1) {
  if (!HEX64.test(String(payloadHash)) || !HEX64.test(String(root))) return false
  return Number(version) === 1 ? verifyV1(payloadHash, path, root) : verifyV2(payloadHash, path, root)
}

/** 给复核页/报告用的算法说明（与上面实现一一对应） */
export function describe(version) {
  return Number(version) === 1
    ? 'v1（历史）：从 payloadHash 起，按 leafPath 逐层 sha256(左hex+右hex)，p=R 表示兄弟在右'
    : 'v2（RFC 6962）：叶 = sha256(0x00‖payloadHash)，节点 = sha256(0x01‖左‖右)，按字节拼接；p=R 表示兄弟在右；奇数末节点直接提升，不产生步骤'
}
