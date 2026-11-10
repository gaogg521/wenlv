-- 第四批：B09 结构化服务权益 + B11 可见范围 + B14 产品专属完成奖励
-- B09：套餐项权益结构化（游客端/商户端同源展示；不含成本）；宣传视频走 rich_desc JSON（无需迁移）
ALTER TABLE package_item
  ADD COLUMN benefit_desc  VARCHAR(500) NULL COMMENT '权益说明（游客可见：服务内容/包含项）',
  ADD COLUMN benefit_rules VARCHAR(300) NULL COMMENT '使用规则（游客可见：有效期/预约方式/注意事项）';

-- 订单项权益快照（建单时固化，模板后改不改已售）
ALTER TABLE order_item
  ADD COLUMN benefit_desc  VARCHAR(500) NULL COMMENT '权益说明快照',
  ADD COLUMN benefit_rules VARCHAR(300) NULL COMMENT '使用规则快照';

-- B14：产品专属完成奖励进产品 profile（reward_extra_beans/reward_note），发放沿用旅豆预算双闸+账本幂等，无独立表
-- B11：产品可见范围进产品 profile（visible_channels 数组，空=默认渠道）；渠道清单以参数中心 channel.initial 为准
