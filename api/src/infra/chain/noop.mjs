// NOOP：未配置任何链凭据时的兜底实现
// 铁律：绝不返回伪交易号。没有真实链上交易，就没有 txRef。
export default {
  id: 'noop',
  label: '未接入（本地存证）',
  docs: '配置 CHAIN_PROVIDER 与对应凭据后自动切换；缺凭据期间批次停在「已打包·待锚定」',
  capabilities: { anchor: false, queryByRoot: false, assets: false, did: false },
  mode: () => 'noop',
  status: () => ({ provider: 'noop', mode: 'noop', missing: [], note: 'NOOP：哈希与 Merkle 根实时落库，不产生任何链上交易' }),
  async anchor() { return { txRef: null, block: null, mode: 'noop' } },
  async queryByRoot() { return null },
}
