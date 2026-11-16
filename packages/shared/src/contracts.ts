import { z } from "zod";

export const RoleSchema = z.enum(["employee", "approver", "admin"]);
export type Role = z.infer<typeof RoleSchema>;
export const TimesheetStatusSchema = z.enum(["draft", "submitted", "rejected", "approved", "archived"]);
export type TimesheetStatus = z.infer<typeof TimesheetStatusSchema>;
export const LockStateSchema = z.enum(["active", "checked_in", "cancelled", "expired", "revoked"]);
export type LockState = z.infer<typeof LockStateSchema>;

export const UserSchema = z.object({ id: z.string().uuid(), loginId: z.string().min(1), displayName: z.string().min(1), role: RoleSchema });
export type User = z.infer<typeof UserSchema>;
export const ErrorCodeSchema = z.enum(["VALIDATION_ERROR", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "LOCKED", "LOCK_EXPIRED", "VERSION_CONFLICT", "INVALID_STATUS", "IDEMPOTENCY_CONFLICT", "FILE_TOO_LARGE", "INVALID_FILE_TYPE", "INVALID_WORKBOOK", "RATE_LIMITED", "INTERNAL_ERROR"]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export const ErrorResponseSchema = z.object({ error: z.object({ code: ErrorCodeSchema, message: z.string(), requestId: z.string() }) });
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const ApiContract = {
  prefix: "/api/v1",
  checkout: "/timesheets/:id/checkout",
  checkin: "/timesheets/:id/checkin",
  submit: "/timesheets/:id/submit",
} as const;
