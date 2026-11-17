const SESSION_COOKIE = "timesheet_session";
const SESSION_MAX_AGE = 60 * 60 * 8;

export type SessionUser = { id: string; loginId: string; displayName: string; role: "system_admin" | "system_operator" | "verifier" | "member"; tenantId?: string; exportFormat?: "aaaa_sp" | "abcs_regular" | "leave_request" | "sp_report"; suspendedAt?: string | null };

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashSessionId(sessionId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionId));
  return bytesToHex(new Uint8Array(digest));
}

export function createSessionId() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function sessionCookie(sessionId: string) {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSessionId(request: Request) {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie?.slice(SESSION_COOKIE.length + 1) || null;
}

export function sessionMaxAge() {
  return SESSION_MAX_AGE;
}
