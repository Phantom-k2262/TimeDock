import { Hono } from "hono";
import { AdminUserCreateRequestSchema, PasswordPolicySchema, WorkspaceCreateRequestSchema } from "@timesheet/shared";
import { hashPassword } from "../auth/password";
import { canManageFiles, requireAccountManager, requireAdmin, requireFileManager } from "../auth/guard";

type AdminBindings = { DB: D1Database; APP_ENV: string };
export const adminRoutes = new Hono<{ Bindings: AdminBindings }>();

function error(c: any, status: 400 | 401 | 403 | 404 | 409 | 500, code: string, message: string) {
  return c.json({ error: { code, message, requestId: c.get("requestId") ?? crypto.randomUUID() } }, status);
}

function user(row: Record<string, unknown>) {
  const legacyRole = row.role === "admin" ? "system_admin" : row.role === "approver" ? "verifier" : "member";
  return { id: row.id, loginId: row.login_id, displayName: row.display_name, role: row.account_type ?? legacyRole, tenantId: row.primary_tenant_id, tenantName: row.tenant_name, disabledAt: row.disabled_at ?? null, twoFactorRequired: row.two_factor_required !== 0, twoFactorEnrolled: Boolean(row.two_factor_enrolled_at) };
}

function tenant(row: Record<string, unknown>) {
  return { id: row.id, name: row.name, memberCount: Number(row.member_count ?? 0), workspaceCount: Number(row.workspace_count ?? 0) };
}

async function adminOrForbidden(c: any) {
  const current = await requireAdmin(c);
  return current ?? error(c, 403, "FORBIDDEN", "管理者権限が必要です");
}

async function accountManagerOrForbidden(c: any) {
  const current = await requireAccountManager(c);
  return current ?? error(c, 403, "FORBIDDEN", "アカウント管理権限が必要です");
}

async function fileManagerOrForbidden(c: any) {
  const current = await requireFileManager(c);
  if (current && canManageFiles(current.role)) return current;
  return error(c, 403, "FORBIDDEN", "フォルダ管理権限が必要です");
}

adminRoutes.get("/users", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  const rows = await c.env.DB.prepare("SELECT u.id, u.login_id, u.display_name, u.role, u.account_type, u.primary_tenant_id, t.name AS tenant_name, u.disabled_at, u.two_factor_required, u.two_factor_enrolled_at FROM users u LEFT JOIN tenants t ON t.id = u.primary_tenant_id ORDER BY u.disabled_at IS NOT NULL, u.display_name").all<Record<string, unknown>>();
  return c.json({ users: rows.results.map(user) });
});

adminRoutes.get("/tenants", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  const rows = await c.env.DB.prepare("SELECT t.id, t.name, COUNT(DISTINCT tm.user_id) AS member_count, COUNT(DISTINCT w.id) AS workspace_count FROM tenants t LEFT JOIN tenant_members tm ON tm.tenant_id = t.id LEFT JOIN workspaces w ON w.tenant_id = t.id AND w.deleted_at IS NULL WHERE t.deleted_at IS NULL GROUP BY t.id ORDER BY t.name").all<Record<string, unknown>>();
  return c.json({ tenants: rows.results.map(tenant) });
});

adminRoutes.post("/tenants", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  const body = await c.req.json().catch(() => null) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return error(c, 400, "VALIDATION_ERROR", "テナント名を確認してください");
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare("INSERT INTO tenants (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)").bind(id, name, new Date().toISOString()).run();
  } catch {
    return error(c, 409, "CONFLICT", "そのテナント名はすでに使われています");
  }
  return c.json({ tenant: { id, name, memberCount: 0, workspaceCount: 0 } }, 201);
});

adminRoutes.delete("/tenants/:id", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  if (c.req.param("id") === "00000000-0000-4000-8000-000000000001") return error(c, 400, "VALIDATION_ERROR", "既定テナントは削除できません");
  const result = await c.env.DB.prepare("UPDATE tenants SET deleted_at = COALESCE(deleted_at, ?1), updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL").bind(new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "テナントが見つかりません");
  return c.body(null, 204);
});

