# TracePoint architecture-assessment reconciliation

**Repo state:** `/home/user/tracepoint`, HEAD `a3677a6` (= `main` = `origin/main`, 2026-10-07). Audit date 2026-10-20. Read-only; no repo file modified.

**Scope and method.** No single "architecture assessment" document exists. `git log --all -S'assessment'` matches only AI-importer `sheetAssessments` code (commits `f3a221c`, `086e477`, `30b9233`, `79350c7`). No deleted assessment/audit/review doc appears in `git log --diff-filter=D`. History is shallow: 79 commits, starting 2026-09-05. The prior-assessment corpus is the 17 docs named in the brief. Every concrete recommendation, open gate, defect or TODO in them was taken out and checked against `src/`, `supabase/migrations/`, `infra/`, `scripts/` and `.github/workflows/`. Exact duplicates across docs were merged under the first source. This is not a fresh audit. Section K lists 5 newly observed issues.

**Verification limits.** `node_modules` is absent, so I could not run tests, `tsc`, lint or the build. "Verified" therefore means a test file asserts the behavior, or committed machine evidence (JSON/doc tied to a commit) records it. The docs stop at 2026-09-09. Nothing in the repo records live AWS or Supabase state after that date.

**Status key:** IV = Implemented & verified by test/evidence · INV = Implemented, not verified · P = Partially implemented · NI = Not implemented · S = Superseded/No longer applicable · CD = Cannot determine from repo.

---

## Cross-cutting answers

| Question | Finding | Evidence |
|---|---|---|
| **Is Supabase still a runtime dependency?** | **Yes, fully.** Supabase is still the only Auth provider, the only data provider, and the RLS authorization engine. Brevo is the only active email provider. S3 is the only AWS provider that is actually selectable. Cognito, SES and Postgres-session code exists but no route imports it. | `package.json`: `@supabase/ssr`, `@supabase/supabase-js`. `src/lib/supabase/{client,server,proxy,admin}.ts` are imported by about 47 files. `src/lib/authentication/server-provider.ts:8` throws unless `TRACEPOINT_AUTH_PROVIDER` is `supabase`. All `TRACEPOINT_DATA_PROVIDER` factories accept only `supabase` (e.g. `src/lib/certifications/type-catalog-repository-core.ts:16`). `src/lib/email/provider-core.ts:55-60` accepts only `brevo`. `src/lib/storage/object-store.ts:9-13` allows `s3`, and `infra/lib/runtime-stack.ts:100-102` sets it. No file outside `src/lib/authentication` or `src/lib/email` imports the `cognito-*`, `ses-*` or `postgres-*` modules. Source still holds 541 literal `.from("…")` calls and 56 `.rpc(` calls. |
| **Is the browser-localStorage workspace problem fully resolved?** | **No. Partially resolved.** Off-duty requests (`tracepoint-off-duty-workflow-v1`) and the inbox (`tracepoint-inbox-v1`) now go through server APIs and tables; those keys survive only in `.backup` files. **Range Days** (`tracepoint.rangeDays.workspace.v1`) still writes localStorage and falls back to it when the server is unavailable. Its server copy is one JSON blob per department, not the normalized tables. **Training Alerts** keeps acknowledgement and alert state only in localStorage, and writes remediations to both localStorage and the server. The remaining localStorage uses (appearance, table grouping, focus preferences) are legitimate per-viewer preferences. | `src/app/range-days/page.tsx:408,419-447,2399-2406,2478,2945,3503`. `src/app/api/pilot/range-workspace/route.ts:128-173` (`pilot_range_workspaces`). `src/app/training-alerts/TrainingAlertsClient.tsx:177,253,262`. `supabase/migrations/202609060001_retire_legacy_training_alert_permissions.sql:46` says "Server-persisted alert acknowledgement, assignment, dismissal, escalation, and resolution are not implemented". |
| **Are tests run in CI?** | **Only on release paths. There is no PR or main-branch gate for application code.** `aws-staging-runtime.yml` runs script tests, `run-application-tests.mjs`, infra tests and `tsc`. It triggers only on `workflow_dispatch` or on a push to two named `codex/*` branches that touches `.github/staging-release.json`. `aws-staging-oidc-proof.yml` has the same steps but its trigger is limited to one path on one branch. `aws-staging-foundation.yml` runs on `pull_request` only for `infra/**` paths and runs only the infra tests. No workflow runs ESLint, `next build` on PRs, or `db:validate-bootstrap`. | `.github/workflows/aws-staging-runtime.yml:2-31`, `aws-staging-oidc-proof.yml:2-30`, `aws-staging-foundation.yml:3-44`. |
| **Is there application-level test coverage of core workflows?** | **Thin, and it lives at the library level.** `scripts/run-application-tests.mjs` collects every `src/**/*.test.ts(x)` file and runs it with `node --import tsx --test`. That is 79 files and about 377 `test(`/`it(` cases. Coverage by module: authentication 12 (Cognito/Postgres code that is dormant), tracepoint 11, email 8, range 7, ai-importer 7, equipment 5, armory 4, notifications 3, storage 2, fleet 2, agency-training 2, and 1 each for 16 other modules. **None of the 98 `src/app/api/**/route.ts` handlers and none of the pages have a test.** 17 of the 79 files are structural tests that read source text and regex-match it, including every permission and editing test. Playwright is a dev dependency, but no spec or config exists. Off-duty, qualifications, certifications and personal-rifles have only one read-repository test each. Their write workflows are untested. | `scripts/run-application-tests.mjs`. Test list: `find src -name '*.test.ts*'`. Structural examples: `src/lib/tracepoint/permission-controlled-editing.test.ts:5-25`, `granular-permissions.test.ts`. |
| **Are there two parallel permission models?** | **Yes. One rule set is implemented twice and must stay in sync.** (1) The TypeScript app layer: `effectiveDepartmentPermissions()` is evaluated separately in `src/lib/supabase/proxy.ts:359-373` and in `src/lib/tracepoint/server-access.ts:407-451`. Both re-query `department_role_permissions`. Most API routes then use the **service-role admin client**, which bypasses RLS. (2) The SQL layer: `has_department_permission` and the RLS predicates in migrations, used by browser and RLS-scoped calls. The shared catalog is pinned by a generated test, and the SQL side by `validate-clean-bootstrap.mjs`. No test asserts that the TS and SQL decisions are equal, and the SQL validator is not in CI. A third, dormant model is the Cognito claims design in `src/lib/authentication/postgres-mapping.ts`. The old dual *role vocabulary* (`Admin`/`Command` vs `Administrator`/`Command Staff`) survives only as the unused `UserRole` type in `src/app/lib/tracepoint/types.ts:1-7`. | Files as cited. `src/lib/tracepoint/permission-authority.ts:6-27`. |

