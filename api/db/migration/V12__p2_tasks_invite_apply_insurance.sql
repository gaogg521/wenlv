-- V12: P2 八项 —— 约稿任务四态机 / 商户邀请码 / 商户进件自助 / 出行保险挂载
-- 1) 约稿任务（demo 规格四态：待领取→进行中→审核中→已完成）
CREATE TABLE content_task (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_no      VARCHAR(32)  NOT NULL,
  title        VARCHAR(64)  NOT NULL,
  brief        VARCHAR(512) NOT NULL,
  reward_beans INT          NOT NULL DEFAULT 200,
  status       TINYINT      NOT NULL DEFAULT 0 COMMENT '0待领取 1进行中 2审核中 3已完成 4已下线',
  claimed_by   BIGINT UNSIGNED NULL,
  note_id      BIGINT UNSIGNED NULL,
  created_by   BIGINT UNSIGNED NULL COMMENT '后台操作员',
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  claimed_at   DATETIME(3)  NULL,
  submitted_at DATETIME(3)  NULL,
  finished_at  DATETIME(3)  NULL,
  UNIQUE KEY uk_task_no (task_no)
) ENGINE=InnoDB COMMENT='约稿任务（四态机）';

-- 2) 商户店员邀请码（老板/店长生成，店员凭码绑定）
ALTER TABLE merchant
  ADD COLUMN invite_code VARCHAR(12) NULL,
  ADD UNIQUE KEY uk_invite (invite_code);

-- 3) 商户进件自助化：申请联系信息（status 0=进件中 已有口径，审核通过置 1）
ALTER TABLE merchant
  ADD COLUMN apply_contact VARCHAR(64)  NULL COMMENT '申请人',
  ADD COLUMN apply_mobile  VARCHAR(24)  NULL COMMENT '联系电话（申请时明文，审核通过后由后台接管）',
  ADD COLUMN apply_note    VARCHAR(256) NULL COMMENT '门店/资质说明',
  ADD COLUMN approved_at   DATETIME(3)  NULL;

-- 4) 出行保险挂载：产品级保费（分/人，0=未挂载），订单级实收保费；保费平台代收直付保险公司，不入商户结算与佣金基数
ALTER TABLE tour_product
  ADD COLUMN insurance_note VARCHAR(256) NULL COMMENT '保险方案说明',
  ADD COLUMN insurance_fee  BIGINT      NOT NULL DEFAULT 0 COMMENT '保费（分/人），0=未挂载';
ALTER TABLE orders
  ADD COLUMN insurance_fee BIGINT NOT NULL DEFAULT 0 COMMENT '实收保费（分），已含在 amount_pay 内';
