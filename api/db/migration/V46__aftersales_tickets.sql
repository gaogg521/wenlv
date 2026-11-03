-- V46: 订单售后工单（GLM 交接 T04 / 批次 D）
-- 工单：新建→认领→处理中→等待(游客/商户/财务)→已解决→关闭；可转派/恢复/重开，全程时间线留痕。
-- 城市角色可发起本城请求与补充材料；认领/转派/解决/关闭由平台客服（super/ops）办理。
CREATE TABLE aftersales_ticket (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_no    VARCHAR(24)  NOT NULL COMMENT '工单号 AS+日期+序号',
  order_no     VARCHAR(32)  NOT NULL,
  category     VARCHAR(16)  NOT NULL DEFAULT 'other' COMMENT 'refund refund/assist 改期咨询/contact 联系人变更/complaint 投诉/other',
  source       VARCHAR(16)  NOT NULL DEFAULT 'admin' COMMENT 'admin/city',
  city_code    VARCHAR(8)   NULL,
  priority     TINYINT      NOT NULL DEFAULT 2 COMMENT '1紧急 2普通 3低',
  status       TINYINT      NOT NULL DEFAULT 0 COMMENT '0待认领 1处理中 2等待外部 3已解决 4已关闭',
  assignee     VARCHAR(64)  NULL COMMENT '当前责任人（admin:显示名）',
  promised_at  DATETIME(3)  NULL COMMENT '承诺办结时限',
  resolution   VARCHAR(500) NULL COMMENT '结论/解决方案',
  closed_at    DATETIME(3)  NULL,
  created_by   VARCHAR(64)  NOT NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_no (ticket_no),
  KEY idx_order (order_no),
  KEY idx_status (status, priority)
) ENGINE=InnoDB COMMENT='订单售后工单';

CREATE TABLE aftersales_record (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id   BIGINT UNSIGNED NOT NULL,
  actor       VARCHAR(64)  NOT NULL,
  action      VARCHAR(16)  NOT NULL COMMENT 'create/claim/transfer/wait/resume/note/resolve/close/reopen',
  note        VARCHAR(500) NULL,
  from_status TINYINT      NULL,
  to_status   TINYINT      NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_ticket (ticket_id)
) ENGINE=InnoDB COMMENT='售后工单处理记录（不可改写时间线）';
