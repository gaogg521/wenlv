-- V32 结算五口径比例参数化（此前 58% / 12% / 5% 写死在 promo.generateSettlement）
-- 推广服务费 = 实际佣金，留存毛利 = 差额兜底，不设参数。生成时把比例快照进结算单，事后改参数不影响已出账单
INSERT IGNORE INTO rule_config (k, v, group_name, `sensitive`, memo) VALUES
('settlement.split_fulfill',    '0.58', 'settlement', 1, '结算五口径：履约结算占订单实收比例'),
('settlement.split_service',    '0.12', 'settlement', 1, '结算五口径：平台服务费占比'),
('settlement.split_beanbudget', '0.05', 'settlement', 1, '结算五口径：权益（旅豆）预算占比');
ALTER TABLE settlement ADD COLUMN split_snapshot JSON NULL COMMENT '生成时采用的五口径比例 {fulfill,service,beanbudget}（万分比）';
