-- V94: 商户双端与 PC 主体资源审批及运营权限
-- 方案:docs/GLM交接-PC主体资源审批与运营权限-20261120.md
-- 状态机:0 草稿 → 1 待审核 → 4 已生效 | 2 已撤回 | 3 已退回(退回/撤回后可再提交,新行关联 reentry_of)
-- 原则:草稿与待审不写正式资源表;审批事务内复验后经共享正式写服务(entity-schema.save)生效。

CREATE TABLE IF NOT EXISTS subject_resource_request (
  id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  req_no               VARCHAR(40)  NOT NULL COMMENT '申请编号 SR+日期+序号,对外可读',
  kind                 VARCHAR(24)  NOT NULL COMMENT 'product/session/stock/merchant/scenic',
  action               VARCHAR(24)  NOT NULL DEFAULT 'update' COMMENT 'create/update',
  resource_id          BIGINT UNSIGNED NULL COMMENT '正式资源 ID(新增为 NULL)',
  subject_type         VARCHAR(16)  NOT NULL COMMENT 'merchant/scenic',
  subject_id           BIGINT UNSIGNED NOT NULL,
  city_code            VARCHAR(8)   NULL,
  channel              VARCHAR(8)   NOT NULL DEFAULT 'pc' COMMENT '来源端 pc/mini',
  status               TINYINT      NOT NULL DEFAULT 0 COMMENT '0草稿 1待审核 2已撤回 3已退回 4已生效',
  submitted_by         BIGINT UNSIGNED NULL COMMENT '提交人(admin_user.id 或 user_account.id)',
  submitted_by_name    VARCHAR(64)  NULL,
  submitter_role       VARCHAR(24)  NULL COMMENT '提交时岗位快照(staff 1/2/3 或 admin role)',
  submitted_at         DATETIME(3)  NULL COMMENT '提交时间',
  baseline_version     INT          NULL COMMENT '提交时正式资源版本(乐观锁基线)',
  baseline_snapshot    JSON         NULL COMMENT '提交时基线值(差异展示用)',
  payload              JSON         NOT NULL COMMENT '拟提交字段(实体 schema 展示口径,金额=元)',
  field_diffs          JSON         NULL COMMENT '[{key,label,group,before,after,important}]',
  impact_flags         JSON         NULL COMMENT '{price,stock,schedule,status,policy,contact,address} 布尔',
  impact_note          VARCHAR(500) NULL COMMENT '受影响时段/既有订单处理说明(影响类变更必填)',
  note                 VARCHAR(500) NULL COMMENT '申请说明',
  attachments          JSON         NULL,
  preaudit             JSON         NULL COMMENT '预审记录 [{by,byName,at,note}]',
  reviewed_by          BIGINT UNSIGNED NULL,
  reviewed_by_name     VARCHAR(64)  NULL,
  reviewed_at          DATETIME(3)  NULL,
  review_note          VARCHAR(500) NULL COMMENT '批准说明/退回原因(退回必填)',
  effective_resource_id BIGINT UNSIGNED NULL,
  effective_version    INT          NULL,
  effective_at         DATETIME(3)  NULL,
  parent_id            BIGINT UNSIGNED NULL COMMENT '多资源依赖:子申请(首批团期)指向主申请(商品)',
  reentry_of           BIGINT UNSIGNED NULL COMMENT '退回/撤回后再提交关联的历史申请',
  version              INT          NOT NULL DEFAULT 1 COMMENT '申请自身版本(重提递增)',
  idem_key             VARCHAR(80)  NULL COMMENT '提交幂等键(channel:kind:resource:主体)',
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_req_no (req_no),
  KEY idx_status (status, subject_type, subject_id),
  KEY idx_resource (kind, resource_id),
  KEY idx_submitter (submitted_by),
  KEY idx_parent (parent_id)
) ENGINE=InnoDB COMMENT='主体资源变更申请(草稿→待审→生效)';

