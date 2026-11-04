-- 上链内容原样落库（方案 §7.6：上链的只有 哈希指纹 + 时间戳 + 主体标识 + 签名）
--
-- 为什么必须存原串：
--   v2 内容里带"提交时刻的毫秒时间戳"和"平台签名"，确认阶段重算不可能复现同一毫秒，
--   所以提交时把最终 content 原样存下来，确认时与链上读回逐字比对。
--   不回退去重算 —— 重算出来的东西和链上不是同一串，比对就没意义了。
ALTER TABLE attest_batch
  ADD COLUMN chain_content VARCHAR(2048) NULL COMMENT '上链原文（v2 含主体标识/时间戳/签名），用于回查逐字比对' AFTER chain_tx_ref,
  ADD COLUMN chain_ts_ms BIGINT NULL COMMENT '提交时刻毫秒时间戳（上链原文里那个）' AFTER chain_content;
