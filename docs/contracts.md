# Shared API contracts (G0 freeze)

Version: 0.1.0. Coordinator-owned. Changes require a documented decision.

- API prefix: `/api/v1`
- Roles: `employee`, `approver`, `admin`
- Timesheet states: `draft`, `submitted`, `rejected`, `approved`, `archived`
- Lock states: `active`, `checked_in`, `cancelled`, `expired`, `revoked`
- Mutating requests require an authenticated HttpOnly session, CSRF protection, and Origin validation.
- Check-in requires `lockId`, `checkoutToken`, `expectedVersion`, and `Idempotency-Key`.
- Error body: `{ "error": { "code": string, "message": string, "requestId": string } }`.
- Version records are immutable and contain `version`, `r2Key`, `sha256`, `sizeBytes`.
