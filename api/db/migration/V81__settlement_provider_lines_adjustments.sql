-- 修复4（Codex退回#4）：多方结算可复算 + 已出账/已付款后调整路径
--
-- 资金归属规则 v2（与 V77 契约衔接，唯一主单原则不变）：
--   1) 提供方应付从订单项复算：order_item.cash_fen 按项归属店（merchant_id）计入各提供方结算；
--      跨店套餐不再整单计入主单商户（避免重复计入景区与商户汇总）。
--      无订单项的历史/简单订单全额归属主单商户（orders.merchant_id），行为与 V9 一致。
--   2) orders.merchant_id 仍是收银与对账主键（一笔支付流水、一个 order_no）；settlement_line 是
--      各提供方应付的复算维度：同一订单项只落一行结算行（order_item.settle_line_id 防重复分账）。
--   3) 补贴责任仍挂订单级 freedom_order（V77 契约第5条不变）；项级 subsidy_fen 只做对账维度，
--      不进各提供方应付。
--   4) 已出账（结算单 status 0/1/2）或已付款（status 3）后发生按项退款：已出账单快照不改写，
--      逐条写 settlement_adjustment（type=1，商户应付变动=−Σ被退项净额×该单快照履约占比）；
--      未冲抵调整在下一张补充单出账时并入 total 并标记 applied_settlement_id，同一笔不重复扣减。
--      确认成本变化走 type=2 调整（只影响利润复算，不改商户应付五口径）。
--   5) 五口径在每张结算单内部恒等（amt_fulfill+amt_service+amt_promoter+amt_beanbudget+amt_retained
--      = total_amount）；跨店单各提供方分别出五口径，Σ提供方结算行净额 = 订单商品现金净额。

-- 1) 结算行：每张结算单 × 每笔订单 × 每个提供方一行（可从订单项复算）
CREATE TABLE settlement_line (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  settlement_id BIGINT UNSIGNED NOT NULL COMMENT '所属结算单',
  order_id     BIGINT UNSIGNED NOT NULL,
  merchant_id  BIGINT UNSIGNED NOT NULL COMMENT '提供方（无订单项订单=主单商户）',
  cross_store  TINYINT NOT NULL DEFAULT 0 COMMENT '1=跨店项（提供方≠主单商户）',
  cash_fen     BIGINT NOT NULL DEFAULT 0 COMMENT '该店订单项现金分摊合计（无项订单=订单商品现金）',
  refund_fen   BIGINT NOT NULL DEFAULT 0 COMMENT '该店项已结算按项退款冲减合计（净额口径）',
  net_fen      BIGINT NOT NULL DEFAULT 0 COMMENT '净额=cash_fen−refund_fen（该提供方应付基数）',
  rule_version INT NOT NULL DEFAULT 2 COMMENT '资金归属规则版本（v2=按订单项归属）',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_settle_order_merchant (settlement_id, order_id, merchant_id),
  KEY idx_merchant (merchant_id),
  KEY idx_order (order_id)
) ENGINE=InnoDB COMMENT='结算行（修复4：各提供方应付从订单项复算）';

-- 2) 结算调整：已出账/已付款后的退款与成本变化留痕（只增不改）
CREATE TABLE settlement_adjustment (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  settlement_id BIGINT UNSIGNED NULL COMMENT '触发调整时订单所在结算单（未结算=NULL）',
  order_id      BIGINT UNSIGNED NOT NULL,
  merchant_id   BIGINT UNSIGNED NULL COMMENT '受影响提供方（type=1 必填；type=2 成本调整为订单级，可空）',
  type          TINYINT NOT NULL COMMENT '1=按项退款（商户应付变动） 2=确认成本变化（利润口径）',
  amount_fen    BIGINT NULL COMMENT '商户应付变动（负=应付减少；type=1 必填）',
  cost_fen      BIGINT NULL COMMENT '确认成本变动（type=2 填写，正=成本增加）',
  refund_no     VARCHAR(32) NULL,
  reason        VARCHAR(300) NOT NULL,
  operator      VARCHAR(64) NOT NULL,
  applied_settlement_id BIGINT UNSIGNED NULL COMMENT '并入的补充结算单（NULL=尚未冲抵）',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_refund_merchant (refund_no, merchant_id) COMMENT '同一退款单对同一提供方只登记一次调整（幂等）',
  KEY idx_merchant_pending (merchant_id, applied_settlement_id),
  KEY idx_order (order_id),
  KEY idx_settlement (settlement_id)
) ENGINE=InnoDB COMMENT='结算调整（修复4：已出账/已付款后退款与成本变化留痕）';

-- 3) 订单项结算行回填防重分账；部分退款项净额落表供提供方归属复算
ALTER TABLE order_item
  ADD COLUMN settle_line_id BIGINT UNSIGNED NULL COMMENT '所属结算行（NULL=未结算）',
  ADD KEY idx_item_settle (settle_line_id);

ALTER TABLE partial_refund
  ADD COLUMN item_nets JSON NULL COMMENT '各被退项实退净额数组（手续费按项现金占比分摊、尾差归最后正额项；与 item_ids 同序）';
