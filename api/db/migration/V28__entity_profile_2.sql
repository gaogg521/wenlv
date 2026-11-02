-- V28 表单引擎第二批：旅豆预算、共创人、约稿任务增加扩展资料列
-- （暗号与逐品佣金作用于 tour_product，复用 V27 已加的 profile 列）
ALTER TABLE bean_budget  ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
ALTER TABLE co_creator   ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
ALTER TABLE content_task ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
