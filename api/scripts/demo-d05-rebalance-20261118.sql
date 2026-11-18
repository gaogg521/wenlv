-- D-05 演示库订单时间重排（2026-11-18，验收人 Claude）
-- 目的：下单口径漏斗（今日 / 近 7 天 / 近 30 天 / 近一年）都落在可讲解区间，且不产生新的存证、不删有存证的订单。
-- 只改 orders.created_at / paid_at / updated_at、少量 user_id（及对应 travel_pass.user_id）、造数专用团期的状态。
-- 用法：mysql ... < 本文件          演练（末尾 ROLLBACK，只打印指标）
--       mysql ... -e "SET @commit=1; SOURCE 本文件"   提交
-- 回滚：执行前先把受影响行的旧值导出到备份目录（见交接文档），或用整库备份恢复。
SET @commit = IFNULL(@commit, 0);
SET @A = '演示样例·分布1118-买家%';
SET @B = '演示样例·分布1118-未支付%';
SET @DAY0 = '2026-11-10';  -- 近期窗口起点：历史数据止于 11-09，造数订单接续到今天

START TRANSACTION;

-- 1) 历史订单：创建时间恢复为「支付前 1–40 分钟」（D-04 曾把 6,938 笔创建时间统一挤到单号日期）
UPDATE orders
   SET created_at = paid_at - INTERVAL (1 + MOD(id * 7919, 40)) MINUTE
 WHERE paid_at IS NOT NULL
   AND contact_name NOT LIKE @A AND contact_name NOT LIKE @B
   AND created_at > paid_at;

-- 2) 「已关闭」造单：前 36 笔接续到近期窗口，其余按历史已支付订单的日分布摊开
CREATE TEMPORARY TABLE tmp_hp AS
  SELECT id, paid_at, ROW_NUMBER() OVER (ORDER BY paid_at, id) rn
    FROM orders
   WHERE paid_at IS NOT NULL AND contact_name NOT LIKE @A AND contact_name NOT LIKE @B;
CREATE TEMPORARY TABLE tmp_b AS
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) rn FROM orders WHERE contact_name LIKE @B;
SELECT COUNT(*) INTO @ch FROM tmp_hp;
SELECT COUNT(*) INTO @nb FROM tmp_b;
SET @recentB = 36;

UPDATE orders o
  JOIN tmp_b b ON b.id = o.id
  JOIN tmp_hp h ON h.rn = FLOOR((b.rn - @recentB - 1) * @ch / (@nb - @recentB)) + 1
   SET o.created_at = h.paid_at - INTERVAL (2 + MOD(o.id * 131, 45)) MINUTE,
       o.updated_at = h.paid_at - INTERVAL (2 + MOD(o.id * 131, 45)) MINUTE + INTERVAL 15 MINUTE
 WHERE b.rn > @recentB;

-- 3) 近期窗口（11-10 ~ 今天）：已支付造单 + 36 笔已关闭造单，按哈希均匀落到各天；今天只落在 08:00–11:30
UPDATE orders o
   SET o.created_at = TIMESTAMP(DATE_ADD(@DAY0, INTERVAL MOD(CRC32(CONCAT('d5d-', o.id)), 9) DAY),
         SEC_TO_TIME(IF(MOD(CRC32(CONCAT('d5d-', o.id)), 9) = 8, 8 * 3600 + MOD(CRC32(CONCAT('d5t-', o.id)), 3.5 * 3600),
                                                                  9 * 3600 + MOD(CRC32(CONCAT('d5t-', o.id)), 12 * 3600))))
 WHERE o.contact_name LIKE @A
    OR o.id IN (SELECT id FROM tmp_b WHERE rn <= @recentB);

UPDATE orders SET paid_at = created_at + INTERVAL (1 + MOD(id, 9)) MINUTE, updated_at = created_at + INTERVAL (1 + MOD(id, 9)) MINUTE
 WHERE contact_name LIKE @A;
UPDATE orders SET updated_at = created_at + INTERVAL 15 MINUTE
 WHERE id IN (SELECT id FROM tmp_b WHERE rn <= @recentB);

-- 4) 让约 1/6 的近期买家产生复购：第 6、12、18… 笔订单改归上一笔订单的买家（通行证随订单一起归属）
CREATE TEMPORARY TABLE tmp_a AS
  SELECT id, user_id, ROW_NUMBER() OVER (ORDER BY created_at, id) rn FROM orders WHERE contact_name LIKE @A;
CREATE TEMPORARY TABLE tmp_a2 AS SELECT id, user_id, rn FROM tmp_a;
UPDATE orders o JOIN tmp_a a ON a.id = o.id JOIN tmp_a2 p ON p.rn = a.rn - 1
   SET o.user_id = p.user_id
 WHERE MOD(a.rn, 6) = 0;
UPDATE travel_pass tp JOIN orders o ON o.id = tp.order_id
   SET tp.user_id = o.user_id
 WHERE o.contact_name LIKE @A AND tp.user_id <> o.user_id;

-- 5) 造数专用团期（远期、挂着上面的订单）对游客隐藏：停售，订单与已报名人数保持不变
UPDATE tour_session SET status = 3
 WHERE status = 1 AND JSON_UNQUOTE(JSON_EXTRACT(profile, '$.note')) = '演示样例·分布1118专用';

-- 指标预测（与后台漏斗同口径：按下单时间；已支付=有支付时间；核销=40/50；复购=窗口内支付≥2 单的买家占支付买家）
SELECT w.label,
       COUNT(*) created, SUM(o.paid_at IS NOT NULL) paid,
       ROUND(100 * SUM(o.paid_at IS NOT NULL) / COUNT(*), 1) pay_rate,
       ROUND(100 * SUM(o.status IN (40, 50)) / NULLIF(SUM(o.paid_at IS NOT NULL), 0), 1) verify_rate
  FROM orders o
  JOIN (SELECT '今日' label, '2026-11-18 00:00:00' f UNION ALL SELECT '近7天', '2026-11-12 00:00:00'
        UNION ALL SELECT '近30天', '2026-10-20 00:00:00' UNION ALL SELECT '近一年', '2025-11-19 00:00:00') w
    ON o.created_at >= w.f AND o.created_at < '2026-11-19 00:00:00'
 GROUP BY w.label ORDER BY FIELD(w.label, '今日', '近7天', '近30天', '近一年');
SELECT w.label, COUNT(*) payers, SUM(c >= 2) rebuy, ROUND(100 * SUM(c >= 2) / COUNT(*), 1) rebuy_rate
  FROM (SELECT '今日' label, '2026-11-18 00:00:00' f UNION ALL SELECT '近7天', '2026-11-12 00:00:00'
        UNION ALL SELECT '近30天', '2026-10-20 00:00:00' UNION ALL SELECT '近一年', '2025-11-19 00:00:00') w
  JOIN (SELECT user_id, created_at, COUNT(*) OVER (PARTITION BY user_id) c0 FROM orders WHERE paid_at IS NOT NULL) x ON x.created_at >= w.f
  JOIN LATERAL (SELECT COUNT(*) c FROM orders p WHERE p.user_id = x.user_id AND p.paid_at IS NOT NULL AND p.created_at >= w.f AND p.created_at < '2026-11-19 00:00:00') cc ON TRUE
 WHERE x.created_at < '2026-11-19 00:00:00'
 GROUP BY w.label;

-- 提交或回滚
SET @sql = IF(@commit = 1, 'COMMIT', 'ROLLBACK');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SELECT IF(@commit = 1, '已提交', '演练结束，已回滚') AS result;
