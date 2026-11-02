-- V30 小程序装修：单例配置（id=1），承载此前写死在小程序里的文案与配置；默认值即原有文案
CREATE TABLE IF NOT EXISTS site_config (
  id         INT PRIMARY KEY,
  profile    JSON NULL COMMENT '装修内容（表单引擎 kind=site）',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB COMMENT='小程序装修（单例）';
INSERT IGNORE INTO site_config (id, profile) VALUES (1, JSON_OBJECT(
  'brand_name', '向往的自由', 'slogan', '世界就是我的游乐场', 'share_title', '向往的自由 · 主题游·预约制',
  'hero_eyebrow', 'WANDERLUST · 向往的自由', 'hero_title', '世界就是', 'hero_title_em', '我的游乐场',
  'hero_caption', '去水乡入戏，去山野放空。下一段故事，由你出发。', 'search_ph', '搜索目的地、线路与新体验', 'destination_line', '朱家角 · 苏州 · 安吉',
  'themes', JSON_ARRAY(
    JSON_OBJECT('cat', 'script', 'name', '剧本探秘', 'sub', '走进故事现场', 'icon', '⌕'),
    JSON_OBJECT('cat', 'yoga', 'name', '山野疗愈', 'sub', '把时间还给自己', 'icon', '◌'),
    JSON_OBJECT('cat', 'family', 'name', '亲子时光', 'sub', '一起发现世界', 'icon', '☼'),
    JSON_OBJECT('cat', 'sister', 'name', '好友出游', 'sub', '约一场好风景', 'icon', '✧')),
  'section_title', '值得出发', 'footer_line', '把一次出行，变成值得分享的故事。', 'footer_sub', '主题体验 · 在地好物 · 旅行记录',
  'dest_caption', '一城一故事 · 在架主题游按城市聚合',
  'destinations', JSON_ARRAY(
    JSON_OBJECT('city', '310118', 'name', '上海·青浦朱家角', 'intro', '千年水乡，入戏一日'),
    JSON_OBJECT('city', '320508', 'name', '苏州·姑苏', 'intro', '园林与评弹'),
    JSON_OBJECT('city', '330523', 'name', '湖州·安吉', 'intro', '竹海与白茶')),
  'list_footer', '下单即锁定名额 · 支持按梯度退改', 'shop_title', '旅行商城', 'shop_caption', '在地好物 · 到店体验与领取',
  'shop_note', '当前好物支持到店预约领取，领取地点与时间请查看商品详情。',
  'service_hours', '每天 09:00-21:00'
));
