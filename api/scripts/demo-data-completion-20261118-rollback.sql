-- 项8 回滚（配合 demo-data-completion-20261118.sql；已在隔离库演练通过）
-- 用法：先把主脚本执行后导出的「演示样例·」评价 id 清单填入下面的 ROLLBACK_IDS（或用注释里的 SELECT 重新生成）。
-- 回滚内容（与主脚本逐项对应）：
--   ① 删除主脚本插入的演示评价（content LIKE '演示样例·%'——内容前缀即本批标记，可整体定位）
--   ② 商户类目恢复为 other（#2/#3/#11/#12；仅当当前值为本脚本设置的目标值时才回滚）
--   ③ share_image 恢复为原 SVG 占位图（#1~#6）
-- 审计行按 actor 保留（回滚本身同样留审计），如需彻底清除可再删 audit_log 中 actor='system:demo-data-20261118' 的行。

START TRANSACTION;

-- ① 演示评价（若主脚本执行后还产生过依赖这些评价的数据（如审核认领），一并清理：
--    review_claim 的 queue_kind='review' 行按 item_id 指向 review.id，演示库无人认领，通常为空）
DELETE FROM review_claim WHERE queue_kind = 'review' AND item_id IN (SELECT id FROM (SELECT id FROM review WHERE content LIKE '演示样例·%') x);
DELETE FROM review WHERE content LIKE '演示样例·%';

-- ② 商户类目回滚（条件限定：只把本脚本改过的值改回去）
UPDATE merchant SET kind = 'other' WHERE id =  2 AND kind = 'hotel';
UPDATE merchant SET kind = 'other' WHERE id =  3 AND kind = 'experience';
UPDATE merchant SET kind = 'other' WHERE id = 11 AND kind = 'catering';
UPDATE merchant SET kind = 'other' WHERE id = 12 AND kind = 'experience';

-- ③ 分享封面回滚为 SVG 占位图（仅当当前值为本脚本设置的目标值）
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/demo-prod-1-1.svg') WHERE id =  1 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) = '/uploads/reference-water-town-20261107.jpg';
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/demo-prod-2-1.svg') WHERE id =  2 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) = '/uploads/reference-bamboo-20261107.jpg';
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/demo-prod-3-1.svg') WHERE id =  3 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) = '/uploads/reference-garden-20261107.jpg';
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/demo-prod-4-1.svg') WHERE id =  4 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) = '/uploads/reference-cloth-20261107.jpg';
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/demo-prod-5-1.svg') WHERE id =  5 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) = '/uploads/reference-tea-20261107.jpg';
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/demo-prod-6-1.svg') WHERE id =  6 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) = '/uploads/reference-zongzi-20261107.jpg';

INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val, ip, created_at)
VALUES ('system:demo-data-20261118', 'demo-data', 'item8-rollback', 'review/merchant/product',
        NULL, JSON_OBJECT('rolled_back', 'demo reviews deleted; merchant kinds and share images restored to pre-script values'), NULL, NOW(3));

COMMIT;

-- 回滚后核对（应：演示样例评价 0；商户 other×5；svg share_image×6）
SELECT COUNT(*) AS demo_reviews_left FROM review WHERE content LIKE '演示样例·%';
SELECT kind, COUNT(*) AS n FROM merchant GROUP BY kind;
SELECT COUNT(*) AS svg_share FROM tour_product WHERE JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) LIKE '%.svg';
