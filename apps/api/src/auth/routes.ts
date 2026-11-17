import { Hono } from "hono";
import { PasswordChangeRequestSchema, PasswordLoginRequestSchema, UserSchema } from "@timesheet/shared";
import { hashPassword, verifyPassword } from "./password";
import { getSessionUser } from "./guard";
import { generateRecoveryCodes, generateTotpSecret, totpUri, verifyTotp } from "./totp";
import { clearSessionCookie, createSessionId, hashSessionId, readSessionId, sessionCookie, sessionMaxAge, type SessionUser } from "./session";

export type AuthBindings = { DB: D1Database; APP_ENV: string };

async function hashRecoveryCode(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code.replace(/-/g, "").toUpperCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function error(c: any, status: 400 | 401 | 500, code: string, message: string) {
  return c.json({ error: { code, message, requestId: c.get("requestId") ?? crypto.randomUUID() } }, status);
}

function userFromRow(row: Record<string, unknown>): SessionUser {
  const legacyRole = row.role === "admin" ? "system_admin" : row.role === "approver" ? "verifier" : "member";
  return { ...UserSchema.parse({ id: row.id, loginId: row.login_id, displayName: row.display_name, role: row.account_type ?? legacyRole }), tenantId: row.primary_tenant_id ? String(row.primary_tenant_id) : undefined, exportFormat: (row.export_format as SessionUser["exportFormat"]) ?? "abcs_regular", suspendedAt: row.suspended_at as string | null };
}

export const authRoutes = new Hono<{ Bindings: AuthBindings }>();

authRoutes.post("/password/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = PasswordLoginRequestSchema.safeParse(body);
  if (!parsed.success) return error(c, 400, "VALIDATION_ERROR", "ログインIDまたはパスワードが正しくありません");
  if (!c.env.DB) return error(c, 500, "INTERNAL_ERROR", "認証サービスを利用できません");

  const result = await c.env.DB.prepare("SELECT u.id, u.login_id, u.display_name, u.role, u.account_type, u.primary_tenant_id, u.export_format, u.two_factor_required, u.two_factor_enrolled_at, u.suspended_at, p.hash, p.failed_attempts, p.blocked_until FROM users u JOIN password_credentials p ON p.user_id = u.id WHERE u.login_id = ?1 AND u.disabled_at IS NULL").bind(parsed.data.loginId).first<Record<string, unknown>>();
  const nowIso = new Date().toISOString();
  const blockedUntil = result?.blocked_until ? new Date(String(result.blocked_until)) : null;
  if (blockedUntil && blockedUntil.getTime() > Date.now()) return error(c, 401, "UNAUTHENTICATED", "ログインIDまたはパスワードが正しくありません");
  const valid = result ? await verifyPassword(parsed.data.password, String(result.hash)) : false;
  if (!valid || !result) {
    if (result) {
      const failedAttempts = Number(result.failed_attempts ?? 0) + 1;
      const nextBlockedUntil = failedAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await c.env.DB.prepare("UPDATE password_credentials SET failed_attempts = ?1, blocked_until = ?2, updated_at = ?3 WHERE user_id = ?4").bind(nextBlockedUntil ? 0 : failedAttempts, nextBlockedUntil, nowIso, result.id).run();
    }
    return error(c, 401, "UNAUTHENTICATED", "ログインIDまたはパスワードが正しくありません");
  }

  const user = userFromRow(result);
  const sessionId = createSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionMaxAge() * 1000).toISOString();
  await c.env.DB.prepare("UPDATE password_credentials SET failed_attempts = 0, blocked_until = NULL, updated_at = ?1 WHERE user_id = ?2").bind(nowIso, user.id).run();
  await c.env.DB.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at, two_factor_verified_at) VALUES (?1, ?2, ?3, ?4, ?3, ?5)").bind(await hashSessionId(sessionId), user.id, now.toISOString(), expiresAt, user.role === "system_admin" || result.two_factor_required === 0 ? now.toISOString() : null).run();
  c.header("Set-Cookie", sessionCookie(sessionId));
  return c.json({ user, twoFactor: { required: user.role !== "system_admin" && result.two_factor_required !== 0, enrolled: Boolean(result.two_factor_enrolled_at), verified: user.role === "system_admin" || result.two_factor_required === 0 } });
});
authRoutes.get("/me", async (c) => {
  const sessionId = readSessionId(c.req.raw);
  if (!sessionId || !c.env.DB) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  const row = await c.env.DB.prepare("SELECT u.id, u.login_id, u.display_name, u.role, u.account_type, u.primary_tenant_id, u.export_format, u.two_factor_required, u.two_factor_enrolled_at, u.suspended_at, s.two_factor_verified_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND u.disabled_at IS NULL").bind(await hashSessionId(sessionId), new Date().toISOString()).first<Record<string, unknown>>();
  if (!row) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  const user = userFromRow(row);
  return c.json({ user, twoFactor: { required: user.role !== "system_admin" && row.two_factor_required !== 0, enrolled: Boolean(row.two_factor_enrolled_at), verified: user.role === "system_admin" || row.two_factor_required === 0 || Boolean(row.two_factor_verified_at) } });
});

