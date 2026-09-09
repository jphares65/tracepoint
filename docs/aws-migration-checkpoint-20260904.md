# Authoritative migration checkpoint — September 4, 2026

TracePoint is **staging operational, not production cutover-ready, and not fully migrated**. Production remains Vercel plus production Supabase/Brevo. No production DNS, customer data, provider configuration or management-account workload was changed. No AWS resources were mutated in this run.

Final addendum: a prepared server-only SES v2 adapter has five additional passing tests covering request mapping, suppression/outage rejection, header validation, sanitized ambiguous outcomes and no automatic retry. Runtime selection remains Brevo; SES is not deployed or enabled. Persistent suppression/event integration and live delivery validation remain required. The score stays 47.80% because its email checks require live capabilities. Private S3 integration also requires replacing the synchronous public department-asset URL contract with authorized delivery.

Delivery limitation: GitHub fetch succeeded, but push failed because the configured VS Code askpass helper is inaccessible; GitHub CLI is absent. Commits are preserved locally and in the final Git bundle. The next run must recover and push those commits before deploying. No remote advancement is claimed.

## Starting state and access limits

Fetched GitHub through a clean temporary clone because the shared workspace Git metadata is read-only. `origin/main=e33e4a4f17b662dddec9bf653ebf4051c3eb78ab`; AWS branch began at `6b0e3028f3e5e97d567de20c05637bb0cb64e7b7`. Application fixes are already equivalent; no duplicate cherry-picks were performed. The existing Officer/equipment/range behavior was preserved. New dependency patches are additional AWS-branch changes and have NOT reached Vercel production.

Target remains account `559054714699`, region `us-east-1`, role containing `TracePointMigrationStaging`. AWS CLI STS returned NoCredentials; local AWS profile directory was inaccessible. The AWS MCP identity call was rejected because it requires approval and session policy is `never`. No management-account operation was attempted. A production account/profile may exist elsewhere; it could not be verified here. Staging DB and authenticated test credentials were not available.

Last authoritative deployed checkpoint: ECS revision 7, desired/running 1/1, healthy target, issued ACM certificate, immutable image from `6b0e302`, zero ECR findings. Those private AWS details are inherited from the user's checkpoint, **not reverified**. The exact digest was not included in that checkpoint and could not be retrieved. Current alarm states, error logs, actual spend, and migration ledger likewise could not be reverified. No new image or revision was deployed.

New independent live evidence: login and `/api/health` return 200; public landing renders; 11 protected page routes plus equipment-types API redirect to login; root redirects to landing as designed. A Chromium session verified visible email/password/submit controls. An additional 10-route HTTP smoke passed (two public 200 responses, eight protected API login redirects). Authenticated scenarios remain explicitly blocked, not passed.

## Implemented and validated

