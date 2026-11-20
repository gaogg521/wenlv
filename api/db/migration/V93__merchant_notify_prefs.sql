-- V93（M-02/M-04/M-06）：商户到单提醒——员工级提醒偏好默认开 + notify_log 记收件人角色 + 店员加入时间。
-- 微信订阅消息无法静默开启，「默认开」= 员工级偏好默认开 + 应用内轮询兜底（M-02 三层里的第一层）。
-- 偏好列三态：NULL=未设置（按岗位默认：老板/店长开、核销员关，发送与读取时解析）；
-- 0=明确关；1=明确开。这样任何时点直接 INSERT 的员工行（种子/夹具）都天然带岗位默认，无需回填新行。

ALTER TABLE merchant_staff
  ADD COLUMN notify_new_order        TINYINT     NULL DEFAULT NULL COMMENT '新订单提醒 NULL=按岗位默认 0关 1开',
  ADD COLUMN notify_refund_apply     TINYINT     NULL DEFAULT NULL COMMENT '退款申请提醒 NULL=按岗位默认 0关 1开',
  ADD COLUMN notify_settlement_pending TINYINT   NULL DEFAULT NULL COMMENT '结算待确认提醒 NULL=按岗位默认 0关 1开',
  ADD COLUMN notify_onboarded        TINYINT     NOT NULL DEFAULT 0 COMMENT '工作台首次提醒引导已确认 0否 1是',
  ADD COLUMN created_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '加入门店时间（M-06；历史行回填自账号创建时间）';

-- 回填现有员工（M-02-1）：老板/店长三项置 1（显式开），核销员置 0（默认关）
UPDATE merchant_staff SET notify_new_order = 1, notify_refund_apply = 1, notify_settlement_pending = 1 WHERE role >= 2;
UPDATE merchant_staff SET notify_new_order = 0, notify_refund_apply = 0, notify_settlement_pending = 0 WHERE role = 1;

-- 店员加入时间：历史行没有记录，用账号创建时间近似回填（新员工由 INSERT 默认值记录真实加入时刻）
UPDATE merchant_staff s JOIN user_account u ON u.id = s.user_id SET s.created_at = u.created_at;

-- M-04：notify_log 记录收件人（商户侧）岗位与用户 id，后台查看可区分老板/店长/核销员
ALTER TABLE notify_log
  ADD COLUMN recipient_user_id BIGINT UNSIGNED NULL COMMENT '收件人 user_account.id（target=merchant 时）',
  ADD COLUMN recipient_role    TINYINT         NULL COMMENT '收件人岗位 1核销员 2店长 3老板（target=merchant 时）';
