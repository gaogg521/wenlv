-- V57（R-02）：订单改期 / 换团——申请 → 审批 → 执行，申请-审批分离、价差与旅豆抵扣显式化。
-- 资金边界（如实）：本表登记价差与旅豆抵扣并随执行调整订单台账金额；真实补款/退差走财务线下或
-- 既有退款流程登记，不在本流程虚构到账（台账总则：登记≠外部确认到账）。
-- 已核销(40)/退款中(60)/已退款(70)/已完成(50) 不走普通改期（仅 20 已支付 / 30 已确认）。
-- active_one 生成列 + 唯一键：同一订单同时仅一条在途申请（待审批/待执行）。
CREATE TABLE IF NOT EXISTS order_reschedule (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  req_no          VARCHAR(44) NOT NULL COMMENT '业务号 RS+日期+随机，幂等',
  order_id        BIGINT UNSIGNED NOT NULL,
  order_no        VARCHAR(32) NOT NULL,
  from_session_id BIGINT UNSIGNED NOT NULL,
  to_session_id   BIGINT UNSIGNED NOT NULL,
  qty             INT NOT NULL,
  price_diff      INT NOT NULL DEFAULT 0 COMMENT '价差合计（分，正=游客需补款，负=平台应退差）',
  diff_bean       INT NOT NULL DEFAULT 0 COMMENT '游客用旅豆抵扣的补款部分（分）',
  status          TINYINT NOT NULL DEFAULT 0 COMMENT '0待审批 1待执行 2已驳回 3已执行 4已撤回 5执行失败',
  reason          VARCHAR(300) NOT NULL,
  applicant       VARCHAR(64) NOT NULL,
  approver        VARCHAR(64) NULL,
  approve_note    VARCHAR(300) NULL,
  executed_at     DATETIME(3) NULL,
  exec_note       VARCHAR(300) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  active_one      TINYINT GENERATED ALWAYS AS (IF(status IN (0, 1), 1, NULL)) STORED
    COMMENT '在途标记：待审批/待执行=1，终态=NULL（配合唯一键：同一订单同时仅一条在途申请）',
  UNIQUE KEY uk_req_no (req_no),
  UNIQUE KEY uk_order_active (order_id, active_one),
  KEY idx_order (order_id)
) ENGINE=InnoDB COMMENT='订单改期/换团（R-02）';
