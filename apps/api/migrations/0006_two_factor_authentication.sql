ALTER TABLE users ADD COLUMN two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN two_factor_required INTEGER NOT NULL DEFAULT 1 CHECK (two_factor_required IN (0,1));
ALTER TABLE users ADD COLUMN two_factor_enrolled_at TEXT;
ALTER TABLE sessions ADD COLUMN two_factor_verified_at TEXT;

UPDATE users SET two_factor_required = 0 WHERE account_type = 'system_admin' OR role = 'admin';

CREATE INDEX idx_users_two_factor_required ON users(two_factor_required, two_factor_enrolled_at);
