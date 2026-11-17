import { Hono } from "hono";
import { FolderPermissionModeSchema, WorkspaceCreateRequestSchema } from "@timesheet/shared";
import { getSessionUser, requireFileManager } from "../auth/guard";

type WorkspaceBindings = { DB: D1Database; FILES: R2Bucket; APP_ENV: string; MAX_UPLOAD_MIB: string };
export const workspaceRoutes = new Hono<{ Bindings: WorkspaceBindings }>();

function error(c: any, status: 400 | 401 | 403 | 404 | 413, code: string, message: string) {
  return c.json({ error: { code, message, requestId: c.get("requestId") ?? crypto.randomUUID() } }, status);
}

workspaceRoutes.get("/", async (c) => {
  const current = await getSessionUser(c);
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (current.suspendedAt) return c.json({ workspaces: [] });
  const allTenants = current.role === "system_admin" || current.role === "system_operator";
  const query = allTenants
    ? "SELECT w.id, w.name, w.description, w.created_at, w.tenant_id, t.name AS tenant_name, w.sharing_mode, w.verification_mode, COUNT(wm2.user_id) AS member_count FROM workspaces w JOIN tenants t ON t.id = w.tenant_id LEFT JOIN workspace_members wm2 ON wm2.workspace_id = w.id WHERE w.deleted_at IS NULL AND t.deleted_at IS NULL GROUP BY w.id ORDER BY t.name, w.created_at DESC"
    : "SELECT w.id, w.name, w.description, w.created_at, w.tenant_id, t.name AS tenant_name, w.sharing_mode, w.verification_mode, COUNT(wm2.user_id) AS member_count FROM workspaces w JOIN tenants t ON t.id = w.tenant_id JOIN tenant_members tm ON tm.tenant_id = w.tenant_id AND tm.user_id = ?1 LEFT JOIN folders access_root ON access_root.workspace_id = w.id AND access_root.parent_id IS NULL WHERE w.deleted_at IS NULL AND t.deleted_at IS NULL AND (?2 IN ('system_admin', 'system_operator', 'verifier') OR w.sharing_mode = 'member_scoped' OR (access_root.permission_mode = 'blacklist' AND NOT EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = access_root.id AND fp.user_id = ?1)) OR (access_root.permission_mode = 'whitelist' AND EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = access_root.id AND fp.user_id = ?1))) GROUP BY w.id ORDER BY t.name, w.created_at DESC";
  const rows = allTenants ? await c.env.DB.prepare(query).all<Record<string, unknown>>() : await c.env.DB.prepare(query).bind(current.id, current.role).all<Record<string, unknown>>();
  return c.json({ workspaces: rows.results.map((row) => ({ id: row.id, name: row.name, description: row.description, createdAt: row.created_at, tenantId: row.tenant_id, tenantName: row.tenant_name, sharingMode: row.sharing_mode, verificationMode: row.verification_mode, memberCount: Number(row.member_count) })) });
});

