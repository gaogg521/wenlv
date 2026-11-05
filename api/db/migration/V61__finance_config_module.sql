-- V61（QA-03 补充）：finance 角色默认矩阵补 config 模块。
-- 背景：config/proposal+approve 映射到 config 模块后，finance 的双人复核审批人角色
-- 需要 config 权限。旧代码无模块闸故 V54 基线未暴露此遗漏。
INSERT IGNORE INTO admin_role_module (role, module_key, level) VALUES ('finance', 'config', 'manage');
