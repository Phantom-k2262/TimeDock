import { z } from "zod";

export const RoleSchema = z.enum(["employee", "approver", "admin"]);
export type Role = z.infer<typeof RoleSchema>;
export const TimesheetStatusSchema = z.enum(["draft", "submitted", "rejected", "approved", "archived"]);
export type TimesheetStatus = z.infer<typeof TimesheetStatusSchema>;
export const LockStateSchema = z.enum(["active", "checked_in", "cancelled", "expired", "revoked"]);
export type LockState = z.infer<typeof LockStateSchema>;

export const UserSchema = z.object({ id: z.string().uuid(), loginId: z.string().min(1), displayName: z.string().min(1), role: RoleSchema });
export type User = z.infer<typeof UserSchema>;
export const PasswordLoginRequestSchema = z.object({ loginId: z.string().trim().min(1).max(100), password: z.string().min(8).max(256) });
export type PasswordLoginRequest = z.infer<typeof PasswordLoginRequestSchema>;
export const AuthSessionSchema = z.object({ user: UserSchema });
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export const FolderKindSchema = z.enum(["template_library", "personal", "shared"]);
export type FolderKind = z.infer<typeof FolderKindSchema>;
export const FolderSchema = z.object({ id: z.string().uuid(), name: z.string().min(1), kind: FolderKindSchema, ownerUserId: z.string().uuid().nullable(), readOnly: z.boolean() });
export type Folder = z.infer<typeof FolderSchema>;
export const FolderPermissionSchema = z.object({ folderId: z.string().uuid(), userId: z.string().uuid().nullable(), role: RoleSchema.nullable(), canRead: z.boolean(), canWrite: z.boolean() });
export type FolderPermission = z.infer<typeof FolderPermissionSchema>;
export const DocumentCategorySchema = z.enum(["timesheet", "expense", "receipt", "other"]);
export type DocumentCategory = z.infer<typeof DocumentCategorySchema>;
export const MonthlyArchiveQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export type MonthlyArchiveQuery = z.infer<typeof MonthlyArchiveQuerySchema>;
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
