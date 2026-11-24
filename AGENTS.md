# Codex repository instructions

Read, in order: `DESIGN.md`, `TEAM_INSTRUCTIONS.md`, `team.yaml`, `implementation.yaml`.

Act as the Coordinator for four implementer roles (P1–P4) and one independent verifier (V1). If Codex supports parallel agents, use isolated worktrees and the roles/ownership configured in `team.yaml`; otherwise execute role-separated tasks sequentially. Do not claim parallel execution occurred unless it did.

Complete G0 scaffold and freeze shared API contracts before concurrent work. Use P1 for auth/infrastructure/migrations, P2 for storage/locks, P3 for timesheet workflow/audit, P4 for UI/E2E, V1 for independent acceptance/security verification. Coordinator alone integrates shared contracts and route mounting. Respect path ownership and no-real-secrets policy.

Mandatory gates: lint, typecheck, unit/integration tests, build, E2E, `DESIGN.md` section 12 acceptance tests. Record truthful PASS/FAIL/BLOCKED in `verification/acceptance-report.md` and integration actions in `docs/integration-log.md`. Route defects to the implementing agent.

Production deployment policy: the user cannot validate locally, so after code changes pass the required build, typecheck, tests, and the existing ABCS/SP report regression tests, deploy the normal Worker update to the Cloudflare production Worker `timesheet-portal-prod` automatically. This standing authorization applies to ordinary Worker deployments and does not require per-deployment reapproval. It does not authorize D1 migrations, R2 data changes, Secrets changes, deletion of existing data, or Git commit/push; obtain separate approval for those actions. After deployment, report success/failure, the Worker version ID, verification URL, and test results. If deployment credentials or permissions fail, report the blocker without bypassing it.

Core product: Cloudflare Workers/Hono + React/Vite + D1 + private R2, password and Google/Microsoft personal OIDC, xlsx checkout/download/edit locally/checkin, immutable versions, submit/approve/reject. Excel Online and Microsoft 365 are NOT required.
