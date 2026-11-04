-- V45: 订单服务端全量检索（GLM 交接 T03 / 批次 C）
-- 后台订单列表从"最近 100 条 + 本地筛选"改为服务端参数化检索 + 分页；
-- 增补城市×状态×id 复合索引与创建时间索引，支撑老单精确命中与状态计数聚合。
ALTER TABLE orders
  ADD KEY idx_city_status_id (city_code, status, id),
  ADD KEY idx_created_at (created_at);
