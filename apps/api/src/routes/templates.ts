import { Hono } from "hono";
import { AttendanceExportFormatSchema } from "@timesheet/shared";
import { canManageFiles, requireFileManager } from "../auth/guard";
import { safeFileName, validateUpload } from "../files/validation";

type TemplateBindings = { DB: D1Database; FILES: R2Bucket; APP_ENV: string; MAX_UPLOAD_MIB: string };
export const templateRoutes = new Hono<{ Bindings: TemplateBindings }>();

function error(c: any, status: 400 | 401 | 403 | 404 | 413, code: string, message: string) {
  return c.json({ error: { code, message, requestId: c.get("requestId") ?? crypto.randomUUID() } }, status);
}

async function manager(c: any) {
  const current = await requireFileManager(c);
  return current && canManageFiles(current.role) ? current : null;
}

async function templateFolder(c: any, workspaceId: string, userId: string) {
  const existing = await c.env.DB.prepare("SELECT id FROM folders WHERE workspace_id = ?1 AND kind = 'template_library' LIMIT 1").bind(workspaceId).first() as { id: string } | null;
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare("INSERT INTO folders (id, name, parent_id, kind, owner_user_id, read_only, created_by, created_at, updated_at, workspace_id, permission_mode) VALUES (?1, 'テンプレート', NULL, 'template_library', NULL, 1, ?2, ?3, ?3, ?4, 'blacklist')").bind(id, userId, now, workspaceId).run();
  return id;
}

templateRoutes.get("/", async (c) => {
  const current = await manager(c);
  if (!current) return error(c, 403, "FORBIDDEN", "テンプレート管理権限が必要です");
  const workspaceId = c.req.query("workspaceId") ?? "";
  const tenantId = c.req.query("tenantId") ?? "";
  const clauses = ["t.active = 1"];
  const values: string[] = [];
  if (workspaceId) { clauses.push("w.id = ?"); values.push(workspaceId); }
  if (tenantId) { clauses.push("w.tenant_id = ?"); values.push(tenantId); }
  const rows = await c.env.DB.prepare(`SELECT t.id, t.name, t.version, t.size_bytes, t.content_type, t.export_format, t.created_at, f.workspace_id, w.name AS workspace_name, w.tenant_id, tn.name AS tenant_name FROM templates t LEFT JOIN folders f ON f.id = t.folder_id LEFT JOIN workspaces w ON w.id = f.workspace_id LEFT JOIN tenants tn ON tn.id = w.tenant_id WHERE ${clauses.join(" AND ")} ORDER BY t.created_at DESC`).bind(...values).all<Record<string, unknown>>();
  return c.json({ templates: rows.results.map((row) => ({ id: row.id, name: row.name, format: row.export_format ?? null, version: Number(row.version), sizeBytes: Number(row.size_bytes), contentType: row.content_type, createdAt: row.created_at, workspaceId: row.workspace_id ?? null, workspaceName: row.workspace_name ?? null, tenantId: row.tenant_id ?? null, tenantName: row.tenant_name ?? null })) });
});

templateRoutes.post("/", async (c) => {
  const current = await manager(c);
  if (!current) return error(c, 403, "FORBIDDEN", "テンプレート管理権限が必要です");
  const form = await c.req.raw.formData().catch(() => null);
  const file = form?.get("file");
  const formatValue = form?.get("format");
  const parsedFormat = AttendanceExportFormatSchema.safeParse(typeof formatValue === "string" ? formatValue : "");
  if (!parsedFormat.success) return error(c, 400, "VALIDATION_ERROR", "テンプレート形式を選択してください");
  const workspaceId = typeof form?.get("workspaceId") === "string" ? String(form?.get("workspaceId")) : "";
  if (!(file instanceof File)) return error(c, 400, "VALIDATION_ERROR", "ファイルを選択してください");
  const maxBytes = Number(c.env.MAX_UPLOAD_MIB ?? 10) * 1024 * 1024;
  const validationError = await validateUpload(file, maxBytes, true);
  if (validationError === "ファイルサイズが上限を超えています") return error(c, 413, "FILE_TOO_LARGE", validationError);
  if (validationError) return error(c, 400, "VALIDATION_ERROR", validationError);
  let folderId: string | null = null;
  if (workspaceId) {
    const workspace = await c.env.DB.prepare("SELECT id FROM workspaces WHERE id = ?1 AND deleted_at IS NULL").bind(workspaceId).first();
    if (!workspace) return error(c, 404, "NOT_FOUND", "ワークスペースが見つかりません");
    folderId = await templateFolder(c, workspaceId, current.id);
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", data);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const fileName = safeFileName(file.name);
  const key = `templates/${id}/${fileName}`;
  await c.env.FILES.put(key, data, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  await c.env.DB.prepare("INSERT INTO templates (id, name, version, r2_key, sha256, size_bytes, created_by, created_at, active, folder_id, content_type, export_format) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9, ?10)").bind(id, fileName, key, sha256, file.size, current.id, now, folderId, file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", parsedFormat.data).run();
  return c.json({ template: { id, name: fileName, format: parsedFormat.data, version: 1, sizeBytes: file.size, workspaceId: workspaceId || null } }, 201);
});

templateRoutes.patch("/:id", async (c) => {
  const current = await manager(c);
  if (!current) return error(c, 403, "FORBIDDEN", "テンプレート管理権限が必要です");
  const body = await c.req.json().catch(() => null) as { workspaceId?: unknown } | null;
  if (body?.workspaceId !== null && typeof body?.workspaceId !== "string") return error(c, 400, "VALIDATION_ERROR", "ワークスペースを確認してください");
  const template = await c.env.DB.prepare("SELECT id FROM templates WHERE id = ?1 AND active = 1").bind(c.req.param("id")).first();
  if (!template) return error(c, 404, "NOT_FOUND", "テンプレートが見つかりません");
  if (body.workspaceId && !(await c.env.DB.prepare("SELECT id FROM workspaces WHERE id = ?1 AND deleted_at IS NULL").bind(body.workspaceId).first())) return error(c, 404, "NOT_FOUND", "ワークスペースが見つかりません");
  const folderId = body.workspaceId ? await templateFolder(c, body.workspaceId, current.id) : null;
  await c.env.DB.prepare("UPDATE templates SET folder_id = ?1 WHERE id = ?2").bind(folderId, c.req.param("id")).run();
  return c.json({ ok: true, workspaceId: body.workspaceId ?? null });
});

templateRoutes.delete("/:id", async (c) => {
  const current = await manager(c);
  if (!current) return error(c, 403, "FORBIDDEN", "テンプレート管理権限が必要です");
  const result = await c.env.DB.prepare("UPDATE templates SET active = 0 WHERE id = ?1 AND active = 1").bind(c.req.param("id")).run();
  if (!result.meta.changes) return error(c, 404, "NOT_FOUND", "テンプレートが見つかりません");
  return c.body(null, 204);
});

templateRoutes.get("/:id/download", async (c) => {
  const current = await manager(c);
  if (!current) return error(c, 403, "FORBIDDEN", "テンプレート参照権限が必要です");
  const row = await c.env.DB.prepare("SELECT name, r2_key, content_type FROM templates WHERE id = ?1 AND active = 1").bind(c.req.param("id")).first<{ name: string; r2_key: string; content_type: string }>();
  if (!row) return error(c, 404, "NOT_FOUND", "テンプレートが見つかりません");
  const object = await c.env.FILES.get(row.r2_key);
  if (!object) return error(c, 404, "NOT_FOUND", "ファイルが見つかりません");
  return new Response(object.body, { headers: { "Content-Type": row.content_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
});
