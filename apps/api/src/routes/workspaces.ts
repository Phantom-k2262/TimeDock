import { Hono } from "hono";
import { WorkspaceCreateRequestSchema } from "@timesheet/shared";
import { getSessionUser } from "../auth/guard";

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

workspaceRoutes.get("/:id/templates", async (c) => {
  const current = await getSessionUser(c);
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (current.suspendedAt) return c.json({ templates: [] });
  const workspaceId = c.req.param("id");
  const allowed = await c.env.DB.prepare("SELECT w.id FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?1 WHERE w.id = ?2 AND w.deleted_at IS NULL").bind(current.id, workspaceId).first();
  if (!allowed && current.role !== "system_admin" && current.role !== "system_operator" && current.role !== "verifier") return error(c, 403, "FORBIDDEN", "ワークスペース参照権限がありません");
  const rows = await c.env.DB.prepare("SELECT t.id, t.name, t.size_bytes, t.content_type FROM templates t JOIN folders f ON f.id = t.folder_id AND f.workspace_id = ?1 WHERE t.active = 1 ORDER BY t.created_at DESC").bind(workspaceId).all<Record<string, unknown>>();
  return c.json({ templates: rows.results.map((row) => ({ id: row.id, name: row.name, sizeBytes: Number(row.size_bytes), contentType: row.content_type })) });
});

workspaceRoutes.get("/:id/templates/:templateId/download", async (c) => {
  const current = await getSessionUser(c);
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  const allowed = await c.env.DB.prepare("SELECT w.id FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?1 WHERE w.id = ?2 AND w.deleted_at IS NULL").bind(current.id, c.req.param("id")).first();
  if (!allowed && current.role !== "system_admin" && current.role !== "system_operator" && current.role !== "verifier") return error(c, 403, "FORBIDDEN", "ワークスペース参照権限がありません");
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
  const member = await c.env.DB.prepare("SELECT w.id FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?1 WHERE w.id = ?2 AND w.deleted_at IS NULL").bind(current.id, workspaceId).first();
  const elevated = current.role === "system_admin" || current.role === "system_operator" || current.role === "verifier";
  return { current, allowed: Boolean(member) || elevated };
}

workspaceRoutes.get("/:id/files", async (c) => {
  const { current, allowed } = await workspaceAccess(c, c.req.param("id"));
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (!allowed) return error(c, 403, "FORBIDDEN", "ワークスペース参照権限がありません");
  const rows = await c.env.DB.prepare("SELECT d.id, d.name, d.category, d.size_bytes, d.content_type, d.created_at, f.name AS folder_name FROM documents d JOIN folders f ON f.id = d.folder_id AND f.workspace_id = ?1 WHERE d.deleted_at IS NULL ORDER BY d.created_at DESC").bind(c.req.param("id")).all<Record<string, unknown>>();
  return c.json({ files: rows.results.map((row) => ({ id: row.id, name: row.name, category: row.category, sizeBytes: Number(row.size_bytes), contentType: row.content_type, createdAt: row.created_at, folderName: row.folder_name })) });
});

workspaceRoutes.post("/:id/files", async (c) => {
  const { current, allowed } = await workspaceAccess(c, c.req.param("id"));
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (!allowed) return error(c, 403, "FORBIDDEN", "ワークスペース追加権限がありません");
  const form = await c.req.raw.formData().catch(() => null);
  const file = form?.get("file");
  const category = typeof form?.get("category") === "string" ? String(form?.get("category")) : "other";
  if (!(file instanceof File) || !file.name) return error(c, 400, "VALIDATION_ERROR", "ファイルを選択してください");
  if (!["timesheet", "expense", "receipt", "other"].includes(category)) return error(c, 400, "VALIDATION_ERROR", "ファイル種別を確認してください");
  const maxBytes = Number(c.env.MAX_UPLOAD_MIB ?? 10) * 1024 * 1024;
  if (file.size > maxBytes) return error(c, 413, "FILE_TOO_LARGE", "ファイルサイズが上限を超えています");
  const folder = await c.env.DB.prepare("SELECT f.id FROM folders f WHERE f.workspace_id = ?1 AND f.read_only = 0 AND (f.parent_id IS NULL OR f.owner_user_id = ?2) ORDER BY CASE WHEN f.owner_user_id = ?2 THEN 0 ELSE 1 END LIMIT 1").bind(c.req.param("id"), current.id).first<{ id: string }>();
  if (!folder) return error(c, 400, "VALIDATION_ERROR", "追加可能なフォルダがありません");
  const data = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", data);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const key = `workspaces/${c.req.param("id")}/${id}/${file.name}`;
  await c.env.FILES.put(key, data, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  await c.env.DB.prepare("INSERT INTO documents (id, folder_id, owner_user_id, name, category, r2_key, sha256, size_bytes, content_type, uploaded_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?3, ?10)").bind(id, folder.id, current.id, file.name, category, key, sha256, file.size, file.type || "application/octet-stream", now).run();
  return c.json({ file: { id, name: file.name, category, sizeBytes: file.size } }, 201);
});

workspaceRoutes.get("/:id/files/:fileId/download", async (c) => {
  const { current, allowed } = await workspaceAccess(c, c.req.param("id"));
  if (!current) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (!allowed) return error(c, 403, "FORBIDDEN", "ワークスペース参照権限がありません");
  const row = await c.env.DB.prepare("SELECT d.name, d.r2_key, d.content_type FROM documents d JOIN folders f ON f.id = d.folder_id AND f.workspace_id = ?1 WHERE d.id = ?2 AND d.deleted_at IS NULL").bind(c.req.param("id"), c.req.param("fileId")).first<{ name: string; r2_key: string; content_type: string }>();
  if (!row) return error(c, 404, "NOT_FOUND", "ファイルが見つかりません");
  const object = await c.env.FILES.get(row.r2_key);
  if (!object) return error(c, 404, "NOT_FOUND", "ファイルが見つかりません");
  return new Response(object.body, { headers: { "Content-Type": row.content_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}` } });
});
