import { UserSchema } from "@timesheet/shared";
import { hashSessionId, readSessionId, type SessionUser } from "./session";

export async function getSessionUser(c: any, allowTwoFactorPending = false): Promise<SessionUser | null> {
  const sessionId = readSessionId(c.req.raw);
  if (!sessionId || !c.env.DB) return null;
  const row = await c.env.DB.prepare("SELECT u.id, u.login_id, u.display_name, u.role, u.account_type, u.primary_tenant_id, u.two_factor_required, u.two_factor_enrolled_at, u.suspended_at, s.two_factor_verified_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND u.disabled_at IS NULL").bind(await hashSessionId(sessionId), new Date().toISOString()).first() as Record<string, unknown> | null;
  if (!row) return null;
  const legacyRole = row.role === "admin" ? "system_admin" : row.role === "approver" ? "verifier" : "member";
  if (!allowTwoFactorPending && row.account_type !== "system_admin" && row.two_factor_required !== 0 && (!row.two_factor_enrolled_at || !row.two_factor_verified_at)) return null;
  return { ...UserSchema.parse({ id: row.id, loginId: row.login_id, displayName: row.display_name, role: row.account_type ?? legacyRole }), tenantId: String(row.primary_tenant_id), suspendedAt: row.suspended_at as string | null };
}

export async function requireAdmin(c: any): Promise<SessionUser | null> {
  const user = await getSessionUser(c);
  return user?.role === "system_admin" && !user.suspendedAt ? user : null;
}

export async function requireAccountManager(c: any): Promise<SessionUser | null> {
  const user = await getSessionUser(c);
  return (user?.role === "system_admin" || user?.role === "system_operator") && !user.suspendedAt ? user : null;
}

export async function requireFileManager(c: any): Promise<SessionUser | null> {
  const user = await getSessionUser(c);
  return (user?.role === "system_admin" || user?.role === "verifier") && !user.suspendedAt ? user : null;
}

export async function requireWorkspaceManager(c: any): Promise<SessionUser | null> {
  const user = await getSessionUser(c);
  return (user?.role === "system_admin" || user?.role === "system_operator" || user?.role === "verifier") && !user.suspendedAt ? user : null;
}

export function canManageFiles(role: SessionUser["role"]) {
  return role === "system_admin" || role === "verifier";
}
