import { Hono } from "hono";
import { authRoutes } from "./auth/routes";
import { archiveRoutes } from "./routes/archive";
import { adminRoutes } from "./routes/admin";
import { workspaceRoutes } from "./routes/workspaces";
import { tenantRoutes } from "./routes/tenants";
import { templateRoutes } from "./routes/templates";

type Bindings = { DB: D1Database; FILES: R2Bucket; ASSETS: Fetcher; APP_ENV: string; MAX_UPLOAD_MIB: string };
const app = new Hono<{ Bindings: Bindings }>();

app.use("*", async (c, next) => {
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

app.get("/health", (c) => c.json({ ok: true, service: "timesheet-portal-api", environment: c.env.APP_ENV ?? "unknown" }));
app.get("/api/v1/health", (c) => c.json({ ok: true, service: "timesheet-portal-api", environment: c.env.APP_ENV ?? "unknown" }));
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/admin/archive", archiveRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/workspaces", workspaceRoutes);
app.route("/api/v1/tenants", tenantRoutes);
app.route("/api/v1/admin/templates", templateRoutes);
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
