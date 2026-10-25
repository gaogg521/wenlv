-- V5：数据边界（城市合伙人行级隔离）+ 公开验证支撑
ALTER TABLE admin_user
  ADD COLUMN scope_city VARCHAR(8) NULL COMMENT '城市合伙人数据范围（NULL=全量，内部角色）',
  ADD COLUMN scope_merchant BIGINT UNSIGNED NULL COMMENT '预留：商户主账号范围（当前商户走小程序B）';

-- 城市合伙人演示账号由 api 启动时种入（city310118 / city123，仅看青浦数据）
