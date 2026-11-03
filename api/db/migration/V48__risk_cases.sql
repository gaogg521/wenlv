-- V48: 风险案件闭环（GLM 交接 T12 / 批次 F-1）
-- 风控事件升级为可办理案件：待研判→处理中→待补材料/待协查→待复核→关闭，可重开；
-- 处理原因、证据、处置动作、复核人与结案时间全留痕；"标记已处理"必须写结论；
-- 冻结/解冻可引用案件写入时间线；解冻与结案分离（关闭必须走复核）。
CREATE TABLE risk_case (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_no      VARCHAR(24)  NOT NULL COMMENT '案件号 RC+日期+序号',
  source_type  VARCHAR(16)  NOT NULL DEFAULT 'manual' COMMENT 'risk_event/verify_conflict/manual/city',
  source_id    BIGINT UNSIGNED NULL COMMENT '来源事件/冲突记录 id',
  object_type  VARCHAR(16)  NOT NULL DEFAULT 'user' COMMENT 'user/order/merchant/other',
  object_id    BIGINT UNSIGNED NULL,
  user_id      BIGINT UNSIGNED NULL COMMENT '关联账号（冻结/解冻引用）',
  city_code    VARCHAR(8)   NULL,
  severity     TINYINT      NOT NULL DEFAULT 2 COMMENT '1高 2中 3低',
  title        VARCHAR(120) NOT NULL,
  status       TINYINT      NOT NULL DEFAULT 0 COMMENT '0待研判 1处理中 2待补材料 3待协查 4待复核 5已关闭',
  handler      VARCHAR(64)  NULL COMMENT '当前责任人',
  reviewer     VARCHAR(64)  NULL COMMENT '结案复核人（≠责任人）',
  conclusion   VARCHAR(500) NULL,
  closed_at    DATETIME(3)  NULL,
  created_by   VARCHAR(64)  NOT NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_no (case_no),
  KEY idx_status (status, severity),
  KEY idx_user (user_id),
  KEY idx_city (city_code)
) ENGINE=InnoDB COMMENT='风险案件（T12 闭环）';

CREATE TABLE risk_case_record (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id     BIGINT UNSIGNED NOT NULL,
  actor       VARCHAR(64)  NOT NULL,
  action      VARCHAR(16)  NOT NULL COMMENT 'create/judge/need_info/coordinate/resume/review/close/reopen/note/freeze/unfreeze',
  note        VARCHAR(500) NULL,
  from_status TINYINT      NULL,
  to_status   TINYINT      NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_case (case_id)
) ENGINE=InnoDB COMMENT='风险案件处理时间线（不可改写）';
