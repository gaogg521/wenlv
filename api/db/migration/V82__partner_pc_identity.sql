-- 商户/景区独立 PC 身份（补充验收项3）：主体方登录后台查看自身授权范围
--   merchant_partner：商户主体方，subject_id = merchant.id —— 只看本店订单/结算/商品；
--   scenic_partner  ：景区主体方，subject_id = scenic_spot.id —— 只看本景区订单/算账/复盘。
--   授权基线：复用既有 admin_user（登录/MFA/会话 epoch/审计），不另造身份体系；
--   行级隔离在 requireAdmin 注入主体范围（每请求从库取，改绑即生效），资金工作台/参数中心等平台模块不在默认模块集。
ALTER TABLE admin_user
  ADD COLUMN subject_type VARCHAR(16) NULL COMMENT '主体类型（merchant_partner→merchant / scenic_partner→scenic；其余角色 NULL）',
  ADD COLUMN subject_id   BIGINT UNSIGNED NULL COMMENT '绑定主体ID（商户/景区）',
  ADD KEY idx_subject (subject_type, subject_id);
