# Migration-only file manifest

This allowlist is the exact migration staging boundary as of 2026-08-30.
Anything not listed is excluded.

## Root/application

- `.dockerignore`
- `.gitignore`
- `Dockerfile`
- `next.config.ts`
- `tsconfig.json`
- `src/app/api/health/route.ts`
- `src/app/fonts/OFL.txt`
- `src/app/fonts/README.md`
- `src/app/fonts/geist-latin.woff2`
- `src/app/fonts/geist-mono-latin.woff2`
- `src/app/globals.css`
- `src/app/layout.tsx`

## Infrastructure

- `infra/README.md`
- `infra/bin/tracepoint-infra.ts`
- `infra/cdk.context.json`
- `infra/cdk.json`
- `infra/lib/compute-foundation-stack.ts`
- `infra/lib/network-stack.ts`
- `infra/lib/runtime-stack.ts`
- `infra/lib/security-stack.ts`
- `infra/lib/storage-stack.ts` (dormant/deferred; not instantiated)
- `infra/package-lock.json`
- `infra/package.json`
- `infra/tsconfig.json`

## Documentation

- `docs/aws-auth-cutover-runbook.md`
- `docs/aws-authorization-claims-model.md`
- `docs/aws-cdk-diff-review.md`
- `docs/aws-cognito-migration-design.md`
- `docs/aws-data-migration-runbook.md`
- `docs/aws-data-validation-plan.md`
- `docs/aws-database-target-decision.md`
- `docs/aws-email-provider-decision.md`
- `docs/aws-integration-security-model.md`
- `docs/aws-migration-baseline.md`
- `docs/aws-migration-commit-plan.md`
- `docs/aws-migration-file-manifest.md`
- `docs/aws-migration-status.md`
- `docs/aws-module-migration-matrix.md`
- `docs/aws-open-api-readiness.md`
- `docs/aws-operational-runbook.md`
- `docs/aws-production-readiness-gates.md`
- `docs/aws-provider-abstraction-design.md`
- `docs/aws-provider-conversion-status.md`
- `docs/aws-security-control-matrix.md`
- `docs/aws-staging-cost-and-deployment-review.md`
- `docs/aws-storage-migration-runbook.md`
- `docs/aws-supabase-dependency-map.md`
- `docs/aws-threat-model.md`
- `docs/openapi/tracepoint-v1.yaml`

## Explicit exclusions

- Exclusion: `src/app/integration-demo/` is unrelated pre-existing user work.
  Never stage it through the migration allowlist.
- All other existing product source, Supabase migrations and documentation are
  read-only evidence and are not migration changes.
- Generated/local artifacts are excluded: `.next/`, `infra/dist/`,
  `infra/node_modules/`, every `infra/cdk.out*`, logs and environment files.
- No secret file, database export, AWS response or live-data artifact belongs in
  this manifest.
