-- =====================================================================
-- 「向往的自由」V1__init_schema.sql  (MySQL 8.0 / InnoDB / utf8mb4)
-- 依据：《项目总方案（定稿·完整版）V3.1》§6 —— 38 张核心表
-- 约定：金额 BIGINT 分；比率基点；DATETIME(3)；SM4 加密 VARBINARY + HMAC 检索列；
--       CHECK 约束（8.0.16+ 强制）；乐观锁 version；Flyway 只增不破坏。
-- =====================================================================

-- ===== 身份与会员 =====
CREATE TABLE user_account (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  unionid       VARCHAR(64)  NULL,
  mini_a_openid VARCHAR(64)  NULL,
  mini_b_openid VARCHAR(64)  NULL,
  mobile_enc    VARBINARY(512) NULL,
  mobile_hmac   CHAR(64)     NULL,
  nickname      VARCHAR(64)  NULL,
  avatar_url    VARCHAR(256) NULL,
  member_level  TINYINT      NOT NULL DEFAULT 1,
  growth_value  BIGINT       NOT NULL DEFAULT 0,
  did_ref       VARCHAR(128) NULL,
  status        TINYINT      NOT NULL DEFAULT 1,
  risk_flag     TINYINT      NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version       INT          NOT NULL DEFAULT 0,
  UNIQUE KEY uk_unionid (unionid),
  UNIQUE KEY uk_a_openid (mini_a_openid),
  UNIQUE KEY uk_b_openid (mini_b_openid),
  UNIQUE KEY uk_mobile_hmac (mobile_hmac),
  KEY idx_level (member_level, status)
) ENGINE=InnoDB COMMENT='用户主档（unionid 打通主题矩阵）';

CREATE TABLE user_privacy_consent (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  scene      VARCHAR(32) NOT NULL,
  granted    TINYINT(1)  NOT NULL,
  granted_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  UNIQUE KEY uk_user_scene (user_id, scene)
) ENGINE=InnoDB COMMENT='隐私授权（逐项可撤回）';

CREATE TABLE user_growth_log (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  delta      BIGINT       NOT NULL,
  biz_type   TINYINT      NOT NULL COMMENT '1核销订单 2CS月结 3退款扣回 4年度滚降',
  biz_ref    VARCHAR(48)  NULL,
  after_val  BIGINT       NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_user (user_id, created_at)
) ENGINE=InnoDB COMMENT='会员成长值流水';

-- ===== 商户与商品 =====
CREATE TABLE merchant (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  city_code       VARCHAR(8)   NOT NULL,
  name            VARCHAR(128) NOT NULL,
  merchant_no     VARCHAR(24)  NOT NULL,
  wxpay_sub_mchid VARCHAR(32)  NULL,
  biz_license     VARCHAR(64)  NULL,
  status          TINYINT      NOT NULL DEFAULT 0 COMMENT '0进件中 1生效 2暂停 3清退',
  score           DECIMAL(3,1) NOT NULL DEFAULT 5.0,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_mno (merchant_no),
  KEY idx_city (city_code, status)
) ENGINE=InnoDB COMMENT='商户主档';

CREATE TABLE merchant_staff (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  role        TINYINT NOT NULL COMMENT '1核销员 2店长 3老板',
  status      TINYINT NOT NULL DEFAULT 1,
  UNIQUE KEY uk_merch_user (merchant_id, user_id)
) ENGINE=InnoDB COMMENT='商户店员';

CREATE TABLE tour_product (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  channel      VARCHAR(24)  NOT NULL DEFAULT 'main',
  city_code    VARCHAR(8)   NOT NULL,
  cat          VARCHAR(24)  NOT NULL,
  title        VARCHAR(128) NOT NULL,
  subtitle     VARCHAR(256) NULL,
  days_desc    VARCHAR(32)  NULL,
  price_from   BIGINT       NOT NULL,
  bean_gift    INT          NOT NULL DEFAULT 0,
  merchant_id  BIGINT UNSIGNED NOT NULL,
  license_type TINYINT      NOT NULL DEFAULT 1 COMMENT '1自营(旅行社子公司) 2合作代销 3单票代理',
  contract_ref VARCHAR(64)  NULL,
  status       TINYINT      NOT NULL DEFAULT 0 COMMENT '0草稿 1上架 2下架',
  rich_desc    JSON NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version      INT          NOT NULL DEFAULT 0,
  KEY idx_chan_city_cat (channel, city_code, cat, status)
) ENGINE=InnoDB COMMENT='主题游商品';

