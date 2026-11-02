import crypto from 'node:crypto'
import { E } from './conf.mjs'
// 通用 HTTP 网关适配器：用"配置"描述一条链的接口，而不是为每家写代码。
//
// 适用：长安链 ChainMaker、至信链、BSN 开放联盟链、星火·链网、百度超级链、京东智臻链……
//      这些链多以"服务网关 / 开放平台 REST"对外，差异只在路径、字段名、签名串和返回结构。
//
// 配置项（后台「链接入中心」填写，或环境变量）：
//   GW_ENDPOINT        网关基址
//   GW_ANCHOR_PATH     提交路径（默认 /v1/anchor）
//   GW_BODY_TEMPLATE   请求体 JSON 模板，占位符 {root} {prevRoot} {leafCount} {bizDate} {kind} {appId} {ts} {nonce}
//   GW_TX_PATH         响应里交易号的位置（点号路径，如 data.txId）
//   GW_BLOCK_PATH      响应里块高的位置（可选）
//   GW_OK_PATH / GW_OK_VALUE   业务成功判定（如 code / 0），不配则只看 HTTP 状态
//   GW_RECEIPT_PATH    回执查询路径（可选，占位 {txRef}）；GW_FINAL_PATH / GW_FINAL_VALUE 判定终局
//   GW_ASYNC           1=提交后进入"已提交·待确认"，等回执查询或回调（POST /callback/chain/gateway）
//   GW_APP_ID / GW_SECRET      接入凭据
//   GW_SIGN_ALGO       hmac-sha256 | hmac-sm3（国密）| none
//   GW_SIGN_TEMPLATE   签名原文模板，默认 {method}\n{path}\n{ts}\n{nonce}\n{body}
//   GW_HDR_APP / GW_HDR_TS / GW_HDR_NONCE / GW_HDR_SIGN   头名（默认 x-app-id / x-timestamp / x-nonce / x-signature）
//   GW_PROBE_PATH      只读健康检查路径（可选）
//
// 预置模板（PRESETS）只是"起点"：字段名来自各家公开资料的常见形态，必须按对方签发的接口文档逐项核对后再启用。

export const PRESETS = {
  chainmaker: { label: '长安链 ChainMaker（服务网关）', GW_ANCHOR_PATH: '/api/v1/contract/invoke', GW_SIGN_ALGO: 'hmac-sm3',
    GW_BODY_TEMPLATE: '{"contractName":"RootAnchor","method":"writeRoot","params":{"root":"{root}","prevRoot":"{prevRoot}","bizDate":"{bizDate}"}}',
    GW_TX_PATH: 'data.txId', GW_BLOCK_PATH: 'data.blockHeight', GW_OK_PATH: 'code', GW_OK_VALUE: '0' },
  zhixin: { label: '至信链（腾讯 · 存证开放平台）', GW_ANCHOR_PATH: '/api/v1/evidence/save', GW_SIGN_ALGO: 'hmac-sha256',
    GW_BODY_TEMPLATE: '{"appId":"{appId}","evidenceHash":"{root}","prevHash":"{prevRoot}","bizDate":"{bizDate}","extra":"{kind}"}',
    GW_TX_PATH: 'data.txHash', GW_OK_PATH: 'retCode', GW_OK_VALUE: '0' },
  bsn: { label: 'BSN 开放联盟链（网关）', GW_ANCHOR_PATH: '/api/v1/node/trans', GW_SIGN_ALGO: 'hmac-sha256', GW_ASYNC: '1',
    GW_BODY_TEMPLATE: '{"header":{"appCode":"{appId}"},"body":{"funcName":"writeRoot","args":["{root}","{prevRoot}","{bizDate}"]}}',
    GW_TX_PATH: 'body.blockInfo.txId', GW_OK_PATH: 'header.code', GW_OK_VALUE: '0', GW_RECEIPT_PATH: '/api/v1/node/getTxInfoByTxId/{txRef}', GW_FINAL_PATH: 'header.code', GW_FINAL_VALUE: '0' },
  xinghuo: { label: '星火·链网（国家级区块链基础设施）', GW_ANCHOR_PATH: '/api/v1/anchor', GW_SIGN_ALGO: 'hmac-sm3',
    GW_BODY_TEMPLATE: '{"appId":"{appId}","data":"{root}","prev":"{prevRoot}","date":"{bizDate}"}', GW_TX_PATH: 'data.hash', GW_OK_PATH: 'code', GW_OK_VALUE: '0' },
  xuperchain: { label: '百度超级链 XuperChain（开放网络）', GW_ANCHOR_PATH: '/v1/contract/invoke', GW_SIGN_ALGO: 'hmac-sha256',
    GW_BODY_TEMPLATE: '{"module_name":"wasm","contract_name":"rootanchor","method_name":"writeRoot","args":{"root":"{root}","prev":"{prevRoot}","date":"{bizDate}"}}',
    GW_TX_PATH: 'txid', GW_OK_PATH: 'code', GW_OK_VALUE: '0' },
}

