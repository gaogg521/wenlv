// 参数中心：rule_config 表加载 + 内存缓存（改参接口触发刷新）；缺省值兜底 = V2 种子
import { q } from './db.mjs'

export const DEFAULTS = {
  'bean.order_rate': '0.10', 'bean.deduct_max_pct': '0.10', 'bean.expire_months': '12',
  'bean.value_anchor': '{"beans":100,"yuan":10}', 'bean.task_reward': '200',
  'bean.note_reward': '50', 'bean.note_weekly_cap': '500', 'bean.script_rewards': '[80,50,20]',
  'bean.budget_profit_pct': '0.05', 'bean.global_cap_yuan': '600000',
  'member.level.thresholds': '[0,2000,10000,50000]', 'merchant.levels': '[{"lv":1,"name":"新晋商户","minOrders":0,"minReviews":0,"minRating":0,"maxRefundPct":100,"perks":["接入平台订单与核销","参与平台常规活动"]},{"lv":2,"name":"优选商户","minOrders":10,"minReviews":3,"minRating":45,"maxRefundPct":10,"perks":["平台活动优先报名","运营定期经营复盘"]},{"lv":3,"name":"金牌商户","minOrders":50,"minReviews":15,"minRating":47,"maxRefundPct":6,"perks":["平台推荐位优先考虑","专属运营对接人"]},{"lv":4,"name":"品质标杆","minOrders":200,"minReviews":50,"minRating":48,"maxRefundPct":4,"perks":["年度标杆商户评选资格","新业务与新线路优先试点"]}]', 'member.levels': '[{"lv":1,"name":"探索者","min":0,"rebateBonusBp":0,"perks":["注册即享旅豆返豆","参与剧本闯关与约稿任务"]},{"lv":2,"name":"旅行家","min":200000,"rebateBonusBp":30,"perks":["消费返豆额外加成","解锁「旅行家」专属勋章"]},{"lv":3,"name":"城市探索官","min":1000000,"rebateBonusBp":60,"perks":["消费返豆更高加成","优先参与新线路体验"]},{"lv":4,"name":"环球探索家","min":3000000,"rebateBonusBp":100,"perks":["消费返豆最高加成","年度专属礼遇与新品首发"]}]', 'member.cs_multiplier': '10', 'member.annual_reset': 'true',
  'promoter.tier2_gmv': '1000000', 'promoter.tier3_gmv': '5000000', 'promoter.rate_bp': '[500,800,1200]',
  'promoter.tier3_score_min': '4.5', 'promoter.window_days': '90',
  'promoter.withdraw_min': '10000', 'promoter.withdraw_daily_max': '500000',
  'contribution.weights': '{"q":0.5,"s":0.3,"r":0.2}',
  'contribution.s_adoption': '5', 'contribution.r_rebuy': '3', 'contribution.r_window_days': '90',
  'order.pay_timeout': '15', 'order.observe_days': '7',
  'order.refund_policy': '{"d7":0.0,"d3":0.10,"d1":0.30}', 'order.group_cancel_hours': '48',
  'pass.code_window': '60', 'pass.verify_end_days': '7', 'commission.settle_delay_days': '7', 'settlement.weekday': '1', 'settlement.refund_fee_merchant_pct': '0', 'settlement.split_fulfill': '0.58', 'settlement.split_service': '0.12', 'settlement.split_beanbudget': '0.05',
  'coprofit.pay_approve_min': '0',
  'budget.approval.l1': '300000', 'budget.approval.l2': '800000', 'budget.fuse_pct': '0.25',
  'budget.forecast.warn': '[0.25,0.50]',
  'city.initial': '["310118","320508"]', 'city.country': '{"310118":"CN","310000":"CN","320508":"CN","330500":"CN","330523":"CN"}', 'channel.initial': '["main"]',
}

