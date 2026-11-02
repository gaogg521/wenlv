-- V34 内容审核留痕：约稿投稿每次判定（通过/驳回、原因、核对结果、审核人）都记一条；笔记驳回原因对作者可见。
-- 背景：后台此前只有"通过/驳回"两个按钮，看不到投稿内容，驳回也不留原因，作者不知道为什么没过。
CREATE TABLE IF NOT EXISTS content_task_review (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id     BIGINT UNSIGNED NOT NULL,
  note_id     BIGINT UNSIGNED NULL COMMENT '被审核的投稿（驳回后任务上的 note_id 会清空，这里保留）',
  user_id     BIGINT UNSIGNED NULL COMMENT '投稿人',
  verdict     TINYINT NOT NULL COMMENT '1 通过 0 驳回',
  reason      VARCHAR(300) NULL COMMENT '驳回原因（作者可见）/ 通过备注',
  checks      JSON NULL COMMENT '自动核对结果 + 审核标准逐条确认',
  reviewer    VARCHAR(64) NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_task (task_id, id)
) ENGINE=InnoDB COMMENT='约稿任务审核记录';

ALTER TABLE content_note ADD COLUMN reject_reason VARCHAR(300) NULL COMMENT '人工审核未通过原因（作者可见）';
