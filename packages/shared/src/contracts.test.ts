import { describe, expect, it } from "vitest";
import { ApiContract, ErrorCodeSchema, ErrorResponseSchema, FolderPermissionSchema, FolderSchema, LockStateSchema, PasswordPolicySchema, RoleSchema, TimesheetStatusSchema, UserSchema, WorkspaceCreateRequestSchema } from "./contracts.js";

describe("shared API contracts", () => {
  it("accepts every supported role and rejects unknown roles", () => {
    expect(RoleSchema.options).toEqual(["system_admin", "system_operator", "verifier", "member"]);
    expect(RoleSchema.parse("system_admin")).toBe("system_admin");
    expect(() => RoleSchema.parse("owner")).toThrow();
  });

  it("accepts every timesheet and lock state", () => {
    expect(TimesheetStatusSchema.options).toHaveLength(5);
    expect(LockStateSchema.options).toHaveLength(5);
    expect(TimesheetStatusSchema.parse("submitted")).toBe("submitted");
    expect(LockStateSchema.parse("expired")).toBe("expired");
  });

  it("validates users and the standard error envelope", () => {
    expect(UserSchema.parse({ id: "00000000-0000-0000-0000-000000000000", loginId: "user001", displayName: "User", role: "member" }).loginId).toBe("user001");
    expect(() => UserSchema.parse({ id: "bad", loginId: "", displayName: "", role: "member" })).toThrow();
    expect(ErrorCodeSchema.parse("VERSION_CONFLICT")).toBe("VERSION_CONFLICT");
    expect(ErrorResponseSchema.parse({ error: { code: "NOT_FOUND", message: "missing", requestId: "req-1" } }).error.code).toBe("NOT_FOUND");
  });

  it("freezes the initial route contract", () => {
    expect(ApiContract).toEqual({ prefix: "/api/v1", checkout: "/timesheets/:id/checkout", checkin: "/timesheets/:id/checkin", submit: "/timesheets/:id/submit" });
  });

  it("models read-only template libraries and personal folders", () => {
    const folder = FolderSchema.parse({ id: "00000000-0000-0000-0000-000000000001", name: "Templates", kind: "template_library", ownerUserId: null, readOnly: true });
    expect(folder.readOnly).toBe(true);
    expect(FolderPermissionSchema.parse({ folderId: folder.id, userId: null, role: "member", canRead: true, canWrite: false }).canWrite).toBe(false);
  });

  it("enforces the password policy and workspace names", () => {
    expect(PasswordPolicySchema.safeParse("Abcd1234!").success).toBe(true);
    expect(PasswordPolicySchema.safeParse("onlyletters").success).toBe(false);
    expect(PasswordPolicySchema.safeParse("A1!").success).toBe(false);
    expect(WorkspaceCreateRequestSchema.parse({ name: "年末調整" }).name).toBe("年末調整");
  });
});
