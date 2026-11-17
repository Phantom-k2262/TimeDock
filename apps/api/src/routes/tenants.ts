import { Hono } from "hono";
import { getSessionUser } from "../auth/guard";

type TenantBindings = { DB: D1Database; APP_ENV: string };
export const tenantRoutes = new Hono<{ Bindings: TenantBindings }>();

tenantRoutes.get("/", async (c) => {
  const current = await getSessionUser(c);
  if (!current) return c.json({ error: { code: "UNAUTHENTICATED", message: "ログインが必要です" } }, 401);
  if (current.suspendedAt) return c.json({ tenants: [] });
  const crossTenant = current.role === "system_admin" || current.role === "system_operator";
  const rows = crossTenant
    ? await c.env.DB.prepare("SELECT id, name FROM tenants WHERE deleted_at IS NULL ORDER BY name").all<{ id: string; name: string }>()
    : await c.env.DB.prepare("SELECT t.id, t.name FROM tenants t JOIN tenant_members tm ON tm.tenant_id = t.id AND tm.user_id = ?1 WHERE t.deleted_at IS NULL ORDER BY t.name").bind(current.id).all<{ id: string; name: string }>();
  return c.json({ tenants: rows.results });
});

tenantRoutes.get("/:id/members", async (c) => {
  const current = await getSessionUser(c);
  if (!current) return c.json({ error: { code: "UNAUTHENTICATED", message: "ログインが必要です" } }, 401);
  const tenantId = c.req.param("id");
  const elevated = current.role === "system_admin" || current.role === "system_operator";
  const allowed = elevated || await c.env.DB.prepare("SELECT 1 FROM tenant_members WHERE tenant_id = ?1 AND user_id = ?2").bind(tenantId, current.id).first();
  if (!allowed) return c.json({ error: { code: "FORBIDDEN", message: "テナント参照権限がありません" } }, 403);
  const rows = await c.env.DB.prepare("SELECT u.id, u.display_name FROM users u JOIN tenant_members tm ON tm.user_id = u.id AND tm.tenant_id = ?1 WHERE u.disabled_at IS NULL ORDER BY u.display_name").bind(tenantId).all<{ id: string; display_name: string }>();
  return c.json({ members: rows.results.map((row) => ({ id: row.id, displayName: row.display_name })) });
});
