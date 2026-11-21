// 后台按钮与对应写接口共享角色规则；实体编辑权限仍以 entity-schema 为准。
// V94:动作级按员工三态授权(admin_user_action 允许/收回)叠加在角色基线上——
// subject.approve(主体资源审批)基线仅超管,由超管按员工单独授予或撤回,普通运营默认无权审批。
export const ADMIN_ACTIONS = {
  'order.refund': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  'order.service': { roles: ['super', 'ops'], label: '超级管理员或运营' },
  'note.review': { roles: ['super', 'review'], label: '超级管理员或审核员' },
  'review.moderate': { roles: ['super', 'review'], label: '超级管理员或审核员' },
  'task.status': { roles: ['super', 'ops'], label: '超级管理员或运营' },
  'task.delete': { roles: ['super', 'ops'], label: '超级管理员或运营' },
  'task.cashPaid': { roles: ['super', 'finance'], label: '超级管理员或财务' },
  'creator.manage': { roles: ['super', 'ops'], label: '超级管理员或运营' },
  'user.manage': { roles: ['super', 'ops', 'risk'], label: '超级管理员、运营或风控' },
  'product.status': { roles: ['super', 'ops'], label: '超级管理员或运营' },
  'merchant.approve': { roles: ['super', 'ops'], label: '超级管理员或运营' },
  // T01：共创分润资金出口。登记打款=财务/超管（运营只核对进度，不再延续旧 ops 打款权）；作废错单=超管
  'coProfit.pay': { roles: ['super', 'finance'], label: '超级管理员或财务' },
  'coProfit.void': { roles: ['super'], label: '仅超级管理员' },
  // T02：后台账号生命周期仅超管
  'account.manage': { roles: ['super'], label: '仅超级管理员' },
  // R-01：主体视角只读代看（默认仅超管）——进入/退出各记一条审计；带 viewAs 参数的写操作在网关层一律拒绝
  'partner.viewAs': { roles: ['super'], label: '仅超级管理员' },
  // T04：售后工单办理（认领/转派/办结/关闭/重开）=平台客服；城市账号可发起与补充材料
  'ticket.manage': { roles: ['super', 'ops'], label: '超级管理员或运营' },
  // T12：风险案件办理（研判/转态/复核/结案）=风控或超管；城市账号发起协查与补充材料
  'case.manage': { roles: ['super', 'risk'], label: '超级管理员或风控' },
  // T00：导出按报表类型定角色；城市账号一律不放导出（AC-06 导出不越界）
  'export.orders': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  // V82 主体方：按绑定主体过滤导出行（products 只含本店；settlements 景区口径投影行）
  'export.products': { roles: ['super', 'ops', 'finance', 'merchant_partner', 'scenic_partner'], label: '超管/运营/财务；商户·景区主体方（本主体范围）' },
  'export.merchants': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  'export.settlements': { roles: ['super', 'finance', 'merchant_partner', 'scenic_partner'], label: '超管/财务；商户·景区主体方（本主体范围）' },
  'export.scenics': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  'export.suppliers': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  'export.creators': { roles: ['super', 'ops', 'review'], label: '超级管理员、运营或审核员' },
  // D-07：用户台账 / 评价 / 存证事件导出——照 export.merchants 口径（超管/运营/财务；城市账号不放导出）
  'export.users': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  'export.reviews': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  'export.attest': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  // P-04：办理按钮与后端动作共用同一权限来源——只读观察者等角色不再看到可点击的办理入口
  'order.complete': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务（联调按钮，生产禁用）' },
  'settle.pay': { roles: ['super', 'finance'], label: '超级管理员或财务' },
  // P-03/P-04：手动任务干预（存证打包/补锚/日终封存/关单/佣金放行等全库动作）= 超管或运维；开发只读
  'system.jobRun': { roles: ['super', 'sre'], label: '超级管理员或运维' },
  // V94 主体资源审批:基线仅超管;运营由超管按员工单独授予(admin_user_action),撤回后旧会话即时复验
  'subject.approve': { roles: ['super'], label: '超级管理员;运营可由超管按员工单独授予' },
  // V94 主体申请预审(意见/提醒补材料,不改状态):超管与运营默认可办
  'subject.preaudit': { roles: ['super', 'ops'], label: '超级管理员或运营' },
}

export function actionRoles(action) {
  const rule = ADMIN_ACTIONS[action]
  if (!rule) throw new Error('未知后台操作权限：' + action)
  return rule.roles
}

// ---- V94 动作级按员工有效集合:基线角色映射 ∪ allow − deny(admin_user_action 三态) ----
// 30s 进程内缓存 + 授予/撤回即失效;服务端每次敏感写入调用——撤销授权后旧会话立即复验被拒。
import { q } from '../db.mjs'

const _actionCache = new Map() // uid -> { set, at }
const ACTION_TTL = 30 * 1000
export function invalidateActionCache(uid) {
  if (uid != null) _actionCache.delete(Number(uid))
  else _actionCache.clear()
}

export async function effectiveActionsFor(uid, role) {
  const base = new Set(Object.entries(ADMIN_ACTIONS).filter(([, r]) => r.roles.includes(role)).map(([k]) => k))
  if (uid == null) return base // 测试夹具令牌:按角色基线
  const key = Number(uid)
  const hit = _actionCache.get(key)
  if (hit && Date.now() - hit.at < ACTION_TTL) return hit.set
  const rows = await q('SELECT action, effect FROM admin_user_action WHERE uid = ?', [key])
  const set = new Set(base)
  for (const r of rows) {
    if (Number(r.effect) === 1) set.add(r.action)
    else set.delete(r.action)
  }
  _actionCache.set(key, { set, at: Date.now() })
  return set
}