-- 平台主体资源权限配置(PC 平台后台唯一授权来源;最终权限 = 平台授权 ∩ 主体范围 ∩ 岗位 ∩ 渠道)
CREATE TABLE IF NOT EXISTS subject_perm_grant (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_type   VARCHAR(16) NOT NULL COMMENT 'merchant/scenic',
  subject_id     BIGINT UNSIGNED NULL COMMENT 'NULL=该类型全部主体',
  staff_role     TINYINT     NULL COMMENT '商户端岗位 1核销员/2店长/3老板; NULL=全部岗位',
  account_uid    BIGINT UNSIGNED NULL COMMENT 'PC 主体方账号(admin_user.id); NULL=全部账号',
  channel        VARCHAR(8)  NOT NULL DEFAULT 'all' COMMENT 'pc/mini/all',
  res_kind       VARCHAR(24) NOT NULL COMMENT 'product/session/stock/merchant/scenic',
  action         VARCHAR(24) NOT NULL DEFAULT '*' COMMENT 'create/update/price/quota/stop/resume/early; *=该资源全部动作',
  field_group    VARCHAR(40) NULL COMMENT 'NULL=全部字段组; 否则限定/排除该字段组',
  effect         TINYINT     NOT NULL DEFAULT 1 COMMENT '1允许(含字段组收紧) 0拒绝',
  reason         VARCHAR(200) NULL COMMENT '授权原因(必填)',
  granted_by     BIGINT UNSIGNED NOT NULL,
  granted_by_name VARCHAR(64) NULL,
  granted_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '变更时间',
  KEY idx_lookup (subject_type, subject_id, res_kind, action),
  KEY idx_account (account_uid)
) ENGINE=InnoDB COMMENT='主体资源权限配置(PC 下发,最新为准)';

-- 后台动作级三态授权(允许/收回):审批权 subject.approve 基线仅超管,按员工单独授予或撤回
CREATE TABLE IF NOT EXISTS admin_user_action (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uid             BIGINT UNSIGNED NOT NULL,
  action          VARCHAR(64) NOT NULL,
  effect          TINYINT     NOT NULL DEFAULT 1 COMMENT '1允许 0收回',
  reason          VARCHAR(200) NULL,
  granted_by      BIGINT UNSIGNED NOT NULL,
  granted_by_name VARCHAR(64) NULL,
  granted_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_uid_action (uid, action)
) ENGINE=InnoDB COMMENT='后台动作级授权覆盖(按员工)';

-- 站内收件箱:提交→超管+获授权运营;批准/退回→提交人;同一事件按收件人去重
CREATE TABLE IF NOT EXISTS platform_inbox (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recipient_type        VARCHAR(8)  NOT NULL COMMENT 'admin/staff',
  recipient_uid         BIGINT UNSIGNED NOT NULL COMMENT 'admin_user.id 或 user_account.id',
  recipient_merchant_id BIGINT UNSIGNED NULL COMMENT 'staff 收件人所属门店',
  kind                  VARCHAR(40) NOT NULL COMMENT 'subject_request_submitted/approved/rejected/withdrawn',
  title                 VARCHAR(120) NOT NULL,
  body                  VARCHAR(500) NULL,
  link                  VARCHAR(200) NULL,
  biz_ref               VARCHAR(64) NULL COMMENT '申请编号',
  dedup_key             VARCHAR(150) NOT NULL COMMENT '去重键(kind:bizRef:recipient)',
  read_at               DATETIME(3) NULL,
  handled_at            DATETIME(3) NULL COMMENT '办理完成时间(已读≠已处理,待审数独立计算)',
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_dedup (dedup_key),
  KEY idx_rcpt (recipient_type, recipient_uid, created_at),
  KEY idx_biz (biz_ref)
) ENGINE=InnoDB COMMENT='平台站内通知收件箱';

-- 主体权限下发版本号:各端登录/回前台刷新快照,仅更高版本可覆盖本地(乱序响应不恢复旧授权)
CREATE TABLE IF NOT EXISTS subject_perm_version (
  id           TINYINT     NOT NULL PRIMARY KEY,
  version      BIGINT      NOT NULL DEFAULT 1,
  published_by VARCHAR(64) NULL,
  published_at DATETIME(3) NULL
) ENGINE=InnoDB COMMENT='主体权限下发版本(单一行 id=1)';
INSERT IGNORE INTO subject_perm_version (id, version, published_by, published_at) VALUES (1, 1, 'init', CURRENT_TIMESTAMP(3));
