-- P1（全量检查 20261106）三件套：A-14 退款异步 close_reason / A-16 一篇笔记一个任务 / A-10 离线名单签发时间
-- 1) refunds.close_reason：退款单记录"完成退款后订单应写的 close_reason"（group_cancel 等），
--    异步退款（PROCESSING→SUCCESS）走补偿任务完成时也能把 close_reason 写进订单，未成团单不再丢改签资格
ALTER TABLE refunds ADD COLUMN close_reason VARCHAR(32) NULL AFTER operator;

-- 2) 一篇笔记只能用于一个任务：note_id 唯一（NULL 不受约束，未提交作品的行为 NULL）
--    历史数据如存在同笔记多任务，迁移会在该库失败，需先人工归档历史脏数据
ALTER TABLE content_task_entry ADD UNIQUE KEY uk_task_entry_note (note_id);

-- 3) 离线名单签发时间：/m/verify/offline-list 每次下发记录时间，
--    恢复上传时校验 offlineAt ∈ [签发时间, 当前时间]，防客户端伪造 offlineAt 绕窗口校验
CREATE TABLE IF NOT EXISTS verify_offline_sync (
  merchant_id BIGINT UNSIGNED PRIMARY KEY,
  issued_at   DATETIME(3) NOT NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