workspaceRoutes.post("/", async (c) => {
  const current = await getSessionUser(c);
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (current.suspendedAt) return error(c, 403, "FORBIDDEN", "停止中のアカウントはワークスペースを作成できません");
  if (current.role === "member") return error(c, 403, "FORBIDDEN", "メンバーはワークスペースを作成できません");
  const parsed = WorkspaceCreateRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return error(c, 400, "VALIDATION_ERROR", "ワークスペース名を確認してください");
  const crossTenant = current.role === "system_admin" || current.role === "system_operator";
  const tenantId = parsed.data.tenantId ?? current.tenantId;
  const tenant = crossTenant
    ? await c.env.DB.prepare("SELECT id FROM tenants WHERE id = ?1 AND deleted_at IS NULL").bind(tenantId).first()
    : await c.env.DB.prepare("SELECT t.id FROM tenants t JOIN tenant_members tm ON tm.tenant_id = t.id AND tm.user_id = ?1 WHERE t.id = ?2 AND t.deleted_at IS NULL").bind(current.id, tenantId).first();
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
  const permissionUserIds = parsed.data.sharingMode === "shared_box" ? Array.from(new Set(parsed.data.permissionUserIds)) : [];
  const permissionUsers = permissionUserIds.length ? await c.env.DB.prepare(`SELECT id FROM users u JOIN tenant_members tm ON tm.user_id = u.id AND tm.tenant_id = ?1 WHERE u.disabled_at IS NULL AND u.id IN (${permissionUserIds.map(() => "?").join(",")})`).bind(tenantId, ...permissionUserIds).all<{ id: string }>() : { results: [] };
  if (permissionUsers.results.length !== permissionUserIds.length) return error(c, 400, "VALIDATION_ERROR", "参照権限のユーザーを確認してください");
  const statements = [c.env.DB.prepare("INSERT INTO workspaces (id, name, description, created_by, created_at, updated_at, tenant_id, sharing_mode, verification_mode) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8)").bind(workspaceId, parsed.data.name, parsed.data.description ?? null, current.id, now, tenantId, parsed.data.sharingMode, parsed.data.verificationMode), c.env.DB.prepare("INSERT INTO folders (id, name, parent_id, kind, owner_user_id, read_only, created_by, created_at, updated_at, workspace_id, permission_mode) VALUES (?1, ?2, NULL, 'shared', NULL, 0, ?3, ?4, ?4, ?5, ?6)").bind(rootId, parsed.data.name, current.id, now, workspaceId, parsed.data.permissionMode)];
  for (const permissionUserId of permissionUserIds) statements.push(c.env.DB.prepare("INSERT INTO folder_permissions (id, folder_id, user_id, role, can_read, can_write, created_at) VALUES (?1, ?2, ?3, NULL, 1, 0, ?4)").bind(crypto.randomUUID(), rootId, permissionUserId, now));
  for (const memberId of scopedMemberIds) {
    statements.push(c.env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, created_at) VALUES (?1, ?2, ?3)").bind(workspaceId, memberId, now));
    if (parsed.data.sharingMode === "member_scoped") statements.push(c.env.DB.prepare("INSERT INTO folders (id, name, parent_id, kind, owner_user_id, read_only, created_by, created_at, updated_at, workspace_id, permission_mode) VALUES (?1, ?2, ?3, 'personal', ?4, 0, ?5, ?6, ?6, ?7, 'blacklist')").bind(crypto.randomUUID(), nameById.get(memberId) ?? "メンバー", rootId, memberId, current.id, now, workspaceId));
  }
  await c.env.DB.batch(statements);
  return c.json({ workspace: { id: workspaceId, name: parsed.data.name, description: parsed.data.description ?? null, tenantId, sharingMode: parsed.data.sharingMode, verificationMode: parsed.data.verificationMode, memberCount: scopedMemberIds.length } }, 201);
});

workspaceRoutes.get("/:id/access", async (c) => {
  const current = await getSessionUser(c);
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (current.role !== "system_admin" && current.role !== "verifier") return error(c, 403, "FORBIDDEN", "参照権限の設定を変更できません");
  const workspace = await c.env.DB.prepare("SELECT w.id, w.tenant_id, w.sharing_mode, f.id AS folder_id, f.permission_mode FROM workspaces w JOIN tenants t ON t.id = w.tenant_id JOIN folders f ON f.workspace_id = w.id AND f.parent_id IS NULL WHERE w.id = ?1 AND w.deleted_at IS NULL AND t.deleted_at IS NULL").bind(c.req.param("id")).first<{ id: string; tenant_id: string; sharing_mode: string; folder_id: string; permission_mode: string }>();
  if (!workspace) return error(c, 404, "NOT_FOUND", "ワークスペースが見つかりません");
  if (current.role === "verifier" && !await c.env.DB.prepare("SELECT 1 FROM tenant_members WHERE tenant_id = ?1 AND user_id = ?2").bind(workspace.tenant_id, current.id).first()) return error(c, 403, "FORBIDDEN", "ワークスペース参照権限がありません");
  const users = await c.env.DB.prepare("SELECT u.id, u.display_name, EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = ?1 AND fp.user_id = u.id AND fp.can_read = 1) AS selected FROM users u JOIN tenant_members tm ON tm.user_id = u.id AND tm.tenant_id = ?2 WHERE u.disabled_at IS NULL ORDER BY u.display_name").bind(workspace.folder_id, workspace.tenant_id).all<{ id: string; display_name: string; selected: number }>();
  return c.json({ sharingMode: workspace.sharing_mode, permissionMode: workspace.permission_mode, users: users.results.map((user) => ({ id: user.id, displayName: user.display_name, selected: Boolean(user.selected) })) });
});

