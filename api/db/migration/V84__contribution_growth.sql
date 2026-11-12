ALTER TABLE orders ADD COLUMN contribution_scenic_id BIGINT UNSIGNED NULL COMMENT '贡献分景区快照，0无景区，NULL为历史订单';

ALTER TABLE contribution_record
  MODIFY COLUMN score DECIMAL(16,2) NOT NULL,
  MODIFY COLUMN cs DECIMAL(16,2) NOT NULL,
  ADD COLUMN source_id BIGINT UNSIGNED NULL,
  ADD COLUMN scenic_id BIGINT UNSIGNED NULL,
  ADD COLUMN anchor_id BIGINT UNSIGNED NULL,
  ADD COLUMN event_day DATE NULL,
  ADD COLUMN rule_snapshot JSON NULL,
  ADD COLUMN growth_state VARCHAR(16) NOT NULL DEFAULT 'legacy',
  ADD COLUMN growth_granted BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN growth_active BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN reason VARCHAR(128) NULL,
  ADD KEY idx_cs_user_day(user_id,kind,event_day),
  ADD KEY idx_cs_anchor(anchor_id,kind);

CREATE TABLE contribution_job (
  source ENUM('order','entry') NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  event_day DATE NOT NULL,
  rules JSON NOT NULL,
  run_after DATETIME(3) NULL,
  PRIMARY KEY(source,source_id),
  KEY idx_cs_due(run_after)
) ENGINE=InnoDB;

CREATE TABLE contribution_retention_window (
  user_id BIGINT UNSIGNED NOT NULL,
  scenic_id BIGINT UNSIGNED NOT NULL,
  anchor_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(user_id,scenic_id)
) ENGINE=InnoDB;

INSERT INTO rule_config(k,v,group_name,`sensitive`,memo)
VALUES ('contribution.effective_at','""','contribution',0,'S/R及贡献成长生效时间（北京时间 YYYY-MM-DD HH:mm:ss，空=暂未启用）')
 ,('contribution.sr_limits','{"monthCap":10000,"sScore":500,"sCap":10,"rScore":300,"rCap":3,"windowDays":90}','contribution',0,'贡献成长和S/R限额；分值按百分位整数')
ON DUPLICATE KEY UPDATE k=k;
