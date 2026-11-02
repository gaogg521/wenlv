-- V33 商户工作台公告给默认文案：V30 装修单例没有预置 merchant_notice，商户端首页公告卡默认不显示，
-- 容易被误以为功能缺失。只在公告为空时写入；后台「小程序装修 · 商户端」可随时修改或清空（清空即不显示）。
UPDATE site_config
SET profile = JSON_SET(COALESCE(profile, JSON_OBJECT()), '$.merchant_notice',
  '<p>欢迎使用商户工作台。每周一出上周结算单，请在「结算」页逐单核对后确认，有差异可直接发起异议。</p><p>游客退改产生的手续费按结算单所示比例计入本店应结；核销遇到问题请联系平台客服。</p>')
WHERE id = 1 AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(profile, '$.merchant_notice')), '') IN ('', 'null');
