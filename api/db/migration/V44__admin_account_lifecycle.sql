-- V44: 后台账号与城市授权生命周期（GLM 交接 T02 / 批次 B）
-- 1) token_epoch：登录令牌版本号。停用 / 改角色 / 改城市 / 重置密码时 +1，
--    已登录会话在下一个请求即被拒绝（requireAdmin 校验 ver 与库内一致），不能只禁止下次登录。
-- 2) must_change_pwd：超管重置密码后置 1，本人用临时密码登录后必须先改密。
-- 3) note：所属责任人 / 备注。
ALTER TABLE admin_user
  ADD COLUMN token_epoch INT NOT NULL DEFAULT 1 COMMENT '登录令牌版本：停用/改权限/改城市/重置密码时+1，旧会话立即失效',
  ADD COLUMN must_change_pwd TINYINT NOT NULL DEFAULT 0 COMMENT '1=重置后的临时密码，本人登录后必须先改密',
  ADD COLUMN note VARCHAR(255) NULL COMMENT '所属责任人 / 备注';