- Patched Next.js 16.2.6 to **16.3.4**, synchronized ESLint config, updated vulnerable transitive packages within supported ranges, and moved SheetJS from npm's 0.18.5 to the official **0.20.3** tarball. Final npm audit reports **zero vulnerabilities**, including dev dependencies. The official tarball is integrity-pinned in the lockfile. A representative spreadsheet round-trip test passed. These patches are not yet deployed anywhere.
- Added browser acceptance through the supported login form with exact staging-origin/project restrictions, explicit disposable-tenant selection, session/tenant/page/API checks, optional foreign-tenant cookie test, equipment-type lifecycle with cleanup, and logout. Public portions ran; credential-dependent portions did not.
- Fixed clean-checkout deployment, exact staging Supabase validation, scan gating, strict ECS/ALB health enforcement, PowerShell-compatible public smoke, and executable rollback. Added structural template validation that admits the expected ECS image replacement but rejects unrelated resource changes. Fifteen mocked identity/scan/runtime cases and two structural template tests pass without AWS calls.
- Bound CodeBuild input to the uploaded S3 VersionId; added build/scan waiting and an OIDC staging runtime workflow using a protected GitHub environment. Added a guarded release wrapper with previous-revision recovery. These paths are implemented and locally checked, but **not live-rehearsed**.
- Added application-target 5xx and memory alarms to CDK. Existing ALB 5xx, unhealthy-target alarms, encryption, retention, circuit breaker and health checks were preserved. New alarms are **not deployed**; alarm destinations and delivery still require validation.
- Added an offline production preview using synthetic account `111111111111`, with separate names/secrets/certificate references, two tasks, scaling to four, one-year application logs and ALB deletion protection. Six infrastructure tests and strict staging/production synth pass. The real deployment entry point remains staging-only until a production account is verified.
- Extended the clean 56-migration bootstrap with real PostgreSQL tenant-negative tests and an optional disposable export/restore rehearsal. All public-table row counts/checksums and RLS definitions matched after restore. Recorded synthetic restore/reconciliation time: **2.742 seconds**, not a production RTO.
- Added a staging-only read-only snapshot manifest (row counts, SHA-256 fingerprints, FK/RLS metadata), exact staging migration-version comparison, trusted TLS, and local storage checksum/reconciliation utilities with corruption/loss tests. No production export, storage copy or provider migration occurred.
- Added a fail-closed production cutover evidence validator and the concrete execution/rollback package in `aws-cutover-execution-20260904.md`. The validator checks supplied inputs; it does not independently prove the attested gates or authorize execution.

## Validation record

| Gate | Result and limit |
|---|---|
| Application tests | 127 passed after dependency update and prepared SES adapter |
| Script tests | 12 passed, including spreadsheet, manifests, runtime configuration, structural diff and production preflight |
| PowerShell safety cases | 15 passed; all scripts parse; zero AWS API calls in mocks |
| TypeScript | Application and infrastructure pass |
| Changed-file lint | Pass; no new errors/warnings |
| Next.js production build | Next 16.3.4 build passed, 78 static pages; staging URL and placeholder public key only, not live credentials |
| Migration bootstrap | All 56 applied on clean disposable PostgreSQL |
| Tenant isolation | Own-tenant read succeeds; foreign-tenant read, foreign-tenant write and non-manager write denied |
| Export/restore rehearsal | Synthetic local dump/restore, all-public-table count/checksum and RLS policy reconciliation pass |
| Infrastructure tests | 6 pass, including production separation/scaling/retention assertions |
| Strict staging and production synth | Pass offline; production identity/certificate are placeholders |
| Template review | Offline comparison against 6b0e302: two added alarms, CodeBuild environment change, zero removed resources; no network/security/compute changes. Not a live AWS drift review |
| Source archive | Final committed source archive passed: 332 tracked files |
| Public staging smoke | HTTP and Chromium form checks pass |
| Authenticated staging | Blocked on disposable account credentials; additional mutation/file/export fixtures remain engineering work |
| CloudWatch/ECR/ECS private checks | Blocked on AWS access; checkpoint values retained as historical |
| Cost | Revised modeled $54.17/month, $20.83 below $75 ceiling; actual bill/budget not verified |

The existing CDK unit-test fixture emits acknowledged availability-zone warnings during template assertions; strict CLI synthesis passes. No lint debt was hidden. Test-runner access to Windows user information initially failed; a test-only OS fallback resolves it. An initial restore attempt lacked pg_dump; trusted EDB PostgreSQL 18.6 client binaries were downloaded into temporary storage and the rehearsal then passed. No system installation or production database access was used.

## Weighted completion — full migration scope

**33.35% before → 47.80% after**, calculated from `aws-migration-checklist-20260904.json`. Weights total 100; each category contains equally weighted binary capabilities. The baseline is reconstructed from this run's authoritative checkpoint/source, not compared against an earlier undocumented percentage. Documents alone earn no credit. Local validated engineering earns only its named capability; unexecuted deployments and rehearsals remain incomplete.

