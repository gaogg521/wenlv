-- V29 批次记录提交到哪条链：切换"当前链"后，已提交待确认的旧批次仍去原链核验，避免跨链误确认
ALTER TABLE attest_batch ADD COLUMN chain_provider VARCHAR(16) NULL COMMENT '提交时的链适配器 id' AFTER chain_tx_ref;
