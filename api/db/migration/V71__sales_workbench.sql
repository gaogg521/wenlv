CREATE TABLE promoter_product (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 promoter_id BIGINT UNSIGNED NOT NULL,
 product_id BIGINT UNSIGNED NOT NULL,
 status TINYINT NOT NULL DEFAULT 1,
 rate_bp INT NULL,
 valid_from DATETIME NOT NULL,
 valid_to DATETIME NOT NULL,
 agreement VARCHAR(120) NOT NULL,
 reason VARCHAR(300) NOT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_person_product(promoter_id,product_id),
 CHECK (rate_bp IS NULL OR (rate_bp>=0 AND rate_bp<=1200))
) ENGINE=InnoDB;
ALTER TABLE attribution ADD COLUMN product_id BIGINT UNSIGNED NULL;
ALTER TABLE orders ADD COLUMN promo_snapshot JSON NULL;
ALTER TABLE promoter_withdraw
 ADD COLUMN review_note VARCHAR(300) NULL,
 ADD COLUMN paid_at DATETIME(3) NULL,
 ADD COLUMN paid_by VARCHAR(64) NULL,
 ADD COLUMN receipt_url VARCHAR(512) NULL;
-- 0待审/1历史已登记付款/2驳回保持不变；新增3审批通过待付款。
CREATE TABLE promoter_pay_ref (
 pay_ref VARCHAR(64) PRIMARY KEY,
 withdraw_id BIGINT UNSIGNED NOT NULL UNIQUE
) ENGINE=InnoDB;
-- 旧重复流水不伪造、不覆盖；保留首笔占用并禁止未来重复使用。
INSERT INTO promoter_pay_ref(pay_ref,withdraw_id)
 SELECT pay_ref,MIN(id) FROM promoter_withdraw WHERE status=1 AND pay_ref IS NOT NULL AND pay_ref<>'' GROUP BY pay_ref;
CREATE TABLE cooperation_feedback (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 subject_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 co_profit_id BIGINT UNSIGNED NOT NULL,
 detail VARCHAR(500) NOT NULL,
 status TINYINT NOT NULL DEFAULT 0,
 reply VARCHAR(500) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