workspaceRoutes.put("/:id/access", async (c) => {
  const current = await requireFileManager(c);
  if (!current) return error(c, 403, "FORBIDDEN", "参照権限の設定を変更できません");
  const body = await c.req.json().catch(() => null) as { mode?: unknown; userIds?: unknown } | null;
  const mode = FolderPermissionModeSchema.safeParse(body?.mode);
  if (!mode.success || !Array.isArray(body?.userIds) || !body.userIds.every((id) => typeof id === "string") ) return error(c, 400, "VALIDATION_ERROR", "参照権限の設定を確認してください");
  const workspace = await c.env.DB.prepare("SELECT w.id, w.tenant_id, w.sharing_mode, f.id AS folder_id FROM workspaces w JOIN tenants t ON t.id = w.tenant_id JOIN folders f ON f.workspace_id = w.id AND f.parent_id IS NULL WHERE w.id = ?1 AND w.deleted_at IS NULL AND t.deleted_at IS NULL").bind(c.req.param("id")).first<{ id: string; tenant_id: string; sharing_mode: string; folder_id: string }>();
  if (!workspace || workspace.sharing_mode !== "shared_box") return error(c, 400, "VALIDATION_ERROR", "共有ボックスのワークスペースだけ設定できます");
  if (current.role === "verifier" && !await c.env.DB.prepare("SELECT 1 FROM tenant_members WHERE tenant_id = ?1 AND user_id = ?2").bind(workspace.tenant_id, current.id).first()) return error(c, 403, "FORBIDDEN", "ワークスペース参照権限がありません");
  const userIds = Array.from(new Set(body.userIds as string[]));
  const users = userIds.length ? await c.env.DB.prepare(`SELECT u.id FROM users u JOIN tenant_members tm ON tm.user_id = u.id AND tm.tenant_id = ?1 WHERE u.disabled_at IS NULL AND u.id IN (${userIds.map(() => "?").join(",")})`).bind(workspace.tenant_id, ...userIds).all<{ id: string }>() : { results: [] };
  if (users.results.length !== userIds.length) return error(c, 400, "VALIDATION_ERROR", "参照権限のユーザーを確認してください");
  const now = new Date().toISOString();
  const statements = [c.env.DB.prepare("UPDATE folders SET permission_mode = ?1, updated_at = ?2 WHERE id = ?3").bind(mode.data, now, workspace.folder_id), c.env.DB.prepare("DELETE FROM folder_permissions WHERE folder_id = ?1").bind(workspace.folder_id)];
  for (const userId of userIds) statements.push(c.env.DB.prepare("INSERT INTO folder_permissions (id, folder_id, user_id, role, can_read, can_write, created_at) VALUES (?1, ?2, ?3, NULL, 1, 0, ?4)").bind(crypto.randomUUID(), workspace.folder_id, userId, now));
  await c.env.DB.batch(statements);
  return c.json({ ok: true, permissionMode: mode.data, userIds });
});

