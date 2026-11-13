// 后台按钮与对应写接口共享角色规则；实体编辑权限仍以 entity-schema 为准。
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
  // P-04：办理按钮与后端动作共用同一权限来源——只读观察者等角色不再看到可点击的办理入口
  'order.complete': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务（联调按钮，生产禁用）' },
  'settle.pay': { roles: ['super', 'finance'], label: '超级管理员或财务' },
  // P-03/P-04：手动任务干预（存证打包/补锚/日终封存/关单/佣金放行等全库动作）= 超管或运维；开发只读
  'system.jobRun': { roles: ['super', 'sre'], label: '超级管理员或运维' },
}

export function actionRoles(action) {
  const rule = ADMIN_ACTIONS[action]
  if (!rule) throw new Error('未知后台操作权限：' + action)
  return rule.roles
}
