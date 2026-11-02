// 小程序审核用语：游客端与商户端界面不出现区块链/虚拟资产类词汇（PC 后台与对外 H5 不受限）。
// 两处使用：test/wording-guard.mjs（代码与接口扫描）、entity-schema.mjs（后台录入小程序可见字段时拦截）。
export const BANNED = ['区块链', '链上', '上链', '联盟链', '公链', '锚定', '存证', 'Web3', 'WEB3', 'web3', 'NFT', '数字藏品', '藏品', '代币', '通证',
  '加密货币', '虚拟货币', '数字货币', '钱包', 'DID', 'did:', 'Merkle', '默克尔', '哈希', '智能合约', '元宇宙', '铸造', '空投', '挖矿', '向往自由链', '交易所', '升值', 'Token']

// 后台录入时给出的替换建议
export const SUGGEST = { 存证: '可信记录', 上链: '封存', 链上: '可信', 锚定: '对应', 哈希: '校验码', 藏品: '纪念品', 钱包: '账户', 数字藏品: '数字纪念卡', Token: '积分', 代币: '积分', 通证: '权益' }

/** 返回命中的第一个敏感词（无则 null）；富文本先去标签 */
export function findBanned(value) {
  const text = (typeof value === 'string' ? value : JSON.stringify(value ?? '')).replace(/<[^>]+>/g, '')
  for (const w of BANNED) if (w === 'Token' ? /\bToken\b/.test(text) : text.includes(w)) return w
  return null
}
