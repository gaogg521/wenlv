-- V18__attest_integrity.sql
-- 存证完整性改造（2026-10-26）
-- 1) 事件表：多版本锚点（同一业务对象随状态演进可多次锚定）+ inclusion proof + 规范化原文
-- 2) 批次表：seq / prev_root 形成"存证链"（防整批替换）+ 上链重试状态
-- 3) 新增 bean_day_root：旅豆账本日终 Merkle 根（借贷恒等，D6 原文要求）
-- 4) 触发器：已锚定的存证记录不可回改、不可回退
-- 说明：本迁移只增不改业务字段；老数据由 V18 之后的 backfill 语句补齐 seq/prev_root

-- ---------- 1) 事件表 ----------
ALTER TABLE attest_event
  ADD COLUMN version_no INT  NOT NULL DEFAULT 1 AFTER biz_ref,
  ADD COLUMN leaf_index INT  NULL AFTER payload_hash,
  ADD COLUMN leaf_path  JSON NULL COMMENT 'inclusion proof: [{"h":"..","p":"L|R","dup":false}]' AFTER leaf_index,
  ADD COLUMN canonical  JSON NULL COMMENT '规范化白名单字段，不含 PII' AFTER leaf_path,
  DROP INDEX uk_biz,
  ADD UNIQUE KEY uk_biz_ver (biz_type, biz_ref, version_no),
  ADD UNIQUE KEY uk_batch_leaf (batch_id, leaf_index);

-- ---------- 2) 批次表 ----------
ALTER TABLE attest_batch
  ADD COLUMN seq          BIGINT       NOT NULL DEFAULT 0 AFTER id,
  ADD COLUMN prev_root    CHAR(64)     NULL COMMENT '上一批 Merkle 根，形成存证链' AFTER merkle_root,
  ADD COLUMN attempt      TINYINT      NOT NULL DEFAULT 0 AFTER chain_block,
  ADD COLUMN last_err     VARCHAR(255) NULL AFTER attempt,
  ADD COLUMN is_day_close TINYINT      NOT NULL DEFAULT 0 COMMENT '1=旅豆账本日终根批次' AFTER last_err,
  ADD COLUMN merkle_kind  VARCHAR(16)  NOT NULL DEFAULT 'mixed' AFTER is_day_close,
  ADD KEY idx_seq (seq),
  ADD KEY idx_status (status);

-- 老批次补 seq（按 id 升序），prev_root 保持 NULL 表示"链起点"
UPDATE attest_batch b
  JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM attest_batch) t ON t.id = b.id
   SET b.seq = t.rn
 WHERE b.seq = 0;

-- 老批次若被写成"已上链"但其实是 NOOP，降级为"已打包待锚定"（status=1），语义纠偏
UPDATE attest_batch
   SET status = 1, chain_tx_ref = NULL, chain_block = NULL, anchored_at = NULL
 WHERE status = 2 AND (chain_tx_ref IS NULL OR chain_tx_ref LIKE 'NOOP%');

UPDATE attest_event e
  JOIN attest_batch b ON b.id = e.batch_id
   SET e.status = 1
 WHERE e.status = 2 AND b.status = 1;

-- ---------- 3) 旅豆账本日终根 ----------
CREATE TABLE IF NOT EXISTS bean_day_root (
  biz_date    DATE          NOT NULL,
  leaf_count  INT           NOT NULL,
  debit_sum   BIGINT        NOT NULL COMMENT 'Σ借（抵扣/过期/风控回收）',
  credit_sum  BIGINT        NOT NULL COMMENT 'Σ贷（消费返豆/任务/内容奖励）',
  merkle_root CHAR(64)      NOT NULL,
  prev_root   CHAR(64)      NULL,
  batch_id    BIGINT UNSIGNED NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (biz_date),
  KEY idx_batch (batch_id)
) ENGINE=InnoDB COMMENT='旅豆账本日终根（借贷恒等 + 链式前根，严禁超发的外部证明）';

-- ---------- 4) 不可回改触发器 ----------
DROP TRIGGER IF EXISTS trg_attest_event_guard;
CREATE TRIGGER trg_attest_event_guard BEFORE UPDATE ON attest_event FOR EACH ROW
BEGIN
  IF NEW.biz_type <> OLD.biz_type
     OR NEW.biz_ref <> OLD.biz_ref
     OR NEW.version_no <> OLD.version_no
     OR NEW.payload_hash <> OLD.payload_hash THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'attest_event 身份字段不可修改';
  END IF;
  IF OLD.status = 2 AND NEW.status < 2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'attest_event 已锚定，不可回退';
  END IF;
  IF OLD.batch_id IS NOT NULL AND NEW.batch_id IS NOT NULL AND NEW.batch_id <> OLD.batch_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'attest_event 已入批，不可改批';
  END IF;
END;

DROP TRIGGER IF EXISTS trg_attest_batch_guard;
CREATE TRIGGER trg_attest_batch_guard BEFORE UPDATE ON attest_batch FOR EACH ROW
BEGIN
  IF OLD.status = 2 AND NEW.merkle_root <> OLD.merkle_root THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '已锚定批次的 Merkle 根不可修改';
  END IF;
END;