workspaceRoutes.get("/:id/templates", async (c) => {
  const current = await getSessionUser(c);
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (current.suspendedAt) return c.json({ templates: [] });
  const workspaceId = c.req.param("id");
  const allowed = await c.env.DB.prepare("SELECT w.id FROM workspaces w JOIN tenants t ON t.id = w.tenant_id JOIN tenant_members tm ON tm.tenant_id = w.tenant_id AND tm.user_id = ?1 LEFT JOIN folders access_root ON access_root.workspace_id = w.id AND access_root.parent_id IS NULL WHERE w.id = ?2 AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND (?3 IN ('system_admin', 'system_operator', 'verifier') OR w.sharing_mode = 'member_scoped' OR (access_root.permission_mode = 'blacklist' AND NOT EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = access_root.id AND fp.user_id = ?1)) OR (access_root.permission_mode = 'whitelist' AND EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = access_root.id AND fp.user_id = ?1)))").bind(current.id, workspaceId, current.role).first();
  if (!allowed && current.role !== "system_admin" && current.role !== "system_operator") return error(c, 403, "FORBIDDEN", "ワークスペース参照権限がありません");
  const rows = await c.env.DB.prepare("SELECT t.id, t.name, t.size_bytes, t.content_type FROM templates t JOIN folders f ON f.id = t.folder_id AND f.workspace_id = ?1 WHERE t.active = 1 ORDER BY t.created_at DESC").bind(workspaceId).all<Record<string, unknown>>();
  return c.json({ templates: rows.results.map((row) => ({ id: row.id, name: row.name, sizeBytes: Number(row.size_bytes), contentType: row.content_type })) });
});

