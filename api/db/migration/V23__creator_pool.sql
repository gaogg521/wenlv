-- V23: 创作者池 —— 用户加创作者资源标记（UGC 运营第一步：先有池子视角）
-- 背景：content_note/review/content_task 骨架已在，但缺"创作者"资源视角；标签挂在用户上，不动角色模型。

ALTER TABLE user_account
  ADD COLUMN creator_tag VARCHAR(16) NOT NULL DEFAULT 'none'
  COMMENT '创作者标签：none普通/signed签约/star优质/limited限流' AFTER member_level;

ALTER TABLE user_account
  ADD KEY idx_creator_tag (creator_tag);
