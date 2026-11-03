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
  // T00：导出按报表类型定角色；城市账号一律不放导出（AC-06 导出不越界）
  'export.orders': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  'export.products': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  'export.merchants': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  'export.settlements': { roles: ['super', 'finance'], label: '超级管理员或财务' },
  'export.scenics': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  'export.suppliers': { roles: ['super', 'ops', 'finance'], label: '超级管理员、运营或财务' },
  'export.creators': { roles: ['super', 'ops', 'review'], label: '超级管理员、运营或审核员' },
}

export function actionRoles(action) {
  const rule = ADMIN_ACTIONS[action]
  if (!rule) throw new Error('未知后台操作权限：' + action)
  return rule.roles
}
