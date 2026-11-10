-- D01 商品促销折扣：规则表 + 订单价格快照列
-- 折扣是商品促销降价（付款比例），自由豆是官方补贴券，两套配置与记录互不混用。
-- discount_bp 为"付款比例"（bp）：8000 = 按原价 80% 付款 = 8折；界面按"折"填写（1–10，最多两位小数）。
CREATE TABLE promo_discount (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(80)  NOT NULL COMMENT '活动名称',
  discount_bp  INT          NOT NULL COMMENT '付款比例bp：8000=按原价80%付款（8折）；>0 且 <=10000',
  stack_early  TINYINT      NOT NULL DEFAULT 0 COMMENT '0=与早鸟不叠加（默认，取较低价） 1=开启先早鸟价再乘折扣',
  from_time    DATETIME     NOT NULL COMMENT '生效时间',
  to_time      DATETIME     NOT NULL COMMENT '失效时间',
  products     JSON         NULL COMMENT '适用产品ID，空=全部',
  cities       JSON         NULL COMMENT '适用城市代码，空=全部',
  channels     JSON         NULL COMMENT '适用渠道，空=全部',
  dates        JSON         NULL COMMENT '适用团期出发日，空=全部',
  version      INT          NOT NULL DEFAULT 1 COMMENT '规则版本（建单写入快照）',
  status       TINYINT      NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  operator     VARCHAR(64)  NULL COMMENT '最后操作人',
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_status_window (status, from_time, to_time)
) ENGINE=InnoDB COMMENT='商品促销折扣规则';

-- 订单价格快照：原价/早鸟/折扣规则版本与折数/自由豆/旅豆/保费/现金应付及推导过程，
-- 不能只存当前活动ID再动态反查历史价格（旧单不改，新配置不改已售快照）。
ALTER TABLE orders ADD COLUMN price_snapshot JSON NULL COMMENT '下单价格快照（D01）：原价、早鸟、折扣、自由豆、旅豆、保费、实付推导';
