PRAGMA foreign_keys = ON;

-- Legacy users created before multi-tenant assignments keep their primary tenant
-- as a compatibility value. Restore the missing membership without duplicating
-- rows so tenant visibility remains membership-driven.
INSERT OR IGNORE INTO tenant_members (tenant_id, user_id, created_at)
SELECT u.primary_tenant_id, u.id, COALESCE(u.created_at, datetime('now'))
FROM users u
JOIN tenants t ON t.id = u.primary_tenant_id AND t.deleted_at IS NULL
WHERE u.primary_tenant_id IS NOT NULL;
