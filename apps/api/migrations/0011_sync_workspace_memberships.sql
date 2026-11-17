PRAGMA foreign_keys = ON;

-- Workspace visibility is scoped by tenant assignment, while the existing
-- workspace_members table is still used by the file APIs for authorization.
-- Keep those two views consistent for workspaces that already existed before
-- a user was assigned to the tenant.
INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, created_at)
SELECT w.id, tm.user_id, COALESCE(tm.created_at, datetime('now'))
FROM workspaces w
JOIN tenant_members tm ON tm.tenant_id = w.tenant_id
JOIN users u ON u.id = tm.user_id AND u.disabled_at IS NULL
JOIN tenants t ON t.id = w.tenant_id AND t.deleted_at IS NULL
WHERE w.deleted_at IS NULL;

PRAGMA foreign_keys = ON;
