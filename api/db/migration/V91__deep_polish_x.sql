-- V91（三端深度打磨 X 系列）：
-- X-03 改价留痕与并发：tour_session 增乐观锁版本列——商户端与 PC 两条改价路径并发时，
--   后提交者得到明确冲突提示（2002），不再静默覆盖；两条路径的改价都写 master_data_version（kind=session）。
-- X-04 评价闭环：review 增商户回复列（reply/reply_at/reply_status），回复经平台审核后游客可见。
-- X-05 消息触达：订阅消息下发记录表——MOCK 与真实下发统一留痕，后台「消息下发记录」可查；
--   未配置模板记录 result=skipped，页面不报错。
ALTER TABLE tour_session
  ADD COLUMN version INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号（改价/调名额时校验 expectedVersion，X-03）';

ALTER TABLE review
  ADD COLUMN reply VARCHAR(500) NULL COMMENT '商户回复内容（X-04）',
  ADD COLUMN reply_at DATETIME(3) NULL COMMENT '回复时间',
  ADD COLUMN reply_status TINYINT NOT NULL DEFAULT 0 COMMENT '回复状态：0待审 1展示 2下架';

CREATE TABLE notify_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scene       VARCHAR(32)  NOT NULL COMMENT 'pay_ok/new_order/group_cancel/refund_apply/refund_done/depart_reminder/note_review/settlement_pending',
  target      VARCHAR(16)  NOT NULL COMMENT 'tourist/merchant',
  openid      VARCHAR(64)  NULL,
  template_id VARCHAR(64)  NULL,
  biz_ref     VARCHAR(64)  NULL COMMENT '订单号/结算单号/note-id 等',
  payload     JSON         NULL,
  mock        TINYINT      NOT NULL DEFAULT 0,
  result      VARCHAR(16)  NOT NULL COMMENT 'sent/mock/skipped/failed',
  error       VARCHAR(255) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_scene (scene, created_at),
  KEY idx_biz (biz_ref),
  KEY idx_dedupe (scene, biz_ref, openid)
) ENGINE=InnoDB COMMENT='订阅消息下发记录（X-05）';
