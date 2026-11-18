-- V92（P-01）：经营测算独立页模块种子——测算从经营概览迁出为独立栏目（经营总览 → 经营测算），按模块授权。
-- 只授 ops（super 代码恒全部）；城市合伙人/其他角色不展示（R-02：避免把示例测算误读为真实分账）。
-- 与 modules.mjs ROLE_DEFAULT_MODULES、test/admin-modules.mjs BASELINE 三处同步。
INSERT IGNORE INTO admin_role_module (role, module_key, level) VALUES ('ops', 'scenario', 'manage');
