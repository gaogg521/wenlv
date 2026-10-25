-- V9: 结算与订单挂钩（防重复分账）——同一订单只能进一张结算单
ALTER TABLE orders
  ADD COLUMN settlement_id BIGINT UNSIGNED NULL COMMENT '所属结算单（NULL=未结算）',
  ADD KEY idx_settlement (settlement_id);