---

## A. `docs/backend-source-audit.md`

| ID | Recommendation | Source | Status | Evidence | Remaining action | Priority |
|---|---|---|---|---|---|---|
| ARC-01 | Replace the three browser-local workspaces (range days, off-duty, inbox) with database tables | BSA table + migration order 3-5 | P | Off-duty uses `off_duty_firearm_requests` (`src/app/api/off-duty-firearms/route.ts`). The inbox uses `notification_events`. Range stays in localStorage plus a JSON blob (`range-days/page.tsx:408`, `api/pilot/range-workspace/route.ts:128-173`). | Make the server the only source of truth for Range Days. Delete the localStorage fallback and writes. | High |
| ARC-02 | One authoritative Range Day type model (remove duplicate `types.ts` / `range-day-types.ts`) | BSA #1 | P | Both still define `RangeDay`: `src/app/lib/tracepoint/types.ts:109`, `range-day-types.ts:88`. The second imports `ScoringMode` from the first (`range-day-types.ts:1`). | Collapse to one type generated from or aligned with the DB schema. | Medium |
| ARC-03 | Stable role codes; multiple roles per person | BSA #2 | IV | Authorization uses role codes and the permission matrix (`permission-authority.ts:6-27`; `granular-permissions.test.ts:24`). The legacy `UserRole` (`"Admin"|"Command"`) remains, unused for authorization (`types.ts:1-7`). | Delete the legacy `UserRole` type. | Low |
| ARC-04 | One `scoring_format` enum with all seven modes | BSA #3 | P | DB uses `scoring_format` (`src/lib/range/read-repository-supabase.ts:17`). The UI `ScoringMode` still has 4 values (`types.ts:96-100`). | Align the UI scoring type with the DB enum. | Medium |
| ARC-05 | Normalize array fields into relationship tables | BSA #4 | P | Normalized tables exist and are read (`read-repository-supabase.ts:16-19`). Live range writes go to one JSON `workspace` column, so the arrays live in JSON (`range-workspace/route.ts:157-173`). The Drill Library alone moved to `drill_templates` (`202609010001_drill_documents_mvp.sql:2`). | Write range rosters, results and malfunctions to the normalized tables. | Medium |
| ARC-06 | Replace hard-coded `current-user.ts` with the authenticated profile | BSA #5, order 6 | IV | No `current-user` file or import in `src`. PCA #12 records its removal. `server-access.ts` resolves the user. | None. | Low |
| ARC-07 | Cross-module analytics from one normalized source | BSA #6 | P | Read repositories exist (`src/lib/range/read-repository-supabase.ts`), but they mix the JSON workspace with normalized tables. Training Alerts merges server data with localStorage. | Depends on ARC-05. Then point analytics at normalized tables only. | Medium |
| ARC-08 | Migration step 7: pilot data import and acceptance testing | BSA order 7 | P | Import wizard and AI importer exist (`src/lib/ai-importer/*`, 7 test files). No pilot acceptance evidence (see ARC-75). | Run and record pilot acceptance. | High |

