-- V26 退改梯度落地：退款单记录手续费与命中档位（amount 仍为实际退回金额）
ALTER TABLE refunds
  ADD COLUMN fee_amount    BIGINT        NOT NULL DEFAULT 0 COMMENT '退改手续费（分），从现金实付中扣除' AFTER amount,
  ADD COLUMN fee_rate      DECIMAL(5,4)  NULL COMMENT '命中的手续费比例；NULL=全额退款（未成团/客服处理）' AFTER fee_amount,
  ADD COLUMN days_to_depart INT          NULL COMMENT '申请时距出发天数（业务时区日历日）' AFTER fee_rate;
