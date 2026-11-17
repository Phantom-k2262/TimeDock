import { Hono } from "hono";
import { AdminUserCreateRequestSchema, PasswordPolicySchema, WorkspaceCreateRequestSchema } from "@timesheet/shared";
import { hashPassword } from "../auth/password";
import { requireAdmin } from "../auth/guard";

type AdminBindings = { DB: D1Database; APP_ENV: string };
export const adminRoutes = new Hono<{ Bindings: AdminBindings }>();

function error(c: any, status: 400 | 401 | 403 | 404 | 409 | 500, code: string, message: string) {
  return c.json({ error: { code, message, requestId: c.get("requestId") ?? crypto.randomUUID() } }, status);
}

function user(row: Record<string, unknown>) {
  return { id: row.id, loginId: row.login_id, displayName: row.display_name, role: row.role, disabledAt: row.disabled_at ?? null };
}

async function adminOrForbidden(c: any) {
  const current = await requireAdmin(c);
  return current ?? error(c, 403, "FORBIDDEN", "管理者権限が必要です");
}

adminRoutes.get("/users", async (c) => {
  const current = await adminOrForbidden(c);
  if (!current.id) return current;
  const rows = await c.env.DB.prepare("SELECT id, login_id, display_name, role, disabled_at FROM users ORDER BY disabled_at IS NOT NULL, display_name").all<Record<string, unknown>>();
  return c.json({ users: rows.results.map(user) });
});

adminRoutes.post("/users", async (c) => {
  const current = await adminOrForbidden(c);
  if (!current.id) return current;
  const parsed = AdminUserCreateRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.password !== parsed.data.passwordConfirmation) return error(c, 400, "VALIDATION_ERROR", "入力内容を確認してください。パスワードは英字・数字・記号を含む8〜20文字で、確認入力と一致させてください");
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE login_id = ?1").bind(parsed.data.loginId).first();
  if (existing) return error(c, 409, "CONFLICT", "そのログインIDはすでに使われています");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users (id, login_id, display_name, role, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)").bind(id, parsed.data.loginId, parsed.data.displayName, parsed.data.role, now),
    c.env.DB.prepare("INSERT INTO password_credentials (user_id, hash, algorithm, params_json, updated_at) VALUES (?1, ?2, 'pbkdf2-sha256', '{\"iterations\":100000,\"hash\":\"SHA-256\",\"keyLength\":256}', ?3)").bind(id, await hashPassword(parsed.data.password), now),
  ]);
  return c.json({ user: { id, loginId: parsed.data.loginId, displayName: parsed.data.displayName, role: parsed.data.role, disabledAt: null } }, 201);
});

adminRoutes.patch("/users/:id", async (c) => {
  const current = await adminOrForbidden(c);
  if (!current.id) return current;
  const body = await c.req.json().catch(() => null);
  const parsed = body && typeof body.displayName === "string" && body.displayName.trim().length > 0 && body.displayName.trim().length <= 100 && (body.role === undefined || ["employee", "approver", "admin"].includes(body.role)) ? { data: { displayName: body.displayName.trim(), role: body.role } } : null;
  if (!parsed) return error(c, 400, "VALIDATION_ERROR", "アカウント名を確認してください");
  const result = await c.env.DB.prepare("UPDATE users SET display_name = ?1, role = COALESCE(?2, role), updated_at = ?3 WHERE id = ?4").bind(parsed.data.displayName, parsed.data.role ?? null, new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "ユーザーが見つかりません");
  return c.json({ ok: true });
});

adminRoutes.post("/users/:id/password", async (c) => {
  const current = await adminOrForbidden(c);
  if (!current.id) return current;
  const body = await c.req.json().catch(() => null);
  const parsed = body && typeof body.password === "string" && typeof body.passwordConfirmation === "string" && PasswordPolicySchema.safeParse(body.password).success ? { data: body } : null;
  if (!parsed || parsed.data.password !== parsed.data.passwordConfirmation) return error(c, 400, "VALIDATION_ERROR", "パスワードは英字・数字・記号を含む8〜20文字で、確認入力と一致させてください");
  const result = await c.env.DB.prepare("UPDATE password_credentials SET hash = ?1, updated_at = ?2, failed_attempts = 0, blocked_until = NULL WHERE user_id = ?3").bind(await hashPassword(parsed.data.password), new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "ユーザーが見つかりません");
  return c.body(null, 204);
});

