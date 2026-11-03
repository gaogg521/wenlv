-- V47: 用户运营标签/内部备注（T05）+ 人工权益调整申请（T06）（GLM 交接 / 批次 E）
-- 标签与备注是运营内部口径，与用户自维护昵称/头像无关；游客接口不下发（红线：内部备注不外泄）。
CREATE TABLE user_ops_tag (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  tag        VARCHAR(32)  NOT NULL,
  note       VARCHAR(200) NULL COMMENT '打标说明',
  created_by VARCHAR(64)  NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_user_tag (user_id, tag),
  KEY idx_tag (tag)
) ENGINE=InnoDB COMMENT='用户运营标签（可管理词表见参数 user.ops_tags）';

CREATE TABLE user_ops_note (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  actor      VARCHAR(64)  NOT NULL,
  note       VARCHAR(500) NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_user (user_id)
) ENGINE=InnoDB COMMENT='用户内部备注（追加式，不可覆盖）';

-- 人工权益调整：申请→他人审批→执行（账本分录/成长记录与审计同事务）；不做"直接改余额"接口
CREATE TABLE entitlement_request (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  req_no      VARCHAR(32)  NOT NULL COMMENT '业务号 EQ+日期+序号（执行幂等键）',
  user_id     BIGINT UNSIGNED NOT NULL,
  kind        VARCHAR(16)  NOT NULL COMMENT 'bean_grant 旅豆补发/bean_deduct 旅豆扣回/growth_fix 成长值更正/badge_grant 徽章补发/badge_revoke 徽章撤回',
  amount      BIGINT       NULL COMMENT '旅豆（个）/成长值（点）；徽章类为空',
  badge_id    BIGINT       UNSIGNED NULL,
  reason      VARCHAR(500) NOT NULL COMMENT '原始业务依据与原因',
  status      TINYINT      NOT NULL DEFAULT 0 COMMENT '0待审批 1已执行 2已驳回 3已撤回',
  applicant   VARCHAR(64)  NOT NULL,
  approver    VARCHAR(64)  NULL,
  approve_note VARCHAR(200) NULL,
  exec_result VARCHAR(255) NULL COMMENT '执行结果摘要（账本/等级/徽章）',
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  approved_at DATETIME(3)  NULL,
  UNIQUE KEY uk_no (req_no),
  KEY idx_status (status, id)
) ENGINE=InnoDB COMMENT='人工权益调整申请';

-- 可用标签词表走参数中心（JSON 数组），运营可在参数中心按流程调整
INSERT IGNORE INTO rule_config (k, v, group_name, `sensitive`, memo) VALUES
('user.ops_tags', '["高价值用户","投诉跟进","内部核查","合作达人","风险观察"]', 'user', 0, '用户运营标签词表（T05）：标签管理按此词表校验');
