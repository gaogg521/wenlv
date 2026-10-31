// mock：自测专用（生产环境强制禁用）。用来在没有真凭据时验证"派发→签名→状态翻转"整条链路。
import crypto from 'node:crypto'
const store = new Map()
let block = 9000000
export default {
  id: 'mock',
  label: '自测链（仅非生产）',
  docs: 'CHAIN_PROVIDER=mock 时启用；生产 NODE_ENV=production 会被拒绝',
  capabilities: { anchor: true, queryByRoot: true, assets: true, did: false },
  mode: () => 'real',
  status: () => ({ provider: 'mock', mode: 'real', missing: [], note: '自测链：交易号只在进程内存中，重启即失效，用于 CI/演示' }),
  async anchor({ root }) {
    if (!/^[0-9a-f]{64}$/.test(root || '')) throw new Error('mock: root 必须是 64 位 hex')
    if (store.has(root)) return store.get(root)
    const rec = { txRef: '0x' + crypto.randomBytes(24).toString('hex'), block: String(++block) }
    store.set(root, rec)
    return rec
  },
  async queryByRoot(root) { return store.get(root) || null },
  async issueAsset({ to, tokenId, uri }) {
    return { txRef: '0x' + crypto.randomBytes(24).toString('hex'), contract: '0xmock1155', tokenId: tokenId || crypto.randomBytes(4).toString('hex'), uri: uri || null, to }
  },
  _reset() { store.clear(); block = 9000000 },
}
