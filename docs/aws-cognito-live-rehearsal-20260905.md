# Disabled staging Cognito: live protocol evidence

The application still uses Supabase authentication. This rehearsal does not establish application lifecycle, persistent refresh-session, department/RLS or production migration compatibility and adds no weighted migration credit.

Stack tracepoint-staging-cognito manages pool us-east-1_Y9GiDA5Zy and client 4apeul5qohqgnf7d10ta2lk5qe in account 559054714699/us-east-1. Essentials supports the configured refresh rotation; TOTP is required, SRP is the only explicit authentication flow, self-signup is disabled, and the public OAuth client has no secret. The stack has termination protection and the pool has deletion protection/retention.

The initial Lite foundation could not create the rotation-enabled client. CloudFormation retained the empty pool. An explicitly reviewed single-resource IMPORT adopted that same pool into tracepoint-staging-cognito; it was then updated in place to Essentials and the client/domain were added. No duplicate pool or infrastructure deletion was performed. The empty historical tracepoint-staging-cognito-foundation stack remains ROLLBACK_COMPLETE. Import change set: adopt-retained-empty-pool-v2-20260905, ec21ad47-e9d0-4777-b2a8-21f51c91b793. Managed stack identifier: 6eba13b0-a912-11f1-9ebe-12a36a90fe45.

The reusable infra/scripts/rehearse-cognito.mts creates only a uniquely named synthetic example.invalid user with suppressed email, uses in-memory credentials and browser state, enrolls TOTP through supported SRP/MFA APIs, and exercises the real hosted sign-in and OAuth endpoints. It verifies the Secure/HttpOnly transaction cookie, PKCE exchange, signed identity/access tokens, stable synthetic identity mapping, wrong-client denial and session-activity denial. A successful refresh rotates the token; the prior token fails after the grace period. Revocation then invalidates the working rotated token. Hosted logout restores the login prompt. No token, password, TOTP secret, email address or browser storage is saved in evidence.

The harness captures callback requests before staging application handling; it does not activate a Cognito application route. Transaction/mapping/activity ports are explicitly rehearsal-only in-memory state. Twelve uniquely identified fixture users were removed; each cleanup was verified. Earlier failures and cleanup evidence are retained in aws-cognito-rehearsal-evidence-20260905.json. Hosted callback interception was repaired without changing provider scopes or weakening MFA.

Run from the isolated repository with installed infrastructure dependencies and Playwright Chromium:

    node scripts/with-staging-aws-session.mjs node --import tsx infra/scripts/rehearse-cognito.mts --execute

Idempotent recovery for one recorded fixture only:

    node scripts/with-staging-aws-session.mjs node --import tsx infra/scripts/rehearse-cognito.mts --execute --cleanup-run <recorded-UUID>

The harness passes a focused TypeScript check. Infrastructure provider tests and strict production provider synthesis passed with Essentials. New SRP tooling is an infrastructure development dependency, not a runtime application dependency. The monthly model reserves $0.25 for this bounded synthetic Cognito cohort, with total modeled staging cost $68.67 plus a $2 rehearsal reserve.
