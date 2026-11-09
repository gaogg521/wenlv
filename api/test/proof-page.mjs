// 商户端「记录复核」页（pages/proof）：商户拿勋章 / 订单记录上的 8 位编号来核对。
// 做法：把页面 JS 放进 vm，桩掉 Page / wx / getApp / api，真把方法跑一遍；不碰数据库、不需要服务。
// 守的是：编号校验、三种校验结果的说法、错误提示、连点只认最后一次、复制链接、不展示指纹与单号、入口真的接上了。
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { BANNED } from '../src/domain/wording.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
let pass = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }

let reqs = [], reply = null, clip = [], toasts = []
const apiStub = { request: (p) => { reqs.push(p); return typeof reply === 'function' ? reply(p) : Promise.resolve(reply) } }
let pageDef = null
const sandbox = {
  Page: (d) => { pageDef = d }, wx: { setClipboardData: (o) => clip.push(o.data), showToast: (o) => toasts.push(o.title) },
  getApp: () => ({ globalData: { apiBase: 'http://127.0.0.1:8080' } }),
  require: (m) => { if (m === '../../utils/api') return apiStub; throw new Error('页面不该依赖 ' + m) },
  console, Promise, String, Number, Object, Array, setTimeout,
}
vm.createContext(sandbox)
vm.runInContext(read('mini-b/pages/proof/index.js'), sandbox, { filename: 'mini-b/pages/proof/index.js' })
const mk = (q) => {
  const p = Object.assign({}, pageDef, { data: JSON.parse(JSON.stringify(pageDef.data)), setData(o) { Object.assign(this.data, o) } })
  if (q) p.onLoad(q)
  return p
}
const REC = (o = {}) => ({ kind: '商户勋章', title: '优选商户认证', date: '2026-11-09', status: 2, batchSeq: 6, proofValid: true, canonicalValid: true, payloadHash: 'e'.repeat(64), merkleRoot: 'a'.repeat(64), note: '已锚定上链', ...o })

console.log('== 商户端 · 记录复核页 ==')

