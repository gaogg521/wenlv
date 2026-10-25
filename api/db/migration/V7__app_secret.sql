-- V7：集成凭据后台化（.env 仅保留自举：DB/JWT_SECRET/ADMIN_INIT_PASSWORD）
CREATE TABLE IF NOT EXISTS app_secret (
  k          VARCHAR(64) PRIMARY KEY,
  enc_value  VARBINARY(1024) NOT NULL COMMENT 'AES-256-GCM 密文(iv+tag+ct)',
  hint       VARCHAR(64)     NOT NULL COMMENT '脱敏提示（末4位）',
  updated_by VARCHAR(32)     NULL,
  updated_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB COMMENT='第三方集成凭据（后台集成中心读写，加密存储）';
