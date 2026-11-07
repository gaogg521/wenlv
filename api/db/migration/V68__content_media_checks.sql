CREATE TABLE content_media_check (
  trace_id VARCHAR(128) PRIMARY KEY,
  note_id BIGINT UNSIGNED NOT NULL,
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0待回执 1通过 2需人工复核',
  suggest VARCHAR(32) NULL,
  error_code INT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_at DATETIME(3) NULL,
  KEY idx_note (note_id, status)
) ENGINE=InnoDB COMMENT='微信图片审核任务与幂等回执';
