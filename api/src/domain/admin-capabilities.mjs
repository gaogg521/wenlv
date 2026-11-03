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
}

export function actionRoles(action) {
  const rule = ADMIN_ACTIONS[action]
  if (!rule) throw new Error('未知后台操作权限：' + action)
  return rule.roles
}
