-- V39：账号冻结期间不发订单返豆，标记为"待补发"；解冻时由 bean.releaseDeferredRebates 补发（照常累计、不丢失）
ALTER TABLE orders ADD COLUMN bean_rebate_deferred TINYINT NOT NULL DEFAULT 0 COMMENT '1=完成时账号冻结、返豆待补发；补发后置 0';