workspaceRoutes.get("/:id/templates/:templateId/download", async (c) => {
  const current = await getSessionUser(c);
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  const allowed = await c.env.DB.prepare("SELECT w.id FROM workspaces w JOIN tenants t ON t.id = w.tenant_id JOIN tenant_members tm ON tm.tenant_id = w.tenant_id AND tm.user_id = ?1 LEFT JOIN folders access_root ON access_root.workspace_id = w.id AND access_root.parent_id IS NULL WHERE w.id = ?2 AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND (?3 IN ('system_admin', 'system_operator', 'verifier') OR w.sharing_mode = 'member_scoped' OR (access_root.permission_mode = 'blacklist' AND NOT EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = access_root.id AND fp.user_id = ?1)) OR (access_root.permission_mode = 'whitelist' AND EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = access_root.id AND fp.user_id = ?1)))").bind(current.id, c.req.param("id"), current.role).first();
  if (!allowed && current.role !== "system_admin" && current.role !== "system_operator") return error(c, 403, "FORBIDDEN", "ワークスペース参照権限がありません");
  const row = await c.env.DB.prepare("SELECT t.name, t.r2_key, t.content_type FROM templates t JOIN folders f ON f.id = t.folder_id AND f.workspace_id = ?1 WHERE t.id = ?2 AND t.active = 1").bind(c.req.param("id"), c.req.param("templateId")).first<{ name: string; r2_key: string; content_type: string }>();
  if (!row) return error(c, 404, "NOT_FOUND", "テンプレートが見つかりません");
  const object = await c.env.FILES.get(row.r2_key);
  if (!object) return error(c, 404, "NOT_FOUND", "ファイルが見つかりません");
  return new Response(object.body, { headers: { "Content-Type": row.content_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}` } });
});

async function workspaceAccess(c: any, workspaceId: string) {
  const current = await getSessionUser(c);
  if (!current) return { current: null, allowed: false };
  if (current.suspendedAt) return { current, allowed: false };
  const member = await c.env.DB.prepare("SELECT w.id, w.sharing_mode FROM workspaces w JOIN tenants t ON t.id = w.tenant_id JOIN tenant_members tm ON tm.tenant_id = w.tenant_id AND tm.user_id = ?1 LEFT JOIN folders access_root ON access_root.workspace_id = w.id AND access_root.parent_id IS NULL WHERE w.id = ?2 AND w.deleted_at IS NULL AND t.deleted_at IS NULL AND (?3 IN ('system_admin', 'system_operator', 'verifier') OR w.sharing_mode = 'member_scoped' OR (access_root.permission_mode = 'blacklist' AND NOT EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = access_root.id AND fp.user_id = ?1)) OR (access_root.permission_mode = 'whitelist' AND EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = access_root.id AND fp.user_id = ?1)))").bind(current.id, workspaceId, current.role).first() as { id: string; sharing_mode: string } | null;
  const elevated = current.role === "system_admin" || current.role === "system_operator" || current.role === "verifier";
  return { current, allowed: Boolean(member) || current.role === "system_admin" || current.role === "system_operator", sharingMode: member?.sharing_mode ?? null };
}

workspaceRoutes.get("/:id/files", async (c) => {
  const { current, allowed } = await workspaceAccess(c, c.req.param("id"));
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (!allowed) return error(c, 403, "FORBIDDEN", "ワークスペース参照権限がありません");
  const rows = await c.env.DB.prepare("SELECT d.id, d.name, d.category, d.size_bytes, d.content_type, d.created_at, f.name AS folder_name FROM documents d JOIN folders f ON f.id = d.folder_id AND f.workspace_id = ?1 JOIN workspaces w ON w.id = f.workspace_id WHERE d.deleted_at IS NULL AND (w.sharing_mode = 'shared_box' OR ?2 IN ('system_admin', 'system_operator', 'verifier') OR f.owner_user_id = ?3) ORDER BY d.created_at DESC").bind(c.req.param("id"), current.role, current.id).all<Record<string, unknown>>();
  return c.json({ files: rows.results.map((row) => ({ id: row.id, name: row.name, category: row.category, sizeBytes: Number(row.size_bytes), contentType: row.content_type, createdAt: row.created_at, folderName: row.folder_name })) });
});

workspaceRoutes.post("/:id/files", async (c) => {
  return error(c, 403, "FORBIDDEN", "セキュリティ上、ユーザーファイルのアップロードは無効です。勤怠入力画面を使用してください");
});

workspaceRoutes.delete("/:id/files/:fileId", async (c) => {
  const { current, allowed } = await workspaceAccess(c, c.req.param("id"));
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (!allowed || current.role === "system_operator") return error(c, 403, "FORBIDDEN", "ファイル削除権限がありません");
  const row = await c.env.DB.prepare("SELECT d.id, d.r2_key, d.owner_user_id FROM documents d JOIN folders f ON f.id = d.folder_id AND f.workspace_id = ?1 WHERE d.id = ?2 AND d.deleted_at IS NULL").bind(c.req.param("id"), c.req.param("fileId")).first<{ id: string; r2_key: string; owner_user_id: string }>();
  if (!row) return error(c, 404, "NOT_FOUND", "ファイルが見つかりません");
  if (current.role !== "system_admin" && current.role !== "verifier" && row.owner_user_id !== current.id) return error(c, 403, "FORBIDDEN", "自分が追加したファイルのみ削除できます");
  await c.env.FILES.delete(row.r2_key);
  await c.env.DB.prepare("UPDATE documents SET deleted_at = ?1 WHERE id = ?2").bind(new Date().toISOString(), row.id).run();
  return c.json({ ok: true });
});

workspaceRoutes.get("/:id/files/:fileId/download", async (c) => {
  const { current, allowed } = await workspaceAccess(c, c.req.param("id"));
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (!allowed) return error(c, 403, "FORBIDDEN", "ワークスペース参照権限がありません");
  const row = await c.env.DB.prepare("SELECT d.name, d.r2_key, d.content_type FROM documents d JOIN folders f ON f.id = d.folder_id AND f.workspace_id = ?1 JOIN workspaces w ON w.id = f.workspace_id WHERE d.id = ?2 AND d.deleted_at IS NULL AND (w.sharing_mode = 'shared_box' OR ?3 IN ('system_admin', 'system_operator', 'verifier') OR f.owner_user_id = ?4)").bind(c.req.param("id"), c.req.param("fileId"), current.role, current.id).first<{ name: string; r2_key: string; content_type: string }>();
  if (!row) return error(c, 404, "NOT_FOUND", "ファイルが見つかりません");
  const object = await c.env.FILES.get(row.r2_key);
  if (!object) return error(c, 404, "NOT_FOUND", "ファイルが見つかりません");
  return new Response(object.body, { headers: { "Content-Type": row.content_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
});
