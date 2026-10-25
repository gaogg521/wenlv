-- V6：MFA 安全域（TOTP/短信/邮箱）
ALTER TABLE admin_user
  ADD COLUMN mfa_secret VARCHAR(64) NULL COMMENT 'TOTP 密钥(base32)，NULL=未启用',
  ADD COLUMN mfa_channel VARCHAR(16) NOT NULL DEFAULT 'totp' COMMENT 'totp/sms/email',
  ADD COLUMN mobile VARCHAR(32) NULL,
  ADD COLUMN email VARCHAR(128) NULL,
  ADD COLUMN mfa_enabled TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS mfa_code (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target     VARCHAR(128) NOT NULL COMMENT '手机号/邮箱',
  channel    VARCHAR(16) NOT NULL COMMENT 'sms/email',
  code       VARCHAR(8)  NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at    DATETIME(3) NULL,
  purpose    VARCHAR(24) NOT NULL DEFAULT 'login',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_target (target, channel, created_at)
) ENGINE=InnoDB COMMENT='验证码（MOCK 通道后台可见；60s 限频/每日上限/用后即焚）';
