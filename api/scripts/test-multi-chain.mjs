// 多链适配层 + 资产发行闸门 自测（不需要任何真实链凭据）
// 用法：node scripts/test-multi-chain.mjs
import { q, one } from '../src/db.mjs'
import * as chain from '../src/infra/chain.mjs'
import * as asset from '../src/domain/asset.mjs'

let pass = 0, fail = 0
const ok = (c, m, extra) => { if (c) { pass++; console.log('  PASS ', m) } else { fail++; console.log('  FAIL ', m, extra === undefined ? '' : JSON.stringify(extra)) } }
const restore = { ...process.env }

console.log('== 1. 适配器注册表 ==')
const ids = Object.keys(chain.PROVIDERS)
ok(['chaingen', 'tbaas', 'antchain', 'evm', 'noop', 'mock'].every((k) => ids.includes(k)), '六种链适配器都在：' + ids.join(' / '))
const list = chain.listProviders()
ok(list.length === ids.length, 'listProviders 返回全部')
ok(list.filter((p) => p.current).length === 1, '有且只有一个"当前"链')

console.log('== 2. 默认与非法值 ==')
delete process.env.CHAIN_PROVIDER
ok(chain.providerId() === 'noop', '无凭据时自动落到 noop', chain.providerId())
process.env.CHAIN_PROVIDER = 'nosuchchain'
let threw = false
try { chain.active() } catch { threw = true }
ok(threw, '非法 CHAIN_PROVIDER 直接抛错（不静默降级）')
process.env.CHAIN_PROVIDER = 'mock'

console.log('== 3. mock 链（验证派发与幂等）==')
const root = 'ab'.repeat(32)
const a1 = await chain.submit({ root, prevRoot: null, leafCount: 1, bizDate: '2026-10-26', merkleKind: 'test' })
ok(!!a1.txRef && a1.mode === 'real', '锚定拿到 txRef', a1.txRef)
const a2 = await chain.submit({ root, prevRoot: null, leafCount: 1, bizDate: '2026-10-26', merkleKind: 'test' })
ok(a2.txRef === a1.txRef, '同一根重复提交返回同一交易号（幂等）')
ok(!!(await chain.queryByRoot(root)), '按根可反查')
let bad = false
try { await chain.submit({ root: 'zz', leafCount: 1 }) } catch { bad = true }
ok(bad, '非法 root 被拒')

console.log('== 4. 生产环境禁用 mock ==')
process.env.NODE_ENV = 'production'
let prodBlocked = false
try { chain.active() } catch { prodBlocked = true }
ok(prodBlocked, 'NODE_ENV=production + mock → 拒绝')
process.env.NODE_ENV = restore.NODE_ENV || 'development'

console.log('== 5. 资产闸门：微信渠道硬禁 ==')
const u = await one('SELECT id FROM user_account ORDER BY id LIMIT 1')
if (!u) { console.error('库里没有用户，先跑 npm run e2e'); process.exit(1) }
let wechatBlocked = false
let wechatMsg = ''
try { await asset.issue({ kind: 'badge', userId: u.id, channel: 'wechat', meta: { name: 'x' } }) }
catch (e) { wechatBlocked = true; wechatMsg = e.message }
ok(wechatBlocked && /禁止/.test(wechatMsg), 'channel=wechat 被代码层拒绝', wechatMsg)
// 库层第二道：绕过代码直接插
let dbBlocked = false
try {
  await q(`INSERT INTO asset_issue (kind, channel, provider, user_id, status) VALUES ('badge','wechat','mock',?,0)`, [u.id])
} catch { dbBlocked = true }
ok(dbBlocked, '库层 CHECK 约束也拦住了 wechat 渠道')

console.log('== 6. 能力闸门：不支持的链明确报错 ==')
process.env.CHAIN_PROVIDER = 'noop'
let capBlocked = false
let capMsg = ''
let capRecId = null
try { await asset.issue({ kind: 'badge', userId: u.id, channel: 'ecosystem', meta: { name: '瑜伽修行者' } }) }
catch (e) { capBlocked = true; capMsg = e.message }
ok(capBlocked && /不支持资产发行/.test(capMsg), 'noop 链拒绝发行（写明原因）', capMsg)
const failed = await one(`SELECT id, status, err FROM asset_issue WHERE status = 2 ORDER BY id DESC LIMIT 1`)
ok(!!failed && /不支持/.test(failed.err || ''), '失败也落台账（status=2 + 原因）')
capRecId = failed && failed.id

console.log('== 7. 真实发行（mock 链）==')
process.env.CHAIN_PROVIDER = 'mock'
const r = await asset.issue({ kind: 'badge', userId: u.id, channel: 'ecosystem', meta: { name: '瑜伽修行者' }, tokenId: 'B-001' })
ok(r.status === 1 && !!r.txRef, '发行成功并回填交易号', r)
const again = await asset.retry(r.id)
ok(again.skipped === true, '已发行的记录重试被跳过')
const pending = await asset.issue({ kind: 'collectible', userId: u.id, channel: 'antchain_collectible', meta: { name: '朱家角限定' } })
ok(pending.status === 1 || pending.status === 0, '藏品渠道可走（mock 下直接发行）', pending.status)

console.log('== 8. NOOP 时只排队不造假 ==')
process.env.CHAIN_PROVIDER = 'noop'
const q1 = await (async () => {
  // 临时把 capabilities.assets 打补丁不现实，改为直接验证 retry 语义：NOOP 下 retry 不写 txRef
  const rec = await one('SELECT id FROM asset_issue WHERE status = 2 ORDER BY id DESC LIMIT 1')
  if (!rec) return null
  try { return await asset.retry(rec.id) } catch (e) { return { err: e.message } }
})()
ok(!!q1 && (q1.skipped || /不支持/.test(q1.err || '')), 'NOOP 下重试既不发行也不造假', q1)

console.log('== 9. 台账与统计 ==')
const st = await asset.stats()
ok(st.total >= 3 && st.channels.length === 4, `台账 ${st.total} 条 · 渠道 ${st.channels.length} 类`, { issued: st.issued, pending: st.pending, failed: st.failed })
ok(st.providers.length >= 6, '统计里带多链能力矩阵')

// 清理本次测试写入（保持演示库干净；asset_issue 是台账，测试数据不应留存）
await q(`DELETE FROM asset_issue WHERE user_id = ? AND meta LIKE '%瑜伽修行者%'`, [u.id])
await q(`DELETE FROM asset_issue WHERE user_id = ? AND meta LIKE '%朱家角限定%'`, [u.id])
const left = await one('SELECT COUNT(*) n FROM asset_issue WHERE user_id = ?', [u.id])
ok(Number(left.n) === 0, '测试台账已清理')

Object.assign(process.env, restore)
console.log(`\nMULTI-CHAIN: ${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
