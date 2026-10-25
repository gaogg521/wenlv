-- V4：系统运维域（任务心跳）+ 资金出口（提现审批）
CREATE TABLE IF NOT EXISTS sys_job (
  name         VARCHAR(48) PRIMARY KEY,
  last_run_at  DATETIME(3) NULL,
  last_status  VARCHAR(16) NULL COMMENT 'ok/fail',
  last_message VARCHAR(256) NULL,
  run_count    BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB COMMENT='定时任务心跳（jobs.mjs 每轮更新，后台运维页读取）';

CREATE TABLE IF NOT EXISTS promoter_withdraw (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  promoter_id  BIGINT UNSIGNED NOT NULL,
  amount       BIGINT NOT NULL COMMENT '申请金额(分)，来自已结算佣金',
  status       SMALLINT NOT NULL DEFAULT 0 COMMENT '0待审 1已打款 2驳回',
  proposer_note VARCHAR(128) NULL,
  reviewed_by  VARCHAR(32) NULL,
  reviewed_at  DATETIME(3) NULL,
  pay_ref      VARCHAR(64) NULL COMMENT '打款流水（商家转账单号）',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_status (status, created_at)
) ENGINE=InnoDB COMMENT='推广服务费提现申请（资金出口：财务双人审批）';