## B. `docs/permission-coverage-audit-20260905.md`

| ID | Recommendation | Source | Status | Evidence | Remaining action | Priority |
|---|---|---|---|---|---|---|
| ARC-09 | Register the missing catalog permissions (`manage_training`/`certifications`/`equipment`) | PCA defect 1 | IV | `202609050002_granular_permission_authority.sql`. `granular-permissions.test.ts:8` checks generated coverage. | None. | Low |
| ARC-10 | Remove role-name authorization shortcuts | PCA defect 2 | IV | `granular-permissions.test.ts:69` (structural). The only remaining role-code branch is display text in `api/pilot/personnel/route.ts:59-80`. | None. A behavioral test would make this stronger. | Low |
| ARC-11 | Only the exact `administrator` role inherits the catalog | PCA defect 3 | IV | `permission-authority.ts:6-12`; `granular-permissions.test.ts:24`. | None. | Low |
| ARC-12 | Restore `set_department_member_roles` validation, audit and final-Administrator triggers | PCA defect 4, 11 | IV | `scripts/validate-clean-bootstrap.mjs`. `docs/aws-migration-status.md` records a clean bootstrap and tenant-isolation run on all 75 migrations (2026-09-09). | Add `db:validate-bootstrap` to CI. | Medium |
| ARC-13 | Fix certification false denial (no `auth.uid()` under the service role) | PCA defect 5 | INV | `granular-permissions.test.ts:107` matches source text only. | Add a behavioral route test. | Medium |
| ARC-14 | Agency-training writes require `manage_training` | PCA defect 6 | IV | RLS checks in the bootstrap validator. Structural test at `granular-permissions.test.ts:107`. | None. | Low |
| ARC-15 | Remove dead Training Alert and off-duty permission codes | PCA defect 7 | IV | `grep` finds zero runtime hits in `src`. Retired by `202609060001_retire_legacy_training_alert_permissions.sql`. | None. | Low |
| ARC-16 | Settings save via a tenant-bound API; report success only after a verified reload | PCA defect 8 | INV | `granular-permissions.test.ts:52` (structural). No UI test. | Add a UI or E2E test. | Low |
| ARC-17 | Gate the previously ungated operational endpoints | PCA defect 9 | INV | Structural regex tests only (`granular-permissions.test.ts:89-126`). Zero route-handler tests. | Add behavioral 401/403/cross-tenant route tests. | High |
| ARC-18 | Controlled 401/403 responses and `/unauthorized` | PCA defect 10 | IV | `proxy-authorization.test.ts:10-33` (behavioral). `src/app/unauthorized/page.tsx`. | None. | Low |
| ARC-19 | Remove the obsolete client authority module | PCA defect 12 | IV | Module absent. No hard-coded user IDs found. | None. | Low |
| ARC-20 | Pay down repository lint debt (441 errors) | PCA validation results | NI | `docs/aws-migration-status.md` reports 462 findings. No lint step in any workflow. | Burn down the findings and add lint to the PR gate. | Medium |
| ARC-21 | Fix the two legacy tests that Node's strip-only TypeScript runner cannot parse | PCA validation results | S | The runner now uses `--import tsx` (`scripts/run-application-tests.mjs`). | None. | Low |
| ARC-22 | Deploy migrations before the application | PCA migration section | CD | No migration-apply step in any workflow. Database lease workflows exist (`aws-staging-database-lease.yml`). | Document or enforce the order in the release workflow. | Medium |

