import { Hono } from "hono";
import { authRoutes } from "./auth/routes";
import { archiveRoutes } from "./routes/archive";
import { adminRoutes } from "./routes/admin";
import { workspaceRoutes } from "./routes/workspaces";
import { tenantRoutes } from "./routes/tenants";

type Bindings = { DB: D1Database; FILES: R2Bucket; ASSETS: Fetcher; APP_ENV: string; MAX_UPLOAD_MIB: string };
const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true, service: "timesheet-portal-api", environment: c.env.APP_ENV ?? "unknown" }));
app.get("/api/v1/health", (c) => c.json({ ok: true, service: "timesheet-portal-api", environment: c.env.APP_ENV ?? "unknown" }));
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/admin/archive", archiveRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/workspaces", workspaceRoutes);
app.route("/api/v1/tenants", tenantRoutes);
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
