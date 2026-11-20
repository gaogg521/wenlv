-- M-11 证据截图夹具（隔离库 wanderlust_qa_mn 专用；在 test:db 全链跑完并出 EXIT=0 之后再执行，避免污染选单类断言）。
-- 用法：mysql -uroot -proot wanderlust_qa_mn < scripts/mn-fixtures.sql
-- 截图结束后可整段反向清掉（见文末注释）。

-- 商户端三岗位（门店 1）：老板 / 核销员（店长=seed 的 mock-chenjie 已存在）
INSERT INTO user_account (mini_b_openid, nickname) VALUES ('mock-openid-mock-mn-boss-fix', '陈大山（老板夹具）');
INSERT INTO merchant_staff (merchant_id, user_id, role, status) SELECT 1, id, 3, 1 FROM user_account WHERE mini_b_openid='mock-openid-mock-mn-boss-fix';
INSERT INTO user_account (mini_b_openid, nickname) VALUES ('mock-openid-mock-mn-verify-fix', '小夏（核销员夹具）');
INSERT INTO merchant_staff (merchant_id, user_id, role, status) SELECT 1, id, 1, 1 FROM user_account WHERE mini_b_openid='mock-openid-mock-mn-verify-fix';

-- T-01 截图夹具：55 单完成态游客
INSERT INTO user_account (mini_a_openid, nickname) VALUES ('mock-openid-mock-mn-tour55', '老周（55单夹具）');
SET @uid = (SELECT id FROM user_account WHERE mini_a_openid='mock-openid-mock-mn-tour55');
SET @pid = (SELECT id FROM tour_product WHERE merchant_id=1 AND status=1 ORDER BY id LIMIT 1);
SET @sid = (SELECT id FROM tour_session WHERE product_id=@pid AND depart_date >= CURDATE() ORDER BY id LIMIT 1);
SET @m = (SELECT merchant_id FROM tour_product WHERE id=@pid);
INSERT INTO orders (order_no, user_id, product_id, session_id, merchant_id, city_code, status, qty, amount_goods, amount_pay, channel, paid_at)
SELECT CONCAT('MN55', n), @uid, @pid, @sid, @m, '310118', 50, 1, 23800, 23800, 'main', NOW()
FROM (SELECT (a.N + b.N*10) AS n FROM
  (SELECT 0 N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a,
  (SELECT 0 N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5) b) nums
WHERE n < 55;

-- 清理（截图完成后执行）：
-- DELETE o FROM orders o JOIN user_account u ON u.id=o.user_id WHERE u.mini_a_openid='mock-openid-mock-mn-tour55';
-- DELETE FROM user_account WHERE mini_a_openid='mock-openid-mock-mn-tour55' OR mini_b_openid LIKE 'mock-openid-mn-%-fix';
-- DELETE FROM merchant_staff WHERE user_id NOT IN (SELECT id FROM user_account);
