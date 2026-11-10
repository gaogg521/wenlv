CREATE TABLE business_subject (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB COMMENT='经核对的合作主体，不自动合并';
CREATE TABLE subject_resource (
  subject_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(16) NOT NULL,
  resource_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (kind, resource_id),
  KEY idx_subject (subject_id)
) ENGINE=InnoDB COMMENT='主体关联商户供应商共创合同';
CREATE TABLE subject_grant (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  valid_from DATETIME NOT NULL,
  valid_to DATETIME NULL,
  status TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_subject_user (subject_id, user_id)
) ENGINE=InnoDB COMMENT='只读经办授权，不授核销或付款权';
