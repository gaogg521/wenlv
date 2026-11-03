-- V42 商户经营等级 + 商户徽章
-- 1) merchant.level / level_at：当前经营等级（由 domain/merchant-level.mjs 按订单、评价、退款率评定并落库，便于列表与后台筛选）
-- 2) merchant_badge：商户获得的徽章（与游客的 user_badge 并列；徽章定义仍在 badge 表，规则类型以 m_ 开头的是商户徽章）
-- 3) 参数 merchant.levels：等级名 / 门槛 / 权益说明，改动走双人复核，生效后立即重评所有商户
-- 4) 预置 20 枚商户徽章：商户等级 4 + 经营荣誉（里程 / 流水 / 口碑 / 核销 / 入驻时长）13 + 可信经营 3；幂等：同名已存在则跳过

ALTER TABLE merchant ADD COLUMN level TINYINT NOT NULL DEFAULT 1 COMMENT '经营等级（merchant.levels）';
ALTER TABLE merchant ADD COLUMN level_at DATETIME(3) NULL COMMENT '等级最近一次变化时间';

CREATE TABLE IF NOT EXISTS merchant_badge (
  merchant_id BIGINT UNSIGNED NOT NULL,
  badge_id    SMALLINT UNSIGNED NOT NULL,
  granted_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ref         VARCHAR(48) NULL,
  PRIMARY KEY (merchant_id, badge_id),
  KEY idx_badge (badge_id)
) ENGINE=InnoDB COMMENT='商户徽章';

INSERT IGNORE INTO rule_config (k, v, group_name, `sensitive`, memo) VALUES
('merchant.levels',
 '[{"lv":1,"name":"新晋商户","minOrders":0,"minReviews":0,"minRating":0,"maxRefundPct":100,"perks":["接入平台订单与核销","参与平台常规活动"]},{"lv":2,"name":"优选商户","minOrders":10,"minReviews":3,"minRating":45,"maxRefundPct":10,"perks":["平台活动优先报名","运营定期经营复盘"]},{"lv":3,"name":"金牌商户","minOrders":50,"minReviews":15,"minRating":47,"maxRefundPct":6,"perks":["平台推荐位优先考虑","专属运营对接人"]},{"lv":4,"name":"品质标杆","minOrders":200,"minReviews":50,"minRating":48,"maxRefundPct":4,"perks":["年度标杆商户评选资格","新业务与新线路优先试点"]}]',
 'merchant', 1, '商户经营等级：等级名 / 订单·评价·评分·退款率门槛 / 权益说明（评分 45 = 4.5 分）；改动需双人复核，生效后立即重评所有商户');

INSERT INTO badge (name, icon_key, rule_desc, rule_type, profile)
SELECT t.name, t.icon_key, t.rule_desc, t.rule_type,
  JSON_OBJECT('rarity', t.rarity, 'category', t.category, 'series', t.series, 'tier', t.tier, 'threshold', t.th,
              'min_reviews', t.minrev, 'display_order', t.ord, 'description', t.story, 'max_issue', 0)
