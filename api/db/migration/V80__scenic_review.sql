CREATE TABLE scenic_review (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenic_id BIGINT UNSIGNED NOT NULL,
  admin_id BIGINT UNSIGNED NOT NULL,
  admin_role VARCHAR(24) NOT NULL,
  snapshot JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_owner (scenic_id, admin_id, admin_role, id)
) ENGINE=InnoDB;
