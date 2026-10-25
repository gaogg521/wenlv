-- =====================================================================
-- V2__seed_rule_config.sql —— 参数中心种子（总方案 V3.1 §4.1bis 全量 key）
-- 初始值即定稿数字；此后一切修改走 PC 后台参数中心（双人复核/影响预览/回滚）
-- =====================================================================

INSERT INTO rule_config (k, v, group_name, `sensitive`, memo) VALUES
-- 旅豆 bean
('bean.order_rate',          '0.10',                          'bean', 1, '消费返豆率（实付×10%）'),
('bean.deduct_max_pct',      '0.10',                          'bean', 1, '单笔订单旅豆抵扣上限'),
('bean.expire_months',       '12',                            'bean', 1, '滚动 FIFO 过期月数'),
('bean.value_anchor',        '{"beans":100,"yuan":10}',       'bean', 1, '旅豆价值锚定（对外展示口径）'),
('bean.task_reward',         '200',                           'bean', 0, '约稿任务完成奖励（豆）'),
('bean.note_reward',         '50',                            'bean', 0, '笔记被推荐奖励（豆/篇）'),
('bean.note_weekly_cap',     '500',                           'bean', 0, '笔记奖励周上限（豆）'),
('bean.script_rewards',      '[80,50,20]',                    'bean', 0, '剧本三结局奖励（真相/私藏/迷途）'),
('bean.budget_profit_pct',   '0.05',                          'bean', 1, '批次预算≤min(营销预算,贡献利润×此值)'),
('bean.global_cap_yuan',     '600000',                        'bean', 1, '年度发行总量上限（元折豆）'),
-- 会员 member
('member.level.thresholds',  '[0,2000,10000,50000]',          'member', 1, '四级成长值阈值'),
('member.cs_multiplier',     '10',                            'member', 0, '贡献分×10 计入成长值'),
('member.annual_reset',      'true',                          'member', 0, '年度滚降一级保级'),
-- 推广 promoter
('promoter.tier2_gmv',       '1000000',                       'promoter', 1, '优选档 90 天有效成交门槛（分）'),
('promoter.tier3_gmv',       '5000000',                       'promoter', 1, '金牌档 90 天有效成交门槛（分）'),
('promoter.rate_bp',         '[500,800,1200]',                'promoter', 1, '三档费率（与 promoter 表 CHECK 双保险）'),
('promoter.tier3_score_min', '4.5',                           'promoter', 0, '金牌档服务评分门槛'),
('promoter.window_days',     '90',                            'promoter', 0, '滚动定档窗口（天）'),
('promoter.withdraw_min',    '10000',                         'promoter', 1, '提现门槛（分）'),
('promoter.withdraw_daily_max', '500000',                     'promoter', 1, '单日提现上限（分）'),
-- 贡献分 contribution
('contribution.weights',     '{"q":0.5,"s":0.3,"r":0.2}',     'contribution', 1, 'CS=0.5Q+0.3S+0.2R 权重（可校准）'),
-- 订单 order
('order.pay_timeout',        '15',                            'order', 0, '待支付超时（分钟）自动关单'),
('order.observe_days',       '7',                             'order', 1, '退款观察期（天），到期订单40→50'),
('order.refund_policy',      '{"d7":0.0,"d3":0.10,"d1":0.30}','order', 0, '平台默认退改梯度'),
('order.group_cancel_hours', '48',                            'order', 0, '未达 min_go 自动取消提前量（小时）'),
-- 核销 pass
('pass.code_window',         '60',                            'pass', 0, '动态核销码窗口（秒）'),
-- 结算 settlement
('commission.settle_delay_days', '7',                         'settlement', 1, '佣金 T+N 结算天数'),
('settlement.weekday',       '1',                             'settlement', 0, '周结算出账日（1=周一）'),
-- 成本控制 cost
('budget.approval.l1',       '300000',                        'cost', 1, '超支一级审批额度（分，≤运营总监）'),
('budget.approval.l2',       '800000',                        'cost', 1, '超支二级审批额度（分，≤财务；超出 CEO）'),
('budget.fuse_pct',          '0.25',                          'cost', 1, '熔断线：超支率（停新增投放不停存量核销）'),
('budget.forecast.warn',     '[0.25,0.50]',                   'cost', 0, '预测预警三态阈值（绿/黄/红）'),
-- 维度 channel
('city.initial',             '["310118","320508"]',           'channel', 1, '首批城市：上海青浦/苏州姑苏'),
('channel.initial',          '["main"]',                      'channel', 1, '初始主题频道（yoga 随 P2 分叉）');

-- 旅豆全局发行总量（单行表）：¥600,000 → 按 100豆=¥10 锚定 = 6,000,000 豆
INSERT INTO bean_global_cap (id, cap_total, issued_sum, year) VALUES (1, 6000000, 0, 2026);