adminRoutes.post("/users", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  const parsed = AdminUserCreateRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.password !== parsed.data.passwordConfirmation) return error(c, 400, "VALIDATION_ERROR", "入力内容を確認してください。パスワードは英字・数字・記号を含む8〜20文字で、確認入力と一致させてください");
  if (parsed.success && parsed.data.role === "system_admin" && current.role !== "system_admin") return error(c, 403, "FORBIDDEN", "システム管理者を作成できるのはシステム管理者だけです");
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE login_id = ?1").bind(parsed.data.loginId).first();
  if (existing) return error(c, 409, "CONFLICT", "そのログインIDはすでに使われています");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const tenantId = parsed.data.tenantId ?? current.tenantId;
  const targetTenant = await c.env.DB.prepare("SELECT id FROM tenants WHERE id = ?1 AND deleted_at IS NULL").bind(tenantId).first();
  if (!targetTenant) return error(c, 400, "VALIDATION_ERROR", "テナントを確認してください");
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users (id, login_id, display_name, role, account_type, primary_tenant_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)").bind(id, parsed.data.loginId, parsed.data.displayName, parsed.data.role === "system_admin" ? "admin" : parsed.data.role === "verifier" ? "approver" : "employee", parsed.data.role, tenantId, now),
    c.env.DB.prepare("INSERT INTO password_credentials (user_id, hash, algorithm, params_json, updated_at) VALUES (?1, ?2, 'pbkdf2-sha256', '{\"iterations\":100000,\"hash\":\"SHA-256\",\"keyLength\":256}', ?3)").bind(id, await hashPassword(parsed.data.password), now),
    c.env.DB.prepare("INSERT INTO tenant_members (tenant_id, user_id, created_at) VALUES (?1, ?2, ?3)").bind(tenantId, id, now),
  ]);
  return c.json({ user: { id, loginId: parsed.data.loginId, displayName: parsed.data.displayName, role: parsed.data.role, tenantId, disabledAt: null } }, 201);
});

adminRoutes.patch("/users/:id", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  const body = await c.req.json().catch(() => null);
  const parsed = body && typeof body.displayName === "string" && body.displayName.trim().length > 0 && body.displayName.trim().length <= 100 && (body.role === undefined || ["system_admin", "system_operator", "verifier", "member"].includes(body.role)) && (body.tenantId === undefined || typeof body.tenantId === "string") ? { data: { displayName: body.displayName.trim(), role: body.role, tenantId: body.tenantId } } : null;
  if (!parsed) return error(c, 400, "VALIDATION_ERROR", "アカウント名を確認してください");
  if (parsed.data.role === "system_admin" && current.role !== "system_admin") return error(c, 403, "FORBIDDEN", "システム管理者の変更はシステム管理者だけが行えます");
  const legacyRole = parsed.data.role === undefined ? null : parsed.data.role === "system_admin" ? "admin" : parsed.data.role === "verifier" ? "approver" : "employee";
  const targetTenantId = parsed.data.tenantId ?? undefined;
  if (targetTenantId) {
    const tenantExists = await c.env.DB.prepare("SELECT id FROM tenants WHERE id = ?1 AND deleted_at IS NULL").bind(targetTenantId).first();
    if (!tenantExists) return error(c, 400, "VALIDATION_ERROR", "テナントを確認してください");
  }
  const result = await c.env.DB.prepare("UPDATE users SET display_name = ?1, role = COALESCE(?2, role), account_type = COALESCE(?3, account_type), primary_tenant_id = COALESCE(?4, primary_tenant_id), updated_at = ?5 WHERE id = ?6").bind(parsed.data.displayName, legacyRole, parsed.data.role ?? null, targetTenantId ?? null, new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "ユーザーが見つかりません");
  if (targetTenantId) await c.env.DB.prepare("INSERT OR IGNORE INTO tenant_members (tenant_id, user_id, created_at) VALUES (?1, ?2, ?3)").bind(targetTenantId, c.req.param("id"), new Date().toISOString()).run();
  return c.json({ ok: true });
});