const env = () => ({
  endpoint: (E.GW_ENDPOINT || '').replace(/\/+$/, ''),
  anchorPath: E.GW_ANCHOR_PATH || '/v1/anchor',
  body: E.GW_BODY_TEMPLATE || '{"root":"{root}","prevRoot":"{prevRoot}","leafCount":{leafCount},"bizDate":"{bizDate}","kind":"{kind}"}',
  txPath: E.GW_TX_PATH || 'txRef', blockPath: E.GW_BLOCK_PATH || '',
  okPath: E.GW_OK_PATH || '', okValue: E.GW_OK_VALUE ?? '',
  receiptPath: E.GW_RECEIPT_PATH || '', finalPath: E.GW_FINAL_PATH || '', finalValue: E.GW_FINAL_VALUE ?? '',
  async: E.GW_ASYNC === '1' || E.GW_ASYNC === 'true',
  appId: E.GW_APP_ID || '', secret: E.GW_SECRET || '',
  algo: (E.GW_SIGN_ALGO || 'hmac-sha256').toLowerCase(),
  signTpl: E.GW_SIGN_TEMPLATE || '{method}\n{path}\n{ts}\n{nonce}\n{body}',
  hApp: E.GW_HDR_APP || 'x-app-id', hTs: E.GW_HDR_TS || 'x-timestamp', hNonce: E.GW_HDR_NONCE || 'x-nonce', hSign: E.GW_HDR_SIGN || 'x-signature',
  probePath: E.GW_PROBE_PATH || '',
})

