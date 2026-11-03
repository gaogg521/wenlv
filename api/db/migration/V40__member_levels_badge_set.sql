-- V40 会员等级体系参数化 + 预置勋章系列
-- 1) 等级名 / 成长值门槛 / 返豆加成 / 权益说明改由参数中心 member.levels 配置（此前三处各写死一份，且名称互不相同）。
--    成长值单位沿用「分」：1 元消费 = 100 单位，小程序展示为 1 成长值。旧的 member.level.thresholds 保留但标记弃用。
-- 2) 预置勋章：按「旅程 / 探索 / 创作 / 成长 / 特别」五类、普通→传说四档稀有度配齐一套，
--    图形由服务端按类别与稀有度生成（GET /badge-art/<id>.svg），后台仍可上传自己的勋章图覆盖。
--    勋章分类、系列、阶数存在 profile JSON 里，不改表结构。幂等：同名勋章已存在则跳过。

INSERT IGNORE INTO rule_config (k, v, group_name, `sensitive`, memo) VALUES
('member.levels',
 '[{"lv":1,"name":"探索者","min":0,"rebateBonusBp":0,"perks":["注册即享旅豆返豆","参与剧本闯关与约稿任务"]},{"lv":2,"name":"旅行家","min":200000,"rebateBonusBp":30,"perks":["消费返豆额外加成","解锁「旅行家」专属勋章"]},{"lv":3,"name":"城市探索官","min":1000000,"rebateBonusBp":60,"perks":["消费返豆更高加成","优先参与新线路体验"]},{"lv":4,"name":"环球探索家","min":3000000,"rebateBonusBp":100,"perks":["消费返豆最高加成","年度专属礼遇与新品首发"]}]',
 'member', 1, '会员等级体系：等级名 / 成长值门槛（分）/ 返豆加成（bp）/ 权益说明；改动需双人复核，生效后立即重算全员等级');

UPDATE rule_config SET memo = '已弃用：请改用「会员等级体系」member.levels' WHERE k = 'member.level.thresholds';

-- 已有用户按新门槛重算一次等级（只改 member_level，不动成长值）
UPDATE user_account SET member_level = 1 + (growth_value >= 200000) + (growth_value >= 1000000) + (growth_value >= 3000000);

INSERT INTO badge (name, icon_key, rule_desc, rule_type, profile)
SELECT t.name, t.icon_key, t.rule_desc, t.rule_type,
  JSON_OBJECT('rarity', t.rarity, 'category', t.category, 'series', t.series, 'tier', t.tier, 'threshold', t.th,
              'display_order', t.ord, 'description', t.story, 'max_issue', t.maxi)
FROM (
  SELECT '水乡首游' name, 'boat' icon_key, '完成第 1 次旅程' rule_desc, 'order_count' rule_type, 1 th, 'common' rarity, 'journey' category, '旅程里程' series, 1 tier, 10 ord, '第一次出发，水乡的风景从此留在记忆里。' story, 0 maxi
  UNION ALL SELECT '旅途常客', 'ticket', '累计完成 5 次旅程', 'order_count', 5, 'rare', 'journey', '旅程里程', 2, 11, '说走就走，已经是这里的老朋友。', 0
  UNION ALL SELECT '资深旅人', 'footprint', '累计完成 15 次旅程', 'order_count', 15, 'epic', 'journey', '旅程里程', 3, 12, '脚步所至，皆成风景。', 0
  UNION ALL SELECT '传奇旅者', 'crown', '累计完成 50 次旅程', 'order_count', 50, 'legend', 'journey', '旅程里程', 4, 13, '五十次出发，见证了无数个清晨与黄昏。', 0
  UNION ALL SELECT '足迹初印', 'pin', '打卡 1 座城市', 'city_count', 1, 'common', 'explore', '城市足迹', 1, 20, '在地图上落下第一枚图钉。', 0
  UNION ALL SELECT '双城印记', 'compass', '打卡 2 座城市', 'city_count', 2, 'rare', 'explore', '城市足迹', 2, 21, '从一座城走到另一座城。', 0
  UNION ALL SELECT '三城漫游', 'globe', '打卡 3 座城市', 'city_count', 3, 'epic', 'explore', '城市足迹', 3, 22, '世界很大，你已经走出了第一圈。', 0
  UNION ALL SELECT '五城行者', 'mountain', '打卡 5 座城市', 'city_count', 5, 'legend', 'explore', '城市足迹', 4, 23, '山海之间，处处都是目的地。', 0
  UNION ALL SELECT '落笔留痕', 'pen', '发表 1 条评价', 'review', 1, 'common', 'creator', '旅行口碑', 1, 30, '把这一趟的感受写下来。', 0
  UNION ALL SELECT '口碑旅人', 'heart', '发表 5 条评价', 'review', 5, 'rare', 'creator', '旅行口碑', 2, 31, '你的评价，帮后来的人少走弯路。', 0
  UNION ALL SELECT '金牌点评官', 'star', '发表 20 条评价', 'review', 20, 'epic', 'creator', '旅行口碑', 3, 32, '字字有据，句句真诚。', 0
  UNION ALL SELECT '游记新手', 'book', '发布 1 篇旅行笔记', 'note_count', 1, 'common', 'creator', '旅行游记', 1, 33, '第一篇游记，从此开始记录。', 0
  UNION ALL SELECT '游记达人', 'camera', '发布 10 篇旅行笔记', 'note_count', 10, 'rare', 'creator', '旅行游记', 2, 34, '镜头与文字，都在讲同一个故事。', 0
  UNION ALL SELECT '旅行家认证', 'flag', '会员等级达到 Lv2', 'level', 2, 'rare', 'growth', '会员成长', 2, 40, '成长值累积到「旅行家」，解锁更多返豆加成。', 0
  UNION ALL SELECT '城市探索官认证', 'lantern', '会员等级达到 Lv3', 'level', 3, 'epic', 'growth', '会员成长', 3, 41, '你已是这座城市的探索官。', 0
  UNION ALL SELECT '环球探索家认证', 'globe', '会员等级达到 Lv4', 'level', 4, 'legend', 'growth', '会员成长', 4, 42, '会员体系的最高荣誉。', 0
  UNION ALL SELECT '元老旅友', 'heart', '平台早期用户，由运营授予', 'manual', 0, 'legend', 'special', '', 0, 90, '感谢你在最早的日子里与我们同行。', 500
  UNION ALL SELECT '内测先锋', 'bridge', '参与产品内测，由运营授予', 'manual', 0, 'epic', 'special', '', 0, 91, '你的反馈，让这座桥更稳。', 200
) t
WHERE NOT EXISTS (SELECT 1 FROM badge b WHERE b.name = t.name);
