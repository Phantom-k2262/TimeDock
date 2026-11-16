import { Hono } from "hono";
import { PasswordLoginRequestSchema, UserSchema } from "@timesheet/shared";
import { verifyPassword } from "./password";
import { clearSessionCookie, createSessionId, hashSessionId, readSessionId, sessionCookie, sessionMaxAge, type SessionUser } from "./session";

export type AuthBindings = { DB: D1Database; APP_ENV: string };

function error(c: any, status: 400 | 401 | 500, code: string, message: string) {
  return c.json({ error: { code, message, requestId: c.get("requestId") ?? crypto.randomUUID() } }, status);
}

function userFromRow(row: Record<string, unknown>): SessionUser {
  return UserSchema.parse({ id: row.id, loginId: row.login_id, displayName: row.display_name, role: row.role });
}

export const authRoutes = new Hono<{ Bindings: AuthBindings }>();

authRoutes.post("/password/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = PasswordLoginRequestSchema.safeParse(body);
  if (!parsed.success) return error(c, 400, "VALIDATION_ERROR", "ログインIDまたはパスワードが正しくありません");
  if (!c.env.DB) return error(c, 500, "INTERNAL_ERROR", "認証サービスを利用できません");

  const result = await c.env.DB.prepare("SELECT u.id, u.login_id, u.display_name, u.role, p.hash FROM users u JOIN password_credentials p ON p.user_id = u.id WHERE u.login_id = ?1 AND u.disabled_at IS NULL").bind(parsed.data.loginId).first<Record<string, unknown>>();
  const valid = result ? await verifyPassword(parsed.data.password, String(result.hash)) : false;
  if (!valid || !result) return error(c, 401, "UNAUTHENTICATED", "ログインIDまたはパスワードが正しくありません");

  const user = userFromRow(result);
  const sessionId = createSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionMaxAge() * 1000).toISOString();
  await c.env.DB.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?3)").bind(await hashSessionId(sessionId), user.id, now.toISOString(), expiresAt).run();
  c.header("Set-Cookie", sessionCookie(sessionId));
  return c.json({ user });
});

authRoutes.get("/me", async (c) => {
  const sessionId = readSessionId(c.req.raw);
  if (!sessionId || !c.env.DB) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  const row = await c.env.DB.prepare("SELECT u.id, u.login_id, u.display_name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND u.disabled_at IS NULL").bind(await hashSessionId(sessionId), new Date().toISOString()).first<Record<string, unknown>>();
  if (!row) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  return c.json({ user: userFromRow(row) });
});

authRoutes.post("/logout", async (c) => {
  const sessionId = readSessionId(c.req.raw);
  if (sessionId && c.env.DB) await c.env.DB.prepare("UPDATE sessions SET revoked_at = ?1 WHERE id_hash = ?2 AND revoked_at IS NULL").bind(new Date().toISOString(), await hashSessionId(sessionId)).run();
  c.header("Set-Cookie", clearSessionCookie());
  return c.body(null, 204);
});
