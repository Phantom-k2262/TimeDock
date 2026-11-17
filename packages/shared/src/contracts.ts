import { z } from "zod";

export const RoleSchema = z.enum(["system_admin", "system_operator", "verifier", "member"]);
export type Role = z.infer<typeof RoleSchema>;
export const TimesheetStatusSchema = z.enum(["draft", "submitted", "rejected", "approved", "archived"]);
export type TimesheetStatus = z.infer<typeof TimesheetStatusSchema>;
export const LockStateSchema = z.enum(["active", "checked_in", "cancelled", "expired", "revoked"]);
export type LockState = z.infer<typeof LockStateSchema>;

export const UserSchema = z.object({ id: z.string().uuid(), loginId: z.string().min(1), displayName: z.string().min(1), role: RoleSchema });
export type User = z.infer<typeof UserSchema>;
export const PasswordLoginRequestSchema = z.object({ loginId: z.string().trim().min(1).max(100), password: z.string().min(8).max(256) });
export type PasswordLoginRequest = z.infer<typeof PasswordLoginRequestSchema>;
export const PasswordPolicySchema = z.string().regex(/^(?=.{8,20}$)(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9])[\x21-\x7E]+$/, "英字・数字・記号を含む8〜20文字で入力してください");
export const PasswordChangeRequestSchema = z.object({ currentPassword: z.string().min(1), password: PasswordPolicySchema, passwordConfirmation: z.string().min(1) });
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequestSchema>;
export const AdminUserCreateRequestSchema = z.object({ loginId: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/), displayName: z.string().trim().min(1).max(100), role: RoleSchema, password: PasswordPolicySchema, passwordConfirmation: z.string().min(1) });
export type AdminUserCreateRequest = z.infer<typeof AdminUserCreateRequestSchema>;
export const WorkspaceSharingModeSchema = z.enum(["shared_box", "member_scoped"]);
export type WorkspaceSharingMode = z.infer<typeof WorkspaceSharingModeSchema>;
export const WorkspaceVerificationModeSchema = z.enum(["none", "verified_only"]);
export type WorkspaceVerificationMode = z.infer<typeof WorkspaceVerificationModeSchema>;
export const WorkspaceCreateRequestSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).optional(), sharingMode: WorkspaceSharingModeSchema.default("member_scoped"), verificationMode: WorkspaceVerificationModeSchema.default("none"), memberIds: z.array(z.string().uuid()).default([]) });
export type WorkspaceCreateRequest = z.infer<typeof WorkspaceCreateRequestSchema>;
export const DocumentVerificationStatusSchema = z.enum(["unverified", "in_review", "returned", "verified"]);
export type DocumentVerificationStatus = z.infer<typeof DocumentVerificationStatusSchema>;
export const FolderPermissionModeSchema = z.enum(["whitelist", "blacklist"]);
export type FolderPermissionMode = z.infer<typeof FolderPermissionModeSchema>;
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
