-- V95: 景区自营经营主体绑定(归属判定依据,经超管确认后写入)
-- 方案§2:景区自营商品必须用经过超管确认的经营主体绑定判定;
-- 现有模型无独立绑定表,首版不开放景区商品写入,本字段预埋归属判定依据(后续批次放开)。
ALTER TABLE scenic_spot
  ADD COLUMN selfrun_merchant_id BIGINT UNSIGNED NULL COMMENT '经超管确认的自营经营主体(merchant.id);NULL=无明确自营归属' AFTER ticket_interface;
