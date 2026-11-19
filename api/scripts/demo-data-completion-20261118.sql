-- 项8 演示数据补全（8080 演示库 wanderlust，2026-11-18，GLM 二轮）
-- 范围：① 演示评价 34 条（标「演示样例·」，含商户回复 11 条：待审5/展示5/下架1；评价本体 展示30/下架4）
--       ② 商户类目补全：#2 安吉瑜伽谷民宿=住宿、#3 苏州园林文旅=体验、#11 朱家角手冲咖啡实验室=餐饮、#12 水乡蓝染工作室=体验
--       ③ 分享封面：#1~#6 的 share_image 为 SVG（微信 image 组件不支持），换成商品现用封面同款摄影参考图
-- 约束：纯 SQL 直写；不调用任何业务接口；库内触发器仅在 attest_batch/attest_event（存证守卫），本脚本不触碰存证链路。
-- 素材来源：全部复用 8080 已有 /uploads/reference-*.jpg（2026-11-07/08 商品摄影参考图库，来源与许可见
--           docs/演示内容补充与双端验证-20261108.md 与小程序关于页）。
-- 前置备份：C:/Users/allenzhao/AppData/Local/Wanderlust/Backups/round2-item8-20261118/wanderlust-before-item8-20261118.sql（87,969,102 字节，含完成标记）
-- 回滚：api/scripts/demo-data-completion-20261118-rollback.sql（按执行后导出的演示评价 id 清单 + 固定前值回滚；已在隔离库演练通过）
-- 幂等：若已存在「演示样例·」评价则报错退出，不重复插入。

START TRANSACTION;

-- 0) 幂等守卫
SELECT COUNT(*) INTO @demo_reviews FROM review WHERE content LIKE '演示样例·%';
SET @msg = IF(@demo_reviews > 0, '已存在演示样例评价，请勿重复执行', 'ok');
SELECT @demo_reviews AS existing_demo_reviews, @msg AS status;

DELIMITER $$
DROP PROCEDURE IF EXISTS demo_seed_guard $$
CREATE PROCEDURE demo_seed_guard()
BEGIN
  IF @demo_reviews > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '演示样例评价已存在（幂等守卫），本次不执行';
  END IF;
END $$
DELIMITER ;
CALL demo_seed_guard();
DROP PROCEDURE demo_seed_guard;

-- 1) 评价文案表：product_id × rn（rn=该商品第几笔候选完成单）
--    rating 1-5；status 1=展示 0=隐藏（下架）；reply 非 NULL 时 reply_status：0=待审 1=展示 2=下架
CREATE TEMPORARY TABLE tmp_review_text (
  product_id INT NOT NULL, rn INT NOT NULL, rating TINYINT NOT NULL,
  status TINYINT NOT NULL DEFAULT 1, content VARCHAR(200) NOT NULL,
  reply VARCHAR(200) NULL, reply_status TINYINT NULL, age_days INT NOT NULL,
  PRIMARY KEY (product_id, rn)
) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4;