await t('编号不合规（不是 8 位 0-9A-F）不发请求，直接给人话提示', async () => {
  for (const bad of ['', 'abc', 'DEF45B8', 'DEF45B800', 'ZZZZZZZZ', 'DEF4 5B8!']) {
    reqs = []; const p = mk(); await p.check(bad)
    assert.equal(reqs.length, 0, `「${bad}」不该发请求`); assert.match(p.data.err, /8 位数字或字母/); assert.equal(p.data.records.length, 0)
  }
})
await t('合规编号：去掉空格、转大写后请求公开接口；查到就显示类型 / 名称 / 日期，输入框回填大写', async () => {
  reqs = []; reply = { code: 'DEF45B80', records: [REC()] }
  const p = mk(); await p.check(' def4 5b80 ')
  assert.deepEqual(reqs, ['/open/verify/record/DEF45B80']); assert.equal(p.data.input, 'DEF45B80'); assert.equal(p.data.code, 'DEF45B80')
  const r = p.data.records[0]; assert.equal(r.kind, '商户勋章'); assert.equal(r.title, '优选商户认证'); assert.equal(r.date, '2026-11-09'); assert.equal(r.stateText, '已确认'); assert.equal(r.batchText, '第 6 批')
  assert.equal(p.data.loading, false); assert.equal(p.data.err, '')
})
await t('从勋章页带编号跳进来（?code=）自动复核', async () => {
  reqs = []; reply = { records: [REC()] }
  const p = mk({ code: 'def45b80' }); await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(reqs, ['/open/verify/record/DEF45B80']); assert.equal(p.data.records.length, 1)
})
await t('三种校验结果各说各的：一致 / 不一致（说联系平台）/ 还没封存；不一致时绝不出现「一致」', async () => {
  reply = { records: [REC(), REC({ proofValid: false }), REC({ canonicalValid: false }), REC({ proofValid: null, canonicalValid: null, status: 0, batchSeq: null })] }
  const p = mk(); await p.check('DEF45B80')
  const [ok, bad1, bad2, wait] = p.data.records
  assert.equal(ok.result, 'ok'); assert.equal(ok.resultText, '校验一致'); assert.match(ok.resultNote, /没有被改动/)
  for (const b of [bad1, bad2]) { assert.equal(b.result, 'bad'); assert.equal(b.resultText, '校验不一致'); assert.ok(!/一致$/.test(b.resultText.replace('不一致', ''))); assert.match(b.resultNote, /联系平台/) }
  assert.equal(wait.result, 'wait'); assert.match(wait.resultText, /还没封存/); assert.equal(wait.stateText, '等待封存'); assert.equal(wait.batchText, '')
})
await t('找不到 / 网络不通 / 其他错误：各给一句人话，清掉旧结果', async () => {
  const p = mk(); reply = { records: [REC()] }; await p.check('DEF45B80'); assert.equal(p.data.records.length, 1)
  reply = () => Promise.reject({ code: 1004, msg: '没有找到这个记录编号' }); await p.check('00000000')
  assert.match(p.data.err, /没有找到这个记录编号/); assert.equal(p.data.records.length, 0)
  reply = () => Promise.reject({ msg: '服务不可达', network: true }); await p.check('00000000'); assert.match(p.data.err, /网络不通/)
  reply = () => Promise.reject({ code: 500, msg: '服务繁忙' }); await p.check('00000000'); assert.equal(p.data.err, '服务繁忙')
  reply = () => Promise.reject(undefined); await p.check('00000000'); assert.match(p.data.err, /暂时无法复核/)
  assert.equal(p.data.loading, false, '失败后不能一直转圈')
})
await t('连点两次：先发的慢请求晚到，不能盖掉后发的结果', async () => {
  const slow = new Promise((res) => setTimeout(() => res({ records: [REC({ title: '旧的' })] }), 40))
  const fast = Promise.resolve({ records: [REC({ title: '新的' })] })
  let n = 0; reply = () => (++n === 1 ? slow : fast)
  const p = mk(); const a = p.check('AAAAAAAA'); const b = p.check('BBBBBBBB'); await Promise.all([a, b]); await new Promise((r) => setTimeout(r, 60))
  assert.equal(p.data.records.length, 1); assert.equal(p.data.records[0].title, '新的'); assert.equal(p.data.code, 'BBBBBBBB')
})
await t('复制复核链接：带 mode=t1（商户口径）和编号；没查过时不复制', async () => {
  clip = []; toasts = []; const p = mk(); p.copyLink(); assert.deepEqual(clip, [])
  reply = { records: [REC()] }; await p.check('def45b80'); p.copyLink()
  assert.deepEqual(clip, ['http://127.0.0.1:8080/verify?mode=t1&no=DEF45B80']); assert.match(toasts[0], /复核链接已复制/)
})
await t('页面不展示指纹原文、批次根、业务单号、金额：wxml 只引用白名单字段', () => {
  const wxml = read('mini-b/pages/proof/index.wxml')
  const refs = [...wxml.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1])
  const used = new Set(refs.flatMap((r) => r.match(/\b(?:item|records|code|err|input|loading|tried)\b(?:\.\w+)?/g) || []))
  const allowed = new Set(['item.result', 'item.resultText', 'item.resultNote', 'item.kind', 'item.title', 'item.date', 'item.stateText', 'item.batchText', 'code', 'err', 'input', 'loading', 'tried', 'records'])
  for (const u of used) assert.ok(allowed.has(u) || u === 'records.length' || u.startsWith('records'), '页面引用了白名单之外的字段：' + u)
  assert.ok(!/payloadHash|merkleRoot|bizRef|leafPath|amount|proofValid/.test(wxml), 'wxml 里不该出现指纹 / 根 / 单号 / 金额字段')
})
await t('用语合规：页面源码里没有区块链 / 虚拟资产类用语（接口回的 note 里有「锚定上链」，页面不显示它）', () => {
  const src = ['index.js', 'index.wxml', 'index.json'].map((f) => read('mini-b/pages/proof/' + f)).join('\n')
  const js = read('mini-b/pages/proof/index.js')
  assert.ok(!/\.note\b|r\.note|d\.note/.test(js), '页面 JS 不该读接口的 note 字段')
  const hit = BANNED.filter((w) => src.includes(w)); assert.deepEqual(hit, [])
})
await t('版式（真机渲染里量到的）：两个按钮各 136rpx 固定宽度，不会把「复制编号」挤出卡片；标题里的 & 不能写成 &amp;（微信不转义，会原样显示）', () => {
  const css = read('mini-b/pages/honor/index.wxss')
  assert.match(css, /.proof-acts{display:flex;gap:12rpx;flex:none}.proof-acts .compact-button{flex:none;width:136rpx;min-width:0;margin:0;padding:11rpx 0;text-align:center}/)
  const bad = []
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) { if (!/node_modules|miniprogram_npm/.test(p)) walk(p) } else if (e.name.endsWith('.wxml') && /&(amp|lt|gt|quot);/.test(read(p))) bad.push(p) } }
  walk('mini-a'); walk('mini-b')
  assert.deepEqual(bad, [], '这些 wxml 里写了 HTML 实体，真机 / 模拟器会原样显示出来：' + bad)
})
await t('入口接上了：页面已登记 app.json；勋章页每张凭证有「复核」按钮并带编号跳转', () => {
  const pages = JSON.parse(read('mini-b/app.json')).pages
  assert.ok(pages.includes('pages/proof/index'), 'app.json 没登记')
  for (const f of ['js', 'wxml', 'wxss', 'json']) assert.ok(fs.statSync(path.join(root, 'mini-b/pages/proof/index.' + f)).size > 2, f + ' 不能是空文件')
  const wxml = read('mini-b/pages/honor/index.wxml'); assert.match(wxml, /bindtap="goProof" data-code="\{\{item\.proof\.code\}\}">复核<\/button>/)
  assert.match(read('mini-b/pages/honor/index.js'), /goProof\(e\)[^}]*navigateTo\(\{ url: '\/pages\/proof\/index' \+ \(code \? '\?code=' \+ encodeURIComponent\(code\) : ''\) \}\)/)
  assert.match(read('api/admin/miniapp.js'), /path: 'pages\/proof\/index', name: '记录复核'/)
})

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
