import { describe, expect, it } from "vitest";
import { verifyTotp } from "../src/auth/totp";

describe("TOTP", () => {
  it("verifies the RFC 6238 SHA-1 test vector", async () => {
    expect(await verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 59_000)).toBe(true);
    expect(await verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287083", 59_000)).toBe(false);
  });

  it("accepts the adjacent 30 second window", async () => {
    expect(await verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "287082", 60_001)).toBe(true);
  });
});
