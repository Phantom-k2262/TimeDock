PRAGMA foreign_keys = ON;

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id),
  kind TEXT NOT NULL CHECK (kind IN ('template_library', 'personal', 'shared')),
  owner_user_id TEXT REFERENCES users(id),
  read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE folder_permissions (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id),
  user_id TEXT REFERENCES users(id),
  role TEXT CHECK (role IN ('employee', 'approver', 'admin')),
  can_read INTEGER NOT NULL DEFAULT 1 CHECK (can_read IN (0,1)),
  can_write INTEGER NOT NULL DEFAULT 0 CHECK (can_write IN (0,1)),
  created_at TEXT NOT NULL,
  CHECK (user_id IS NOT NULL OR role IS NOT NULL),
  UNIQUE(folder_id, user_id, role)
);

ALTER TABLE templates ADD COLUMN folder_id TEXT REFERENCES folders(id);
ALTER TABLE timesheets ADD COLUMN folder_id TEXT REFERENCES folders(id);

CREATE INDEX idx_folders_parent ON folders(parent_id);
CREATE INDEX idx_folders_owner ON folders(owner_user_id);
CREATE INDEX idx_folder_permissions_folder ON folder_permissions(folder_id);