// 仅展示元数据，不改变参数键、值、单位或审批规则；新增参数应同时补名称。
export const CONFIG_NAMES = {
  'bean.order_rate': '消费返豆率', 'bean.deduct_max_pct': '订单旅豆抵扣上限',
  'bean.expire_months': '旅豆有效期', 'bean.value_anchor': '旅豆价值基准',
  'bean.task_reward': '约稿任务奖励', 'bean.note_reward': '推荐笔记奖励',
  'bean.note_weekly_cap': '笔记奖励周上限', 'bean.script_rewards': '剧本结局奖励',
  'bean.budget_profit_pct': '批次预算利润比例', 'bean.global_cap_yuan': '旅豆年度发行额度',
  'member.level.thresholds': '会员等级成长值门槛（已弃用）', 'member.levels': '会员等级体系', 'merchant.levels': '商户经营等级体系', 'member.cs_multiplier': '贡献分成长倍数',
  'member.annual_reset': '会员年度滚降', 'promoter.tier2_gmv': '优选推广商成交门槛',
  'promoter.tier3_gmv': '金牌推广商成交门槛', 'promoter.rate_bp': '推广档位佣金费率',
  'promoter.tier3_score_min': '金牌推广商评分门槛', 'promoter.window_days': '推广商定档周期',
  'promoter.withdraw_min': '推广佣金最低提现额', 'promoter.withdraw_daily_max': '推广佣金每日提现上限',
  'contribution.weights': '贡献分计算权重', 'contribution.s_adoption': '贡献分S·任务采纳计分', 'contribution.r_rebuy': '贡献分R·窗口内复购计分', 'contribution.r_window_days': '贡献分R·复购判定窗口(天)', 'order.pay_timeout': '订单支付时限',
  'order.observe_days': '订单退款观察期', 'order.refund_policy': '订单退改梯度',
  'order.group_cancel_hours': '未成团取消提前时限', 'pass.code_window': '动态核销码有效窗口', 'pass.verify_end_days': '核销有效结束日（出发日后 N 天）',
  'commission.settle_delay_days': '佣金结算延迟天数', 'settlement.weekday': '周结算出账日',
  'settlement.refund_fee_merchant_pct': '退改手续费商户分成', 'settlement.split_fulfill': '履约结算比例',
  'settlement.split_service': '平台服务费比例', 'settlement.split_beanbudget': '旅豆预算比例',
  'coprofit.pay_approve_min': '共创分润打款审批阈值', 'budget.approval.l1': '预算一级审批额度', 'budget.approval.l2': '预算二级审批额度',
  'budget.fuse_pct': '预算超支熔断线', 'budget.forecast.warn': '预算预测预警阈值',
  'city.initial': '初始开放城市', 'city.country': '城市所属国家', 'channel.initial': '初始主题频道',
  'admin.mfa.mode': '后台多因素认证策略', 'feature.city.320508': '苏州姑苏开城开关',
  'feature.create': '创作中心开关', 'feature.promo': '推广中心开关',
  'feature.script': '剧本闯关开关', 'feature.shop': '商城入口开关', 'feature.withdraw': '佣金提现开关',
}
export const configName = (key, memo) => CONFIG_NAMES[key] || String(memo || '').trim() || '自定义参数（待补名称）'

let cache = null
let loadedAt = 0

export async function loadConfig(force = false) {
  if (!force && cache && Date.now() - loadedAt < 30_000) return cache
  try {
    const rows = await q('SELECT k, v FROM rule_config')
    cache = {}
    for (const r of rows) cache[r.k] = typeof r.v === 'string' ? r.v : JSON.stringify(r.v)
    for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in cache)) cache[k] = v
  } catch {
    cache = { ...DEFAULTS } // 库不可用时兜底（只读接口可用）
  }
  loadedAt = Date.now()
  return cache
}

export async function cfg(key) {
  const c = await loadConfig()
  if (!(key in c)) throw new Error('unknown config key: ' + key)
  return c[key]
}
export async function cfgNum(key) { return Number(await cfg(key)) }
export async function cfgArr(key) { return JSON.parse(await cfg(key)) }
export async function cfgAll() { return loadConfig(true) }
