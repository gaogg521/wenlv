-- V59（QA-01/QA-02）：改期申请身份不可变 + 执行幂等。
-- QA-01：申请人/审批人原来只存 'admin:显示名' 快照（可变），同一账号改显示名后可自批。
--        新增 applicant_uid / approver_uid 存不可变账号 ID；名字列保留为展示快照。
--        存量行 uid 为 NULL → 回退名字比较；申请已记录 UID 而请求令牌无 uid → fail-closed 拒绝。
-- QA-02：执行并发重复扣库存——修在代码层（事务内锁申请行 + 状态条件更新校验影响行数），
--        迁移只补身份列。
ALTER TABLE order_reschedule
  ADD COLUMN applicant_uid INT NULL COMMENT '申请人账号UID（不可变身份）' AFTER applicant,
  ADD COLUMN approver_uid  INT NULL COMMENT '审批人账号UID（不可变身份）' AFTER approver;

-- 存量行按用户名回填 UID（admin_user.username 与 'admin:'+显示名 无必然对应，回填按
-- applicant = 'admin:' + display_name 或 username 匹配；匹配不上的保持 NULL 走名字回退）
UPDATE order_reschedule r
JOIN admin_user u ON r.applicant_uid IS NULL AND r.applicant = CONCAT('admin:', u.display_name)
SET r.applicant_uid = u.id;
UPDATE order_reschedule r
JOIN admin_user u ON r.applicant_uid IS NULL AND r.applicant = CONCAT('admin:', u.username)
SET r.applicant_uid = u.id;
UPDATE order_reschedule r
JOIN admin_user u ON r.approver_uid IS NULL AND r.approver = CONCAT('admin:', u.display_name)
SET r.approver_uid = u.id;
UPDATE order_reschedule r
JOIN admin_user u ON r.approver_uid IS NULL AND r.approver = CONCAT('admin:', u.username)
SET r.approver_uid = u.id;
