-- B04 结算单元：确认成本回填 + 部分退款冲减进结算 + 平台资金桥表
-- 契约：确认成本在订单进入结算时点回填（=下单快照 cost_total_fen，B01 口径）；
--   部分退款只可能发生在结算前（订单 20/30），结算 total 按"实付−已结算部分退款"扣减，
--   状态机保证不存在"已结算后再部分退"（50 不可部分退）→ 无需事后调整机制；
--   全退订单（70）不进结算（现状保留）。资金桥表逐项可复算、同一项不重复扣减。

ALTER TABLE settlement
  ADD COLUMN cost_total BIGINT NULL COMMENT '确认成本合计（分）=Σ订单 cost_total_fen；未维护成本订单按0计但不影响五口径恒等',
  ADD COLUMN partial_deduct BIGINT NOT NULL DEFAULT 0 COMMENT '生成时扣减的部分退款合计（分，对账用）',
  ADD COLUMN bridge_snapshot JSON NULL COMMENT '生成时点该单资金桥快照（收入→成本→口径说明）';

-- 平台资金桥表期间快照（只增不改；生成即冻结，改参数不出新行不改旧行）
CREATE TABLE econ_bridge (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  period_from  DATE         NOT NULL,
  period_to    DATE         NOT NULL,
  rows_snapshot JSON        NOT NULL COMMENT '桥表行：{label,fen,caliber,note}[]',
  income_fen   BIGINT       NOT NULL,
  cost_fen     BIGINT       NULL,
  commission_fen BIGINT     NOT NULL DEFAULT 0,
  operating_fen BIGINT      NULL,
  balance_ok   TINYINT      NOT NULL DEFAULT 1 COMMENT '桥表内部恒等校验（1平 0不平）',
  operator     VARCHAR(64)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_period (period_from, period_to)
) ENGINE=InnoDB COMMENT='平台资金桥表快照（B04 可复算）';
