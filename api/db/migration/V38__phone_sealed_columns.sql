-- V38：商户申请电话、订单联系电话改存密文（AES-256-GCM，与 user_account.mobile_enc 同一套密钥体系）
-- 只新增列、旧列保留：新写入只进新列（旧列置 NULL）；历史明文由 scripts/encrypt-mobiles.mjs 搬到新列后清空旧列。
-- 新列"非空即密文"，secrets-key.mjs 的 check / rotate 据此覆盖，不靠长度猜测。
ALTER TABLE merchant ADD COLUMN apply_mobile_enc VARBINARY(512) NULL COMMENT '申请联系电话密文（AES-256-GCM）；历史明文在 apply_mobile，加密脚本跑完后清空';
ALTER TABLE orders ADD COLUMN contact_phone_sealed VARBINARY(512) NULL COMMENT '订单联系电话密文（AES-256-GCM）；历史明文在 contact_phone_enc，加密脚本跑完后清空';
