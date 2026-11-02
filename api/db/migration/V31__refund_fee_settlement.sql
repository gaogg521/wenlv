-- V31 退改手续费计入商户结算
-- 分成比例不写死：参数中心 settlement.refund_fee_merchant_pct（0~1，默认 0 = 全部归平台），商户资料可单独覆盖
INSERT IGNORE INTO rule_config (k, v, group_name, `sensitive`, memo) VALUES
('settlement.refund_fee_merchant_pct', '0', 'settlement', 1, '退改手续费分给履约商户的比例（0~1）；商户资料「退改手续费分成」可单独覆盖');

-- 每笔手续费只计入一张结算单
ALTER TABLE refunds ADD COLUMN settlement_id BIGINT UNSIGNED NULL COMMENT '手续费计入的结算单' AFTER days_to_depart,
  ADD KEY idx_refund_settle (settlement_id);

-- 结算单增加手续费栏（独立于五口径恒等：五口径只拆订单实收，手续费另列并自成恒等）
ALTER TABLE settlement
  ADD COLUMN fee_count    INT    NOT NULL DEFAULT 0 COMMENT '计入的退改手续费笔数',
  ADD COLUMN fee_total    BIGINT NOT NULL DEFAULT 0 COMMENT '退改手续费合计（分）',
  ADD COLUMN fee_merchant BIGINT NOT NULL DEFAULT 0 COMMENT '其中分给商户（分）',
  ADD COLUMN fee_platform BIGINT NOT NULL DEFAULT 0 COMMENT '其中归平台（分）',
  ADD COLUMN fee_share_bp INT    NULL COMMENT '生成时采用的商户分成比例（万分比，快照）',
  ADD CONSTRAINT chk_fee_identity CHECK (fee_merchant + fee_platform = fee_total AND fee_merchant >= 0 AND fee_platform >= 0);
