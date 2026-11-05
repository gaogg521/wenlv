-- V60（QA-04）：角色默认矩阵的"已配置"标记。
-- 问题：admin_role_module 无行时无法区分"从未配置（用基线默认）"与"已配置但全部撤空"——
-- 超管把角色模块逐个关闭后，空集合被静态基线回退顶掉，权限悄悄恢复。
-- 方案：admin_role_config 记录"该角色已被显式配置过"——存在行即以矩阵表为准（可为空集合），
-- 不存在行才回退代码内基线快照。POST /admin/role-modules 首次变更即写入标记。
CREATE TABLE IF NOT EXISTS admin_role_config (
  role        VARCHAR(32) NOT NULL PRIMARY KEY COMMENT '角色（已显式配置过默认矩阵）',
  updated_by  VARCHAR(64) NOT NULL,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB COMMENT='角色默认矩阵配置标记（QA-04：空集合必须保持空）';
