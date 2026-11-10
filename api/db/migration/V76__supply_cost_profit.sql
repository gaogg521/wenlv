-- 第三批：供给项台账（B01）+ 产品挂成本 + 订单成本快照 —— 成本/售价/毛利/毛利率/经营收益同源口径
-- 口径（台账已定稿）：
--   商品经营毛利 = 同口径商品净销售额 − 对应直接采购/履约成本；毛利率 = 毛利 ÷ 商品净销售额 × 100%
--   商品净销售额采用实际成交/退款冲减口径；保费及代收款不算销售收入
--   成本缺失显示"未维护/不可计算"，不得默认 0；真实零成本须有明确依据（note 必填）
--   预计成本只能算"预计毛利"；确认成本/应付/实付随 B04 结算单元启用，本单元保持 NULL=未确认

-- 1) 供给项台账：采购/履约成本单价、参考零售价、计价单位、生效期/协议版本、提供方、状态、依据
CREATE TABLE supply_item (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(80)  NOT NULL COMMENT '供给项名称',
  kind           TINYINT      NOT NULL DEFAULT 1 COMMENT '1采购 2履约 3赠送（赠送项同样有成本）',
  unit           VARCHAR(16)  NOT NULL DEFAULT 'per_person' COMMENT '计价单位：per_person每人/per_order每单/room_night房晚',
  unit_cost_fen  BIGINT       NOT NULL COMMENT '成本单价（分；0=真实零成本，必须填依据）',
  ref_retail_fen BIGINT       NULL COMMENT '参考零售价（分，可空；参考值不能冒充实际售价）',
  provider_type  VARCHAR(16)  NULL COMMENT '提供方类型：scenic/supplier/merchant/platform',
  provider_id    BIGINT UNSIGNED NULL COMMENT '提供方ID',
  provider_name  VARCHAR(80)  NULL COMMENT '提供方名称快照',
  valid_from     DATE         NULL COMMENT '生效期起（空=不限）',
  valid_to       DATE         NULL COMMENT '生效期止（空=不限）',
  agreement      VARCHAR(120) NULL COMMENT '协议版本/编号',
  note           VARCHAR(300) NULL COMMENT '成本依据与调整说明',
  status         TINYINT      NOT NULL DEFAULT 1 COMMENT '1生效 0停用',
  version        INT          NOT NULL DEFAULT 1,
  operator       VARCHAR(64)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_status (status)
) ENGINE=InnoDB COMMENT='供给项台账（B01 成本来源）';

-- 2) 产品挂供给项：数量（每份产品消耗该供给项的数量）
CREATE TABLE product_supply (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  item_id    BIGINT UNSIGNED NOT NULL,
  qty        INT          NOT NULL DEFAULT 1 COMMENT '每份产品消耗数量（≥1）',
  sort       INT          NOT NULL DEFAULT 0,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_prod_item (product_id, item_id),
  KEY idx_item (item_id)
) ENGINE=InnoDB COMMENT='产品×供给项挂载（成本构成）';

-- 3) 订单成本快照：下单时按当时生效的供给项配置留痕；新改成本不覆盖已售历史
ALTER TABLE orders
  ADD COLUMN cost_snapshot JSON NULL COMMENT '下单成本快照（B01）：供给项明细+单价×数量+合计；NULL=商品未维护成本',
  ADD COLUMN cost_total_fen BIGINT NULL COMMENT '成本合计（分，冗余便于汇总）；NULL=未维护不可计算',
  ADD COLUMN cost_confirmed_fen BIGINT NULL COMMENT '已确认成本（分，B04结算回填；未接入前保持NULL=未确认）';
