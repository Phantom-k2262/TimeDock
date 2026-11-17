import { Hono } from "hono";
import { MonthlyArchiveQuerySchema } from "@timesheet/shared";
import { hashSessionId, readSessionId } from "../auth/session";
import { createStoredZip } from "../files/zip";

type Bindings = { DB: D1Database; FILES: R2Bucket; APP_ENV: string };
export const archiveRoutes = new Hono<{ Bindings: Bindings }>();

function responseError(c: any, status: 400 | 401 | 404 | 500, code: string, message: string) {
  return c.json({ error: { code, message, requestId: crypto.randomUUID() } }, status);
}

archiveRoutes.get("/monthly", async (c) => {
  const parsed = MonthlyArchiveQuerySchema.safeParse({ month: c.req.query("month") });
  if (!parsed.success) return responseError(c, 400, "VALIDATION_ERROR", "対象月はYYYY-MM形式で指定してください");
  const sessionId = readSessionId(c.req.raw);
  if (!sessionId || !c.env.DB || !c.env.FILES) return responseError(c, 401, "UNAUTHENTICATED", "管理者ログインが必要です");
  const admin = await c.env.DB.prepare("SELECT u.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND u.role = 'admin' AND u.disabled_at IS NULL").bind(await hashSessionId(sessionId), new Date().toISOString()).first<{ id: string }>();
  if (!admin) return responseError(c, 401, "UNAUTHENTICATED", "管理者ログインが必要です");
  const rows = await c.env.DB.prepare("SELECT f.name AS folder_name, d.name, d.category, d.r2_key, d.size_bytes FROM documents d JOIN folders f ON f.id = d.folder_id WHERE f.kind = 'personal' AND d.target_month = ?1 AND d.deleted_at IS NULL ORDER BY f.name, d.name").bind(parsed.data.month).all<{ folder_name: string; name: string; category: "timesheet" | "expense" | "receipt" | "other"; r2_key: string; size_bytes: number }>();
  if (!rows.results.length) return responseError(c, 404, "NOT_FOUND", "対象月のファイルがありません");
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const row of rows.results) {
    const object = await c.env.FILES.get(row.r2_key);
    if (!object) continue;
    const folder = row.category === "expense" || row.category === "receipt" ? "経費・領収証" : "勤務表ファイル";
    entries.push({ name: `${row.folder_name}/${folder}/${row.name}`, data: new Uint8Array(await object.arrayBuffer()) });
  }
  if (!entries.length) return responseError(c, 404, "NOT_FOUND", "対象月のファイルがありません");
  const archive = createStoredZip(entries);
  return new Response(archive as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="timesheets-${parsed.data.month}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
});