adminRoutes.delete("/users/:id", async (c) => {
  const current = await adminOrForbidden(c);
  if (!current.id) return current;
  if (current.id === c.req.param("id")) return error(c, 400, "VALIDATION_ERROR", "自分自身は無効化できません");
  const result = await c.env.DB.prepare("UPDATE users SET disabled_at = COALESCE(disabled_at, ?1), updated_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "ユーザーが見つかりません");
  return c.body(null, 204);
});

adminRoutes.get("/workspaces", async (c) => {
  const current = await adminOrForbidden(c);
  if (!current.id) return current;
  const rows = await c.env.DB.prepare("SELECT w.id, w.name, w.description, w.created_at, COUNT(wm.user_id) AS member_count FROM workspaces w LEFT JOIN workspace_members wm ON wm.workspace_id = w.id WHERE w.deleted_at IS NULL GROUP BY w.id ORDER BY w.created_at DESC").all<Record<string, unknown>>();
  return c.json({ workspaces: rows.results.map((row) => ({ id: row.id, name: row.name, description: row.description, createdAt: row.created_at, memberCount: Number(row.member_count) })) });
});

adminRoutes.post("/workspaces", async (c) => {
  const current = await adminOrForbidden(c);
  if (!current.id) return current;
  const parsed = WorkspaceCreateRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return error(c, 400, "VALIDATION_ERROR", "ワークスペース名を確認してください");
  const memberIds = parsed.data.memberIds.length ? parsed.data.memberIds : (await c.env.DB.prepare("SELECT id FROM users WHERE disabled_at IS NULL").all<{ id: string }>()).results.map((row) => row.id);
  const workspaceId = crypto.randomUUID();
  const rootId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [c.env.DB.prepare("INSERT INTO workspaces (id, name, description, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)").bind(workspaceId, parsed.data.name, parsed.data.description ?? null, current.id, now), c.env.DB.prepare("INSERT INTO folders (id, name, parent_id, kind, owner_user_id, read_only, created_by, created_at, updated_at, workspace_id, permission_mode) VALUES (?1, ?2, NULL, 'shared', NULL, 0, ?3, ?4, ?4, ?5, 'blacklist')").bind(rootId, parsed.data.name, current.id, now, workspaceId)];
  for (const memberId of memberIds) {
    statements.push(c.env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, created_at) VALUES (?1, ?2, ?3)").bind(workspaceId, memberId, now));
    statements.push(c.env.DB.prepare("INSERT INTO folders (id, name, parent_id, kind, owner_user_id, read_only, created_by, created_at, updated_at, workspace_id, permission_mode) VALUES (?1, ?2, ?3, 'personal', ?4, 0, ?5, ?6, ?6, ?7, 'blacklist')").bind(crypto.randomUUID(), (await c.env.DB.prepare("SELECT display_name FROM users WHERE id = ?1").bind(memberId).first<{ display_name: string }>())?.display_name ?? "メンバー", rootId, memberId, current.id, now, workspaceId));
  }
  await c.env.DB.batch(statements);
  return c.json({ workspace: { id: workspaceId, name: parsed.data.name, description: parsed.data.description ?? null, memberCount: memberIds.length } }, 201);
});

adminRoutes.delete("/workspaces/:id", async (c) => {
  const current = await adminOrForbidden(c);
  if (!current.id) return current;
  const result = await c.env.DB.prepare("UPDATE workspaces SET deleted_at = COALESCE(deleted_at, ?1), updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL").bind(new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "ワークスペースが見つかりません");
  return c.body(null, 204);
});

adminRoutes.patch("/folders/:id", async (c) => {
  const current = await adminOrForbidden(c);
  if (!current.id) return current;
  const body = await c.req.json().catch(() => null);
  const parsed = body && (body.name === undefined || (typeof body.name === "string" && body.name.trim().length > 0 && body.name.trim().length <= 100)) && (body.readOnly === undefined || typeof body.readOnly === "boolean") && (body.permissionMode === undefined || ["whitelist", "blacklist"].includes(body.permissionMode)) ? { data: body } : null;
  if (!parsed) return error(c, 400, "VALIDATION_ERROR", "フォルダ設定を確認してください");
  const result = await c.env.DB.prepare("UPDATE folders SET name = COALESCE(?1, name), read_only = COALESCE(?2, read_only), permission_mode = COALESCE(?3, permission_mode), updated_at = ?4 WHERE id = ?5").bind(parsed.data.name ?? null, parsed.data.readOnly === undefined ? null : (parsed.data.readOnly ? 1 : 0), parsed.data.permissionMode ?? null, new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "フォルダが見つかりません");
  return c.json({ ok: true });
});

adminRoutes.put("/folders/:id/permissions", async (c) => {
  const current = await adminOrForbidden(c);
  if (!current.id) return current;
  const body = await c.req.json().catch(() => null);
  const parsed = body && ["whitelist", "blacklist"].includes(body.mode) && Array.isArray(body.userIds) && body.userIds.every((id: unknown) => typeof id === "string") && (body.canWrite === undefined || typeof body.canWrite === "boolean") ? { data: { ...body, canWrite: body.canWrite ?? false } } : null;
  if (!parsed) return error(c, 400, "VALIDATION_ERROR", "参照権限の設定を確認してください");
  const folderId = c.req.param("id");
  const exists = await c.env.DB.prepare("SELECT id FROM folders WHERE id = ?1").bind(folderId).first();
  if (!exists) return error(c, 404, "NOT_FOUND", "フォルダが見つかりません");
  const statements = [c.env.DB.prepare("UPDATE folders SET permission_mode = ?1, updated_at = ?2 WHERE id = ?3").bind(parsed.data.mode, new Date().toISOString(), folderId), c.env.DB.prepare("DELETE FROM folder_permissions WHERE folder_id = ?1").bind(folderId)];
  for (const userId of parsed.data.userIds) statements.push(c.env.DB.prepare("INSERT INTO folder_permissions (id, folder_id, user_id, role, can_read, can_write, created_at) VALUES (?1, ?2, ?3, NULL, 1, ?4, ?5)").bind(crypto.randomUUID(), folderId, userId, parsed.data.canWrite ? 1 : 0, new Date().toISOString()));
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});
