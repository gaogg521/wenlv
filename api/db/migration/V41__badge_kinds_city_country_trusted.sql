-- V41 徽章分种类：会员等级 / 会员荣誉 / 城市 / 国家 / 链上（小程序称「可信勋章」）
-- 1) 城市所属国家参数 city.country（国家徽章据此统计到访；缺省按 CN）
-- 2) 旧「成长」类并入「会员等级」类；元老旅友 / 内测先锋归入「会员荣誉」
-- 3) 预置：Lv1 等级徽章、注册天数荣誉 3 枚、城市徽章 6 枚（青浦 / 姑苏 / 湖州 各 2 阶）、国家印章 4 枚（日本 / 泰国 / 法国在对应城市开放前不在勋章墙显示）、
--    链上勋章 3 枚（按订单存证封存数发放）
-- 勋章分类 / 系列 / 阶数 / 城市 / 国家都在 profile JSON，不改表结构；幂等：同名勋章已存在则跳过。

INSERT IGNORE INTO rule_config (k, v, group_name, `sensitive`, memo) VALUES
('city.country', '{"310118":"CN","310000":"CN","320508":"CN","330500":"CN","330523":"CN"}', 'city', 0, '城市所属国家（ISO 两位代码，未列出的城市按 CN）：国家徽章据此统计到访订单');

UPDATE badge SET profile = JSON_SET(COALESCE(profile, JSON_OBJECT()), '$.category', 'level') WHERE JSON_UNQUOTE(JSON_EXTRACT(profile, '$.category')) = 'growth';
UPDATE badge SET profile = JSON_SET(COALESCE(profile, JSON_OBJECT()), '$.series', '会员等级') WHERE name IN ('旅行家认证', '城市探索官认证', '环球探索家认证');
UPDATE badge SET icon_key = 'crown' WHERE name = '城市探索官认证';
UPDATE badge SET profile = JSON_SET(COALESCE(profile, JSON_OBJECT()), '$.category', 'member', '$.series', '会员荣誉', '$.tier', 0) WHERE name IN ('元老旅友', '内测先锋');

INSERT INTO badge (name, icon_key, rule_desc, rule_type, profile)
SELECT t.name, t.icon_key, t.rule_desc, t.rule_type,
  JSON_OBJECT('rarity', t.rarity, 'category', t.category, 'series', t.series, 'tier', t.tier, 'threshold', t.th,
              'display_order', t.ord, 'description', t.story, 'max_issue', 0, 'city_code', t.city, 'country_code', t.country)
FROM (
  SELECT '探索者认证' name, 'compass' icon_key, '成为会员，开启旅程' rule_desc, 'level' rule_type, 1 th, 'common' rarity, 'level' category, '会员等级' series, 1 tier, 39 ord, '每一位旅人，都从这里出发。' story, '' city, '' country
  UNION ALL SELECT '同行百日', 'lantern', '注册满 100 天', 'member_days', 100, 'common', 'member', '同行时长', 1, 50, '一百个日夜，我们一路同行。', '', ''
  UNION ALL SELECT '周年旅友', 'heart', '注册满 1 年', 'member_days', 365, 'rare', 'member', '同行时长', 2, 51, '又是一年，感谢你一直在。', '', ''
  UNION ALL SELECT '三年同行', 'crown', '注册满 3 年', 'member_days', 1095, 'epic', 'member', '同行时长', 3, 52, '三年风雨同舟，你是最资深的同路人。', '', ''
  UNION ALL SELECT '青浦·水乡印', 'bridge', '在上海·青浦完成 1 次出行', 'city_visit', 1, 'rare', 'city', '青浦印记', 1, 60, '拱桥、河港与白墙黛瓦，印在记忆里。', '310118', ''
  UNION ALL SELECT '青浦·水乡常客', 'bridge', '在上海·青浦完成 3 次出行', 'city_visit', 3, 'epic', 'city', '青浦印记', 2, 61, '这座水乡的石板路，你已走得很熟。', '310118', ''
  UNION ALL SELECT '姑苏·园林印', 'pagoda', '在苏州·姑苏完成 1 次出行', 'city_visit', 1, 'rare', 'city', '姑苏印记', 1, 62, '一扇月洞门，框住一园春色。', '320508', ''
  UNION ALL SELECT '姑苏·园林常客', 'pagoda', '在苏州·姑苏完成 3 次出行', 'city_visit', 3, 'epic', 'city', '姑苏印记', 2, 63, '园林深处，已有你熟悉的角落。', '320508', ''
  UNION ALL SELECT '湖州·竹海印', 'bamboo', '在湖州完成 1 次出行', 'city_visit', 1, 'rare', 'city', '湖州印记', 1, 64, '千竿翠竹，一湖清风。', '330500', ''
  UNION ALL SELECT '湖州·竹海常客', 'bamboo', '在湖州完成 3 次出行', 'city_visit', 3, 'epic', 'city', '湖州印记', 2, 65, '山水之间，已是常来常往。', '330500', ''
  UNION ALL SELECT '中国印记', 'flag', '在中国境内完成 1 次出行', 'country_visit', 1, 'rare', 'country', '', 0, 70, '山河壮美，第一枚印章盖在这里。', '', 'CN'
  UNION ALL SELECT '日本印记', 'plane', '在日本完成 1 次出行', 'country_visit', 1, 'rare', 'country', '', 0, 71, '樱与枫的国度。', '', 'JP'
  UNION ALL SELECT '泰国印记', 'plane', '在泰国完成 1 次出行', 'country_visit', 1, 'rare', 'country', '', 0, 72, '微笑之国。', '', 'TH'
  UNION ALL SELECT '法国印记', 'plane', '在法国完成 1 次出行', 'country_visit', 1, 'rare', 'country', '', 0, 73, '浪漫与艺术之都。', '', 'FR'
  UNION ALL SELECT '首单封存', 'seal', '首个完成的订单被可信记录封存', 'sealed_count', 1, 'rare', 'trusted', '可信旅程', 1, 80, '这一趟的每个环节，都有据可查。', '', ''
  UNION ALL SELECT '可信旅人', 'shieldcheck', '5 个订单被可信记录封存', 'sealed_count', 5, 'epic', 'trusted', '可信旅程', 2, 81, '五段旅程，全程留痕、不可篡改。', '', ''
  UNION ALL SELECT '全程可信', 'node', '20 个订单被可信记录封存', 'sealed_count', 20, 'legend', 'trusted', '可信旅程', 3, 82, '二十段旅程，构成一条完整的可信足迹。', '', ''
) t
WHERE NOT EXISTS (SELECT 1 FROM badge b WHERE b.name = t.name);