| Category | Weight | Before → after | Evidence | Exact remainder | Can Codex finish without Jason? |
|---|---:|---:|---|---|---|
| AWS account/governance | 6 | 50% → 50% | Isolated staging checkpoint; exact identity boundary | Verify dedicated production identity and organization controls | No: account/profile access |
| Network and compute | 10 | 60% → 60% | Healthy staging checkpoint; lean synth | Production deployment and load/failure test | No: authorized production target |
| Runtime deployment | 8 | 25% → 25% | Immutable staging image checkpoint | Full authenticated staging acceptance, production runtime, live rollback | No: staging credentials and production authority |
| Database/schema/data migration | 16 | 25% → 50% | Bootstrap, RLS negatives, local restore | Live snapshot reconciliation, production-size rehearsal/PITR, production database transfer | Local tooling yes; live work needs credentials and transfer authority |
| Authentication | 10 | 40% → 40% | Existing Supabase wiring/access tests | Authenticated staging; replacement issuer/MFA/session migration | Adapter work yes; live validation needs test accounts and target |
| Storage | 8 | 25% → 50% | ObjectStore tests; checksum failure tests | S3 adapter/deployment, real object transfer and reconciliation | Adapter work yes; live transfer requires access/approval |
| Email | 6 | 50% → 50% | Provider tests; staging Brevo configuration checkpoint | SES adapter/deployment, suppression/bounce/invite/reset tests | Adapter work yes; account/sender approval needed |
| DNS/TLS | 8 | 50% → 50% | Current staging HTTPS/HTTP checks | Production ACM and reviewed DNS cutover | No: production account and DNS approval |
| CI/CD | 8 | 20% → 60% | Scan/runtime safety tests; existing publication checkpoint | GitHub OIDC environment setup, actual full release/recovery | No: AWS/GitHub environment/test-account access |
| Security/monitoring/backups | 10 | 37.5% → 50% | Retained encryption/logging/alarms; clean source audit | Alarm delivery, production restore, WAF/load controls, actual costs | Local controls yes; live checks/owners needed |
| Production account readiness | 6 | 0% → 50% | Strict preview and production template assertions | Real account/role gate and deployment | No: exact target/profile |
| Cutover/rollback validation | 4 | 0% → 25% | Executable rejection tests | DNS/app rollback rehearsal and agency approval | No: authorized environment/window |

## Remaining provider dependencies

| Surface | Actual current dependency | Implemented boundary/evidence | Exit requirement |
|---|---|---|---|
| PostgreSQL/data access | Supabase PostgreSQL through PostgREST and RPC | 560 static data calls (495 .from, 65 RPC), 24 browser data calls; repository adapters and tenant tests | Replace browser/server transport, preserve RPC transactions, roles/auth.uid semantics and all RLS; rehearse real data |
| Authentication | Supabase password/OTP, SSR cookies/claims, PKCE callbacks, Auth Admin | Four client factories; 39 matched static Auth calls (regex does not include every method) | Replacement issuer adapters, immutable subject mapping, resets/activation, session cutover/MFA validation |
| Storage | Supabase Storage for application files; AWS S3 only holds build source | Tested ObjectStore boundary and local checksum tools | S3 adapter, tenant signing, object/metadata copy, quarantine and retention |
| Realtime | No .channel/postgres_changes/.realtime usage found in current source search | Static absence only | Confirm deployed/client behavior during pilot; no realtime migration currently demonstrated necessary |
| Email | Brevo transactional provider; Supabase auth messaging also remains | Email provider interface tests | SES delivery implementation plus verified identities, suppression/bounce/complaint handling and idempotency |
| Public configuration | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SITE_URL | Build-time injection; exact staging/production URL guards | Rebuild per environment; never reuse staging client bundle in production |
| Server configuration | SUPABASE_SECRET_KEY (legacy fallback SUPABASE_SERVICE_ROLE_KEY), BREVO_API_KEY, NOTIFICATION_DISPATCH_SECRET, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, CONFIGURATION_ENVIRONMENT | Secret references and startup guard; provider switches pinned to supabase/brevo/supabase | Install isolated production secret values; rotate/revoke with validation; do not print or commit |

