-- A-01（全量检查 20261106）：每笔订单只能免费改签一次
-- rebook_of 唯一索引：并发改签只可能成功一次（应用层事务内复查 + 数据库约束双保险）。
-- NULL 不受唯一约束影响（正常订单 rebook_of 为 NULL）。历史数据如存在同一原单多次改签，
-- 迁移会在该库失败——需先人工处理历史脏数据，迁移只增不改。
ALTER TABLE orders ADD UNIQUE KEY uk_orders_rebook_of (rebook_of);
