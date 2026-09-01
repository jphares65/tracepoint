# AWS staging runtime readiness

Target: account `559054714699`, region `us-east-1`, hostname
`staging.tracepointhq.com`. Every AWS-aware helper begins with an STS account,
role, and region gate and refuses management account `265544358665`.

## Required human inputs

- A running Docker engine; the scripts do not install Docker Desktop.
- `TRACEPOINT_STAGING_NEXT_PUBLIC_SUPABASE_URL`,
  `TRACEPOINT_STAGING_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
  `TRACEPOINT_STAGING_NEXT_PUBLIC_SITE_URL` in the invoking staging session.
- Secret values named `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`,
  `NOTIFICATION_DISPATCH_SECRET`, and
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. The Server Actions value must be base64
  for a 16-, 24-, or 32-byte AES key and must be identical at build and runtime.
- An issued `us-east-1` ACM certificate for `staging.tracepointhq.com`, followed
  by a platform-owner DNS alias. No helper requests a certificate or changes DNS.
- Permission for the staging deployment role to read KMS rotation status if that
  verification is to become conclusive.

## Operator sequence

1. Run `test-tracepoint-staging-acm-dns.ps1` with the explicit staging hostname.
2. Review and invoke `set-tracepoint-staging-secret.ps1`; it replaces the four-key
   JSON value atomically, uses concealed input, prints no value, and rejects
   production-looking values.
3. Export the three public build variables in the current staging-only shell.
4. Invoke only `scripts/deploy-tracepoint-staging.ps1`. It repeats STS, cost, diff,
   and non-deletion gates before any runtime deployment.
5. Run `test-tracepoint-staging-runtime.ps1`, then the smoke script. Without a
   session cookie, protected reads must return 401/403; with one, they must return
   200 for the same authorized staging tenant.
6. Keep rollback dry-run-only until a reviewed orchestration change can accept an
   explicit prior immutable image digest. Never destroy the runtime or foundation.

The checked-in Next.js 16 container uses standalone output, copies `public` and
`.next/static`, runs the minimal `server.js` as a non-root user on port 3000, and
uses `/api/health` through the ALB. The route is dynamic, returns `200` JSON, and
sets `Cache-Control: no-store` without touching providers.
