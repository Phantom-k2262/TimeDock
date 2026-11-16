# Shared API contracts (G0 freeze)

Version: 0.1.0. Coordinator-owned. Changes require a documented decision.

- API prefix: `/api/v1`
- Roles: `employee`, `approver`, `admin`
- User identity: internal `loginId`; email addresses are not collected or stored.
- Authentication routes: `POST /api/v1/auth/password/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`.
- Password login accepts `{ loginId, password }` and returns `{ user }` with an HttpOnly session cookie; failed login responses do not disclose account existence.
- Timesheet states: `draft`, `submitted`, `rejected`, `approved`, `archived`
- Lock states: `active`, `checked_in`, `cancelled`, `expired`, `revoked`
- Mutating requests require an authenticated HttpOnly session, CSRF protection, and Origin validation.
- Check-in requires `lockId`, `checkoutToken`, `expectedVersion`, and `Idempotency-Key`.
- OIDC identities use only `issuer + subject`; email claims must not be used for automatic account linking.
- Error body: `{ "error": { "code": string, "message": string, "requestId": string } }`.
- Version records are immutable and contain `version`, `r2Key`, `sha256`, `sizeBytes`.