adminRoutes.post("/users/:id/password", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  const body = await c.req.json().catch(() => null);
  const parsed = body && typeof body.password === "string" && typeof body.passwordConfirmation === "string" && PasswordPolicySchema.safeParse(body.password).success ? { data: body } : null;
  if (!parsed || parsed.data.password !== parsed.data.passwordConfirmation) return error(c, 400, "VALIDATION_ERROR", "パスワードは英字・数字・記号を含む8〜20文字で、確認入力と一致させてください");
  const result = await c.env.DB.prepare("UPDATE password_credentials SET hash = ?1, updated_at = ?2, failed_attempts = 0, blocked_until = NULL WHERE user_id = ?3").bind(await hashPassword(parsed.data.password), new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "ユーザーが見つかりません");
  return c.body(null, 204);
});

adminRoutes.patch("/users/:id/2fa", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  const body = await c.req.json().catch(() => null) as { required?: unknown } | null;
  if (typeof body?.required !== "boolean") return error(c, 400, "VALIDATION_ERROR", "二段階認証の設定を確認してください");
  const target = await c.env.DB.prepare("SELECT account_type, role FROM users WHERE id = ?1").bind(c.req.param("id")).first<{ account_type?: string; role?: string }>();
  if (!target) return error(c, 404, "NOT_FOUND", "ユーザーが見つかりません");
  if (target.account_type === "system_admin" || target.role === "admin") return error(c, 400, "VALIDATION_ERROR", "システム管理者には二段階認証を設定できません");
  await c.env.DB.prepare("UPDATE users SET two_factor_required = ?1, updated_at = ?2 WHERE id = ?3").bind(body.required ? 1 : 0, new Date().toISOString(), c.req.param("id")).run();
  return c.json({ ok: true, required: body.required });
});

adminRoutes.post("/users/:id/2fa/reset", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  const targetId = c.req.param("id");
  const target = await c.env.DB.prepare("SELECT account_type, role FROM users WHERE id = ?1 AND disabled_at IS NULL").bind(targetId).first<{ account_type?: string; role?: string }>();
  if (!target) return error(c, 404, "NOT_FOUND", "ユーザーが見つかりません");
  if (target.account_type === "system_admin" || target.role === "admin") return error(c, 400, "VALIDATION_ERROR", "システム管理者の二段階認証はリセットできません");
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET two_factor_secret = NULL, two_factor_enrolled_at = NULL, two_factor_required = 1, updated_at = ?1 WHERE id = ?2").bind(now, targetId),
    c.env.DB.prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?1) WHERE user_id = ?2").bind(now, targetId),
  ]);
  return c.json({ ok: true, required: true });
});

adminRoutes.delete("/users/:id", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  if (current.id === c.req.param("id")) return error(c, 400, "VALIDATION_ERROR", "自分自身は無効化できません");
  const result = await c.env.DB.prepare("UPDATE users SET disabled_at = COALESCE(disabled_at, ?1), updated_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "ユーザーが見つかりません");
  return c.body(null, 204);
});

adminRoutes.get("/workspaces", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  const rows = await c.env.DB.prepare("SELECT w.id, w.name, w.description, w.created_at, w.tenant_id, t.name AS tenant_name, w.sharing_mode, w.verification_mode, COUNT(wm.user_id) AS member_count FROM workspaces w JOIN tenants t ON t.id = w.tenant_id LEFT JOIN workspace_members wm ON wm.workspace_id = w.id WHERE w.deleted_at IS NULL AND t.deleted_at IS NULL GROUP BY w.id ORDER BY t.name, w.created_at DESC").all<Record<string, unknown>>();
  return c.json({ workspaces: rows.results.map((row) => ({ id: row.id, name: row.name, description: row.description, createdAt: row.created_at, tenantId: row.tenant_id, tenantName: row.tenant_name, sharingMode: row.sharing_mode, verificationMode: row.verification_mode, memberCount: Number(row.member_count) })) });
});

