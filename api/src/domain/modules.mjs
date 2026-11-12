// C-04：后台模块单一数据源（key / 中文名 / 分组 / 图标）。
// 来源：core.js NAV（50 个模块）原样抽出——key 与菜单完全一致，防止菜单丢失；
// 前端不再写死 access 表，菜单由 GET /admin/capabilities 的 allModules + modules 驱动。
// 角色默认集合 = §5.1 基线快照（迁移 V54 同步固化到 admin_role_module）：
// - super 恒为全部；
// - ops/finance/review/risk/city_partner 与原前端 access 计算结果一字不差；
// - readonly/sre/dev 原来因缺省放行泄露全部 50 个菜单（缺陷），改为显式默认集合（D-01 决策，见进度台账）；
// - 未知角色默认拒绝（空集合）。
export const MODULE_GROUPS = [
  ['经营总览', [['partnerdash', '主体方经营', 'dash'], ['dash', '经营概览', 'dash']]],
  ['商品与资源', [['products', '商品与团期', 'products'], ['merchants', '商户与进件', 'merchants'], ['scenics', '景区资源', 'eco'], ['suppliers', '供应商', 'merchants']]],
  ['订单履约', [['orders', '订单管理', 'orders'], ['tickets', '售后工单', 'orders'], ['phrases', '核销暗号', 'flag'], ['conflicts', '离线核销冲突', 'risk']]],
  ['用户与权益', [['users', '用户中心', 'promoters'], ['kyc', '实名认证', 'audit'], ['wallets', '权益账户', 'orders'], ['badges', '徽章管理', 'flag'], ['entitlements', '权益调整', 'budgets']]],
  ['内容运营', [['contentdash', '内容看板', 'content'], ['reviewqueue', '审核队列', 'content'], ['content', '内容审核', 'content'], ['contentcases', '举报与申诉', 'audit'], ['tasks', '约稿任务', 'flag'], ['creators', '创作者池', 'content']]],
  ['合伙人与推广', [['partners', '合伙人中心', 'promoters'], ['partnerperf', '排行与对账', 'settlements'], ['promoters', '推广服务商', 'promoters']]],
  ['资金结算', [['fund', '资金工作台', 'settlements'], ['settlements', '结算', 'settlements'], ['withdrawals', '提现审批', 'withdraw'], ['taskcash', '现金加奖打款', 'withdraw'], ['agreements', '协议变更', 'eco'], ['budgets', '旅豆预算', 'budgets'], ['rateov', '逐品佣金', 'promoters'], ['cocreate', '共创分润', 'eco']]],
  ['渠道装修', [['miniapp', '小程序装修与映射', 'content'], ['banners', '轮播管理', 'flag'], ['faqs', '常见问题', 'audit']]],
  ['可信存证', [['web3dash', '链路总览', 'eco'], ['attest', '存证中心', 'eco'], ['vc', '数字身份', 'kyc'], ['pointassets', '旅豆发行台账', 'budgets'], ['chainassets', '链与资产', 'sys'], ['chainhub', '链接入中心', 'sys'], ['terms', '术语映射', 'flag']]],
  ['系统治理', [['risk', '风控事件', 'risk'], ['audit', '审计日志', 'audit'], ['security', '安全中心', 'risk'], ['accounts', '后台账号', 'sys'], ['cases', '风控案件', 'risk'], ['config', '参数中心', 'config'], ['features', '功能开关', 'flag'], ['integrations', '集成中心', 'withdraw'], ['system', '运维控制台', 'sys']]],
]

export const MODULES = MODULE_GROUPS.flatMap(([group, items]) => items.map(([key, name, icon]) => ({ key, name, group, icon })))
export const MODULE_KEYS = MODULES.map((m) => m.key)

