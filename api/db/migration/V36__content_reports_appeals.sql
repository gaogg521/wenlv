CREATE TABLE content_moderation (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  note_id BIGINT UNSIGNED NOT NULL,
  city_code VARCHAR(8) NULL,
  reason VARCHAR(300) NOT NULL,
  snapshot JSON NOT NULL,
  actor VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_note (note_id,id)
) ENGINE=InnoDB COMMENT='笔记下架记录，保留内容快照';
ALTER TABLE content_note ADD COLUMN moderation_id BIGINT UNSIGNED NULL COMMENT '当前生效的下架记录';
CREATE TABLE content_report (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  note_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  city_code VARCHAR(8) NULL,
  reason VARCHAR(300) NOT NULL,
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0待处理 1不成立 2已下架',
  moderation_id BIGINT UNSIGNED NULL,
  resolution VARCHAR(300) NULL,
  actor VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  UNIQUE KEY uk_note_reporter (note_id,user_id),
  KEY idx_queue (status,id)
) ENGINE=InnoDB COMMENT='读者举报及反馈';
CREATE TABLE content_appeal (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  moderation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(300) NOT NULL,
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0待复核 1恢复展示 2维持下架',
  resolution VARCHAR(300) NULL,
  actor VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  UNIQUE KEY uk_moderation (moderation_id),
  KEY idx_queue (status,id)
) ENGINE=InnoDB COMMENT='作者对单次下架的申诉';
