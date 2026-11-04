-- V53（C-03）：单账号 MFA 豁免 / 单账号强制。
-- 登录判定优先级：mfa_force=1 → 强制（未绑定则进入绑定引导）；否则 mfa_exempt=1 → 不要求；
-- 否则按全局策略 admin.mfa.mode（off/optional/required）。
-- 两项同时设置时 force 优先（页面明示），不互斥以免存量数据语义漂移。
-- 修改两项均走 POST /admin/accounts/:id/mfa-flags（仅超管、写审计、token_epoch+1 使旧会话失效）。
ALTER TABLE admin_user
  ADD COLUMN mfa_exempt TINYINT NOT NULL DEFAULT 0 COMMENT 'MFA豁免：全局强制策略下仍不要求该账号两步验证' AFTER mfa_enabled,
  ADD COLUMN mfa_force  TINYINT NOT NULL DEFAULT 0 COMMENT 'MFA单账号强制：全局关闭策略下仍要求该账号两步验证（优先于豁免）' AFTER mfa_exempt;
