ALTER TABLE promoter_withdraw
 ADD COLUMN payout_tail VARCHAR(8) NULL,
 ADD COLUMN payout_method VARCHAR(16) NULL;
ALTER TABLE co_profit
 ADD COLUMN share_bp INT NULL COMMENT '生成时比例快照；历史不反推填充',
 ADD COLUMN rule_snapshot JSON NULL;
