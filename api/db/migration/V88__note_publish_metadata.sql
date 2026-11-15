ALTER TABLE content_note
  ADD COLUMN visibility ENUM('public','private') NOT NULL DEFAULT 'public',
  ADD COLUMN scenic_id BIGINT UNSIGNED NULL,
  ADD KEY ix_note_visibility (visibility, status, published_at, id),
  ADD KEY ix_note_scenic (scenic_id, visibility, status);
