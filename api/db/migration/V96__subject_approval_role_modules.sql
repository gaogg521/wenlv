-- V96: 运营角色的主体审批与运营工作台模块入矩阵(V54 矩阵已存在的角色,静态默认不生效,需补行)。
-- ops 追加 subjectapprove(主体资源审批页)/opsdesk(运营工作台);审批动作本身仍需超管按员工授予 subject.approve。
-- 商户/景区主体方无矩阵行(回退静态默认,已含 subjectwork),不需插入。
-- city_partner 不追加:主体审批不属于城市职责(CITY_DENY_MODULES 已同步拦截)。
INSERT IGNORE INTO admin_role_module (role, module_key, level, updated_by) VALUES
  ('ops', 'subjectapprove', 'manage', 'V94-migration'),
  ('ops', 'opsdesk', 'manage', 'V94-migration');
