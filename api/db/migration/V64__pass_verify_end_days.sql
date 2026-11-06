-- A-04/A-11（全量检查 20261106）：核销有效日期范围
-- 负责人决定：出发日当天到结束日（出发日后 N 天内仍可核销，覆盖多日行程的第 2 天起）
-- 核销日期窗口（自然日）：出发日 ≤ 当天 ≤ 出发日 + N。N 可在参数中心调整，默认 7 天。
INSERT IGNORE INTO rule_config (k, v, group_name, `sensitive`, memo)
VALUES ('pass.verify_end_days', '7', 'pass', 0, '核销有效结束日：出发日后 N 天内仍可核销（多日行程覆盖）');
