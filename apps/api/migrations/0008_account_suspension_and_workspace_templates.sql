PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN suspended_at TEXT;
ALTER TABLE templates ADD COLUMN content_type TEXT NOT NULL DEFAULT 'application/octet-stream';

CREATE INDEX idx_users_suspended ON users(suspended_at, disabled_at);
CREATE INDEX idx_templates_folder ON templates(folder_id, active, created_at);
