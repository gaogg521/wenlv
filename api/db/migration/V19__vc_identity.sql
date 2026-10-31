-- V19__vc_identity.sql
-- 数字身份（VC-JWT）：用户在平台内的旅行身份，可携出、他方可验、最小披露
-- 设计约束：
--   1. 凭证里不放姓名 / 手机号 / 身份证号 / 订单号 / 金额（最小披露，泄露面为零）
--   2. 平台是 issuer，用 Ed25519 私钥签名；公钥经 /open/vc/issuer 公开发布，第三方可离线验签
--   3. 有效期短（默认 30 天）+ 可吊销，替代"吊销列表"这种重资产做法
CREATE TABLE IF NOT EXISTS vc_issue (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  did           VARCHAR(80)  NOT NULL,
  scope         VARCHAR(24)  NOT NULL DEFAULT 'basic',
  jti           CHAR(24)     NOT NULL,              -- 凭证唯一 id（可吊销的最小单元）
  jwt_hash      CHAR(64)     NOT NULL,
  claims        JSON         NOT NULL,
  issued_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    DATETIME(3)  NOT NULL,
  revoked_at    DATETIME(3)  NULL,
  revoke_reason VARCHAR(120) NULL,
  UNIQUE KEY uk_jti (jti),
  UNIQUE KEY uk_jwt (jwt_hash),
  KEY idx_user (user_id, issued_at)
) ENGINE=InnoDB COMMENT='数字身份凭证签发记录（VC-JWT，Ed25519）';

-- did_ref 此前只是占位字段，现在真正启用：加索引便于按 DID 反查（合作方来核对时用）
ALTER TABLE user_account ADD KEY idx_did (did_ref);