CREATE TABLE tour_session (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id  BIGINT UNSIGNED NOT NULL,
  depart_date DATE    NOT NULL,
  quota       INT     NOT NULL,
  booked      INT     NOT NULL DEFAULT 0,
  min_go      INT     NOT NULL DEFAULT 10,
  price_adult BIGINT  NOT NULL,
  status      TINYINT NOT NULL DEFAULT 1 COMMENT '1报名中 2已成团 3停售 4已发团',
  UNIQUE KEY uk_prod_date (product_id, depart_date),
  CONSTRAINT chk_quota CHECK (booked >= 0 AND booked <= quota)
) ENGINE=InnoDB COMMENT='团期';

-- ===== 订单、支付、退款 =====
CREATE TABLE orders (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_no          VARCHAR(32)  NOT NULL,
  channel           VARCHAR(24)  NOT NULL DEFAULT 'main',
  user_id           BIGINT UNSIGNED NOT NULL,
  product_id        BIGINT UNSIGNED NOT NULL,
  session_id        BIGINT UNSIGNED NOT NULL,
  city_code         VARCHAR(8)   NOT NULL,
  merchant_id       BIGINT UNSIGNED NOT NULL,
  qty               INT          NOT NULL,
  amount_goods      BIGINT       NOT NULL,
  amount_bean_ded   BIGINT       NOT NULL DEFAULT 0,
  bean_deducted     INT          NOT NULL DEFAULT 0,
  amount_pay        BIGINT       NOT NULL,
  status            TINYINT      NOT NULL DEFAULT 10 COMMENT '10待支付 20已支付 30已确认 40已核销 50已完成 60退款中 70已退款 90关闭',
  contact_name      VARCHAR(64)  NULL,
  contact_phone_enc VARBINARY(512) NULL,
  promo_scene       VARCHAR(32)  NULL,
  payer_user_id     BIGINT UNSIGNED NULL,
  refund_deadline   DATETIME(3)  NULL,
  paid_at           DATETIME(3)  NULL,
  completed_at      DATETIME(3)  NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version           INT          NOT NULL DEFAULT 0,
  UNIQUE KEY uk_order_no (order_no),
  KEY idx_user (user_id, status),
  KEY idx_merch (merchant_id, status),
  KEY idx_deadline (status, refund_deadline)
) ENGINE=InnoDB COMMENT='订单主表（三端同源读写）';

CREATE TABLE order_traveler (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id   BIGINT UNSIGNED NOT NULL,
  name       VARCHAR(64)    NOT NULL,
  id_type    TINYINT        NOT NULL DEFAULT 1,
  id_no_enc  VARBINARY(512) NOT NULL,
  id_no_hmac CHAR(64)       NOT NULL,
  phone_enc  VARBINARY(512) NULL,
  UNIQUE KEY uk_order_idno (order_id, id_no_hmac)
) ENGINE=InnoDB COMMENT='出行人（SM4）';

CREATE TABLE order_event (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id   BIGINT UNSIGNED NOT NULL,
  from_st    TINYINT NOT NULL,
  to_st      TINYINT NOT NULL,
  actor      VARCHAR(32) NOT NULL,
  detail     JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_order (order_id, id)
) ENGINE=InnoDB COMMENT='状态机审计流';

CREATE TABLE payment (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id     BIGINT UNSIGNED NOT NULL,
  wx_trans_no  VARCHAR(64) NULL,
  amount       BIGINT      NOT NULL,
  status       TINYINT     NOT NULL DEFAULT 0 COMMENT '0待支付 1成功 2关闭 3退款中 4已退款',
  callback_at  DATETIME(3) NULL,
  raw_notify   JSON NULL,
  UNIQUE KEY uk_order (order_id),
  UNIQUE KEY uk_trans (wx_trans_no)
) ENGINE=InnoDB COMMENT='支付单（电商收付通）';

CREATE TABLE refunds (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id   BIGINT UNSIGNED NOT NULL,
  refund_no  VARCHAR(32) NOT NULL,
  amount     BIGINT      NOT NULL,
  reason     VARCHAR(256) NULL,
  status     TINYINT     NOT NULL DEFAULT 0 COMMENT '0申请 1处理中 2成功 3拒绝',
  operator   VARCHAR(32) NULL,
  settled_at DATETIME(3) NULL,
  UNIQUE KEY uk_refund_no (refund_no),
  KEY idx_order (order_id)
) ENGINE=InnoDB COMMENT='退款单';

