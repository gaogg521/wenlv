-- V52（V-04/V-05 配套）：审核认领身份补不可变 UID + 有效认领唯一约束。
-- 背景 1：claimed_by 原来存 'admin:显示名' 快照——同一账号改显示名后自己的认领既不能幂等确认也
--         不能释放，还能以新名字在同一待办上产生第二条有效认领。新增 claimed_uid 存不可变账号 ID；
--         claimed_by 保留为展示快照。存量行 uid 为 NULL，回退名字比较（真实登录令牌必带 uid）。
-- 背景 2：旧唯一键 (queue_kind, item_id, claimed_by) 只防"同名重复认领"，不同人并发认领同一待办
--         可产生两条有效认领。新增生成列 active_one（有效认领=1，已释放=NULL）+ 唯一键，让
--         "同一待办同时仅一条有效认领"由数据库保证。
-- 存量数据：只处理认领协调表自身——同一待办多条有效认领时保留最早一条，其余按当前时间标记释放；
-- 不触碰业务流水与审计。
UPDATE review_claim rc
JOIN (
  SELECT queue_kind, item_id, MIN(id) keep_id
  FROM review_claim WHERE released_at IS NULL
  GROUP BY queue_kind, item_id HAVING COUNT(*) > 1
) d ON rc.queue_kind = d.queue_kind AND rc.item_id = d.item_id AND rc.id > d.keep_id
SET rc.released_at = NOW(3);

ALTER TABLE review_claim
  ADD COLUMN claimed_uid INT NULL COMMENT '认领人账号UID（不可变身份）' AFTER claimed_by,
  ADD COLUMN active_one TINYINT GENERATED ALWAYS AS (IF(released_at IS NULL, 1, NULL)) STORED
    COMMENT '有效认领标记：进行中=1，已释放=NULL（配合唯一键实现同一待办同时仅一条有效认领）',
  ADD UNIQUE KEY uk_active_one (queue_kind, item_id, active_one);
