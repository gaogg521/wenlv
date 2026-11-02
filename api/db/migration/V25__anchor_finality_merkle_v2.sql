-- V25 存证内核加固
-- 1) merkle_version：新批次使用 v2（RFC 6962 域隔离 + 奇数提升），历史批次保持 v1 只读验证
-- 2) status=5「已提交·待确认」：txHash 只代表已广播，回执成功 + 确认数达标 + 交易内容等于根之后才置 2
ALTER TABLE attest_batch
  ADD COLUMN merkle_version TINYINT     NOT NULL DEFAULT 1 COMMENT '1=历史算法 2=RFC6962 域隔离' AFTER merkle_kind,
  ADD COLUMN submitted_at   DATETIME(3) NULL COMMENT '提交上链时间（status=5 起算）' AFTER anchored_at,
  ADD COLUMN confirmations  INT         NULL COMMENT '最近一次核验时的确认数' AFTER submitted_at;

-- 历史批次的算法版本不可修改（否则旧 proof 会被按新算法误判）
DROP TRIGGER IF EXISTS trg_attest_batch_guard;
CREATE TRIGGER trg_attest_batch_guard BEFORE UPDATE ON attest_batch FOR EACH ROW
BEGIN
  IF OLD.status = 2 AND NEW.merkle_root <> OLD.merkle_root THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '已锚定批次的 Merkle 根不可修改';
  END IF;
  IF NEW.merkle_version <> OLD.merkle_version THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '批次 Merkle 算法版本不可修改';
  END IF;
  IF OLD.status = 2 AND NEW.status <> 2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '已锚定批次不可回退';
  END IF;
END;
