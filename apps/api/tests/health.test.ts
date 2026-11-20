import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";

afterEach(() => vi.restoreAllMocks());

describe("health endpoint", () => {
  it("reports the API as healthy", async () => {
    const response = await app.request("/health", undefined, { APP_ENV: "test" } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, service: "timesheet-portal-api" });
  });

  it("exposes the versioned health route", async () => {
    const response = await app.request("/api/v1/health", undefined, { APP_ENV: "test" } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, service: "timesheet-portal-api" });
  });

  it("uses an explicit fallback when the environment is absent", async () => {
    const response = await app.request("/health", undefined, {} as never);
    expect(await response.json()).toMatchObject({ environment: "unknown" });
  });

  it("uses the fallback on the versioned route as well", async () => {
    const response = await app.request("/api/v1/health", undefined, {} as never);
    expect(await response.json()).toMatchObject({ environment: "unknown" });
  });

  it("returns a request id and hides exception details from clients", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = "session-secret-value";
    const response = await app.request("/api/v1/auth/me", { headers: { Cookie: `timesheet_session=${secret}`, Authorization: `Bearer ${secret}` } }, {
      DB: { prepare: () => { throw new Error(`database failure; token=${secret}`); } },
      APP_ENV: "test",
    } as never);
    expect(response.status).toBe(500);
    const requestId = response.headers.get("X-Request-ID");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const body = await response.json() as { error: { code: string; message: string; requestId: string } };
    expect(body.error).toMatchObject({ code: "INTERNAL_ERROR", requestId });
    expect(body.error.message).not.toContain(secret);
    expect(errorLog).toHaveBeenCalledOnce();
    const logged = String(errorLog.mock.calls[0]?.[1]);
    expect(logged).toContain(requestId!);
    expect(logged).toContain("/api/v1/auth/me");
    expect(logged).toContain("Error");
    expect(logged).not.toContain(secret);
  });
});
