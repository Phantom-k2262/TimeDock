import { Hono } from "hono";
import { authRoutes } from "./auth/routes";
import { archiveRoutes } from "./routes/archive";
import { adminRoutes } from "./routes/admin";
import { workspaceRoutes } from "./routes/workspaces";
import { tenantRoutes } from "./routes/tenants";
import { templateRoutes } from "./routes/templates";
import { approvalRoutes } from "./routes/approvals";
import { attendanceRoutes } from "./routes/attendance";
import { logRequestError, logRequestStage } from "./observability";

type Bindings = { DB: D1Database; FILES: R2Bucket; ASSETS: Fetcher; APP_ENV: string; MAX_UPLOAD_MIB: string };
type Variables = { requestId: string };
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-ID", requestId);
  const stateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
  if (stateChanging && c.req.path.startsWith("/api/")) {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: { code: "FORBIDDEN", message: "許可されていないオリジンです" } }, 403);
  }
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (c.req.url.startsWith("https://")) c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});

app.use("/api/v1/auth/*", async (c, next) => {
  logRequestStage(c, "authentication.start");
  await next();
  logRequestStage(c, "authentication.complete");
});

app.use("/api/v1/attendance/*", async (c, next) => {
  logRequestStage(c, "attendance.start");
  await next();
  logRequestStage(c, "attendance.complete");
});

app.onError((error, c) => {
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  c.header("X-Request-ID", requestId);
  logRequestError(c, error instanceof Error ? error : new Error(String(error)), requestId);
  return c.json({ error: { code: "INTERNAL_ERROR", message: "内部エラーが発生しました。サポートへRequest IDをお知らせください。", requestId } }, 500);
});

app.get("/health", (c) => c.json({ ok: true, service: "timesheet-portal-api", environment: c.env.APP_ENV ?? "unknown" }));
app.get("/api/v1/health", (c) => c.json({ ok: true, service: "timesheet-portal-api", environment: c.env.APP_ENV ?? "unknown" }));
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/admin/archive", archiveRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/workspaces", workspaceRoutes);
app.route("/api/v1/tenants", tenantRoutes);
app.route("/api/v1/admin/templates", templateRoutes);
app.route("/api/v1/approvals", approvalRoutes);
app.route("/api/v1/attendance", attendanceRoutes);
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
