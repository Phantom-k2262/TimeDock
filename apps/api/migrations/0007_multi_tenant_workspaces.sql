PRAGMA foreign_keys = ON;

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

INSERT INTO tenants (id, name, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', '既定テナント', datetime('now'), datetime('now'));

ALTER TABLE users ADD COLUMN primary_tenant_id TEXT REFERENCES tenants(id);
UPDATE users SET primary_tenant_id = '00000000-0000-4000-8000-000000000001' WHERE primary_tenant_id IS NULL;

CREATE TABLE tenant_members (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

INSERT INTO tenant_members (tenant_id, user_id, created_at)
SELECT '00000000-0000-4000-8000-000000000001', id, datetime('now') FROM users;

ALTER TABLE workspaces ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
UPDATE workspaces SET tenant_id = '00000000-0000-4000-8000-000000000001' WHERE tenant_id IS NULL;

CREATE INDEX idx_tenant_members_user ON tenant_members(user_id, tenant_id);
CREATE INDEX idx_workspaces_tenant ON workspaces(tenant_id, deleted_at, created_at);
CREATE INDEX idx_users_primary_tenant ON users(primary_tenant_id, disabled_at);
