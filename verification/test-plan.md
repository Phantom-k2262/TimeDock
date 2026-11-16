# V1 verification plan

The independent verifier will execute the 15 mandatory acceptance tests in `DESIGN.md` section 12 after G1/G2. Until implementation exists, all cases are `BLOCKED` rather than `PASS`.

Focus areas: D1 CAS concurrency, stale/forged checkout tokens, RBAC and data isolation, idempotent check-in, immutable R2 versions, malformed XLSX/zip safety, OIDC validation, CSRF, session revocation, and audit redaction.