## C. `docs/aws-production-readiness-gates.md` (G1-G16)

| ID | Recommendation | Source | Status | Evidence | Remaining action | Priority |
|---|---|---|---|---|---|---|
| ARC-23 | G1: separate staging and production accounts, SCPs, no management-account workload | Gate 1 | IV | `docs/aws-production-readiness-20260907.md` (account `193644343389`). `infra/policies/tracepoint-production-guardrails.scp.json`. `production-account-baseline-stack.ts:161`. | None. | Low |
| ARC-24 | G2: architecture, threat model, data classification, CJIS-aligned control review | Gate 2 | P | Docs exist (`aws-threat-model.md`, `aws-security-control-matrix.md`). No recorded named-owner review or approval. | Get dated owner sign-off. | Medium |
| ARC-25 | G3: tested break-glass path; remove `AdministratorAccess` after Access Analyzer review | Gate 3; 0907 blockers | NI | `docs/aws-iam-access-transition.md:11-13,46`. No later evidence. | Rehearse break-glass, then swap in the derived deploy policy. | High |
| ARC-26 | G4: signed and scanned immutable image, SBOM, dependency scan, patch SLA | Gate 4; TM supply chain | P | ECR scan shows zero findings (0907 doc). No SBOM, signing, Dependabot or `npm audit` anywhere in `.github/`, `infra/` or `scripts/`. | Add SBOM, signing, dependency scanning and an SLA. | High |
| ARC-27 | G5: DNS/cert/WAF decision; TLS and security headers tested externally | Gate 5 | P | ACM `ISSUED` (`docs/aws-readiness-20260909.json`). WAF stack exists (`infra/lib/request-controls-stack.ts`). **No HSTS, CSP or X-Frame-Options anywhere** (`next.config.ts`, `src`, `infra/lib`). | Add security headers and test them externally. | High |
| ARC-28 | G6: tenant-negative authorization suite, platform/support-mode isolation, audit continuity | Gate 6; TM row 1 | P | The DB actor matrix (`validate-clean-bootstrap.mjs`, `scripts/validate-local-tenant-isolation.sql`) runs outside CI. App-level checks are structural only. Disposable staging acceptance covers cross-tenant denial. | Build a behavioral per-route tenant-negative suite and run it in CI. | Critical |
| ARC-29 | G7: rehearse secret rotation, build-secret handling and emergency revocation | Gate 7 | NI | Automatic rotation is suppressed (`infra/lib/compute-foundation-stack.ts:98`). No rehearsal evidence. | Rehearse rotation and revocation. | High |
| ARC-30 | G8: rehearse DB migration twice; time the PITR restore; every browser Supabase query gets a tested server API | Gate 8 | P | Postgres rehearsal evidence exists (`docs/aws-postgres-rehearsal-*`). PITR is disabled. 31 direct `.from`/`.rpc` calls remain in 10 client components (`src/app/settings/page.tsx` has 21). | Remove the browser queries and complete the PITR and restore work. | Critical |
| ARC-31 | G9: storage checksum reconciliation, malware quarantine, approved retention | Gate 9 | P | `scripts/storage-reconciliation.mjs` with its test. No malware or quarantine code. Retention deferred (`docs/aws-storage-contract-inventory.md:59`). | Add malware scanning and a retention policy. | High |
| ARC-32 | G10: auth coexistence and cutover, MFA policy, disablement, help-desk recovery | Gate 10 | P | Cognito modules are tested but dormant (`src/lib/authentication/*`; `server-provider.ts:8`). The Cognito pool has `mfa: REQUIRED` (`infra/lib/cognito-foundation-stack.ts:13`). The live Supabase path has no MFA. | Plan the cutover and enforce MFA (see ARC-K3). | High |
| ARC-33 | G11: centrally owned CloudTrail, GuardDuty, Security Hub, Config, with findings routed | Gate 11 | P | Production baseline (`production-account-baseline-stack.ts:98-141`). The 0907 doc lists 8 Security Hub coverage gaps. Staging excludes these services (`infra/README.md`). | Route findings and close coverage gaps. | Medium |
| ARC-34 | G12: actionable alarms with tested on-call escalation | Gate 12 | P | SQS ALARM/OK path verified. "notification escalation tested" is still false (`docs/aws-readiness-20260909.json`). | Run the human delivery test. | High |
| ARC-35 | G13: load, failure, capacity and connection tests; revisit multi-task/cache decision | Gate 13 | IV | Bounded production load and failure test credited (`aws-readiness-20260909.json`). | Run realistic DB connection and capacity tests before agency load. | Medium |
| ARC-36 | G14: cost model, mandatory tags, budget and anomaly alerts | Gate 14 | INV | Budget fixed at $150 (`production-account-baseline-stack.ts:155-198`). `docs/aws-production-cost-model-20260906.json`. Owner approval not recorded. | Record owner approval. | Low |
| ARC-37 | G15: clean change set, canary and rollback approval | Gate 15 | P | Staging ECS rollback 24→23→24 rehearsed (`docs/aws-migration-status.md`). No production rollback. | Rehearse production rollback. | High |
| ARC-38 | G16: data owner and agency approve cutover | Gate 16 | NI | "agency cutover approved" is false (`aws-readiness-20260909.json`). | External approval. | Critical |

