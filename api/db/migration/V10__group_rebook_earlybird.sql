-- V10: 拼团未成团自动取消 + 免费改签 + 早鸟价（总方案 §4 业务规则定稿 / §9 P1）
-- 团期级早鸟价：出发前 early_days 天内报名可享 early_price；NULL = 未开启
ALTER TABLE tour_session
  ADD COLUMN early_price BIGINT NULL COMMENT '早鸟价（分），NULL=未开启',
  ADD COLUMN early_days  INT    NULL COMMENT '早鸟截止：出发前 N 天（含当天之前）';

-- 改签：新订单指向来源订单；close_reason 记录终态原因（group_cancel=未成团自动取消）
ALTER TABLE orders
  ADD COLUMN rebook_of    VARCHAR(32) NULL COMMENT '改签来源订单号（新单持有）',
  ADD COLUMN close_reason VARCHAR(32) NULL COMMENT '终态原因：group_cancel / pay_timeout / user_refund';

-- 团期状态注释补 5=已取消（未成团），TINYINT 无枚举约束，仅注释口径
ALTER TABLE tour_session COMMENT '团期：status 1报名中 2已成团 3停售 4已发团 5已取消(未成团)';
