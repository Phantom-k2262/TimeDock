import { describe, expect, it } from "vitest";
import { archiveRoutes } from "../src/routes/archive";
import { createSessionId } from "../src/auth/session";

const admin = { id: "00000000-0000-4000-8000-000000000001" };

function environment(adminRow: Record<string, string> | null, rows: Array<{ folder_name: string; name: string; category: "timesheet" | "expense" | "receipt" | "other"; r2_key: string; size_bytes: number }> = []) {
  const db = {
    prepare(sql: string) {
      return { bind(..._args: unknown[]) { return {
        first: async <T>() => (sql.includes("u.role = 'admin'") ? adminRow : null) as T | null,
        all: async <T>() => ({ results: rows }) as { results: T[] },
      }; } };
    },
  } as unknown as D1Database;
  const files = { get: async (_key: string) => ({ arrayBuffer: async () => new TextEncoder().encode("file").buffer }) } as unknown as R2Bucket;
  return { DB: db, FILES: files, APP_ENV: "test" };
}

describe("monthly archive endpoint", () => {
  it("validates the month and requires an authenticated admin", async () => {
    const invalid = await archiveRoutes.request("/monthly?month=2026-13", undefined, environment(null));
    expect(invalid.status).toBe(400);
    const unauthenticated = await archiveRoutes.request("/monthly?month=2026-11", undefined, environment(null));
    expect(unauthenticated.status).toBe(401);
  });

  it("returns not found when the month has no documents", async () => {
    const session = createSessionId();
    const response = await archiveRoutes.request("/monthly?month=2026-11", { headers: { Cookie: `timesheet_session=${session}` } }, environment(admin));
    expect(response.status).toBe(404);
  });

  it("returns a zip preserving the personal folder path", async () => {
    const session = createSessionId();
    const response = await archiveRoutes.request("/monthly?month=2026-11", { headers: { Cookie: `timesheet_session=${session}` } }, environment(admin, [
      { folder_name: "山田 太郎", name: "2026-11.xlsx", category: "timesheet", r2_key: "documents/1", size_bytes: 4 },
      { folder_name: "山田 太郎", name: "receipt.pdf", category: "receipt", r2_key: "documents/2", size_bytes: 4 },
    ]));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain("timesheets-2026-11.zip");
    const archive = new Uint8Array(await response.arrayBuffer());
    expect(archive.length).toBeGreaterThan(22);
    expect(new TextDecoder().decode(archive)).toContain("経費");
  });
});
