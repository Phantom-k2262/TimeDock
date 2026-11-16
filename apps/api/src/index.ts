import { Hono } from "hono";

type Bindings = { DB: D1Database; FILES: R2Bucket; APP_ENV: string; MAX_UPLOAD_MIB: string };
const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true, service: "timesheet-portal-api", environment: c.env.APP_ENV ?? "unknown" }));
app.get("/api/v1/health", (c) => c.json({ ok: true, service: "timesheet-portal-api", environment: c.env.APP_ENV ?? "unknown" }));

export default app;
