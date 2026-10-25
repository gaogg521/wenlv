-- V8: 商品素材与评价体系（P0 宣传力补齐）
-- 1) 商品：图集 + 集合点 + 安全告知（rich_desc JSON 沿用：intro/includes/highlights）
ALTER TABLE tour_product
  ADD COLUMN images JSON NULL COMMENT '图集（首图=封面；/uploads 路径或外链）',
  ADD COLUMN meeting_point VARCHAR(255) NULL COMMENT '集合地点/交通',
  ADD COLUMN safety_note VARCHAR(512) NULL COMMENT '安全告知';

-- 2) 评价：核销完成（订单 50）后一单一评；机审前置；可隐藏
CREATE TABLE review (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id     BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  product_id   BIGINT UNSIGNED NOT NULL,
  rating       TINYINT NOT NULL,
  content      VARCHAR(500) NOT NULL,
  status       TINYINT NOT NULL DEFAULT 1 COMMENT '1展示 0隐藏',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_order (order_id),
  KEY idx_product (product_id, status),
  CONSTRAINT chk_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB COMMENT='线路评价（一单一评 · 文本机审）';
