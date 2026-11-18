// R-05：角色能力矩阵（单一事实源）。
// PC 角色的 canView = ROLE_DEFAULT_MODULES（super 全部）；canDo = ADMIN_ACTIONS 命中项——
// 两处都引用既有常量，不新造权限；静态断言（test/role-matrix.mjs）保证矩阵与权限表不漂移。
// 商户端岗位 / 游客端身份（side!=='PC'）是页面与能力描述文案，断言只校验非空。
import { ADMIN_ACTIONS } from './admin-capabilities.mjs'
import { MODULE_KEYS, ROLE_DEFAULT_MODULES } from './modules.mjs'

const pcActions = (role) => Object.entries(ADMIN_ACTIONS).filter(([, r]) => r.roles.includes(role)).map(([k]) => k)
const pcRow = (actor, label, scope, note) => ({
  actor, side: 'PC', label, scope,
  canView: [...(ROLE_DEFAULT_MODULES[actor] || MODULE_KEYS)],
  canDo: pcActions(actor), note,
})

export const ROLE_MATRIX = [
  pcRow('super', '超级管理员', '平台全部', '含后台账号、参数中心、资金出口等最高权限；菜单恒为全部'),
  pcRow('ops', '运营管理员', '平台业务（无资金出口/账号/参数）', '进件审批、商品与团期、内容与约稿办理、改期'),
  pcRow('finance', '财务管理员', '资金线', '结算复核、打款登记、提现裁决、审计查看'),
  pcRow('review', '审核管理员', '内容审核线', '笔记判定、约稿投稿、评价回复审核'),
  pcRow('risk', '风控管理员', '风控线', '风控事件处理、案件研判、用户冻结'),
  pcRow('city_partner', '城市合伙人', '本城（scope_city）', '本城订单/商品/商户/结算查看，商户进件审批；无提现/内容审核/约稿'),
  pcRow('readonly', '只读观察', '经营与内容看板', '全部只读，无任何办理按钮'),
  pcRow('sre', '运维', '基础设施', '审计、运维控制台、集成中心、链基础设施'),
  pcRow('dev', '开发联调', 'sre 集合 + 功能开关', '功能开关与术语映射'),
  pcRow('merchant_partner', '商户主体方', '本店（subject_id）', '只看本店订单/结算/商品；可发起主体经营看板'),
  pcRow('scenic_partner', '景区主体方', '本景区（subject_id）', '只看本景区商品订单与结算投影'),

  { actor: 'mb-verify', side: '商户端', label: '核销员（岗位 role=1）', scope: '本店', canView: ['工作台', '我的'], canDo: ['扫码核销', '暗号核销', '核销记录'], note: '不出现订单/库存/结算入口（A-33 裁剪）' },
  { actor: 'mb-manager', side: '商户端', label: '店长（岗位 role=2）', scope: '本店', canView: ['工作台', '订单', '库存/团期', '我的'], canDo: ['核销员全部', '订单查看', '团期改价/名额/停售', '批量团期操作', '评价回复', '结算单查看'], note: '改价留痕入变更历史（X-03）' },
  { actor: 'mb-owner', side: '商户端', label: '老板（岗位 role=3）', scope: '本店', canView: ['店长全部', '店员管理'], canDo: ['店长全部', '店员角色设置'], note: '多门店老板可在授权门店间切换' },

  { actor: 'ma-tourist', side: '游客端', label: '游客', scope: '本人', canView: ['首页', '主题游', '商城', '笔记', '我的'], canDo: ['浏览/预订/支付', '评价', '发布笔记', '旅豆查询'], note: ' tabBar 五位（A-03 定稿）' },
  { actor: 'ma-promoter', side: '游客端', label: '推广服务商', scope: '本人', canView: ['游客全部', '推广中心'], canDo: ['推广码归因', '佣金查询', '提现申请'], note: '佣金按首触归因、T+7 结算' },
  { actor: 'ma-cooperator', side: '游客端', label: '合作主体经办', scope: '授权主体', canView: ['游客全部', '合作中心'], canDo: ['项目与分润查询', '对账反馈'], note: '' },
  { actor: 'ma-creator', side: '游客端', label: '创作者', scope: '本人', canView: ['游客全部', '创作中心'], canDo: ['笔记发布/草稿', '约稿投稿', '数据看板'], note: '笔记走机审+人工审核' },
]

/** 商户端岗位说明（/m/site.roleGuide 下发，mini-b「我的」角色说明卡高亮当前岗位） */
export const MERCHANT_ROLE_GUIDE = {
  1: '核销员：到店扫码/暗号核销、查看核销记录。订单、库存与结算不可见。',
  2: '店长：核销员全部 + 订单查看、团期改价/名额/停售、对账单查看、评价回复。',
  3: '老板：店长全部 + 店员角色管理、门店码、店员邀请码。',
}
