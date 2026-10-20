# TracePoint

TracePoint is a multi-agency records application for law-enforcement readiness and accountability: armory and ammunition, range days and qualifications, agency training and certifications, equipment and inventory, fleet, off-duty firearms, notifications, and agency administration.

## Stack

- Next.js 16 (App Router) in `src/app`, with shared code in `src/lib`. This Next.js version differs from older documentation; read the guides in `node_modules/next/dist/docs/` before changing Next-specific code (see `AGENTS.md`).
- Production runs in AWS-native mode (`TRACEPOINT_RUNTIME_PROVIDER_MODE=aws-native`): Amazon Cognito sign-in and PostgreSQL accessed as the `tracepoint_runtime` role, with each request authorised by subject and agency.
- The native mobile client uses the `/api/mobile/*` routes and the shared API routes. Keep server contracts backward compatible.
- AWS infrastructure is a CDK application in `infra/` (see `infra/README.md`).

## Database

- `supabase/migrations/` is the historical schema lineage, used to build a clean database.
- `database/aws/` holds the numbered migrations applied to deployed environments. Files are append-only and hash-checked: add a new file with the next number and never edit an applied one. Apply with `scripts/migrate-db.ps1 <environment> -Action status`, then `apply`.

## Development

```bash
npm ci
npm run dev
```

## Checks (the pull-request gate in `.github/workflows/application-quality.yml`)

```bash
node --test --test-concurrency=1 scripts/*.test.mjs
node scripts/run-application-tests.mjs   # src/**/*.test.ts, including embedded-PostgreSQL suites
npm test --prefix infra
npx tsc --noEmit
npm run db:validate-bootstrap            # clean build of both migration sets plus SQL validation suites
npx next build
```

## Further documentation

- `docs/remediation/`: defect remediation records, the staging verification package, and native client contract changes.