INSERT INTO tmp_review_text (product_id, rn, rating, status, content, reply, reply_status, age_days) VALUES
  -- m1 安麓大夫第：朱家角剧本游 #1
  ( 1, 1, 5, 1, '演示样例·谜题设计很巧，石桥那段孩子玩得不肯走', '感谢喜爱，欢迎带朋友来解锁新线索，新品已在准备中。', 1, 44),
  ( 1, 2, 4, 1, '演示样例·讲解员会控场，复盘环节出乎意料的有意思', NULL, NULL, 36),
  ( 1, 3, 3, 0, '演示样例·水巷实景加分，人多时稍显吵闹，建议错峰', NULL, NULL, 30),
  -- m1 江南扎染方巾 #4（商城好物）
  ( 4, 1, 5, 1, '演示样例·蓝印花布纹样很正，自己扎的手感好', NULL, NULL, 41),
  ( 4, 2, 4, 1, '演示样例·方巾比想象小一圈，送人正合适', NULL, NULL, 33),
  ( 4, 3, 3, 0, '演示样例·染料有点味道，晾两天就好了', NULL, NULL, 27),
  -- m1 朱家角阿婆粽礼盒 #6（商城好物）
  ( 6, 1, 5, 1, '演示样例·还是熟悉的阿婆味道，米粒软硬刚好', '感谢支持，礼盒常温保存口感更佳，开封后请尽快食用。', 1, 38),
  ( 6, 2, 4, 1, '演示样例·包装有古镇特色，送人体面', NULL, NULL, 29),
  -- m1 朱家角寻灯记 #29
  (29, 1, 5, 1, '演示样例·提灯夜寻的氛围感拉满，路线不长不累', '感谢回顾，周末场已加开，可在团期页查看。', 0, 34),
  (29, 2, 4, 1, '演示样例·线索卡有点难度，适合细心的玩家', NULL, NULL, 25),
  (29, 3, 5, 1, '演示样例·解谜后的茶馆复盘很舒服，像真的在剧本里', NULL, NULL, 20),
  -- m1 课植园来信 #30
  (30, 1, 4, 1, '演示样例·建筑细节讲得生动，解谜不难，适合入门', NULL, NULL, 42),
  (30, 2, 5, 1, '演示样例·带娃认识古建的好选择，节奏舒服', '谢谢反馈，儿童版线索卡已在试印，下次体验会更有趣。', 0, 22),
  (30, 3, 3, 0, '演示样例·雨天部分点位取消，希望有备选方案', NULL, NULL, 16),
  -- m1 青西自然课 #33
  (33, 1, 5, 1, '演示样例·孩子第一次记住了白鹭的名字，值回票价', '感谢反馈，秋季观察班次已开放预约。', 1, 39),
  (33, 2, 4, 1, '演示样例·叶片拓印材料包很实用', NULL, NULL, 18),
  (33, 3, 4, 1, '演示样例·无痕野餐的理念讲得好，孩子也听进去了', NULL, NULL, 10),
  -- m1 水乡家味·手包粽子 #39
  (39, 1, 5, 1, '演示样例·手包粽子成功四个，带回家全家都夸', '恭喜手作成功！四枚粽子的蒸制时间已发到您的预约页。', 1, 26),
  (39, 2, 5, 1, '演示样例·师傅教得耐心，材料新鲜', NULL, NULL, 12),
  -- m2 安吉瑜伽谷：2天1夜 #2
  ( 2, 1, 5, 1, '演示样例·山谷清晨的瑜伽课太治愈，值得一住', '感谢入住，冬季热汤锅已上线，欢迎再来。', 1, 43),
  ( 2, 2, 4, 1, '演示样例·民宿房间大，瑜伽老师很专业', NULL, NULL, 31),
  -- m2 安吉竹海·轻瑜伽 #31
  (31, 1, 5, 1, '演示样例·竹林里做拉伸，呼吸都顺了', NULL, NULL, 35),
  (31, 2, 4, 1, '演示样例·强度不大，久坐党友好', NULL, NULL, 14),
  (31, 3, 3, 0, '演示样例·夏季蚊虫多，建议自备防蚊', NULL, NULL, 8),
  -- m2 安吉白茶·双人席 #38
  (38, 1, 5, 1, '演示样例·茶艺师冲泡讲解很细，双人席安静', NULL, NULL, 32),
  (38, 2, 4, 1, '演示样例·白茶回甘明显，环境出片', '谢谢喜欢，明前头采已到店，欢迎预约品鉴。', 0, 24),
  -- m3 苏州园林文旅：姐姐茶会 #3
  ( 3, 1, 5, 1, '演示样例·姐姐茶会的园林讲解有烟火气', '谢谢喜欢，下月茶会主题已更新，欢迎再来。', 0, 40),
  ( 3, 2, 4, 1, '演示样例·拍照点位指路贴心，不虚此行', NULL, NULL, 28),
  -- m3 耦园拾光 #35
  (35, 1, 5, 1, '演示样例·摄影散步不赶路，出片率高', NULL, NULL, 37),
  (35, 2, 4, 1, '演示样例·好友同游刚好，茶叙点位舒服', NULL, NULL, 19),
  -- m3 平江路慢游 #36
  (36, 1, 5, 1, '演示样例·蓝印手作成品能带走，成就感足', NULL, NULL, 23),
  (36, 2, 4, 1, '演示样例·漫步路线不累，茶会收尾舒服', '感谢支持，手作工位已扩到八个，预约更从容。', 0, 11),
  (36, 3, 4, 1, '演示样例·古街讲解克制不啰嗦，体验感好', NULL, NULL, 6),
  -- 下架回复样例（回复含平台外联系方式被下架，reply_status=2）
  ( 6, 3, 5, 1, '演示样例·端午前买很划算，两只装当早饭', '演示样例·添加微信号 lingyou-888 可领专属优惠券', 2, 17);

