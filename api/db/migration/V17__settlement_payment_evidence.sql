-- RSA PEM 私钥通常超过 1 KB，旧 VARBINARY 容量无法保存真实凭据。
ALTER TABLE app_secret MODIFY COLUMN enc_value MEDIUMBLOB NOT NULL;
ALTER TABLE merchant ADD COLUMN applicant_user_id BIGINT UNSIGNED NULL;
ALTER TABLE settlement
  ADD COLUMN payment_ref VARCHAR(128) NULL,
  ADD COLUMN payment_note VARCHAR(500) NULL,
  ADD COLUMN paid_by VARCHAR(64) NULL,
  ADD COLUMN paid_at DATETIME(3) NULL,
  ADD UNIQUE KEY uk_settlement_payment_ref (payment_ref);