adminRoutes.post("/workspaces", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  const parsed = WorkspaceCreateRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return error(c, 400, "VALIDATION_ERROR", "ワークスペース名を確認してください");
  const tenantId = parsed.data.tenantId ?? current.tenantId;
  const tenantExists = await c.env.DB.prepare("SELECT id FROM tenants WHERE id = ?1 AND deleted_at IS NULL").bind(tenantId).first();
  if (!tenantExists) return error(c, 400, "VALIDATION_ERROR", "テナントを確認してください");
  const memberIds = parsed.data.memberIds.length ? parsed.data.memberIds : (await c.env.DB.prepare("SELECT u.id FROM users u JOIN tenant_members tm ON tm.user_id = u.id AND tm.tenant_id = ?1 WHERE u.disabled_at IS NULL").bind(tenantId).all<{ id: string }>()).results.map((row) => row.id);
  const workspaceId = crypto.randomUUID();
  const rootId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [c.env.DB.prepare("INSERT INTO workspaces (id, name, description, created_by, created_at, updated_at, tenant_id, sharing_mode, verification_mode) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8)").bind(workspaceId, parsed.data.name, parsed.data.description ?? null, current.id, now, tenantId, parsed.data.sharingMode, parsed.data.verificationMode), c.env.DB.prepare("INSERT INTO folders (id, name, parent_id, kind, owner_user_id, read_only, created_by, created_at, updated_at, workspace_id, permission_mode) VALUES (?1, ?2, NULL, 'shared', NULL, 0, ?3, ?4, ?4, ?5, 'blacklist')").bind(rootId, parsed.data.name, current.id, now, workspaceId)];
  for (const memberId of memberIds) {
    statements.push(c.env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, created_at) VALUES (?1, ?2, ?3)").bind(workspaceId, memberId, now));
    if (parsed.data.sharingMode === "member_scoped") statements.push(c.env.DB.prepare("INSERT INTO folders (id, name, parent_id, kind, owner_user_id, read_only, created_by, created_at, updated_at, workspace_id, permission_mode) VALUES (?1, ?2, ?3, 'personal', ?4, 0, ?5, ?6, ?6, ?7, 'blacklist')").bind(crypto.randomUUID(), (await c.env.DB.prepare("SELECT display_name FROM users WHERE id = ?1").bind(memberId).first<{ display_name: string }>())?.display_name ?? "メンバー", rootId, memberId, current.id, now, workspaceId));
  }
  await c.env.DB.batch(statements);
  return c.json({ workspace: { id: workspaceId, name: parsed.data.name, description: parsed.data.description ?? null, memberCount: memberIds.length } }, 201);
});

adminRoutes.delete("/workspaces/:id", async (c) => {
  const current = await accountManagerOrForbidden(c);
  if (!current.id) return current;
  const result = await c.env.DB.prepare("UPDATE workspaces SET deleted_at = COALESCE(deleted_at, ?1), updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL").bind(new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "ワークスペースが見つかりません");
  return c.body(null, 204);
});

adminRoutes.patch("/folders/:id", async (c) => {
  const current = await fileManagerOrForbidden(c);
  if (!current.id) return current;
  const body = await c.req.json().catch(() => null);
  const parsed = body && (body.name === undefined || (typeof body.name === "string" && body.name.trim().length > 0 && body.name.trim().length <= 100)) && (body.readOnly === undefined || typeof body.readOnly === "boolean") && (body.permissionMode === undefined || ["whitelist", "blacklist"].includes(body.permissionMode)) ? { data: body } : null;
  if (!parsed) return error(c, 400, "VALIDATION_ERROR", "フォルダ設定を確認してください");
  const result = await c.env.DB.prepare("UPDATE folders SET name = COALESCE(?1, name), read_only = COALESCE(?2, read_only), permission_mode = COALESCE(?3, permission_mode), updated_at = ?4 WHERE id = ?5").bind(parsed.data.name ?? null, parsed.data.readOnly === undefined ? null : (parsed.data.readOnly ? 1 : 0), parsed.data.permissionMode ?? null, new Date().toISOString(), c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "フォルダが見つかりません");
  return c.json({ ok: true });
});

adminRoutes.put("/folders/:id/permissions", async (c) => {
  const current = await fileManagerOrForbidden(c);
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
