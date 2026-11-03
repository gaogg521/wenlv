-- V43: 共创分润打款闭环（GLM 交接 T01 / P0）
-- 旧 POST /admin/co-profits/:id/pay 仅把 status 改成 1，没有回单、唯一流水、冻结检查和审批；
-- 本迁移只增不改：co_profit 增加打款轨迹列，新增打款流水表 co_profit_pay（每笔真实打款一行，流水号全局唯一）。
-- 状态语义扩展：0 待打款（含部分已付）→ 1 已结清（paid_amount ≥ amount）→ 2 已作废（未付前整单作废）；
-- 已结清后金额登记错误走「冲正」（direction=2 流水），历史实付不改写。

ALTER TABLE co_profit
  ADD COLUMN paid_amount BIGINT NOT NULL DEFAULT 0 COMMENT '累计有效打款额（分，部分打款累计；冲正扣减）',
  ADD COLUMN pay_channel VARCHAR(32) NULL COMMENT '最近一次打款渠道',
  ADD COLUMN pay_ref VARCHAR(64) NULL COMMENT '最近一次打款流水号',
  ADD COLUMN paid_at DATETIME(3) NULL COMMENT '结清时间',
  ADD COLUMN paid_by VARCHAR(64) NULL COMMENT '结清登记人（admin:显示名）',
  ADD COLUMN pay_note VARCHAR(255) NULL COMMENT '打款备注';

CREATE TABLE co_profit_pay (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  co_profit_id   BIGINT UNSIGNED NOT NULL,
  direction      TINYINT      NOT NULL DEFAULT 1 COMMENT '1=打款 2=冲正',
  pay_ref        VARCHAR(64)  NOT NULL COMMENT '真实支付流水号（全局唯一，防重复登记）',
  channel        VARCHAR(32)  NOT NULL DEFAULT 'bank' COMMENT '打款渠道 bank/alipay/wechat/cash/other',
  pay_date       DATE         NULL COMMENT '实际支付日期',
  amount         BIGINT       NOT NULL COMMENT '本次金额（分）',
  receipt_url    VARCHAR(512) NULL COMMENT '回单附件 URL（/admin/uploads）',
  note           VARCHAR(255) NULL COMMENT '备注',
  status         TINYINT      NOT NULL DEFAULT 1 COMMENT '0=待审批 1=有效 2=已驳回 3=已被冲正 4=登记人撤回',
  operator       VARCHAR(64)  NOT NULL COMMENT '登记人（admin:显示名）',
  approver       VARCHAR(64)  NULL COMMENT '审批人（超阈值时由超级管理员复核）',
  approve_note   VARCHAR(255) NULL,
  reversed_pay_id BIGINT UNSIGNED NULL COMMENT '冲正指向的原打款流水 id（direction=2 时）',
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_pay_ref (pay_ref),
  KEY idx_profit (co_profit_id),
  KEY idx_status (status)
) ENGINE=InnoDB COMMENT='共创分润打款流水（唯一回单与冲正记录）';

-- 审批阈值走参数中心（分）：单笔实付 ≥ 阈值需超级管理员复核后生效；0=不启用审批
INSERT IGNORE INTO rule_config (k, v, group_name, `sensitive`, memo) VALUES
('coprofit.pay_approve_min', '0', 'finance', 0, '共创分润单笔打款审批阈值（分），达到后需超级管理员复核；0=不启用审批');
