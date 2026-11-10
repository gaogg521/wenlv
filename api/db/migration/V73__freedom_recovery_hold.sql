ALTER TABLE freedom_batch ADD COLUMN status TINYINT NOT NULL DEFAULT 1;
ALTER TABLE freedom_budget ADD COLUMN recovering BIGINT NOT NULL DEFAULT 0 COMMENT '已退款但补贴尚未追回，新增发放和使用继续核对此现金占用';
