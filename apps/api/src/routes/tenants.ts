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
