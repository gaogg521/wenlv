-- V24: 富表单 —— 约稿任务/FAQ/轮播/旅豆预算 补齐 SaaS 级字段
-- 原则：C 端读取的列（title/brief/reward_beans、title/image/link）一字不动，只做加法。

ALTER TABLE content_task
  ADD COLUMN category VARCHAR(16) NOT NULL DEFAULT 'note' COMMENT 'note图文笔记/video短视频/strategy攻略长文/review体验点评' AFTER brief,
  ADD COLUMN cover_img VARCHAR(255) NULL COMMENT '封面图 /uploads 路径' AFTER category,
  ADD COLUMN rich_brief MEDIUMTEXT NULL COMMENT '富文本任务说明（后台编辑与预览）' AFTER cover_img,
  ADD COLUMN cash_reward INT NOT NULL DEFAULT 0 COMMENT '现金加奖（分）' AFTER reward_beans,
  ADD COLUMN min_words INT NOT NULL DEFAULT 0 COMMENT '最低字数要求，0=不限' AFTER cash_reward,
  ADD COLUMN min_images INT NOT NULL DEFAULT 0 COMMENT '最少图片数要求，0=不限' AFTER min_words,
  ADD COLUMN max_participants INT NOT NULL DEFAULT 0 COMMENT '参与人数上限，0=不限' AFTER min_images,
  ADD COLUMN deadline DATETIME NULL COMMENT '投稿截止时间' AFTER max_participants,
  ADD COLUMN product_id BIGINT UNSIGNED NULL COMMENT '目标商品（关联种草）' AFTER deadline,
  ADD COLUMN tags VARCHAR(128) NULL COMMENT '标签，逗号分隔' AFTER product_id;

ALTER TABLE faq
  ADD COLUMN category VARCHAR(24) NOT NULL DEFAULT '通用' COMMENT '预订/出行/旅豆/退款/会员/其他' AFTER question,
  ADD COLUMN is_hot TINYINT NOT NULL DEFAULT 0 COMMENT '热门问题' AFTER category;

ALTER TABLE banner
  ADD COLUMN sub_title VARCHAR(128) NULL COMMENT '副标题/角标' AFTER title,
  ADD COLUMN start_at DATETIME NULL COMMENT '上架开始' AFTER sort,
  ADD COLUMN end_at DATETIME NULL COMMENT '下架结束' AFTER start_at;

ALTER TABLE bean_budget
  ADD COLUMN remark VARCHAR(255) NULL COMMENT '用途说明' AFTER biz_owner;