-- ===== 权益与核销 =====
CREATE TABLE travel_pass (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  order_id     BIGINT UNSIGNED NULL,
  kind         TINYINT  NOT NULL COMMENT '1服务使用权 2数字成就 3电子纪念票',
  name         VARCHAR(128) NOT NULL,
  product_id   BIGINT UNSIGNED NULL,
  status       TINYINT  NOT NULL DEFAULT 1 COMMENT '1有效 2已核销 3过期 4冲正',
  valid_from   DATE NULL,
  valid_to     DATE NULL,
  issued_batch VARCHAR(32) NULL,
  serial_no    VARCHAR(24) NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_user (user_id, status),
  UNIQUE KEY uk_serial (serial_no)
) ENGINE=InnoDB COMMENT='Travel Pass 权益凭证';

CREATE TABLE pass_code (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pass_id     BIGINT UNSIGNED NOT NULL,
  window_no   BIGINT      NOT NULL,
  code_hash   CHAR(64)    NOT NULL,
  consumed_at DATETIME(3) NULL,
  consumed_by BIGINT UNSIGNED NULL,
  UNIQUE KEY uk_pass_window (pass_id, window_no)
) ENGINE=InnoDB COMMENT='动态核销码（唯一约束=防重放）';

CREATE TABLE verification_log (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pass_id       BIGINT UNSIGNED NOT NULL,
  merchant_id   BIGINT UNSIGNED NOT NULL,
  staff_id      BIGINT UNSIGNED NOT NULL,
  method        TINYINT  NOT NULL COMMENT '1扫码 2输码 3离线补登',
  offline_batch VARCHAR(32) NULL,
  result        TINYINT  NOT NULL COMMENT '1成功 2重复 3过期 4无效',
  city_code     VARCHAR(8) NOT NULL,
  device_fp     VARCHAR(64) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_merch (merchant_id, created_at),
  KEY idx_pass (pass_id)
) ENGINE=InnoDB COMMENT='核销流水';

-- ===== 旅豆双分录账本 =====
CREATE TABLE bean_account (
  id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id  BIGINT UNSIGNED NOT NULL,
  balance  BIGINT NOT NULL DEFAULT 0,
  lifetime BIGINT NOT NULL DEFAULT 0,
  version  INT    NOT NULL DEFAULT 0,
  UNIQUE KEY uk_user (user_id),
  CONSTRAINT chk_bal CHECK (balance >= 0)
) ENGINE=InnoDB COMMENT='旅豆账户（全局一本账；无冻结态——抵扣即真实扣减）';

CREATE TABLE bean_ledger (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tx_no      VARCHAR(32) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  direction  TINYINT NOT NULL COMMENT '1贷(增) 2借(减)',
  amount     BIGINT  NOT NULL,
  after_bal  BIGINT  NOT NULL,
  biz_type   TINYINT NOT NULL COMMENT '1消费返豆 2任务 3内容 4抵扣 5退款冲正 6过期 7风控',
  biz_ref    VARCHAR(48) NULL,
  budget_id  BIGINT UNSIGNED NULL,
  memo       VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_tx (tx_no, account_id, direction),
  KEY idx_acct (account_id, created_at),
  CONSTRAINT chk_amt CHECK (amount > 0)
) ENGINE=InnoDB COMMENT='旅豆双分录流水（Σ贷=Σ借 恒等）';

CREATE TABLE bean_budget (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(64) NOT NULL,
  total        BIGINT NOT NULL,
  granted      BIGINT NOT NULL DEFAULT 0,
  returned     BIGINT NOT NULL DEFAULT 0,
  biz_owner    VARCHAR(32) NOT NULL,
  status       TINYINT NOT NULL DEFAULT 0 COMMENT '0待批 1生效 2停用',
  approve_ref  VARCHAR(32) NULL,
  period_start DATE NULL,
  period_end   DATE NULL,
  CONSTRAINT chk_budget CHECK (granted <= total + returned)
) ENGINE=InnoDB COMMENT='旅豆批次预算池';

CREATE TABLE bean_global_cap (
  id          TINYINT PRIMARY KEY,
  cap_total   BIGINT   NOT NULL,
  issued_sum  BIGINT   NOT NULL DEFAULT 0,
  year        SMALLINT NOT NULL,
  CONSTRAINT chk_cap CHECK (issued_sum <= cap_total)
) ENGINE=InnoDB COMMENT='旅豆全局发行总量（单行表，严禁超发红线）';

