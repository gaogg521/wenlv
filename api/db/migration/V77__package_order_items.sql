-- 第三批-2b：B02 套餐及订单项快照 / B03 逐项核销 / B04 多提供方分摊与部分退款 / B17 套餐优惠分摊
--
-- B04 资金契约 v1（可复算，唯一主单原则）：
--   1) 唯一主单：套餐订单仍是一张 orders 主单（一个 order_no / 一笔 amount_pay / 一条支付流水）；
--      order_items 是履约与对账维度，不产生第二笔支付，商户子单只读各自范围。
--   2) 现金/补贴/旅豆三路同口径占比分摊：item_share_i = floor(路金额 × 项原价 ÷ G)，尾差归最后一个正额项；
--      保费单列订单级不分摊（直付保险方，与佣金/返豆口径一致）。
--   3) 成本不占比：项成本 = 该项挂的供给项成本快照（unit_cost×map_qty×qty）之和；订单级 cost_total 仍为全单合计，
--      两者恒等可对账（Σitem.cost + 未挂项剩余 = cost_total）。
--   4) 部分退款：仅退"未核销项"的现金分摊 − 按退款政策比例手续费；旅豆/券不冲回（全退才走既有冲回）；
--      部分退款不改变券责任与五口径已出结算单，冲减进 partial_refunds 供结算补充单复算。
--   5) 不得在五口径外无来源追加成本，或将原价完整分账后再额外付补贴——补贴责任始终挂 freedom_order（订单级），项级只做对账维度。
--   6) 部分完成不提前发全部奖励：返豆/佣金仍在订单级 OBSERVE_END 后发放，与现状一致。

-- 1) 套餐项模板（产品=套餐时的组成项；product_supply 仍挂整品成本，项可另挂 supply_item 精算）
CREATE TABLE package_item (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id     BIGINT UNSIGNED NOT NULL,
  name           VARCHAR(80)  NOT NULL COMMENT '项名称（建单快照到 order_item）',
  kind           TINYINT      NOT NULL DEFAULT 1 COMMENT '1按人凭证 2服务项（区分履约方式）',
  merchant_id    BIGINT UNSIGNED NOT NULL COMMENT '提供方门店（跨店隔离：核销校验归属）',
  supply_item_id BIGINT UNSIGNED NULL COMMENT '成本来源供给项（可空；空则该项不计项级成本）',
  unit_price_fen BIGINT       NOT NULL COMMENT '项单价（分）',
  qty_per_unit   INT          NOT NULL DEFAULT 1 COMMENT '每份产品包含数量',
  pass_qty       INT          NULL COMMENT '按人凭证项每份数量（默认=qty_per_unit；服务项无凭证）',
  sort           INT          NOT NULL DEFAULT 0,
  status         TINYINT      NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  version        INT          NOT NULL DEFAULT 1,
  operator       VARCHAR(64)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_product (product_id, status)
) ENGINE=InnoDB COMMENT='套餐项模板（B02 组合配置）';

-- 2) 订单项：下单快照（名称/单价/数量/归属店）+ 三路分摊 + 项成本 + 履约状态
CREATE TABLE order_item (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id       BIGINT UNSIGNED NOT NULL,
  template_id    BIGINT UNSIGNED NULL COMMENT '来源 package_item（历史不随模板改写）',
  product_id     BIGINT UNSIGNED NOT NULL,
  merchant_id    BIGINT UNSIGNED NOT NULL,
  name           VARCHAR(80)  NOT NULL,
  kind           TINYINT      NOT NULL DEFAULT 1,
  unit_price_fen BIGINT       NOT NULL,
  qty            INT          NOT NULL,
  goods_fen      BIGINT       NOT NULL COMMENT '项原价额=unit_price×qty',
  cash_fen       BIGINT       NOT NULL DEFAULT 0 COMMENT '现金实付分摊',
  subsidy_fen    BIGINT       NOT NULL DEFAULT 0 COMMENT '自由豆补贴分摊（对账维度，责任仍在订单级）',
  bean_fen       BIGINT       NOT NULL DEFAULT 0 COMMENT '旅豆抵扣分摊（对账维度）',
  cost_fen       BIGINT       NULL COMMENT '项成本快照（未挂供给项=NULL）',
  supply_item_id BIGINT UNSIGNED NULL,
  supply_version INT            NULL,
  status         TINYINT      NOT NULL DEFAULT 0 COMMENT '0待履约 1已完成 2已退（部分退款） 3赠送',
  pass_total     INT          NOT NULL DEFAULT 0 COMMENT '应出凭证数（按人凭证项）',
  pass_done      INT          NOT NULL DEFAULT 0 COMMENT '已核销凭证数',
  service_done   TINYINT      NOT NULL DEFAULT 0 COMMENT '服务项履约完成标记',
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_order (order_id),
  KEY idx_merchant (merchant_id, status)
) ENGINE=InnoDB COMMENT='订单项（B02快照/B03履约/B04分摊）';

-- 3) 部分退款单（B04）：按项退款，现金口径，手续费按订单退款政策比例
CREATE TABLE partial_refund (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id     BIGINT UNSIGNED NOT NULL,
  refund_no    VARCHAR(32)  NOT NULL,
  item_ids     JSON         NOT NULL COMMENT '被退订单项ID数组',
  cash_fen     BIGINT       NOT NULL COMMENT '实退现金（分摊合计−手续费）',
  fee_fen      BIGINT       NOT NULL DEFAULT 0,
  fee_rate     DECIMAL(6,4) NULL,
  reason       VARCHAR(300) NOT NULL,
  operator     VARCHAR(64)  NOT NULL,
  status       TINYINT      NOT NULL DEFAULT 0 COMMENT '0处理中 2已退款（沿用 refunds 语义）',
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  settled_at   DATETIME(3)  NULL,
  UNIQUE KEY uk_refund_no (refund_no),
  KEY idx_order (order_id)
) ENGINE=InnoDB COMMENT='部分退款单（B04 可复算冲减）';

-- 4) 服务项履约核销（B03）：幂等键防重放；与按人凭证（travel_pass）区分
CREATE TABLE order_item_redeem (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id    BIGINT UNSIGNED NOT NULL,
  idem_key   VARCHAR(64)  NOT NULL COMMENT '幂等键（商户端生成，重复提交返回同一结果）',
  operator   VARCHAR(64)  NOT NULL,
  note       VARCHAR(200) NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_item_idem (item_id, idem_key),
  KEY idx_item (item_id)
) ENGINE=InnoDB COMMENT='服务项履约记录（B03 逐项核销）';

-- 5) 凭证挂项（B03 按人凭证项：pass.order_item_id 指向订单项）
ALTER TABLE travel_pass ADD COLUMN order_item_id BIGINT UNSIGNED NULL COMMENT '所属订单项（套餐分项凭证）',
  ADD KEY idx_pass_item (order_item_id);
