-- V86：UGC 小红书化改造——笔记评论体系 + 发布奖励旅豆（幂等标记）
CREATE TABLE IF NOT EXISTS content_note_comment (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  note_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  content VARCHAR(600) NOT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1展示 0隐藏',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_note (note_id, status, id),
  KEY idx_user (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

ALTER TABLE content_note
  ADD COLUMN comment_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '展示中的评论数（与评论表 status=1 行数对账）',
  ADD COLUMN reward_granted TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '发布奖励旅豆已发放（幂等标记）';

INSERT INTO rule_config(k,v,group_name,`sensitive`,memo)
VALUES ('content.publish_reward_beans','20','content',0,'笔记正式发布发放旅豆数（0=关闭发布奖励）')
 ,('content.publish_reward_monthly_cap','10','content',0,'每用户每月可获得发布奖励的次数上限（防刷量）')
ON DUPLICATE KEY UPDATE k=k;

-- 评论管理后台模块授权（V54 矩阵模式）：内容运营组新栏目，与 content/contentcases 同批角色
INSERT IGNORE INTO admin_role_module (role, module_key, level) VALUES
  ('ops', 'comments', 'manage'),
  ('review', 'comments', 'manage'),
  ('city_partner', 'comments', 'manage');
