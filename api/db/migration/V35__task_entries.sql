-- V35 约稿任务支持多人参与 + 现金加奖打款登记。
-- 背景：原模型是"一人领取一单"（content_task.claimed_by 单值），「参与人数上限」字段形同虚设；
-- 现金加奖通过后没有任何打款记录。现在每位参与者一条 entry，独立创作、投稿、审核、发奖、打款。
CREATE TABLE IF NOT EXISTS content_task_entry (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id       BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  status        TINYINT NOT NULL DEFAULT 1 COMMENT '1 创作中（含驳回待修改）2 审核中 3 已通过',
  note_id       BIGINT UNSIGNED NULL COMMENT '当前投稿（驳回后清空，历史见 content_task_review）',
  claimed_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  submitted_at  DATETIME(3) NULL,
  finished_at   DATETIME(3) NULL,
  reward_beans  INT NOT NULL DEFAULT 0 COMMENT '通过时实发旅豆（快照）',
  cash_reward   INT NOT NULL DEFAULT 0 COMMENT '通过时应付现金加奖（分，快照）',
  cash_status   TINYINT NOT NULL DEFAULT 0 COMMENT '0 无现金加奖 1 待打款 2 已打款',
  cash_paid_at  DATETIME(3) NULL,
  cash_ref      VARCHAR(64) NULL COMMENT '打款流水号（唯一，防重复登记）',
  cash_by       VARCHAR(64) NULL,
  UNIQUE KEY uk_task_user (task_id, user_id),
  UNIQUE KEY uk_cash_ref (cash_ref),
  KEY idx_user (user_id),
  KEY idx_status (status)
) ENGINE=InnoDB COMMENT='约稿任务参与记录（一人一条）';

-- 迁移旧数据：原领取人转为一条参与记录
INSERT IGNORE INTO content_task_entry (task_id, user_id, status, note_id, claimed_at, submitted_at, finished_at, reward_beans)
SELECT id, claimed_by, IF(status IN (1, 2, 3), status, 1), note_id, COALESCE(claimed_at, created_at), submitted_at, finished_at,
       IF(status = 3, reward_beans, 0)
FROM content_task WHERE claimed_by IS NOT NULL;
-- 旧任务实际是单人任务：名额记为 1，行为不变（后台可调大）
UPDATE content_task SET max_participants = 1 WHERE claimed_by IS NOT NULL AND max_participants = 0;
-- 任务本身只剩"招募中 0 / 已下线 4"；进度看参与记录
UPDATE content_task SET status = 0 WHERE status IN (1, 2, 3);

ALTER TABLE content_task_review ADD COLUMN entry_id BIGINT UNSIGNED NULL AFTER task_id, ADD KEY idx_entry (entry_id, id);
UPDATE content_task_review r JOIN content_task_entry e ON e.task_id = r.task_id AND e.user_id = r.user_id SET r.entry_id = e.id;
