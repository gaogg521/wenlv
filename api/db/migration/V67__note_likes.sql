-- A-43（全量检查 20261106）：笔记点赞——一用户一笔记一赞，可取消重赞
CREATE TABLE IF NOT EXISTS content_note_likes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  note_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_note_like (note_id, user_id),
  KEY idx_user (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