## D. `aws-production-readiness-20260906.md`, `-20260907.md`, `aws-migration-status.md`

| ID | Recommendation | Source | Status | Evidence | Remaining action | Priority |
|---|---|---|---|---|---|---|
| ARC-39 | Create the dedicated production account, bootstrap CDK, deploy the foundation stacks | 0906 blockers | IV | 0907 doc. `docs/aws-production-live-evidence-20260907.json`. | None. | Low |
| ARC-40 | Finalize the production runtime secret; deploy runtime, control and alert stacks | 0907 blockers | IV | Commit `978acd9` "Deploy production runtime controls and alert recipient". "production runtime deployed" credited in `aws-readiness-20260909.json`. | None. | Low |
| ARC-41 | Get the ACM certificate to `ISSUED` | 0907 | IV | `aws-readiness-20260909.json`. | None. | Low |
| ARC-42 | Approve Supabase PITR or backup tier; run an isolated production restore | 0906/0907/0909 | NI | "production PITR restore timed" and "production backup restore validated" are still false (`aws-readiness-20260909.json`). | Owner approval, then restore test. | Critical |
| ARC-43 | Human on-call SNS subscription plus ALARM/OK human delivery test | 0906/0907/0909 #2 | P | Recipient added in `978acd9`. Test deferred until after 2026-09-15. No later evidence. | Run and record the test. | High |
| ARC-44 | Close the 8 Security Hub coverage gaps | 0907 | CD | Live state; no evidence after 09-07. | Re-inventory. | Medium |
| ARC-45 | Production DNS alias, traffic cutover and DNS rollback | 0906/0907/0909 | NI | DNS cutover and rollback are false (`aws-readiness-20260909.json`). | Separate authorization. | High |
| ARC-46 | Merge the integration branch (importer repair) into `main` | 0909 #1 | IV | `git merge-base --is-ancestor 0bca9fd main` holds. Merges `99b4a69`, `1fbc98e`, `4d34a44`. | None. | Low |
| ARC-47 | Install `pg_dump`, set `TRACEPOINT_PG_BIN`, rerun the dump/restore rehearsal | 0909 #3 | NI | No evidence after 09-09. | Rerun the rehearsal and record it. | Medium |
| ARC-48 | Classify the 2 unclassified historical log events; WAF log access for correlation | 0906 operational | NI | 0906 doc. Nothing later. | Grant read access, then classify. | Low |

## E. `docs/aws-security-control-matrix.md` and `docs/aws-threat-model.md` (items not already covered by the gates)

