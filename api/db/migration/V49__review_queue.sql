-- V49: 审核工作队列（GLM 交接 T07 / 批次 F-3）
-- 四类队列（独立笔记审核 / 约稿投稿审核 / 举报处理 / 作者申诉）统一认领机制：
-- review_claim 表记录谁在什么时间认领了哪条待办，防止重复处理；不改既有审核判定逻辑。
CREATE TABLE review_claim (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  queue_kind  VARCHAR(16)  NOT NULL COMMENT 'note/task_entry/report/appeal',
  item_id     BIGINT UNSIGNED NOT NULL,
  claimed_by  VARCHAR(64)  NOT NULL,
  released_at DATETIME(3)  NULL COMMENT '释放时间（判定完成后自动释放）',
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_active (queue_kind, item_id, claimed_by),
  KEY idx_item (queue_kind, item_id)
) ENGINE=InnoDB COMMENT='审核认领（四类队列统一）';
