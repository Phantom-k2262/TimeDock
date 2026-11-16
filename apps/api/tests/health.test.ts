import { describe, expect, it } from "vitest";
import app from "../src/index";

describe("health endpoint", () => {
  it("reports the API as healthy", async () => {
    const response = await app.request("/health", undefined, { APP_ENV: "test" } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, service: "timesheet-portal-api" });
  });
});