-- 2) 挂到真实核销完成单（status=50，一单一评唯一键保护；同游客同商品不重复取）
-- 注：MySQL 的 WITH 只能前置 SELECT/UPDATE/DELETE，INSERT 里把 CTE 写在 SELECT 段开头
INSERT INTO review (order_id, user_id, product_id, rating, content, status, reply, reply_at, reply_status, created_at, updated_at)
WITH cand AS (
  SELECT o.id AS oid, o.user_id AS uid, o.product_id AS pid, o.paid_at AS paid_at,
         ROW_NUMBER() OVER (PARTITION BY o.product_id ORDER BY o.id) AS rn
  FROM orders o
  WHERE o.status = 50
    AND NOT EXISTS (SELECT 1 FROM review r WHERE r.order_id = o.id)
)
SELECT c.oid, c.uid, c.pid, t.rating, t.content, t.status, t.reply,
       IF(t.reply IS NULL, NULL, DATE_ADD(NOW(), INTERVAL -(t.age_days - 1) DAY)),
       IFNULL(t.reply_status, 0),
       DATE_ADD(NOW(), INTERVAL -t.age_days DAY), NOW()
FROM cand c
JOIN tmp_review_text t ON t.product_id = c.pid AND t.rn = c.rn;

SELECT ROW_COUNT() INTO @inserted;
DROP TEMPORARY TABLE tmp_review_text;

-- 3) 商户类目补全（覆盖负责人指定四家；其余本就非「其他」）
UPDATE merchant SET kind = 'hotel'      WHERE id =  2 AND kind = 'other';
UPDATE merchant SET kind = 'experience' WHERE id =  3 AND kind = 'other';
UPDATE merchant SET kind = 'catering'   WHERE id = 11 AND kind = 'other';
UPDATE merchant SET kind = 'experience' WHERE id = 12 AND kind = 'other';

-- 4) 分享封面 SVG → 商品现用封面同款参考图（微信 image 不支持 SVG）
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/reference-water-town-20261107.jpg') WHERE id =  1 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) LIKE '%.svg';
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/reference-bamboo-20261107.jpg')      WHERE id =  2 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) LIKE '%.svg';
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/reference-garden-20261107.jpg')      WHERE id =  3 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) LIKE '%.svg';
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/reference-cloth-20261107.jpg')       WHERE id =  4 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) LIKE '%.svg';
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/reference-tea-20261107.jpg')         WHERE id =  5 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) LIKE '%.svg';
UPDATE tour_product SET profile = JSON_SET(profile, '$.share_image', '/uploads/reference-zongzi-20261107.jpg')      WHERE id =  6 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) LIKE '%.svg';

-- 5) 审计（actor 命名沿用上轮 system:demo-* 约定）
INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val, ip, created_at)
VALUES ('system:demo-data-20261118', 'demo-data', 'item8-review-seed', 'review-batch-20261118',
        JSON_OBJECT('review_total', (SELECT COUNT(*) FROM review) - @inserted),
        JSON_OBJECT('inserted', @inserted, 'marked', '演示样例·', 'replies', 11, 'reply_status', '0x5/1x5/2x1', 'review_status', '1x30/0x4'),
        NULL, NOW(3));
INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val, ip, created_at)
VALUES ('system:demo-data-20261118', 'demo-data', 'item8-merchant-kind', 'merchant-2,3,11,12',
        JSON_OBJECT('2', 'other', '3', 'other', '11', 'other', '12', 'other'),
        JSON_OBJECT('2', 'hotel', '3', 'experience', '11', 'catering', '12', 'experience'),
        NULL, NOW(3));
INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val, ip, created_at)
VALUES ('system:demo-data-20261118', 'demo-data', 'item8-share-image-svg2jpg', 'product-1..6',
        JSON_OBJECT('note', 'share_image 均为不受微信支持的 SVG 占位图'),
        JSON_OBJECT('1', 'reference-water-town-20261107.jpg', '2', 'reference-bamboo-20261107.jpg', '3', 'reference-garden-20261107.jpg',
                    '4', 'reference-cloth-20261107.jpg', '5', 'reference-tea-20261107.jpg', '6', 'reference-zongzi-20261107.jpg'),
        NULL, NOW(3));

COMMIT;

-- 6) 执行后核对（应：新增 34 条评价、30 展示 / 4 下架；回复 0×5 1×5 2×1；商户无 other；share_image 无 svg）
SELECT COUNT(*) AS demo_reviews_total, SUM(status = 1) AS shown, SUM(status = 0) AS hidden,
       SUM(reply IS NOT NULL) AS replied, SUM(reply_status = 0) AS rs_pending, SUM(reply_status = 1) AS rs_shown, SUM(reply_status = 2) AS rs_hidden
FROM review WHERE content LIKE '演示样例·%';
SELECT kind, COUNT(*) AS n FROM merchant GROUP BY kind;
SELECT COUNT(*) AS svg_share_left FROM tour_product WHERE JSON_UNQUOTE(JSON_EXTRACT(profile, '$.share_image')) LIKE '%.svg';
