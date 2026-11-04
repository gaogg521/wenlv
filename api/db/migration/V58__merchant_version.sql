-- V58（R-01 第二期）：商户实体加入乐观锁与版本簿。
-- updated_version 列就位后，实体引擎的版本钩子（entity-schema.save 对 updated_version != null 的表）
-- 自动覆盖商户编辑（名称/联系方式等关键资料变更入 master_data_version，快照敏感字段打码）。
ALTER TABLE merchant ADD COLUMN updated_version INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号（R-01 第二期）';
