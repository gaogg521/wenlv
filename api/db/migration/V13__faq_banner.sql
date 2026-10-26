-- V13: 低垂果实 —— 常见问题管理 + 轮播媒体管理（小程序内容运营位）
CREATE TABLE faq (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question   VARCHAR(128) NOT NULL,
  answer     VARCHAR(1024) NOT NULL,
  sort       INT NOT NULL DEFAULT 0,
  status     TINYINT NOT NULL DEFAULT 1 COMMENT '1上架 0下架',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB COMMENT='常见问题';

CREATE TABLE banner (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(64)  NOT NULL,
  image      VARCHAR(512) NOT NULL,
  link       VARCHAR(256) NULL COMMENT '跳转路径（如 /package-tour/pages/detail/index?id=1）',
  sort       INT NOT NULL DEFAULT 0,
  status     TINYINT NOT NULL DEFAULT 1 COMMENT '1上架 0下架',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB COMMENT='轮播媒体';

INSERT INTO faq (question, answer, sort) VALUES
('旅豆是什么？', '旅豆是消费与活动的积分奖励，100 豆=10 元，下单可抵扣最多 10%，核销完成 24 小时后到账。', 1),
('核销码怎么用？', '入园时向商户出示「我的-订单」里的 6 位动态码或二维码，每 60 秒自动轮换，一码一次有效。', 2),
('退款规则是什么？', '出发前 7 天免费退；3-7 天收 10%；72 小时内收 30%；出发后不退。拼团未成团自动全额退款。', 3);