FROM (
  SELECT '新晋商户认证' name, 'store' icon_key, '入驻平台，开启经营' rule_desc, 'm_level' rule_type, 1 th, 0 minrev, 'common' rarity, 'mlevel' category, '商户等级' series, 1 tier, 100 ord, '每一家好店，都从这里开张。' story
  UNION ALL SELECT '优选商户认证', 'store', '经营等级达到 Lv2', 'm_level', 2, 0, 'rare', 'mlevel', '商户等级', 2, 101, '订单、口碑与退款率都达到优选标准。'
  UNION ALL SELECT '金牌商户认证', 'store', '经营等级达到 Lv3', 'm_level', 3, 0, 'epic', 'mlevel', '商户等级', 3, 102, '稳定的履约与口碑，是游客的放心之选。'
  UNION ALL SELECT '品质标杆认证', 'store', '经营等级达到 Lv4', 'm_level', 4, 0, 'legend', 'mlevel', '商户等级', 4, 103, '平台最高经营荣誉，品质的标杆。'
  UNION ALL SELECT '首单开张', 'store', '完成第 1 笔订单', 'm_orders', 1, 0, 'common', 'mhonor', '经营里程', 1, 110, '第一位游客，已满意离店。'
  UNION ALL SELECT '百单达成', 'trend', '累计完成 100 笔订单', 'm_orders', 100, 0, 'rare', 'mhonor', '经营里程', 2, 111, '一百位游客的信任。'
  UNION ALL SELECT '千单传奇', 'crown', '累计完成 1000 笔订单', 'm_orders', 1000, 0, 'legend', 'mhonor', '经营里程', 3, 112, '千单之后，依旧如初。'
  UNION ALL SELECT '流水过万', 'trend', '累计成交满 1 万元', 'm_gmv', 10000, 0, 'common', 'mhonor', '经营流水', 1, 120, '生意从这里起步。'
  UNION ALL SELECT '流水十万', 'trend', '累计成交满 10 万元', 'm_gmv', 100000, 0, 'rare', 'mhonor', '经营流水', 2, 121, '稳步成长的好生意。'
  UNION ALL SELECT '流水百万', 'trend', '累计成交满 100 万元', 'm_gmv', 1000000, 0, 'epic', 'mhonor', '经营流水', 3, 122, '百万成交，实力见证。'
  UNION ALL SELECT '口碑良好', 'thumb', '评分不低于 4.5，且不少于 10 条评价', 'm_rating', 45, 10, 'rare', 'mhonor', '游客口碑', 1, 130, '游客用评价投出的信任票。'
  UNION ALL SELECT '口碑卓越', 'thumb', '评分不低于 4.8，且不少于 50 条评价', 'm_rating', 48, 50, 'epic', 'mhonor', '游客口碑', 2, 131, '近乎满分的口碑，来自五十位以上游客。'
  UNION ALL SELECT '核销达人', 'scan', '累计成功核销 100 次', 'm_verify', 100, 0, 'common', 'mhonor', '核销服务', 1, 140, '每一次扫码，都是一次顺畅的到店体验。'
  UNION ALL SELECT '核销千次', 'scan', '累计成功核销 1000 次', 'm_verify', 1000, 0, 'rare', 'mhonor', '核销服务', 2, 141, '千次核销，零差错的默契。'
  UNION ALL SELECT '入驻半年', 'calendar', '入驻满 6 个月', 'm_months', 6, 0, 'common', 'mhonor', '同行时长', 1, 150, '半年同行，彼此熟悉。'
  UNION ALL SELECT '入驻一年', 'calendar', '入驻满 12 个月', 'm_months', 12, 0, 'rare', 'mhonor', '同行时长', 2, 151, '一年又一年，越来越稳。'
  UNION ALL SELECT '入驻三年', 'lantern', '入驻满 36 个月', 'm_months', 36, 0, 'epic', 'mhonor', '同行时长', 3, 152, '三年老店，平台的老朋友。'
  UNION ALL SELECT '账实相符', 'seal', '首个完成的订单被可信记录封存', 'm_sealed', 1, 0, 'rare', 'trusted', '可信经营', 1, 160, '经营数据可核对、可追溯。'
  UNION ALL SELECT '可信商户', 'shieldcheck', '30 个订单被可信记录封存', 'm_sealed', 30, 0, 'epic', 'trusted', '可信经营', 2, 161, '三十笔订单，全程留痕、不可篡改。'
  UNION ALL SELECT '全程可信商户', 'node', '200 个订单被可信记录封存', 'm_sealed', 200, 0, 'legend', 'trusted', '可信经营', 3, 162, '两百笔订单构成一条完整的可信经营足迹。'
) t
WHERE NOT EXISTS (SELECT 1 FROM badge b WHERE b.name = t.name);
