import { UserSchema } from "@timesheet/shared";
import { hashSessionId, readSessionId, type SessionUser } from "./session";

export async function getSessionUser(c: any): Promise<SessionUser | null> {
  const sessionId = readSessionId(c.req.raw);
  if (!sessionId || !c.env.DB) return null;
  const row = await c.env.DB.prepare("SELECT u.id, u.login_id, u.display_name, u.role, u.account_type FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND u.disabled_at IS NULL").bind(await hashSessionId(sessionId), new Date().toISOString()).first() as Record<string, unknown> | null;
  if (!row) return null;
  const legacyRole = row.role === "admin" ? "system_admin" : row.role === "approver" ? "verifier" : "member";
  return UserSchema.parse({ id: row.id, loginId: row.login_id, displayName: row.display_name, role: row.account_type ?? legacyRole });
}

export async function requireAdmin(c: any): Promise<SessionUser | null> {
  const user = await getSessionUser(c);
  return user?.role === "system_admin" ? user : null;
}

export async function requireAccountManager(c: any): Promise<SessionUser | null> {
  const user = await getSessionUser(c);
  return user?.role === "system_admin" || user?.role === "system_operator" ? user : null;
}

export async function requireFileManager(c: any): Promise<SessionUser | null> {
  const user = await getSessionUser(c);
  return user?.role === "system_admin" || user?.role === "verifier" ? user : null;
}

export function canManageFiles(role: SessionUser["role"]) {
  return role === "system_admin" || role === "verifier";
}
