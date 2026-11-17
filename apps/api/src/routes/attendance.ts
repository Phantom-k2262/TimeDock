import { Hono } from "hono";
import { AttendanceExportFormatSchema } from "@timesheet/shared";
import { getSessionUser } from "../auth/guard";
import { createAttendanceWorkbook } from "../attendance/export";

type Bindings = { DB: D1Database; APP_ENV: string };
export const attendanceRoutes = new Hono<{ Bindings: Bindings }>();

function error(c: any, status: 400 | 401 | 403 | 404, message: string) {
  return c.json({ error: { code: status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR", message, requestId: c.get("requestId") ?? crypto.randomUUID() } }, status);
}

function month(value: unknown) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

async function currentUser(c: any) {
  const user = await getSessionUser(c);
  if (!user) return null;
  if (user.suspendedAt) return null;
  return user;
}

attendanceRoutes.get("/month", async (c) => {
  const user = await currentUser(c);
  if (!user) return error(c, 401, "ログインが必要です");
  const targetMonth = month(c.req.query("month"));
  if (!targetMonth) return error(c, 400, "対象年月はYYYY-MM形式で指定してください");
  const [profile, entries, leaveRequests, expenses, report, submission] = await Promise.all([
    c.env.DB.prepare("SELECT p.*, u.display_name FROM attendance_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?1").bind(user.id).first<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT id, work_date, start_time, end_time, break_minutes, project_name, note FROM attendance_entries WHERE user_id = ?1 AND target_month = ?2 ORDER BY work_date").bind(user.id, targetMonth).all<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT id, start_date, end_date, leave_type, reason, status FROM leave_requests WHERE user_id = ?1 AND target_month = ?2 ORDER BY start_date").bind(user.id, targetMonth).all<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT id, expense_date, category, amount, description FROM expense_items WHERE user_id = ?1 AND target_month = ?2 ORDER BY expense_date").bind(user.id, targetMonth).all<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT id, summary, achievements, next_steps FROM monthly_reports WHERE user_id = ?1 AND target_month = ?2").bind(user.id, targetMonth).first<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT status, submitted_at FROM attendance_submissions WHERE user_id = ?1 AND target_month = ?2").bind(user.id, targetMonth).first<Record<string, unknown>>(),
  ]);
  return c.json({ profile, entries: entries.results, leaveRequests: leaveRequests.results, expenses: expenses.results, report, submission });
});

attendanceRoutes.put("/profile", async (c) => {
  const user = await currentUser(c);
  if (!user) return error(c, 401, "ログインが必要です");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const fields = ["employeeCode", "nameKana", "companyName", "divisionName", "departmentName", "projectName", "clientName"] as const;
  if (!body || fields.some((field) => body[field] !== undefined && typeof body[field] !== "string")) return error(c, 400, "共通項目を確認してください");
  const now = new Date().toISOString();
  await c.env.DB.prepare("INSERT INTO attendance_profiles (user_id, employee_code, name_kana, company_name, division_name, department_name, project_name, client_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9) ON CONFLICT(user_id) DO UPDATE SET employee_code = excluded.employee_code, name_kana = excluded.name_kana, company_name = excluded.company_name, division_name = excluded.division_name, department_name = excluded.department_name, project_name = excluded.project_name, client_name = excluded.client_name, updated_at = excluded.updated_at").bind(user.id, body.employeeCode ?? null, body.nameKana ?? null, body.companyName ?? null, body.divisionName ?? null, body.departmentName ?? null, body.projectName ?? null, body.clientName ?? null, now).run();
  return c.json({ ok: true });
});

attendanceRoutes.post("/entries", async (c) => {
  const user = await currentUser(c);
  if (!user) return error(c, 401, "ログインが必要です");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const targetMonth = month(body?.targetMonth);
  if (!targetMonth || typeof body?.workDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.workDate)) return error(c, 400, "勤務日と対象年月を確認してください");
  if (body.startTime !== undefined && body.startTime !== null && typeof body.startTime !== "string") return error(c, 400, "開始時刻を確認してください");
  if (body.endTime !== undefined && body.endTime !== null && typeof body.endTime !== "string") return error(c, 400, "終了時刻を確認してください");
  const breakMinutes = Number(body.breakMinutes ?? 0);
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 1440) return error(c, 400, "休憩時間を確認してください");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO attendance_entries (id, user_id, target_month, work_date, start_time, end_time, break_minutes, project_name, note, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10) ON CONFLICT(user_id, work_date) DO UPDATE SET target_month = excluded.target_month, start_time = excluded.start_time, end_time = excluded.end_time, break_minutes = excluded.break_minutes, project_name = excluded.project_name, note = excluded.note, updated_at = excluded.updated_at").bind(id, user.id, targetMonth, body.workDate, body.startTime ?? null, body.endTime ?? null, breakMinutes, body.projectName ?? null, body.note ?? null, now).run();
  return c.json({ ok: true }, 201);
});

attendanceRoutes.delete("/entries/:id", async (c) => {
  const user = await currentUser(c);
  if (!user) return error(c, 401, "ログインが必要です");
  const result = await c.env.DB.prepare("DELETE FROM attendance_entries WHERE id = ?1 AND user_id = ?2").bind(c.req.param("id"), user.id).run();
  if (!result.meta.changes) return error(c, 404, "勤務実績が見つかりません");
  return c.body(null, 204);
});

