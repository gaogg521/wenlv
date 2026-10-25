-- V3：运营后台账号体系（RBAC）——api 服务启动时若表空则自动种入超管（密码走环境变量）
CREATE TABLE IF NOT EXISTS admin_user (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(32)  NOT NULL,
  password_hash VARCHAR(128) NOT NULL COMMENT 'scrypt: salt$hash(hex)',
  role          VARCHAR(16)  NOT NULL DEFAULT 'ops' COMMENT 'super/ops/finance/review/risk/city_partner/readonly',
  display_name  VARCHAR(32)  NULL,
  status        TINYINT      NOT NULL DEFAULT 1,
  last_login_at DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB COMMENT='后台账号（生产启用 TOTP：加列 totp_secret 并在登录二次校验）';
