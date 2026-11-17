import { Hono } from "hono";
import { WorkspaceCreateRequestSchema } from "@timesheet/shared";
import { getSessionUser } from "../auth/guard";

type WorkspaceBindings = { DB: D1Database; APP_ENV: string };
export const workspaceRoutes = new Hono<{ Bindings: WorkspaceBindings }>();

function error(c: any, status: 400 | 401 | 403, code: string, message: string) {
  return c.json({ error: { code, message, requestId: c.get("requestId") ?? crypto.randomUUID() } }, status);
}

workspaceRoutes.get("/", async (c) => {
  const current = await getSessionUser(c);
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  const allTenants = current.role === "system_admin" || current.role === "system_operator";
  const query = allTenants
    ? "SELECT w.id, w.name, w.description, w.created_at, w.tenant_id, t.name AS tenant_name, w.sharing_mode, w.verification_mode, COUNT(wm2.user_id) AS member_count FROM workspaces w JOIN tenants t ON t.id = w.tenant_id LEFT JOIN workspace_members wm2 ON wm2.workspace_id = w.id WHERE w.deleted_at IS NULL AND t.deleted_at IS NULL GROUP BY w.id ORDER BY t.name, w.created_at DESC"
    : "SELECT w.id, w.name, w.description, w.created_at, w.tenant_id, t.name AS tenant_name, w.sharing_mode, w.verification_mode, COUNT(wm2.user_id) AS member_count FROM workspaces w JOIN tenants t ON t.id = w.tenant_id JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?1 WHERE w.deleted_at IS NULL AND t.deleted_at IS NULL GROUP BY w.id ORDER BY t.name, w.created_at DESC";
  const rows = allTenants ? await c.env.DB.prepare(query).all<Record<string, unknown>>() : await c.env.DB.prepare(query).bind(current.id).all<Record<string, unknown>>();
  return c.json({ workspaces: rows.results.map((row) => ({ id: row.id, name: row.name, description: row.description, createdAt: row.created_at, tenantId: row.tenant_id, tenantName: row.tenant_name, sharingMode: row.sharing_mode, verificationMode: row.verification_mode, memberCount: Number(row.member_count) })) });
});

workspaceRoutes.post("/", async (c) => {
  const current = await getSessionUser(c);
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  const parsed = WorkspaceCreateRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return error(c, 400, "VALIDATION_ERROR", "ワークスペース名を確認してください");
  const crossTenant = current.role === "system_admin" || current.role === "system_operator";
  const tenantId = crossTenant ? (parsed.data.tenantId ?? current.tenantId) : current.tenantId;
  const tenant = await c.env.DB.prepare("SELECT id FROM tenants WHERE id = ?1 AND deleted_at IS NULL").bind(tenantId).first();
  if (!tenant) return error(c, 400, "VALIDATION_ERROR", "テナントを確認してください");
  const requested = parsed.data.memberIds.length ? parsed.data.memberIds : [current.id];
  const memberIds = Array.from(new Set([current.id, ...requested]));
  const workspaceId = crypto.randomUUID();
  const rootId = crypto.randomUUID();
  const now = new Date().toISOString();
  const names = await c.env.DB.prepare(`SELECT u.id, u.display_name FROM users u JOIN tenant_members tm ON tm.user_id = u.id AND tm.tenant_id = ?1 WHERE u.disabled_at IS NULL AND u.id IN (${memberIds.map(() => "?").join(",")})`).bind(tenantId, ...memberIds).all<{ id: string; display_name: string }>();
  const scopedMemberIds = names.results.map((row) => row.id);
  if (!scopedMemberIds.includes(current.id)) return error(c, 403, "FORBIDDEN", "所属テナント以外のユーザーは指定できません");
  const nameById = new Map(names.results.map((row) => [row.id, row.display_name]));
  const statements = [c.env.DB.prepare("INSERT INTO workspaces (id, name, description, created_by, created_at, updated_at, tenant_id, sharing_mode, verification_mode) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8)").bind(workspaceId, parsed.data.name, parsed.data.description ?? null, current.id, now, tenantId, parsed.data.sharingMode, parsed.data.verificationMode), c.env.DB.prepare("INSERT INTO folders (id, name, parent_id, kind, owner_user_id, read_only, created_by, created_at, updated_at, workspace_id, permission_mode) VALUES (?1, ?2, NULL, 'shared', NULL, 0, ?3, ?4, ?4, ?5, 'blacklist')").bind(rootId, parsed.data.name, current.id, now, workspaceId)];
  for (const memberId of scopedMemberIds) {
    statements.push(c.env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, created_at) VALUES (?1, ?2, ?3)").bind(workspaceId, memberId, now));
    if (parsed.data.sharingMode === "member_scoped") statements.push(c.env.DB.prepare("INSERT INTO folders (id, name, parent_id, kind, owner_user_id, read_only, created_by, created_at, updated_at, workspace_id, permission_mode) VALUES (?1, ?2, ?3, 'personal', ?4, 0, ?5, ?6, ?6, ?7, 'blacklist')").bind(crypto.randomUUID(), nameById.get(memberId) ?? "メンバー", rootId, memberId, current.id, now, workspaceId));
  }
  await c.env.DB.batch(statements);
  return c.json({ workspace: { id: workspaceId, name: parsed.data.name, description: parsed.data.description ?? null, tenantId, sharingMode: parsed.data.sharingMode, verificationMode: parsed.data.verificationMode, memberCount: scopedMemberIds.length } }, 201);
});
