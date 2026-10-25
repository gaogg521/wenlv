-- V11: 离线核销冲突人工队列（总方案 §10：恢复上传二次校验，冲突进人工队列）
CREATE TABLE verify_offline_conflict (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id BIGINT UNSIGNED NOT NULL,
  pass_id     BIGINT UNSIGNED NULL,
  payload     VARCHAR(128) NOT NULL,
  offline_at  DATETIME(3) NOT NULL COMMENT '离线核销发生时间（商户端时钟）',
  reason      VARCHAR(128) NOT NULL,
  status      TINYINT NOT NULL DEFAULT 0 COMMENT '0待人工 1已确认核销 2已驳回',
  resolved_by BIGINT UNSIGNED NULL,
  resolved_at DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_status (status)
) ENGINE=InnoDB COMMENT='离线核销冲突人工队列';