| ID | Recommendation | Source | Status | Evidence | Remaining action | Priority |
|---|---|---|---|---|---|---|
| ARC-49 | Remove generic service-role exposure; exact task role | TM service-role row; SCM least privilege | P | The ECS task role is minimal or S3-scoped (`infra/README.md`). The app still hands the Supabase **service-role admin client** to most routes (`server-access.ts`, `src/lib/supabase/admin.ts`). | Narrow privileged DB access per domain. | High |
| ARC-50 | Session/token theft: cookie flags, revocation, Cognito issuer tests | TM | P | Cognito verifier, refresh and transport tests exist (`src/lib/authentication/*.test.ts`) but cover dormant code. Supabase cookie flags are untested. | Test the live cookie and session path. | Medium |
| ARC-51 | Privilege escalation: role-change races, support-mode audit | TM | P | Final-Administrator triggers and set-difference RPC (ARC-12). Race tests not evidenced. | Add a concurrency test. | Medium |
| ARC-52 | Malicious upload: size and type limits, MIME inspection | TM; storage inventory | P | Path and traversal checks are tested (`object-store.test.ts:171`, `s3-object-store.test.ts:12`). MIME inspection and upload-size policy are deferred (`aws-storage-contract-inventory.md:55-61`). | Add upload policy and MIME checks. | High |
| ARC-53 | Audit tampering: immutable central retention, access review, restore | TM; SCM logging | P | DB immutable-audit triggers. CloudTrail in production. No retention or restore review. | Review audit retention and restore. | Medium |
| ARC-54 | Webhook replay/spoofing: canonicalization and replay-store tests | TM | NI | No partner webhooks exist. SNS signature handling covers SES feedback only (`src/lib/email/sns-notification.ts`). | Defer until partner API work. | Low |
| ARC-55 | Independent review of tenant isolation | SCM tenant row | NI | Not evidenced. | Commission a review. | High |
| ARC-56 | Production-blocking abuse cases (inactive member reads, department-ID substitution, presigned traversal, reused activation token, ignored audit-write failure, etc.) | TM abuse list | P | Inactive-user 403 is tested (`proxy-authorization.test.ts:19`). Traversal is tested. Activation-token reuse and audit-failure handling have no tests. | Write one test per abuse case. | High |

## F. `aws-module-migration-matrix.md`, `aws-provider-conversion-status.md`, `aws-supabase-dependency-map.md`

| ID | Recommendation | Source | Status | Evidence | Remaining action | Priority |
|---|---|---|---|---|---|---|
| ARC-57 | Wave 1: contracts and observability, no behavior change | Matrix waves | IV | Provider-core modules with tests (`src/lib/*/…-core.ts`). | None. | Low |
| ARC-58 | Wave 2: email adapter, Brevo retained | Waves; conversion status | IV | `src/lib/email/provider-core.ts`; `provider.test.ts`. SES code exists but cannot be selected (`provider-core.ts:55-60`). | Decide whether SES is activated or removed. | Low |
| ARC-59 | Wave 3: server-only storage adapter (S3 provider) | Waves; conversion status | IV | `object-store.ts:9-13`, `s3-object-store.test.ts`, `infra/lib/runtime-stack.ts:102`. Staging acceptance covers the S3 lifecycle. **`aws-provider-conversion-status.md` is stale: it says no AWS provider exists.** | Update the doc. | Low |
| ARC-60 | Wave 4: bounded read-only repositories with parity tests | Waves; conversion status | P | 125 of 551 reads converted, per the doc. Supabase is the only data provider. 541 `.from` and 56 `.rpc` calls remain in source. | Continue. Writes are unaffected so far. | Medium |
| ARC-61 | Wave 5: transactional domain writes and audit coupling | Waves | NI | All mutations still call Supabase directly (e.g. `api/pilot/range-workspace/route.ts:163-173`). | Design the write repositories. | High |
| ARC-62 | Wave 6: remove browser direct queries | Waves; matrix row | NI | 31 calls in 10 TSX files: `TracePointShell`, `VisualCustomization`, `page.tsx`, `settings/page.tsx`, `platform/*`, `auth/setup`, `RangeQualificationRulesPanel`, `AnalyticsDashboardSettingsPanel`. | Move them behind server APIs. | High |
| ARC-63 | Wave 7: auth and session coexistence, then cutover | Waves; matrix | P | Cognito PKCE, refresh and Postgres-session modules with 12 test files exist but are not wired in (`server-provider.ts:8`). | Wire in behind a gate, then rehearse. | High |
| ARC-64 | Auth, tenant-negative, error-contract and audit tests for every non-health route before conversion | Matrix route disposition | NI | 0 test files under `src/app`. 98 `route.ts` handlers. | Add a route test harness. | Critical |
| ARC-65 | Storage deferrals: delete bytes on archive, clean up old patches, handle compensation failures, reconcile orphans | Conversion status; storage inventory | P | Checksum reconciliation exists (`scripts/storage-reconciliation.mjs`). The other items are deferred (`aws-storage-contract-inventory.md:59-61`). | Decide policy, then implement. | Medium |
| ARC-66 | Define the `tracepoint-attachments` bucket in the repo | Conversion status | IV | `supabase/migrations/202609010001_drill_documents_mvp.sql:44-45`. | None. | Low |
| ARC-67 | Keep Supabase Auth UUIDs as the immutable application subject ID | Dependency map | IV | `src/lib/authentication/postgres-mapping.test.ts`; `scripts/authentication-mapping-manifest.test.mjs`. | None (still dormant). | Low |
| ARC-68 | Find and define the caller or schedule for `/api/notifications/email-dispatch` | Dependency map | CD | No scheduler, EventBridge rule or cron in `infra/lib`, `.github` or `vercel.json`. | Confirm the live caller and codify it (see ARC-K4). | High |
| ARC-69 | Export live Supabase metadata (dashboard SQL, storage policies, auth settings) | Dependency map limitations | P | `scripts/verify-staging-schema.mjs`, `refresh-schema-source.mjs`. Auth settings and templates export not evidenced. | Complete the export. | Medium |

