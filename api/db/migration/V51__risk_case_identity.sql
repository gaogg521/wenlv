-- V51（V-01）：风险案件责任人/复核人以不可变账号 UID 判定身份。
-- 背景（Codex 验收 V-01）：handler/reviewer 原来只存 'admin:显示名' 快照，同一账号改显示名后
-- 名字比较失配，可以自结案（绕过双人复核）；两个不同账号同名又会互相误拒。
-- 方案：新增 handler_uid / reviewer_uid 存不可变账号 ID；显示名列保留为展示快照。
-- 兼容：存量行 uid 列为 NULL，比较时回退旧名字规则（只影响测试夹具令牌与历史行，真实登录令牌必带 uid）。
ALTER TABLE risk_case
  ADD COLUMN handler_uid  INT NULL COMMENT '责任人账号UID（不可变身份，V-01）' AFTER handler,
  ADD COLUMN reviewer_uid INT NULL COMMENT '结案复核人账号UID（不可变身份，V-01）' AFTER reviewer;
