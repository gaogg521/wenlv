-- A-36（全量检查 20261106）：商户入驻可驳回
-- apply_reject_note：驳回原因，小程序端"我的申请"与重新申请前可见；status=2 为驳回态（0 进件中 1 生效 2 已驳回）
ALTER TABLE merchant ADD COLUMN apply_reject_note VARCHAR(200) NULL AFTER apply_note;
