import { Hono } from "hono";
import { getSessionUser } from "../auth/guard";

type ApprovalBindings = { DB: D1Database };
export const approvalRoutes = new Hono<{ Bindings: ApprovalBindings }>();

function error(c: any, status: 400 | 401 | 403 | 404, code: string, message: string) {
  return c.json({ error: { code, message, requestId: c.get("requestId") ?? crypto.randomUUID() } }, status);
}

async function currentUser(c: any) {
  const user = await getSessionUser(c);
  if (!user) return null;
  if (user.suspendedAt) return null;
  return user;
}

approvalRoutes.get("/", async (c) => {
  const user = await currentUser(c);
  if (!user) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (user.role !== "system_admin" && user.role !== "system_operator" && user.role !== "verifier") return error(c, 403, "FORBIDDEN", "承認権限がありません");
  const rows = await c.env.DB.prepare(`SELECT s.id, s.timesheet_id, s.version, s.submitted_at, s.decision, s.rejection_reason, s.version_sha256, t.target_month, t.status, u.id AS employee_id, u.display_name AS employee_name, u.login_id AS employee_login_id FROM submissions s JOIN timesheets t ON t.id = s.timesheet_id JOIN users u ON u.id = t.user_id WHERE s.decision IS NULL AND (?1 IN ('system_admin', 'system_operator') OR EXISTS (SELECT 1 FROM approver_assignments aa WHERE aa.approver_id = ?2 AND aa.employee_id = t.user_id)) ORDER BY s.submitted_at DESC`).bind(user.role, user.id).all<Record<string, unknown>>();
  return c.json({ submissions: rows.results.map((row) => ({ id: row.id, timesheetId: row.timesheet_id, version: Number(row.version), submittedAt: row.submitted_at, decision: row.decision, rejectionReason: row.rejection_reason, sha256: row.version_sha256, targetMonth: row.target_month, status: row.status, employeeId: row.employee_id, employeeName: row.employee_name, employeeLoginId: row.employee_login_id })) });
});

async function decide(c: any, decision: "approved" | "rejected") {
  const user = await currentUser(c);
  if (!user) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (user.role !== "system_admin" && user.role !== "system_operator" && user.role !== "verifier") return error(c, 403, "FORBIDDEN", "承認権限がありません");
  const submissionId = c.req.param("id");
  const submission = await c.env.DB.prepare("SELECT s.id, s.timesheet_id, t.user_id, s.decision FROM submissions s JOIN timesheets t ON t.id = s.timesheet_id WHERE s.id = ?1").bind(submissionId).first() as { id: string; timesheet_id: string; user_id: string; decision: string | null } | null;
  if (!submission) return error(c, 404, "NOT_FOUND", "提出が見つかりません");
  if (submission.user_id === user.id) return error(c, 403, "FORBIDDEN", "自己承認はできません");
  if (user.role === "verifier") {
    const assignment = await c.env.DB.prepare("SELECT id FROM approver_assignments WHERE approver_id = ?1 AND employee_id = ?2").bind(user.id, submission.user_id).first();
    if (!assignment) return error(c, 403, "FORBIDDEN", "割り当てられた提出ではありません");
  }
  if (submission.decision) return error(c, 400, "INVALID_STATE", "この提出はすでに処理されています");
  const body = await c.req.json().catch(() => ({})) as { reason?: unknown };
  if (decision === "rejected" && (typeof body.reason !== "string" || !body.reason.trim())) return error(c, 400, "VALIDATION_ERROR", "差し戻し理由を入力してください");
  const now = new Date().toISOString();
  const nextStatus = decision === "approved" ? "approved" : "rejected";
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE submissions SET decision = ?1, reviewed_by = ?2, reviewed_at = ?3, rejection_reason = ?4 WHERE id = ?5 AND decision IS NULL").bind(decision, user.id, now, decision === "rejected" ? String(body.reason).trim() : null, submissionId),
    c.env.DB.prepare("UPDATE timesheets SET status = ?1, approved_version = CASE WHEN ?1 = 'approved' THEN current_version ELSE approved_version END, updated_at = ?2 WHERE id = ?3 AND status = 'submitted'").bind(nextStatus, now, submission.timesheet_id),
  ]);
  return c.json({ ok: true, decision, timesheetId: submission.timesheet_id });
}

approvalRoutes.post("/:id/approve", (c) => decide(c, "approved"));
approvalRoutes.post("/:id/reject", (c) => decide(c, "rejected"));
