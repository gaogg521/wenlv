-- V27 实体扩展资料：各实体增加 profile JSON 列，承载表单引擎（domain/entity-schema.mjs）中 store=profile 的字段
-- 核心业务字段仍在原列；profile 只放扩展资料（图集、证照、联系人、行程节点等），新增字段不再需要迁移
ALTER TABLE tour_product ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
ALTER TABLE tour_session ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
ALTER TABLE merchant     ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
ALTER TABLE scenic_spot  ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
ALTER TABLE supplier     ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
ALTER TABLE faq          ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
ALTER TABLE banner       ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
ALTER TABLE badge        ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
ALTER TABLE promoter     ADD COLUMN profile JSON NULL COMMENT '扩展资料（表单引擎）';
-- FAQ 答案改为富文本，原 VARCHAR/TEXT 可能不够长
ALTER TABLE faq MODIFY COLUMN answer MEDIUMTEXT NOT NULL;
