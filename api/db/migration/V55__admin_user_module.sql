-- V55（C-05）：账号级模块授权三态。
-- 有效模块集合 = super ? 全部 : (角色默认 ∪ 账号 allow) − 账号 deny。
-- 城市合伙人在 requireModule 侧叠加 CITY_DENY_MODULES（不可授予名单，代码强制）；
-- 资金动作、双人复核、城市行级隔离等细粒度约束继续生效，模块授权不能绕过（台账 D-05）。
CREATE TABLE IF NOT EXISTS admin_user_module (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL COMMENT 'admin_user.id',
  module_key VARCHAR(32)  NOT NULL,
  effect     ENUM('allow','deny') NOT NULL COMMENT 'allow=额外授予 deny=额外收回（相对角色默认）',
  reason     VARCHAR(200) NULL COMMENT '授权/收回原因（4-200 字，进审计）',
  granted_by VARCHAR(64)  NOT NULL,
  granted_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_user_module (user_id, module_key),
  KEY idx_user (user_id)
) ENGINE=InnoDB COMMENT='账号级模块授权三态（C-05）';
