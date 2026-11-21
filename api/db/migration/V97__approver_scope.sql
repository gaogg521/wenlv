-- V97: 主体审批业务范围(按员工;退回项2)。
-- 规则:super 不受限;非超管持有 subject.approve/subject.preaudit 动作时,可办理的申请 = 其 scope 行集合的并集
-- (subject_type/subject_id/city 三维,均可 NULL=不限该维);无任何 scope 行 = 无范围(列表为空、批准/退回/预审 1003)。
-- 申请必须命中至少一行才算授权范围内:命中 = (行.subject_type IS NULL 或 = 申请.subject_type)
--   且 (行.subject_id IS NULL 或 = 申请.subject_id) 且 (行.city_code IS NULL 或 = 申请.city_code)。
CREATE TABLE IF NOT EXISTS subject_approver_scope (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uid             BIGINT UNSIGNED NOT NULL COMMENT 'admin_user.id(运营员工)',
  subject_type    VARCHAR(16)  NULL COMMENT 'merchant/scenic; NULL=不限类型',
  subject_id      BIGINT UNSIGNED NULL COMMENT 'NULL=该类型全部主体',
  city_code       VARCHAR(8)   NULL COMMENT 'NULL=不限城市',
  reason          VARCHAR(200) NULL COMMENT '授权原因(必填,进审计)',
  granted_by      BIGINT UNSIGNED NOT NULL,
  granted_by_name VARCHAR(64)  NULL,
  granted_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_uid (uid)
) ENGINE=InnoDB COMMENT='主体审批业务范围(按员工,最新下发的范围为准)';