-- ===== 推广与佣金 =====
CREATE TABLE promoter (
  user_id       BIGINT UNSIGNED PRIMARY KEY,
  tier          TINYINT    NOT NULL DEFAULT 1 COMMENT '1基础5% 2优选8% 3金牌12%',
  rate_bp       INT        NOT NULL DEFAULT 500,
  valid_gmv_90d BIGINT     NOT NULL DEFAULT 0,
  service_score DECIMAL(3,1) NOT NULL DEFAULT 5.0,
  status        TINYINT    NOT NULL DEFAULT 0 COMMENT '0申请中 1生效 2冻结',
  contract_ref  VARCHAR(32) NULL,
  CONSTRAINT chk_rate CHECK (rate_bp IN (500, 800, 1200))
) ENGINE=InnoDB COMMENT='推广服务商（一级 CPS，无层级字段）';

CREATE TABLE attribution (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  promoter_id BIGINT UNSIGNED NOT NULL,
  scene       VARCHAR(32) NOT NULL,
  channel     VARCHAR(24) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_scene (scene)
) ENGINE=InnoDB COMMENT='推广码归因源';

CREATE TABLE attribution_hit (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scene       VARCHAR(32) NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  hit_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_scene_user (scene, user_id)
) ENGINE=InnoDB COMMENT='归因命中（首触）';

CREATE TABLE commission (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id    BIGINT UNSIGNED NOT NULL,
  promoter_id BIGINT UNSIGNED NOT NULL,
  base_amount BIGINT      NOT NULL,
  rate_bp     INT         NOT NULL,
  amount      BIGINT      NOT NULL,
  status      TINYINT     NOT NULL DEFAULT 0 COMMENT '0观察期 1待结算 2已结算 3已冲正 4无效',
  payable_at  DATETIME(3) NULL,
  settle_id   BIGINT UNSIGNED NULL,
  UNIQUE KEY uk_order_promoter (order_id, promoter_id),
  KEY idx_payable (status, payable_at)
) ENGINE=InnoDB COMMENT='推广服务费（T+7）';

-- ===== 贡献分 =====
CREATE TABLE contribution_record (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  kind        TINYINT  NOT NULL COMMENT '1成交Q 2内容质量S 3留存R',
  biz_ref     VARCHAR(48) NOT NULL,
  score       DECIMAL(6,2) NOT NULL,
  cs          DECIMAL(6,2) NOT NULL,
  cheated     TINYINT  NOT NULL DEFAULT 0,
  verified_at DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_kind_ref (kind, biz_ref),
  KEY idx_user (user_id)
) ENGINE=InnoDB COMMENT='贡献分（权重走参数中心）';

-- ===== 结算（五口径恒等进 CHECK）=====
CREATE TABLE settlement (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id    BIGINT UNSIGNED NOT NULL,
  period         VARCHAR(12)  NOT NULL COMMENT '如 2026-10-W43',
  order_count    INT          NOT NULL,
  total_amount   BIGINT       NOT NULL,
  amt_fulfill    BIGINT       NOT NULL DEFAULT 0,
  amt_service    BIGINT       NOT NULL DEFAULT 0,
  amt_promoter   BIGINT       NOT NULL DEFAULT 0,
  amt_beanbudget BIGINT       NOT NULL DEFAULT 0,
  amt_retained   BIGINT       NOT NULL DEFAULT 0,
  status         TINYINT      NOT NULL DEFAULT 0 COMMENT '0生成 1商户确认 2分账执行 3完成 4异议中',
  attest_ref     VARCHAR(48)  NULL,
  UNIQUE KEY uk_merch_period (merchant_id, period),
  CONSTRAINT chk_identity CHECK (amt_fulfill + amt_service + amt_promoter
                                 + amt_beanbudget + amt_retained = total_amount)
) ENGINE=InnoDB COMMENT='商户周结算单（五口径恒等）';

