import { describe, expect, it } from "vitest";
import { authRoutes } from "../src/auth/routes";
import { hashPassword, verifyPassword } from "../src/auth/password";

const userRow = { id: "00000000-0000-4000-8000-000000000001", login_id: "admin", display_name: "管理者", role: "admin" };

function database(loginRow: Record<string, unknown> | null = { ...userRow, hash: "" }, meRow: Record<string, unknown> | null = userRow) {
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            first: async <T>() => (sql.includes("password_credentials") ? loginRow : meRow) as T | null,
            run: async () => ({ success: true, meta: { changes: 1 } }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe("password hashing", () => {
  it("hashes and verifies without storing the password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^pbkdf2-sha256\$210000\$/);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("rejects malformed hashes", async () => {
    expect(await verifyPassword("password", "not-a-hash")).toBe(false);
    expect(await verifyPassword("password", "pbkdf2-sha256$1$bad$bad")).toBe(false);
  });
});

describe("password session routes", () => {
  it("rejects invalid request and unavailable auth storage", async () => {
    const invalid = await authRoutes.request("/password/login", { method: "POST", body: JSON.stringify({ loginId: "a", password: "short" }), headers: { "Content-Type": "application/json" } }, { DB: database(), APP_ENV: "test" });
    expect(invalid.status).toBe(400);
    const unavailable = await authRoutes.request("/password/login", { method: "POST", body: JSON.stringify({ loginId: "admin", password: "long enough" }), headers: { "Content-Type": "application/json" } }, { APP_ENV: "test" } as never);
    expect(unavailable.status).toBe(500);
  });

  it("logs in, reads the session, and logs out", async () => {
    const hash = await hashPassword("long enough");
    const env = { DB: database({ ...userRow, hash }), APP_ENV: "test" };
    const login = await authRoutes.request("/password/login", { method: "POST", body: JSON.stringify({ loginId: "admin", password: "long enough" }), headers: { "Content-Type": "application/json" } }, env);
    expect(login.status).toBe(200);
    expect(login.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(((await login.json()) as { user: { loginId: string } }).user.loginId).toBe("admin");

    const cookie = login.headers.get("Set-Cookie")!.split(";")[0];
    const me = await authRoutes.request("/me", { headers: { Cookie: cookie } }, env);
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { role: string } }).user.role).toBe("admin");

    const logout = await authRoutes.request("/logout", { method: "POST", headers: { Cookie: cookie } }, env);
    expect(logout.status).toBe(204);
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("does not reveal whether an account exists", async () => {
    const invalid = await authRoutes.request("/password/login", { method: "POST", body: JSON.stringify({ loginId: "admin", password: "long enough" }), headers: { "Content-Type": "application/json" } }, { DB: database(null), APP_ENV: "test" });
    expect(invalid.status).toBe(401);
    const me = await authRoutes.request("/me", undefined, { DB: database(), APP_ENV: "test" });
    expect(me.status).toBe(401);
    const logout = await authRoutes.request("/logout", { method: "POST" }, { DB: database(), APP_ENV: "test" });
    expect(logout.status).toBe(204);
  });
});
