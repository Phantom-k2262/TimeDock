# Decision 0001: Login ID instead of email

Date: 2026-11-16
Status: Accepted

## Decision

The application uses an internal `loginId` for password login, invitations, and user uniqueness. It does not collect or persist email addresses.

For optional Google/Microsoft OIDC, the account identity is the provider `issuer + subject`. Email claims are not used for account linking or user records.

## Consequences

- The UI uses `ログインID`, not email.
- D1 `users` and `invitations` records use `login_id`.
- Password reset and invitation delivery by email are out of scope until a separate approved notification channel is selected.
