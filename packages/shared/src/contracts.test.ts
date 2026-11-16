import { describe, expect, it } from "vitest";
import { ApiContract, ErrorCodeSchema, ErrorResponseSchema, LockStateSchema, RoleSchema, TimesheetStatusSchema, UserSchema } from "./contracts";

describe("shared API contracts", () => {
  it("accepts every supported role and rejects unknown roles", () => {
    expect(RoleSchema.options).toEqual(["employee", "approver", "admin"]);
    expect(RoleSchema.parse("admin")).toBe("admin");
    expect(() => RoleSchema.parse("owner")).toThrow();
  });

  it("accepts every timesheet and lock state", () => {
    expect(TimesheetStatusSchema.options).toHaveLength(5);
    expect(LockStateSchema.options).toHaveLength(5);
    expect(TimesheetStatusSchema.parse("submitted")).toBe("submitted");
    expect(LockStateSchema.parse("expired")).toBe("expired");
  });

  it("validates users and the standard error envelope", () => {
    expect(UserSchema.parse({ id: "00000000-0000-0000-0000-000000000000", email: "user@example.com", displayName: "User", role: "employee" }).email).toBe("user@example.com");
    expect(() => UserSchema.parse({ id: "bad", email: "bad", displayName: "", role: "employee" })).toThrow();
    expect(ErrorCodeSchema.parse("VERSION_CONFLICT")).toBe("VERSION_CONFLICT");
    expect(ErrorResponseSchema.parse({ error: { code: "NOT_FOUND", message: "missing", requestId: "req-1" } }).error.code).toBe("NOT_FOUND");
  });

  it("freezes the initial route contract", () => {
    expect(ApiContract).toEqual({ prefix: "/api/v1", checkout: "/timesheets/:id/checkout", checkin: "/timesheets/:id/checkin", submit: "/timesheets/:id/submit" });
  });
});