authRoutes.post("/2fa/setup", async (c) => {
  const user = await getSessionUser(c, true);
  if (!user) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  if (user.role === "system_admin") return error(c, 400, "VALIDATION_ERROR", "システム管理者には二段階認証は必要ありません");
  const existing = await c.env.DB.prepare("SELECT two_factor_secret, two_factor_enrolled_at FROM users WHERE id = ?1").bind(user.id).first<{ two_factor_secret: string | null; two_factor_enrolled_at: string | null }>();
  if (existing?.two_factor_enrolled_at) return error(c, 400, "VALIDATION_ERROR", "二段階認証は登録済みです。再登録する場合は管理者にリセットを依頼してください");
  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  if (!existing?.two_factor_enrolled_at) {
    const now = new Date().toISOString();
    await c.env.DB.prepare("UPDATE users SET two_factor_secret = ?1, updated_at = ?2 WHERE id = ?3").bind(secret, now, user.id).run();
    await c.env.DB.prepare("DELETE FROM two_factor_recovery_codes WHERE user_id = ?1").bind(user.id).run();
    await c.env.DB.batch(await Promise.all(recoveryCodes.map(async (code) => c.env.DB.prepare("INSERT INTO two_factor_recovery_codes (id, user_id, code_hash, created_at) VALUES (?1, ?2, ?3, ?4)").bind(crypto.randomUUID(), user.id, await hashRecoveryCode(code), now))));
  }
  return c.json({ secret, uri: totpUri(secret, user.loginId), recoveryCodes });
});

authRoutes.post("/2fa/verify", async (c) => {
  const user = await getSessionUser(c, true);
  if (!user) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  const body = await c.req.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  const row = await c.env.DB.prepare("SELECT two_factor_secret FROM users WHERE id = ?1").bind(user.id).first<{ two_factor_secret: string | null }>();
  let verified = Boolean(row?.two_factor_secret && await verifyTotp(row.two_factor_secret, code));
  if (!verified) {
    const recovery = await c.env.DB.prepare("SELECT id FROM two_factor_recovery_codes WHERE user_id = ?1 AND code_hash = ?2 AND used_at IS NULL").bind(user.id, await hashRecoveryCode(code)).first<{ id: string }>();
    if (recovery) {
      const consumed = await c.env.DB.prepare("UPDATE two_factor_recovery_codes SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL").bind(new Date().toISOString(), recovery.id).run();
      verified = consumed.meta.changes === 1;
    }
  }
  if (!verified) return error(c, 401, "UNAUTHENTICATED", "認証コードが正しくありません");
  const now = new Date().toISOString();
  const sessionId = readSessionId(c.req.raw);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET two_factor_enrolled_at = COALESCE(two_factor_enrolled_at, ?1), updated_at = ?1 WHERE id = ?2").bind(now, user.id),
    c.env.DB.prepare("UPDATE sessions SET two_factor_verified_at = ?1 WHERE id_hash = ?2 AND user_id = ?3").bind(now, await hashSessionId(sessionId!), user.id),
  ]);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  const sessionId = readSessionId(c.req.raw);
  if (sessionId && c.env.DB) await c.env.DB.prepare("UPDATE sessions SET revoked_at = ?1 WHERE id_hash = ?2 AND revoked_at IS NULL").bind(new Date().toISOString(), await hashSessionId(sessionId)).run();
  c.header("Set-Cookie", clearSessionCookie());
  return c.body(null, 204);
});

authRoutes.post("/password/change", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return error(c, 401, "UNAUTHENTICATED", "ログインが必要です");
  const body = await c.req.json().catch(() => null);
  const parsed = PasswordChangeRequestSchema.safeParse(body);
  if (!parsed.success || parsed.data.password !== parsed.data.passwordConfirmation) return error(c, 400, "VALIDATION_ERROR", "パスワードは英字・数字・記号を含む8〜20文字で、確認入力と一致させてください");
  const current = await c.env.DB.prepare("SELECT hash FROM password_credentials WHERE user_id = ?1").bind(user.id).first<{ hash: string }>();
  if (!current || !(await verifyPassword(parsed.data.currentPassword, current.hash))) return error(c, 401, "UNAUTHENTICATED", "現在のパスワードが正しくありません");
  const nextHash = await hashPassword(parsed.data.password);
  await c.env.DB.prepare("UPDATE password_credentials SET hash = ?1, updated_at = ?2, failed_attempts = 0, blocked_until = NULL WHERE user_id = ?3").bind(nextHash, new Date().toISOString(), user.id).run();
  return c.body(null, 204);
});
