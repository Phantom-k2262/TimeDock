PRAGMA foreign_keys = ON;

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('timesheet', 'expense', 'receipt', 'other')),
  target_month TEXT CHECK (target_month IS NULL OR target_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  r2_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_documents_owner_month ON documents(owner_user_id, target_month);
CREATE INDEX idx_documents_folder ON documents(folder_id, created_at);