## G. `docs/aws-open-api-readiness.md` and `docs/aws-integration-security-model.md`

| ID | Recommendation | Source | Status | Evidence | Remaining action | Priority |
|---|---|---|---|---|---|---|
| ARC-70 | Partner `/api/v1`: OAuth clients, scopes, idempotency, cursor pagination, rate limits, audit, contract tests | Both docs | NI | No `src/app/api/v1`. `docs/openapi/tracepoint-v1.yaml` is design only. No app-level rate limiting (WAF only). | Deferred by design. | Low |
| ARC-71 | Never route `/api/v1` to internal handlers; expose no internal routes | Open API | IV | No v1 route exists. The proxy denies by default (`proxy-authorization.test.ts`). | None. | Low |

## H. `infra/README.md`

| ID | Recommendation | Source | Status | Evidence | Remaining action | Priority |
|---|---|---|---|---|---|---|
| ARC-72 | Defer the unused attachment bucket | README | S | Superseded by `infra/lib/private-storage-stack.ts`, `storage-stack.ts` and the S3 provider. | Update the README. | Low |
| ARC-73 | Staging excludes CloudTrail, GuardDuty, Security Hub and Config (separate baseline) | README | P | Production baseline has them. Staging has no equivalent. | Decide for staging. | Low |
| ARC-74 | Review a real `cdk diff` before runtime deploy | README gate | IV | `aws-migration-status.md`: zero-difference live diff, drift `IN_SYNC`. | None. | Low |

## I. `docs/refinement-plan.md` and `docs/readington-pilot-checklist.md`

| ID | Recommendation | Source | Status | Evidence | Remaining action | Priority |
|---|---|---|---|---|---|---|
| ARC-75 | Run the Readington pilot QA checklist end to end | Plan step 1; checklist | CD | 156 items, **0 checked** in the doc. No recorded run. No E2E specs. | Run it, record evidence, and automate the acceptance flow. | Critical |
| ARC-76 | Freeze new major modules until the pilot is done | Plan "Do Not Start Yet" | NI | New major features were added afterwards: AI importer and Bedrock (`3263d00`, `086e477`), multi-file migration workspace (`7625613`), dashboard and analytics builder (`a1a7df6`), fleet QR (`11eb8bb`). | Reaffirm or retire the rule. | Medium |
| ARC-77 | DoD: core modules persist to the server; no browser-only remediation or alert records | Plan DoD; checklist §11 | P | See the localStorage row above. Alert acknowledgement is browser-only. Remediations are written twice (`TrainingAlertsClient.tsx:253-262`). | Persist alert workflow state on the server. | High |
| ARC-78 | Test role-based access with Admin, Command, Instructor, Officer and Low-level users | Plan step 6; checklist §12 | P | DB actor matrix by permission (bootstrap validator). Staging acceptance covers cross-tenant denial. No per-role UI or E2E evidence. | Add role-persona E2E tests. | High |
| ARC-79 | Local and Vercel builds pass | Plan DoD; checklist §1 | INV | `next build` runs only in release paths (CodeBuild). No PR build. Vercel status unknown (`next.config.ts:6`). | Add a build step to the PR gate. | Medium |
| ARC-80 | Clean demo and test data; remove stale localStorage records | Checklist §14 | CD | Live data. The localStorage keys still exist in code. | Clean up, then verify. | Medium |

