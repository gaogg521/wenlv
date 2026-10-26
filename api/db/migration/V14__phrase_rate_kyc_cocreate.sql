-- V14: 旧后台评估吸收四项 —— 暗号玩法层 / 逐品佣金覆盖 / KYC 实名审核 / 共创投资分润
-- 1) 暗号玩法（剧本游"入戏"核销）：每产品一对暗号，用户暗号给游客、商家暗号给核销员比对
ALTER TABLE tour_product
  ADD COLUMN phrase_user    VARCHAR(64) NULL COMMENT '用户暗号（游客在剧情点位说出）',
  ADD COLUMN phrase_merchant VARCHAR(64) NULL COMMENT '商家暗号（核销员对答）',
  ADD COLUMN promo_rate_bp  INT NULL COMMENT '逐品佣金覆盖（bp，≤1200），NULL=走推广商档位';

-- 2) KYC 实名认证：游客提交 → 后台人工审核（AES 加密落库同 contact_phone_enc 口径）
CREATE TABLE kyc_application (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  real_name    VARCHAR(64)  NOT NULL,
  id_no_enc    VARBINARY(512) NOT NULL,
  id_no_mask   VARCHAR(24)  NOT NULL COMMENT '脱敏展示（前3后4）',
  status       TINYINT      NOT NULL DEFAULT 0 COMMENT '0待审 1通过 2驳回',
  reject_note  VARCHAR(128) NULL,
  reviewed_by  BIGINT UNSIGNED NULL,
  reviewed_at  DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_user (user_id),
  KEY idx_status (status)
) ENGINE=InnoDB COMMENT='KYC 实名认证';

-- 3) 共创投资分润：资金商/商品商按产品登记，结算期按 pct 从留存毛利切分入账
CREATE TABLE co_creator (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id    BIGINT UNSIGNED NOT NULL,
  co_no         VARCHAR(24) NOT NULL COMMENT '共创编号 C+日期+序号',
  name          VARCHAR(64) NOT NULL,
  mobile        VARCHAR(20) NOT NULL,
  role          TINYINT     NOT NULL COMMENT '1资金商 2商品商',
  invest_amount BIGINT      NOT NULL DEFAULT 0 COMMENT '投资金额（分）',
  share_pct     INT         NOT NULL DEFAULT 0 COMMENT '分润比例（万分比 bp，从留存毛利切）',
  status        TINYINT     NOT NULL DEFAULT 1 COMMENT '1生效 0停用',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_prod (product_id, status)
) ENGINE=InnoDB COMMENT='共创人（产品投资分润）';

CREATE TABLE co_profit (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  settlement_id BIGINT UNSIGNED NOT NULL,
  co_creator_id BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  period        VARCHAR(16) NOT NULL,
  base_amount   BIGINT NOT NULL COMMENT '分润基数（留存毛利内该产品占比额）',
  amount        BIGINT NOT NULL COMMENT '实际分润额（分）',
  status        TINYINT NOT NULL DEFAULT 0 COMMENT '0待打款 1已打款',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_settle_co (settlement_id, co_creator_id),
  KEY idx_period (period)
) ENGINE=InnoDB COMMENT='共创分润台账';
