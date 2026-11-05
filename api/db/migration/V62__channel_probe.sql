-- M-03：验证码通道联调记录——把「配置齐全」与「真实送达验证」分开，不把配置当能力。
-- 每次从安全中心发起的发送测试（或真实登录过程中自然发送的结果）记一行；目标只存脱敏值，不存明文手机号/邮箱。
CREATE TABLE IF NOT EXISTS channel_probe (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  channel      VARCHAR(8)  NOT NULL COMMENT 'sms / email',
  target_masked VARCHAR(64) NOT NULL COMMENT '脱敏目标，如 138****1234 / a***@huanle.com',
  result       TINYINT     NOT NULL COMMENT '1 成功送达服务商（受理） 0 发送失败',
  detail       VARCHAR(255) NULL COMMENT '服务商受理号或失败原因摘要（不含验证码明文）',
  by_admin     VARCHAR(64) NULL COMMENT '发起人（安全中心测试）或 auto（登录自然发送）',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_ch (channel, created_at)
) ENGINE=InnoDB COMMENT='验证码通道发送测试记录（M-03 五态展示依据）';
