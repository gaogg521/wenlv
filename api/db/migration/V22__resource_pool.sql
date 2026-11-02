-- V22: 资源池 —— 景区资源库 + 供应商库 + 商户类目化 + 商品关联资源
-- 背景：4 角色模型（游客/商户/合伙人/平台）中供给侧资源模型未展开；
--       景区信息散落在商品标题、供应商与商户无法区分（商户=收付通履约核销方，保持不变）。

CREATE TABLE scenic_spot (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  city_code        VARCHAR(8)  NOT NULL,
  name             VARCHAR(128) NOT NULL,
  scenic_level     VARCHAR(8)  NOT NULL DEFAULT '' COMMENT '5A/4A/3A/非A',
  coop_mode        VARCHAR(24) NOT NULL DEFAULT '' COMMENT '票务分成/联合运营/引流合作',
  ticket_interface VARCHAR(64) NULL COMMENT '票务对接方式（如：二维码核销直连）',
  contact_name     VARCHAR(64) NULL,
  contact_phone    VARCHAR(32) NULL,
  profit_terms     VARCHAR(255) NULL COMMENT '分成/合作条款摘要',
  status           TINYINT NOT NULL DEFAULT 1 COMMENT '1合作中 0暂缓 2清退',
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_city (city_code, status)
) ENGINE=InnoDB COMMENT='景区资源库（G端合作台账）';

CREATE TABLE supplier (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  city_code     VARCHAR(8)  NOT NULL,
  name          VARCHAR(128) NOT NULL,
  category      VARCHAR(16) NOT NULL DEFAULT 'other' COMMENT 'ticket门票/hotel住宿/transport交通/ground地接/catering餐饮/other其他',
  license_no    VARCHAR(64) NULL COMMENT '资质证照号',
  contact_name  VARCHAR(64) NULL,
  contact_phone VARCHAR(32) NULL,
  settle_mode   VARCHAR(16) NOT NULL DEFAULT 'monthly' COMMENT 'monthly月结/per_order单结/prepaid预付',
  status        TINYINT NOT NULL DEFAULT 1 COMMENT '1合作中 0暂缓 2清退',
  note          VARCHAR(255) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_city (city_code, status)
) ENGINE=InnoDB COMMENT='供应商资源库（资源供给方，独立于履约商户）';

ALTER TABLE merchant
  ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'other'
  COMMENT 'catering餐饮/hotel住宿/ticket门票/transport交通/experience体验/other其他' AFTER name;

ALTER TABLE tour_product
  ADD COLUMN supplier_id BIGINT UNSIGNED NULL COMMENT '关联供应商' AFTER merchant_id,
  ADD COLUMN scenic_id   BIGINT UNSIGNED NULL COMMENT '关联景区' AFTER supplier_id;
