-- V20__asset_issue.sql
-- 链上资产发行台账（数字徽章 / 纪念票 / 藏品）
--
-- 三个硬约束（代码里还有第二道闸）：
--   1. channel='wechat' 一律禁止（D10：微信生态内永久不做藏品发行/交易/转赠）
--   2. provider 必须声明 capabilities.assets=true 才允许发行；不支持就明确报错，不许"假装发了"
--   3. NOOP / 未配置凭据时 status=0（待发行），**绝不写假 tx_ref**
CREATE TABLE IF NOT EXISTS asset_issue (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind        VARCHAR(24)  NOT NULL,          -- badge=数字徽章 / pass_nft=权益凭证NFT / collectible=藏品
  channel     VARCHAR(24)  NOT NULL,          -- ecosystem / antchain_collectible / evm / wechat(禁止)
  provider    VARCHAR(24)  NOT NULL,          -- chaingen / tbaas / antchain / evm / noop
  user_id     BIGINT UNSIGNED NOT NULL,
  token_id    VARCHAR(64)  NULL,              -- 链上 tokenId / 藏品编号
  contract    VARCHAR(96)  NULL,              -- 合约地址或集合 ID
  tx_ref      VARCHAR(128) NULL,              -- 链上交易号；未发行时为空
  status      TINYINT      NOT NULL DEFAULT 0,-- 0待发行 1已发行 2失败 3人工
  meta        JSON         NULL,              -- 名称/图案/权益说明（不含 PII）
  err         VARCHAR(255) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  issued_at   DATETIME(3)  NULL,
  UNIQUE KEY uk_kind_user_item (kind, user_id, token_id),
  KEY idx_status (status, provider),
  KEY idx_user (user_id, created_at),
  CONSTRAINT chk_channel CHECK (channel <> 'wechat')
) ENGINE=InnoDB COMMENT='链上资产发行台账（微信渠道在库层也被禁）';