function missing() {
  const e = env(), m = []
  if (!e.endpoint) m.push('GW_ENDPOINT')
  if (e.algo !== 'none' && !e.secret) m.push('GW_SECRET')
  return m
}
const pick = (obj, p) => String(p || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), obj)
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k]).replace(/["\\]/g, '')))

/** 签名：hmac-sha256 / hmac-sm3（国密）；签名原文由模板决定，对方要求不同顺序时只改模板 */
export function sign({ algo, secret, tpl, method, path, ts, nonce, body }) {
  if (algo === 'none') return ''
  const h = algo === 'hmac-sm3' ? 'sm3' : 'sha256'
  return crypto.createHmac(h, secret).update(fill(tpl, { method, path, ts, nonce, body }).replaceAll('\\n', '\n')).digest('hex')
}

async function call(method, path, bodyStr) {
  const e = env()
  const ts = String(Date.now()), nonce = crypto.randomBytes(8).toString('hex')
  const headers = { 'content-type': 'application/json' }
  if (e.appId) headers[e.hApp] = e.appId
  if (e.algo !== 'none') {
    headers[e.hTs] = ts; headers[e.hNonce] = nonce
    headers[e.hSign] = sign({ algo: e.algo, secret: e.secret, tpl: e.signTpl, method, path, ts, nonce, body: bodyStr || '' })
  }
  const res = await fetch(e.endpoint + path, { method, headers, body: bodyStr || undefined, signal: AbortSignal.timeout(15_000) })
  const text = await res.text()
  let j = null
  try { j = JSON.parse(text) } catch { /* 非 JSON */ }
  if (!res.ok) throw new Error(`gateway ${res.status}: ${text.slice(0, 160)}`)
  if (e.okPath && String(pick(j, e.okPath)) !== String(e.okValue)) throw new Error(`gateway 业务失败 ${e.okPath}=${pick(j, e.okPath)}：${text.slice(0, 120)}`)
  return j || {}
}

export default {
  id: 'gateway',
  label: '通用联盟链网关（长安链 / 至信链 / BSN / 星火链 / 超级链…）',
  docs: '路径、请求体、签名（HMAC-SHA256 / 国密 HMAC-SM3）、返回字段全部可配；支持同步出块与异步回调两种形态',
  capabilities: { anchor: true, queryByRoot: false, assets: false, did: false, confirm: true },
  mode: () => (missing().length ? 'noop' : 'real'),
  status: () => ({ provider: 'gateway', mode: missing().length ? 'noop' : 'real', missing: missing(),
    note: env().async ? '异步模式：提交后等回执查询或回调 /callback/chain/gateway' : '同步模式：提交返回交易号即视为出块' }),
  async anchor({ root, prevRoot, leafCount, bizDate, merkleKind }) {
    if (missing().length) return { txRef: null, block: null, mode: 'noop' }
    const e = env()
    const ts = String(Date.now()), nonce = crypto.randomBytes(8).toString('hex')
    const bodyStr = fill(e.body, { root, prevRoot: prevRoot || '', leafCount: Number(leafCount) || 0, bizDate: String(bizDate || '').slice(0, 10), kind: merkleKind || 'mixed', appId: e.appId, ts, nonce })
    try { JSON.parse(bodyStr) } catch { throw new Error('GW_BODY_TEMPLATE 填充后不是合法 JSON，请检查模板') }
    const r = await call('POST', e.anchorPath, bodyStr)
    const txRef = pick(r, e.txPath)
    if (!txRef) throw new Error(`gateway 响应中 ${e.txPath} 为空`)
    return { txRef: String(txRef), block: e.blockPath ? String(pick(r, e.blockPath) ?? '') : null, mode: 'real' }
  },
  // 异步链：有回执路径就主动查；没有则保持待确认，等对方回调
  async confirm({ txRef }) {
    const e = env()
    if (!e.async) return { final: true }
    if (!e.receiptPath) return { final: false, reason: '等待对方回调 /callback/chain/gateway' }
    const r = await call('GET', fill(e.receiptPath, { txRef }), '')
    const ok = e.finalPath ? String(pick(r, e.finalPath)) === String(e.finalValue) : true
    return ok ? { final: true, block: e.blockPath ? String(pick(r, e.blockPath) ?? '') : null, confirmations: 1 } : { final: false, reason: '对方尚未确认' }
  },
  async queryByRoot() { return null },
  async probe() {
    const e = env()
    if (!e.endpoint) throw new Error('未配置 GW_ENDPOINT')
    if (!e.probePath) return { ok: true, detail: '未配置只读探测路径（GW_PROBE_PATH），仅校验了配置完整性' }
    const t0 = Date.now()
    await call('GET', e.probePath, '')
    return { ok: true, detail: `网关可达，耗时 ${Date.now() - t0}ms` }
  },
  selfTest() {
    const e = env()
    let body = null
    try { body = JSON.parse(fill(e.body, { root: 'ab'.repeat(32), prevRoot: '', leafCount: 1, bizDate: '2026-11-02', kind: 'mixed', appId: e.appId, ts: '0', nonce: 'n' })) } catch { /* 下方报错 */ }
    const s1 = sign({ algo: 'hmac-sha256', secret: 'k', tpl: e.signTpl, method: 'POST', path: '/p', ts: '1', nonce: 'n', body: '{}' })
    const s2 = sign({ algo: 'hmac-sm3', secret: 'k', tpl: e.signTpl, method: 'POST', path: '/p', ts: '1', nonce: 'n', body: '{}' })
    return { ok: !!body && s1.length === 64 && s2.length === 64,
      detail: { bodyTemplate: body ? '合法 JSON' : '模板填充后不是合法 JSON', hmacSha256: s1.slice(0, 12) + '…', hmacSm3: s2.slice(0, 12) + '…', signAlgo: e.algo } }
  },
  /** 回调验签：对方回调时按同一签名规则签名（原文模板相同，method=POST，path=回调路径） */
  verifyCallback({ path, ts, nonce, body, signature }) {
    const e = env()
    if (e.algo === 'none') return true
    if (!ts || Math.abs(Date.now() - Number(ts)) > 5 * 60_000) return false
    const expect = sign({ algo: e.algo, secret: e.secret, tpl: e.signTpl, method: 'POST', path, ts, nonce: nonce || '', body })
    return !!signature && signature.length === expect.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expect))
  },
  callbackHeaders() { const e = env(); return { ts: e.hTs, nonce: e.hNonce, sign: e.hSign } },
}
