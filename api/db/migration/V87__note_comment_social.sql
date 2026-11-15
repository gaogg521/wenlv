-- V87：小红书式评论社交层——平铺盖楼（root_id/reply_to）+ 评论点赞 + 图片评论 + 软删除 + 管理治理列
-- V86 里旧结构的 content_note_comment 在此统一重建（重建时仅存在本轮测试产生的 0-4 行种子数据）；
-- 如生产环境已积累评论数据，应先手工迁数再执行本迁移。
DROP TABLE IF EXISTS content_note_comment;
CREATE TABLE content_note_comment (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  note_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  root_id BIGINT UNSIGNED NULL COMMENT '楼一层：回复树根评论 id，一级评论为 NULL',
  reply_to BIGINT UNSIGNED NULL COMMENT '被回复的评论 id（展示为「回复 @xx」）',
  body VARCHAR(500) NOT NULL COMMENT '评论文本（可空，仅图片评论时为空串）',
  status TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1展示 0管理隐藏（举报治理）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL COMMENT '作者软删除时间',
  media_kind ENUM('image','audio') NULL COMMENT '评论附件类型',
  media_path VARCHAR(255) NULL COMMENT '附件 /uploads 路径',
  media_state TINYINT NOT NULL DEFAULT 1 COMMENT '附件机审 1通过 0待审 2违规',
  media_trace VARCHAR(128) NULL COMMENT '机审回执 trace',
  UNIQUE KEY ux_comment_trace (media_trace),
  KEY ix_note_thread (note_id, root_id, deleted_at, id),
  KEY ix_comment_author (user_id, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS content_note_comment_like (
  comment_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (comment_id, user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
