import { UserSchema } from "@timesheet/shared";
import { hashSessionId, readSessionId, type SessionUser } from "./session";

export async function getSessionUser(c: any): Promise<SessionUser | null> {
  const sessionId = readSessionId(c.req.raw);
  if (!sessionId || !c.env.DB) return null;
  const row = await c.env.DB.prepare("SELECT u.id, u.login_id, u.display_name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND u.disabled_at IS NULL").bind(await hashSessionId(sessionId), new Date().toISOString()).first() as Record<string, unknown> | null;
  if (!row) return null;
  return UserSchema.parse({ id: row.id, loginId: row.login_id, displayName: row.display_name, role: row.role });
}

export async function requireAdmin(c: any): Promise<SessionUser | null> {
  const user = await getSessionUser(c);
  return user?.role === "admin" ? user : null;
}
