-- V56（R-01 第一期）：主数据关键变更版本化。
-- 价格/状态/归属是交易依据：改过必须可追溯、历史不可覆盖；快照记录"从什么变成什么、谁改的、为什么"。
-- 并发防护：tour_product 增 updated_version 乐观锁列——编辑请求带 expectedVersion 不匹配时拒绝（2002），
-- 防两人同时编辑互相覆盖（T09）。
-- 商户进件审核状态变化同样入版本（kind=merchant）。历史版本只增不改，回退=写一条新版本恢复旧值。
CREATE TABLE IF NOT EXISTS master_data_version (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind        VARCHAR(24)  NOT NULL COMMENT 'product/merchant',
  ref_id      BIGINT UNSIGNED NOT NULL,
  version_no  INT NOT NULL COMMENT '该对象第几次关键变更（从 1 起）',
  snapshot    JSON NOT NULL COMMENT '关键字段变更快照：before/after/changedFields',
  changed_by  VARCHAR(64)  NOT NULL,
  reason      VARCHAR(200) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_kind_ref_ver (kind, ref_id, version_no),
  KEY idx_ref (kind, ref_id)
) ENGINE=InnoDB COMMENT='主数据关键变更版本（R-01）';

ALTER TABLE tour_product ADD COLUMN updated_version INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号（编辑时校验 expectedVersion）';
