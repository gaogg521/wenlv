-- V54（C-04）：角色默认模块矩阵种子——与 src/domain/modules.mjs 的 ROLE_DEFAULT_MODULES 基线快照一致。
-- 来源：core.js 原前端 access 表的计算结果（§5.1 基线，开工 SHA 700f727）：
--   ops 23 / finance 14 / review 5 / risk 6 / city_partner 12 与现状零差异；
--   readonly/sre/dev 原缺省放行全菜单是缺陷，本迁移给出显式默认集合（D-01 决策）。
-- level 统一 'manage'：本迁移只固化"默认可见/可办集合"与现状一致；view/manage 分级由批次 D 落地。
-- super 恒为全部模块，不入表（代码保证）。INSERT IGNORE：幂等，重复执行不重复种。
CREATE TABLE IF NOT EXISTS admin_role_module (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role       VARCHAR(32) NOT NULL COMMENT '角色（admin_user.role）',
  module_key VARCHAR(32) NOT NULL COMMENT '模块 key（与前端 NAV key 一致）',
  level      VARCHAR(8)  NOT NULL DEFAULT 'manage' COMMENT '权限等级：view/manage（分级在批次 D 启用）',
  updated_by VARCHAR(64) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_role_module (role, module_key)
) ENGINE=InnoDB COMMENT='角色默认模块矩阵（C-04 单一数据源）';

INSERT IGNORE INTO admin_role_module (role, module_key, level) VALUES
  ('ops','users','manage'),('ops','dash','manage'),('ops','orders','manage'),('ops','tickets','manage'),
  ('ops','entitlements','manage'),('ops','fund','manage'),('ops','reviewqueue','manage'),('ops','products','manage'),
  ('ops','merchants','manage'),('ops','content','manage'),('ops','tasks','manage'),('ops','faqs','manage'),
  ('ops','banners','manage'),('ops','promoters','manage'),('ops','agreements','manage'),('ops','kyc','manage'),
  ('ops','cocreate','manage'),('ops','partners','manage'),('ops','partnerperf','manage'),('ops','scenics','manage'),
  ('ops','contentdash','manage'),('ops','contentcases','manage'),('ops','taskcash','manage'),
  ('finance','dash','manage'),('finance','orders','manage'),('finance','fund','manage'),('finance','settlements','manage'),
  ('finance','withdrawals','manage'),('finance','agreements','manage'),('finance','budgets','manage'),('finance','audit','manage'),
  ('finance','cocreate','manage'),('finance','entitlements','manage'),('finance','partners','manage'),
  ('finance','partnerperf','manage'),('finance','scenics','manage'),('finance','taskcash','manage'),
  ('review','content','manage'),('review','tasks','manage'),('review','reviewqueue','manage'),
  ('review','contentdash','manage'),('review','contentcases','manage'),
  ('risk','risk','manage'),('risk','users','manage'),('risk','conflicts','manage'),('risk','audit','manage'),
  ('risk','entitlements','manage'),('risk','cases','manage'),
  ('city_partner','dash','manage'),('city_partner','orders','manage'),('city_partner','tickets','manage'),
  ('city_partner','products','manage'),('city_partner','merchants','manage'),('city_partner','settlements','manage'),
  ('city_partner','cases','manage'),('city_partner','partners','manage'),('city_partner','partnerperf','manage'),
  ('city_partner','scenics','manage'),('city_partner','contentdash','manage'),('city_partner','contentcases','manage'),
  ('readonly','dash','manage'),('readonly','orders','manage'),('readonly','products','manage'),('readonly','merchants','manage'),
  ('readonly','scenics','manage'),('readonly','settlements','manage'),('readonly','contentdash','manage'),
  ('readonly','partners','manage'),('readonly','partnerperf','manage'),
  ('sre','dash','manage'),('sre','audit','manage'),('sre','system','manage'),('sre','integrations','manage'),
  ('sre','chainhub','manage'),('sre','web3dash','manage'),('sre','attest','manage'),
  ('dev','dash','manage'),('dev','audit','manage'),('dev','system','manage'),('dev','integrations','manage'),
  ('dev','chainhub','manage'),('dev','web3dash','manage'),('dev','attest','manage'),('dev','features','manage'),('dev','terms','manage');
