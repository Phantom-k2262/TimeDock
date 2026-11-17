PRAGMA foreign_keys = ON;

CREATE TABLE two_factor_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL UNIQUE,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_two_factor_recovery_user ON two_factor_recovery_codes(user_id, used_at);