## J. `docs/training-alert-permission-hardening.md`

| ID | Recommendation | Source | Status | Evidence | Remaining action | Priority |
|---|---|---|---|---|---|---|
| ARC-81 | Server-protected `/training-alerts` route with redirects | TAPH | INV | `src/app/training-alerts/page.tsx:14-20`. No behavioral test. | Add a route test. | Low |
| ARC-82 | Add six Training Alert and Remediation permissions | TAPH | S | Retired by `202609060001_retire_legacy_training_alert_permissions.sql`. Mapped to `manage_training` and `view_analytics` (`permissions.ts:17-30`). | Update the doc. | Low |
| ARC-83 | Server-persisted alert acknowledgement, assignment, escalation and resolution (`manage_training_alerts` scope) | TAPH; migration 202609060001:46 | NI | The migration states it is not implemented. State is held in localStorage. | Implement it on the server. | High |

## K. Newly observed issues that block product quality (max 5)

| ID | Issue | Evidence | Priority |
|---|---|---|---|
| ARC-K1 | **Range Day data is one department-wide JSON blob with whole-document PUT.** The server compare-and-swap only guards its own read-to-write window. The client does not send the version it loaded, so a stale tab can overwrite another instructor's scores. The localStorage fallback can also resurrect stale data. | `api/pilot/range-workspace/route.ts:128-185`; `range-days/page.tsx:2399-2406` | High |
| ARC-K2 | **No quality gate on PRs or `main`.** Application tests, `tsc`, lint and `next build` run only in release-dispatch paths. 17 of 79 test files are regex scans of source text. API handlers have zero tests. | `.github/workflows/*` | Critical |
| ARC-K3 | **The department "MFA required" setting is stored but never enforced.** This is a misleading security control. | Read only by `src/app/settings/page.tsx:122,1141,4356`. Column defined in `202606260003_settings_administration.sql:89`. No proxy or auth check reads it. | High |
| ARC-K4 | **No email-dispatch scheduler is defined anywhere in the repo.** Queued notification and digest emails depend on an external caller that is not declared, which matters most once Vercel is retired. | No match for the dispatch route or secret in `infra/lib` schedulers, `.github` or `vercel.json`. Only `runtime-stack.ts` passes the secret. | High |
| ARC-K5 | **Maintainability debt in the app shell.** There are 36 `.bak` and `.backup-*` files in `src/app`, including API routes. Three pages run to 5,000-7,700 lines and embed direct Supabase queries: `settings/import-export/page.tsx` (7,738), `range-days/page.tsx` (7,415), `settings/page.tsx` (5,079). | `find src -name '*.bak' -o -name '*.backup-*'`; `wc -l` | Medium |

---

## Summary counts (ARC-01 to ARC-83; K-items excluded)

| Status | Count |
|---|---:|
| Implemented & verified by test/evidence | 23 |
| Implemented, not verified | 6 |
| Partially implemented | 30 |
| Not implemented | 16 |
| Superseded / No longer applicable | 3 |
| Cannot determine from repo | 5 |
| **Total** | **83** |

**Critical open items:**
- ARC-28: behavioral tenant-negative suite
- ARC-30: browser queries and PITR
- ARC-38: agency cutover approval
- ARC-42: PITR and restore
- ARC-64: route-level tests
- ARC-75: pilot checklist never executed
- ARC-K2: no PR quality gate

**Main pattern:** the permission hardening from 2026-09-05 has landed, and AWS infrastructure is well evidenced up to 2026-09-09. Product-quality items are where most work remains: server-side persistence for Range Days and Training Alerts, behavioral tests, CI gating, and pilot acceptance. Since 2026-09-09 the work has been feature work and staging-lease plumbing, with no further readiness evidence. Some docs are now stale: `aws-provider-conversion-status.md` (says no S3 provider), `infra/README.md` (attachment bucket) and `training-alert-permission-hardening.md`.