/** D-01：城市合伙人不可被授予的模块（系统级/资金敏感/链上配置类）——批次 D 的 requireModule 强制叠加 */
export const CITY_DENY_MODULES = ['security', 'accounts', 'config', 'features', 'integrations', 'system', 'web3dash', 'attest', 'vc', 'pointassets', 'chainassets', 'chainhub', 'terms', 'suppliers', 'kyc', 'wallets', 'badges', 'creators', 'rateov', 'miniapp', 'phrases', 'conflicts']

/**
 * 角色默认模块集合（基线快照，与迁移 V54 种子一致）：
 * - ops 23 / finance 14 / review 5 / risk 6 / city_partner 12 —— 与原 core.js access 计算结果零差异；
 * - readonly（D-01）：只读观察者——经营与内容看板，不给任何资金/系统治理模块；
 * - sre（D-01）：运维向——审计、运维控制台、集成中心与链类基础设施，不给业务资金与账号/参数中心；
 * - dev（D-01）：开发联调——sre 集合 + 功能开关与术语映射；
 * - 未知角色：空集合（默认拒绝，不再缺省放行全菜单）。
 */
export const ROLE_DEFAULT_MODULES = {
  ops: ['users', 'dash', 'orders', 'tickets', 'entitlements', 'fund', 'reviewqueue', 'products', 'merchants', 'content', 'tasks', 'faqs', 'banners', 'promoters', 'agreements', 'kyc', 'cocreate', 'partners', 'partnerperf', 'scenics', 'contentdash', 'contentcases', 'taskcash'],
  finance: ['dash', 'orders', 'fund', 'settlements', 'withdrawals', 'agreements', 'budgets', 'audit', 'cocreate', 'entitlements', 'partners', 'partnerperf', 'scenics', 'taskcash', 'config'],
  review: ['content', 'tasks', 'reviewqueue', 'contentdash', 'contentcases'],
  risk: ['risk', 'users', 'conflicts', 'audit', 'entitlements', 'cases'],
  city_partner: ['dash', 'orders', 'tickets', 'products', 'merchants', 'settlements', 'cases', 'partners', 'partnerperf', 'scenics', 'contentdash', 'contentcases'],
  readonly: ['dash', 'orders', 'products', 'merchants', 'scenics', 'settlements', 'contentdash', 'partners', 'partnerperf'],
  sre: ['dash', 'audit', 'system', 'integrations', 'chainhub', 'web3dash', 'attest'],
  dev: ['dash', 'audit', 'system', 'integrations', 'chainhub', 'web3dash', 'attest', 'features', 'terms'],
  // 商户/景区主体方（V82 独立 PC 身份）：只看本主体授权范围；不给 dash（平台聚合）与资金/参数等平台模块
  merchant_partner: ['partnerdash', 'orders', 'settlements', 'products', 'merchants', 'partnerperf'],
  scenic_partner: ['partnerdash', 'orders', 'scenics', 'settlements', 'products'],
}

/** 有效模块集合：super 全部；已知角色取默认；未知角色空（默认拒绝） */
export function effectiveModules(role) {
  if (role === 'super') return [...MODULE_KEYS]
  const base = ROLE_DEFAULT_MODULES[role]
  return base ? [...base] : []
}

/**
 * P-09：角色默认落地页——登录后与侧栏「返回工作台」的目标，按职责配置而不是"第一个可见栏目"。
 * 首选不在该账号有效模块集合内时由前端回落第一个可用栏目（模块可被收回，首页跟着收回）：
 * super/ops/readonly/city_partner→经营概览；finance→资金工作台；review→审核队列；
 * risk→风控事件；sre/dev→运维控制台。未知角色 null（前端回落）。
 */
export const ROLE_HOME = {
  super: 'dash', ops: 'dash', readonly: 'dash', merchant_partner: 'partnerdash', scenic_partner: 'partnerdash', city_partner: 'dash',
  finance: 'fund', review: 'reviewqueue', risk: 'risk', sre: 'system', dev: 'system',
}
