ALTER TABLE user_privacy_consent ADD COLUMN version VARCHAR(64) NULL COMMENT '用户实际同意的协议版本；历史记录不冒认为当前版本';