CREATE TABLE settlement_dispute (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  settlement_id BIGINT UNSIGNED NOT NULL,
  kind          TINYINT      NOT NULL COMMENT '1核销次数不符 2单价不符',
  claim         JSON         NOT NULL,
  verdict       TINYINT      NOT NULL DEFAULT 0 COMMENT '0待处理 1平台口径核减 2接受商家主张',
  amount_diff   BIGINT       NOT NULL,
  handled_by    VARCHAR(32)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB COMMENT='对账差异/申诉单';

CREATE TABLE agreement_change (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  merchant_id BIGINT UNSIGNED NOT NULL,
  item_code   VARCHAR(24) NOT NULL,
  old_price   BIGINT NOT NULL,
  new_price   BIGINT NOT NULL,
  reason      VARCHAR(256) NULL,
  status      TINYINT NOT NULL DEFAULT 0 COMMENT '0待审批 1生效 2驳回',
  approved_by VARCHAR(32) NULL,
  approved_at DATETIME(3) NULL,
  effect      JSON NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB COMMENT='协议变更单';

-- ===== 内容与徽章 =====
CREATE TABLE content_note (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id            BIGINT UNSIGNED NOT NULL,
  channel            VARCHAR(24) NOT NULL DEFAULT 'main',
  title              VARCHAR(64) NULL,
  body               JSON NOT NULL,
  related_product_id BIGINT UNSIGNED NULL,
  status             TINYINT NOT NULL DEFAULT 0 COMMENT '0机审中 1人工审核 2已发布 3驳回 4下架',
  sec_check_id       VARCHAR(48) NULL,
  like_count         INT NOT NULL DEFAULT 0,
  published_at       DATETIME(3) NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_pub (channel, status, published_at)
) ENGINE=InnoDB COMMENT='旅行笔记';

CREATE TABLE badge (
  id         SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(32) NOT NULL,
  icon_key   VARCHAR(48) NOT NULL,
  rule_desc  VARCHAR(128) NOT NULL,
  rule_type  VARCHAR(24) NOT NULL,
  rule_param JSON NULL
) ENGINE=InnoDB COMMENT='徽章定义';

CREATE TABLE user_badge (
  user_id    BIGINT UNSIGNED NOT NULL,
  badge_id   SMALLINT UNSIGNED NOT NULL,
  granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ref        VARCHAR(48) NULL,
  PRIMARY KEY (user_id, badge_id)
) ENGINE=InnoDB COMMENT='用户徽章';

-- ===== 存证 / 幂等 / 风控 / 参数 / 审计 =====
CREATE TABLE attest_event (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  biz_type     VARCHAR(24) NOT NULL COMMENT 'order/bean_ledger/pass_issue/pass_verify/settlement',
  biz_ref      VARCHAR(48) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  status       TINYINT  NOT NULL DEFAULT 0 COMMENT '0待打包 1已打包 2已上链 3失败重试',
  batch_id     BIGINT UNSIGNED NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_biz (biz_type, biz_ref),
  KEY idx_status (status)
) ENGINE=InnoDB COMMENT='存证事件队列';

CREATE TABLE attest_batch (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  biz_date     DATE NOT NULL,
  merkle_root  CHAR(64) NOT NULL,
  leaf_count   INT NOT NULL,
  chain_tx_ref VARCHAR(96) NULL,
  chain_block  VARCHAR(48) NULL,
  anchored_at  DATETIME(3) NULL,
  status       TINYINT NOT NULL DEFAULT 0
) ENGINE=InnoDB COMMENT='存证锚定批次（小时级 Merkle 根）';

CREATE TABLE idempotency_key (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  idem_key   VARCHAR(80) NOT NULL,
  result     JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_key (idem_key)
) ENGINE=InnoDB COMMENT='幂等键（重放返回首次结果）';

CREATE TABLE risk_event (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NULL,
  merchant_id BIGINT UNSIGNED NULL,
  kind        VARCHAR(24) NOT NULL,
  severity    TINYINT NOT NULL,
  detail      JSON NULL,
  handled     TINYINT NOT NULL DEFAULT 0,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_handled (handled, severity)
) ENGINE=InnoDB COMMENT='风控事件';

CREATE TABLE rule_config (
  k               VARCHAR(48) PRIMARY KEY,
  v               JSON NOT NULL,
  group_name      VARCHAR(24) NOT NULL DEFAULT 'general',
  `sensitive`     TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '敏感参数强制双人复核（SENSITIVE 为 MySQL 保留字）',
  memo            VARCHAR(128) NULL,
  updated_by      VARCHAR(32) NULL,
  updated_version BIGINT      NOT NULL DEFAULT 0,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB COMMENT='参数中心（全部业务数字的落点，页面可改）';

CREATE TABLE config_history (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cfg_key      VARCHAR(48) NOT NULL,
  old_value    JSON NULL,
  new_value    JSON NOT NULL,
  proposer     VARCHAR(32) NOT NULL,
  approver     VARCHAR(32) NULL,
  status       TINYINT NOT NULL DEFAULT 0 COMMENT '0待审 1生效 2驳回 3回滚',
  reason       VARCHAR(256) NULL,
  effective_at DATETIME(3) NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_key (cfg_key, id)
) ENGINE=InnoDB COMMENT='参数变更历史（审批+版本+回滚）';

CREATE TABLE audit_log (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor      VARCHAR(32) NOT NULL,
  module     VARCHAR(24) NOT NULL,
  action     VARCHAR(32) NOT NULL,
  biz_ref    VARCHAR(48) NULL,
  before_val JSON NULL,
  after_val  JSON NULL,
  ip         VARCHAR(45) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_actor (actor, created_at)
) ENGINE=InnoDB COMMENT='操作审计（只增不改）';
