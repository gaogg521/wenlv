// 卡种规则：最高一级固定黑金，其余从普卡往上；等级数取自配置，改了自动跟着变。
// 后台卡面在 admin/pages/web3.js 的 cardTierOf 用同一规则（test/web3-trust-layout.mjs 校验两边一致）。
export const TIER_ORDER = ['classic', 'gold', 'platinum', 'diamond', 'black']
export const TIER_NAMES = { classic: '普卡', gold: '金卡', platinum: '白金卡', diamond: '钻石卡', black: '黑金卡' }
export const SERIES = { traveler: '行者系列', creator: '创作者系列', promoter: '推广服务系列', merchant: '商户系列' }

export function cardTierOf(rank, total) {
  const n = Math.max(1, Number(total) || 4), r = Math.min(Math.max(1, Number(rank) || 1), n)
  if (n > 1 && r === n) return 'black'
  return TIER_ORDER[Math.min(r - 1, 3)]
}
/** 下发给小程序的卡面信息：只有卡种与系列名，不含任何内部字段 */
export function cardOf(role, rank, total) {
  const tier = cardTierOf(rank, total)
  return { tier, tierName: TIER_NAMES[tier], series: SERIES[role] || SERIES.traveler }
}