The initial AWS production hosting cutover must retain production Supabase database/Auth/Storage and Brevo. GovCloud portability is not complete: provider dependencies and commercial-partition infrastructure remain.

## Critical path to Wednesday and Jason's actions

1. **Immediately:** make a short-lived staging session accessible to this execution environment, with account `559054714699`, region `us-east-1`, assumed role containing `TracePointMigrationStaging`. The local AWS directory/credential chain is currently unavailable; the connector additionally requires an approval mode this run does not have. Never supply credentials in chat.
2. **Immediately:** provide a disposable staging manager login and department through secure environment/GitHub secrets; also identify a second disposable tenant and two test Officers for mutation/isolation fixtures. No customer data is needed.
3. **Immediately:** identify the dedicated production workload account and exact production role/profile, or have the authorized organization administrator provision it. No management-account access is requested for Codex. Confirm apex/www production hostname, budget and operational owner.
4. **Next:** configure the GitHub `aws-staging` environment/role trust and variables listed in the execution package. Stage and validate the patched image; do not assume source audit remediation is live. The current Vercel release remains on the old dependency set and needs a separately reviewed patch promotion.
5. **Before cutover:** assign on-call/backup owners, verify production Supabase backup/PITR and a restore, approve RTO/RPO and agency pilot, complete real production configuration/acceptance and rollback rehearsal.
6. **Final manual gate:** separately approve the production deployment/DNS traffic window and captured rollback records. No production-data transfer is needed for hosting-only cutover. Any provider/data exit needs a new explicit transfer authorization and rehearsal.

The next autonomous run should recover the bundle, restore GitHub authentication, push the AWS branch, verify restored staging credentials, deploy/rehearse the patched staging release, complete disposable authenticated fixtures/workflows, confirm alarms/errors/cost, and validate the exact production target. Further independent engineering remains in authenticated mutation coverage and actual provider adapters; these are not disguised as documentation-only manual gates. A full Supabase/Auth/Storage/Brevo exit cannot responsibly be represented as complete by the hosting cutover alone.

Detailed commands, evidence limits, rollback triggers and provider-exit boundaries are in `aws-cutover-execution-20260904.md`. The original shared `docs/aws-migration-status.md` and all protected user files/edits were preserved.

## Final validation and recovery record

Final application tests: 127 passed. Script tests: 12 passed. Infrastructure tests: 6 passed. Mocked deployment safety cases: 15 passed. TypeScript, changed-file lint, Next.js 16.3.4 production build and full npm audit pass (zero reported vulnerabilities). Final implementation archive: 332 tracked files at 10749e940bafc9b5a77c1fc6b3ed7c966e4b311f. The dependency patch is 1b41cdb; release/readiness tooling is 544467b. The prepared SES adapter is 10749e9 and remains disabled. GitHub remote was independently verified still at 6b0e3028f3e5e97d567de20c05637bb0cb64e7b7 after failed push attempts.

Recover the incremental bundle in a checkout that already contains the remote baseline (or fetch that baseline first):

```powershell
git bundle verify C:/Users/jphar/tracepoint/tracepoint-aws-readiness-20260904.bundle
git fetch C:/Users/jphar/tracepoint/tracepoint-aws-readiness-20260904.bundle codex/aws-staging-readiness-20260902:refs/heads/codex/aws-readiness-recovered-20260904
git switch codex/aws-readiness-recovered-20260904
git push origin HEAD:codex/aws-staging-readiness-20260902
```

Do not force-push. If the remote moved, reconcile it first while preserving this work. A later clean checkout of the AWS branch is required by the image publisher's exact branch guard. The clean implementation checkout is C:/Users/jphar/AppData/Local/Temp/tracepoint-migration-20260904. No production or staging provider secret is embedded in the bundle.
