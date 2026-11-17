PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE folders ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
ALTER TABLE folders ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'blacklist' CHECK (permission_mode IN ('whitelist', 'blacklist'));

CREATE INDEX idx_workspaces_created_by ON workspaces(created_by, created_at);
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id, workspace_id);
CREATE INDEX idx_folders_workspace ON folders(workspace_id, parent_id);
