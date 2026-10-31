-- 告警外推：risk_event 的严重事件（severity>=2、未处理）要推送到外部 webhook。
-- notified_at 记录推送时间：NULL=未推送，防 jobs 每轮扫描时重复轰炸。
ALTER TABLE risk_event ADD COLUMN notified_at DATETIME(3) NULL AFTER handled;
ALTER TABLE risk_event ADD KEY idx_notify (handled, notified_at);