attendanceRoutes.post("/leave", async (c) => {
  const user = await currentUser(c);
  if (!user) return error(c, 401, "ログインが必要です");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const targetMonth = month(body?.targetMonth);
  if (!targetMonth || typeof body?.startDate !== "string" || typeof body?.endDate !== "string" || typeof body?.leaveType !== "string") return error(c, 400, "休暇申請の入力を確認してください");
  const now = new Date().toISOString();
  await c.env.DB.prepare("INSERT INTO leave_requests (id, user_id, target_month, start_date, end_date, leave_type, reason, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)").bind(crypto.randomUUID(), user.id, targetMonth, body.startDate, body.endDate, body.leaveType, body.reason ?? null, now).run();
  return c.json({ ok: true }, 201);
});

attendanceRoutes.post("/expenses", async (c) => {
  const user = await currentUser(c);
  if (!user) return error(c, 401, "ログインが必要です");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const targetMonth = month(body?.targetMonth);
  const amount = Number(body?.amount);
  if (!targetMonth || typeof body?.expenseDate !== "string" || typeof body?.category !== "string" || !Number.isInteger(amount) || amount < 0) return error(c, 400, "経費の入力を確認してください");
  const now = new Date().toISOString();
  await c.env.DB.prepare("INSERT INTO expense_items (id, user_id, target_month, expense_date, category, amount, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)").bind(crypto.randomUUID(), user.id, targetMonth, body.expenseDate, body.category, amount, body.description ?? null, now).run();
  return c.json({ ok: true }, 201);
});

attendanceRoutes.put("/monthly-report", async (c) => {
  const user = await currentUser(c);
  if (!user) return error(c, 401, "ログインが必要です");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const targetMonth = month(body?.targetMonth);
  if (!body || !targetMonth || ["summary", "achievements", "nextSteps"].some((field) => body[field] !== undefined && typeof body[field] !== "string")) return error(c, 400, "月次報告の入力を確認してください");
  const now = new Date().toISOString();
  await c.env.DB.prepare("INSERT INTO monthly_reports (id, user_id, target_month, summary, achievements, next_steps, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) ON CONFLICT(user_id, target_month) DO UPDATE SET summary = excluded.summary, achievements = excluded.achievements, next_steps = excluded.next_steps, updated_at = excluded.updated_at").bind(crypto.randomUUID(), user.id, targetMonth, body.summary ?? null, body.achievements ?? null, body.nextSteps ?? null, now).run();
  return c.json({ ok: true });
});

attendanceRoutes.post("/submit", async (c) => {
  const user = await currentUser(c);
  if (!user) return error(c, 401, "ログインが必要です");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const targetMonth = month(body?.targetMonth);
  if (!targetMonth) return error(c, 400, "対象年月を確認してください");
  const now = new Date().toISOString();
  await c.env.DB.prepare("INSERT INTO attendance_submissions (id, user_id, target_month, status, submitted_at, created_at, updated_at) VALUES (?1, ?2, ?3, 'submitted', ?4, ?4, ?4) ON CONFLICT(user_id, target_month) DO UPDATE SET status = 'submitted', submitted_at = excluded.submitted_at, updated_at = excluded.updated_at").bind(crypto.randomUUID(), user.id, targetMonth, now).run();
  return c.json({ ok: true, submittedAt: now });
});

attendanceRoutes.get("/export", async (c) => {
  const user = await currentUser(c);
  if (!user) return error(c, 401, "ログインが必要です");
  const targetMonth = month(c.req.query("month"));
  if (!targetMonth) return error(c, 400, "対象年月はYYYY-MM形式で指定してください");
  const requested = c.req.query("format");
  const parsedFormat = requested ? AttendanceExportFormatSchema.safeParse(requested) : null;
  const elevated = user.role === "system_admin" || user.role === "system_operator" || user.role === "verifier";
  if (requested && (!parsedFormat?.success || !elevated)) return error(c, 403, "指定された出力形式は利用できません");
  const format = parsedFormat?.success ? parsedFormat.data : user.exportFormat ?? "abcs_regular";
  const [profileRow, entries, leaveRequests, expenses, report] = await Promise.all([
    c.env.DB.prepare("SELECT p.*, u.display_name FROM attendance_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?1").bind(user.id).first<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT work_date, start_time, end_time, break_minutes, project_name, note FROM attendance_entries WHERE user_id = ?1 AND target_month = ?2 ORDER BY work_date").bind(user.id, targetMonth).all<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT start_date, end_date, leave_type, reason, status FROM leave_requests WHERE user_id = ?1 AND target_month = ?2 ORDER BY start_date").bind(user.id, targetMonth).all<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT expense_date, category, amount, description FROM expense_items WHERE user_id = ?1 AND target_month = ?2 ORDER BY expense_date").bind(user.id, targetMonth).all<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT summary, achievements, next_steps FROM monthly_reports WHERE user_id = ?1 AND target_month = ?2").bind(user.id, targetMonth).first<Record<string, unknown>>(),
  ]);
  const workbook = createAttendanceWorkbook({ format, month: targetMonth, generatedAt: new Date().toISOString(), profile: profileRow ?? { display_name: user.displayName }, entries: entries.results, leaveRequests: leaveRequests.results, expenses: expenses.results, report });
  const filename = `${format}-${targetMonth}.xls`;
  return new Response(workbook as unknown as BodyInit, { headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "private, no-store" } });
});
