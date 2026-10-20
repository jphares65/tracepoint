# TracePoint: provenance, branch topology and Appendix F re-check

Recon date 2026-10-20. Read-only: no repo file was modified and no AWS or HTTP call was made.
Abbreviations used below:
- **L** = `origin/codex/staging-mobile-api-release-20261007` @ `555f061` (2026-10-09 21:36 -0400). This is the newest code branch, checked out at `.../scratchpad/current`.
- **M** = `origin/main` @ `a3677a6` (2026-10-07). The Oct-20 audit was written against M.
- **TLS** = `origin/codex/production-tls-20260919` @ `54f5862` (2026-09-22).
- **CU** = `origin/codex/production-consolidated-upgrades-20260929` @ `564ff78` (2026-09-29).

All citations are `branch:path` or a commit SHA. "Inferred" marks a conclusion drawn from committed code or scripts rather than from an evidence record.

---

## 0. Bottom line

1. **Production most likely runs AWS-native on ECS, RDS, Cognito, SES and S3 since the night of 2026-09-28/29.** This is a strong inference, not a recorded fact. No committed "cutover complete" or acceptance document exists. The last committed checkpoint (`retry4`, 2026-09-28 ~21:20) still says "Source authority remains Supabase" and is "not acceptance". Every commit after it acts on a live AWS-native production: the final-RDS migration 024 repair, the www→apex ALB redirect, the production Cognito password/invite patch, the production platform-admin probe expecting `tracepoint-production` 1/1, and the production session diagnostics.
2. **Staging is AWS-native:** ECS `tracepoint-staging` in account 559054714699, Cognito with a separate mobile client, staging RDS, SES and S3. The last release-lane work was 2026-10-08. No deployed commit or digest is recorded in the repo after 2026-09-10.
3. **main is badly stale.** M = `6588576` (2026-09-17 feature work) + 7 staging-DB-lease commits. It has none of the AWS-native runtime, cutover tooling, Cognito, RDS ledger 001–037, mobile API, custody or inventory work.
4. **No single branch holds everything.** L holds the runtime and cutover line. M and 5 lease branches hold the SSM DB-lease workflow, which L lacks. TLS and `mobile-v1` hold an earlier AWS line (Sep 8–22) that L partly re-implemented, and some of it was never ported.
5. **No native iOS/Android client code exists in any pushed branch** of `jphares65/tracepoint`, or in `tracepoint-landing`. Only the server mobile API and the Cognito mobile client (staging-only) are present.
6. **"Agency Documents" is absent from every pushed branch.** "Entitlements" (platform feature entitlements) is present: `database/aws/015_platform_entitlements.sql` and the `super-admin` UI.
7. **The deployed state after the last evidence date cannot be verified from the repo.** Last production evidence: 2026-09-29/30. Last staging release-lane commit: 2026-10-08.

---

## 1. Branch topology and the "missing commits" question

### 1.1 Lines of development

| Line | Branches | Base / tip | Content |
|---|---|---|---|
| A. Original main line | `feature/*`, `hotfix/*`, `codex/qol-*`, `codex/aws-staging-readiness-20260902` etc. | up to `4d34a44` (Sep 8) | Supabase/Vercel app, permission hardening, early AWS staging. All fully contained in L (`notInL=0` for feature/hotfix branches). Exceptions: `qol-drill-equipment-types` and `permission-controlled-editing` are rootless (no merge-base, 252/259 unique), meaning old pre-history imports. |
| B. Sep 8–22 AWS line | `aws-s3-*`, `aws-ses-*`, `aws-full-native-*`, `aws-controlled-consolidation`, `aws-main-integration-final`, `aws-staging-cutover-readiness`, `aws-production-cutover-readiness`, `aws-production-ses-authorized`, `aws-route53-dns-preparation`, `aws-precutover-completion`, `mobile-v1-backend-integration`, `aws-staging-full-native-integration-20260917`, **TLS** | fork at `4d34a44` | TLS is the integration tip. `precutover`, `route53`, `ses-authorized`, `consolidation` and `main-integration-final` are all ancestors of TLS (`rev-list TLS..B = 0`). Only `mobile-v1` (12 unique commits, mobile evidence presign flow) and `full-native-20260917` (30 unique, staging mobile Cognito bearer and range autosave) have commits outside TLS. |
| C. Feature line → M | M | `4d34a44`→`6588576` (Sep 16–17 firearms/range UX) → +7 lease commits (Oct 6–7) | 15 commits not in L. Of these, 7 are PR merge commits and 1 (`7610aaf`) is patch-equivalent in L. **6 lease commits are truly unmerged** (`d530642`, `332e157`, `e2591b1`, `8d8562c`, `13e2c2e`, `6ef1f19`), and they add `.github/workflows/aws-staging-database-lease.yml`. `67edc71` is a content-variant of L's `85ad99b`. |
| D. Current runtime line → L | CU (ancestor of L, `notInL=0`), L | `6588576`→`fcabd93` (Sep 22) … `564ff78` (CU, Sep 29) … `555f061` (Oct 9) | 404 commits: shadow/Phase 3B, Phase 3C rehearsal, production cutover tooling and evidence (Sep 24–29), Cognito production, custody Phase A, inventory, vehicle documents, release lanes (Sep 30), native staging release (Oct 7–8), mobile API (Oct 4–9). |
| E. Audit | `claude/tracepoint-operational-audit-w567t8` | M + 16 | Oct-20 audit docs only. |

### 1.2 Are the "missing" commits real unmerged work?

`git cherry L <branch>` matched almost nothing by patch-id: TLS 232/233 unmatched, mobile-v1 177/178, precutover 165/166, cutover-readiness 141/142. The reason is that line B was **not merged** into L. L forked again from `6588576` and re-introduced the AWS work as new, larger commits, e.g. `e7020c4` "integrate isolated AWS-native shadow providers" (115 files, +5,875) and `fcabd93`. I therefore compared content, file by file, for files touched since `4d34a44`:

| Branch | Identical in L | Differs (usually evolved in L) | Absent from L |
|---|---:|---:|---:|
| TLS | 103 | 209 | 161 |
| mobile-v1 | 86 | 209 | 168 |
| full-native-20260917 | 63 | 197 | 62 |
| precutover-completion | 85 | 203 | 158 |

What the "absent from L" files in TLS and mobile-v1 are (excluding docs and scripts):
- **Production infra CDK** (`infra/lib/production-database-stack.ts`, `production-dns-stack.ts`, `full-aws-production-assembly.ts`, `identity-migration-runner-stack.ts`, `database-migration-runner-stack.ts`, `infra/bin/production-ses-foundation.ts`) plus older SCP snapshots. L replaced these with snapshot-restore of the final RDS, CodeBuild/ECS one-off tasks and `infra/changesets/*`. **Likely superseded.**
- `src/app/api/auth/session/refresh/route.ts`, `src/lib/operations/read-repository-postgres.ts`, `src/lib/authentication/cognito-exceptional-identity-migration*.ts`, `src/lib/storage/supabase-object-store.ts` (L imports `./supabase-object-store` dynamically per `scripts/assert-aws-native-provider-reachability.mjs`; verify).
- **Mobile V1 features not ported (mobile-v1 only):**
  - presigned evidence `initiate` / `confirm` / `[evidenceId]` routes, `src/lib/fleet/inspection-evidence.ts` and `src/lib/storage/mobile-upload-intent.ts`
  - `src/lib/range/mobile-range-workspace.ts`, the operationId-idempotent Range Day `POST` mutations
  - `docs/mobile-v1-api-matrix-20260914.md`, the only written mobile API contract

  L instead proxies `/api/mobile/fleet/.../evidence` to the web multipart route and exposes a whole-workspace `PUT /api/mobile/range-workspace`. **This is real divergence:** a mobile client built against the 09-14 contract would not work against L.
- About 39 docs per branch, including AWS readiness JSONs for 09-12/09-13, Route 53 live deployment, the production SES live status and the synthetic auth validation. **This evidence exists only on line B.**

Conclusion: most of line B is **re-implemented, not lost**, but it is not a clean superset. These are genuinely unmerged: (a) the SSM DB-lease workflow (M/lease branches), (b) the mobile-v1 presign and range-mutation contract, (c) line-B-only evidence docs and production CDK stacks. Item (c) is probably superseded, but the code that created live production DNS, SES and RDS in Sep 12–13 lives only on TLS.

---

## 2. Task 1a: Provenance by environment

### 2.1 Production (AWS account 193644343389, us-east-1)

**Timeline from committed evidence:**

| Date (−0400) | Evidence | State |
|---|---|---|
| 2026-09-07/09 | `L:docs/aws-production-live-evidence-20260907.json`; `aws-readiness-20260909.json` | AWS production account, foundation and runtime deployed. App authority on Supabase/Vercel. |
| 2026-09-12/13 | `TLS:docs/aws-route53-live-deployment-20260912.md`, `aws-production-ses-live-deployment-20260912.json`, `aws-precutover-live-execution-20260913.md` | Route 53 zone, SES and pre-cutover executed (line B only). |
| 2026-09-26 | `L:docs/production-public-maintenance-response-20260926.md:3,11` | `www.tracepointhq.com` = Route 53 alias → public ALB → ECS `tracepoint-production` **bridge** (Supabase backend). Apex `tracepointhq.com` = separate Vercel site. Legacy Vercel project `prj_V03LJyQIc231luvZ9u0gcOAt4xK4` still a writer. |
| 2026-09-26 | `L:docs/final-cutover-proof-addendum-20260926.md:7,19` | PITR restore drill on rehearsal RDS (`RESTORE_READ_ONLY_PASS`). Final target `tracepoint-production-final-cutover-20260926` (`db-X4DYNS3TMVSAP7Z3RISDWEYDVE`) restored from snapshot. |
| 2026-09-28 20:16 | `L:docs/production-cutover-abort-20260928-retry3.md` (`967013f`) | Retry 3 **aborted pre-authority**. Full rollback to Supabase + bridge ECS (`tracepoint-production-bridge-rollback-20260926:1`) 1/1, Vercel at 200. |
| 2026-09-28 18:15 | `L:docs/production-rollback-execution-evidence-20260928.md` (`9ecb3bb`) | Rollback controls attested. Vercel Preview pinned at `6588576`. |
| 2026-09-28 ~21:20 | `L:docs/production-cutover-execution-20260928-retry4.md` (`f59de9d`) | **Last committed checkpoint.** ALB 503 maintenance active; Vercel paused (503); bridge ECS 0/0; Supabase SQL fence `frozen=true`; legacy HS256 key revoked; 0 Auth sessions. "No final capture… or AWS application authority switch has occurred." "Do not declare cutover complete from this checkpoint." |
| 2026-09-28 21:56–23:43 | `c84da5b`, `b7115b1`, `fcb7c89`, `044cd3a`, `b630d1d` | Capture secret unwrapped in CodeBuild; final Cognito cohort staged/verified in pool `us-east-1_diFmWDMe9`; SES feedback smoke against **final RDS**; `scripts/register-production-native-public-task.ps1` registers family `tracepoint-production-aws-native-public-20260928` with image `tracepoint-production@sha256:cf19c9887eee2c79eac2abf2e0337f5a2bb95beefc5e20d0f1ffc0453a2f7b46` (built from source `2a92bcc`, 09-26, per `scripts/validate-aws-native-production-review.mjs:6-7`) and port 3000; Cognito transport accepts the exact production ALB origin. |
| 2026-09-29 07:44 | `3fdd215`: `scripts/production-final-notification-queue-schema.mjs`, `infra/changesets/production-www-apex-redirect-20260929/redirect.json` | Migration 024 applied to final RDS. ALB rule redirects www → **apex**. The comment says "The Cognito client and application origin guard use the apex", which implies the apex now resolves to the ALB. |
| 2026-09-29 08:27–11:07 | `51f0893` (`infra/changesets/production-cognito-password-20260929/patch.json`: pool `us-east-1_diFmWDMe9`, min length 14→10, invitation email), `d84d740`, `9338460` (`scripts/probe-production-platform-admin-readonly.ps1` asserts `tracepoint-production` desired/running **1/1** with a pinned image), `cf7d1b3` | Live production Cognito user management and admin probing. |
| 2026-09-29 14:38–22:21 | `96fb939` (custody Phase A, `database/aws/028`), `9520fe5`, `36925e3`/`8c4c032` (production Sentry), CU tip `564ff78` | "Production consolidated upgrades" branch. |
| 2026-09-30 | `d91a1cf` ("Use native production image build project", `scripts/deploy-app.ps1`), `c8005d1` (production session diagnostics), `c0eb1d4` (`L:docs/release-runbook.md`) | Runbook "Live targets" lists Production = ECS `tracepoint-production`, ECR `tracepoint-production`, health `https://tracepointhq.com/api/health`. `deploy-app.ps1 production` builds `<sha>-aws-native-production`. **Production migration apply is "deliberately rejected by the wrapper".** |
| 2026-10-01 → 10-09 | No production-specific commit except `dea702d` (staging bindings) | Nothing after this records production state. |

**Production answers:**

| Item | Finding | Confidence / evidence |
|---|---|---|
| Hosting | **ECS Fargate** service `tracepoint-production` behind public ALB (listener `tracep-Servi-HFH2HwVNXfys`). Vercel project paused at retry4. Landing apex was Vercel until ~09-28. | Inferred-strong: `L:docs/release-runbook.md` (live targets), `L:scripts/deploy-app.ps1:22-28`, `L:infra/changesets/production-www-apex-redirect-20260929/redirect.json`. |
| Last deployed source/image | **Undetermined.** First native public task: digest `sha256:cf19c988…` (source `2a92bcc`, 09-26). Later production builds via `buildspec.aws-native-production.yml` / `buildspec.production-image.yml` (tag `<SOURCE_COMMIT>-aws-native-production`). The likely candidate is CU `564ff78`/Sentry merge `8c4c032` (09-29). No digest or commit is recorded. | `L:scripts/register-production-native-public-task.ps1:6`; `L:buildspec.aws-native-production.yml:16`. |
| Database | **RDS PostgreSQL 17.9** `tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com`, pinned in code (`L:src/lib/database/postgres-pool-core.ts:8,31-38`). Baseline lineage was 99 (97 Supabase + AWS 022/023) plus 024 on 09-29. Whether AWS 025–037 (custody, inventory, vehicle docs) were applied in production is **unknown**: the wrapper rejects production apply (`L:docs/release-runbook.md`, "Database lane"). | Ledger = `public.tracepoint_aws_schema_migrations` over `database/aws/` (`L:scripts/migrate-db.ps1`). **Risk:** if a later image (custody/inventory) is live without 028–037 applied, those routes fail. |
| Auth | **Cognito** pool `us-east-1_diFmWDMe9`, web client `9tfp383dgjuvanhnh94bstafr` (`L:src/lib/authentication/cognito-runtime-configuration-core.ts:91-95`). MFA ON / REQUIRED (`L:infra/lib/cognito-foundation-stack.ts:27`; `L:docs/final-completion-ledger-20260924.md:54`). Web uses an opaque app-session cookie. Mobile bearer is accepted only on `/api/mobile/*` (`L:src/lib/tracepoint/server-access.ts:136-160`). The mobile Cognito client is **staging-only** by CDK (`L:infra/lib/cognito-foundation-stack.ts:48-49`), so production mobile is not provisioned in the repo. | Inferred-strong. |
| Email | **SES** (`ManagedSesProvider`, `L:src/lib/email/provider.ts:24-38`). Brevo only in bridge mode. SES feedback Lambda worker (`L:infra/lib/ses-feedback-worker-stack.ts`); the final-mode worker repoint was packaged (`infra/changesets/production-ses-worker-20260926`). **No scheduler** for `/api/notifications/email-dispatch` on AWS. The Supabase pg_cron job `tracepoint-notification-email-dispatch` was paused at the fence (`L:docs/production-authoritative-writer-inventory-20260927.md:29`). | Code; runtime unverified. |
| Storage | **S3** private bucket (KMS, versioned). `object-store.ts:10` forces S3 in aws-native mode. 2 agency patch images deliberately omitted, needing manual re-upload (`L:docs/production-final-import-acceptance-classification-20260928.md`). | Code + evidence. |
| Cutover outcome | **Most likely completed to AWS-native on 09-28/29** (no maintenance, no bridge). It is *not* recorded. The last recorded state is "maintenance 503 + Supabase frozen, pre-authority". Possible states, by evidence weight: (1) AWS-native live, strongly supported by 09-29/30 commits; (2) still in maintenance, contradicted by the 09-29 probe expecting 1/1 and the Cognito user ops; (3) rolled back to bridge, no evidence. | Last evidence date: **2026-09-29** (changesets/probes), **2026-09-30** (production code paths). |

### 2.2 Staging (AWS account 559054714699)

| Item | Finding | Evidence |
|---|---|---|
| Hosting | ECS `tracepoint-staging` / `staging.tracepointhq.com`. A Supabase staging project `wztqqqashilusoppddxi` still backs Vercel Preview. | `L:docs/release-runbook.md`; `L:docs/production-rollback-execution-evidence-20260928.md`. |
| Runtime mode | **AWS-native**. The release step runs `release-tracepoint-staging.ps1 -ImageTag "$RELEASE_COMMIT-aws-native-staging" -StorageProvider s3 -AuthenticationProvider cognito -IncludeReviewedNativeNotificationMode`. Oct 8: "use native Cognito release acceptance" (`71b7bf2`), "scope Brevo gate to bridge releases" (`d20a608`), "prove mobile routes in immutable image" (`2ef02cf`), "verify ECS image provenance by digest" (`0c02894`). | `L:.github/workflows/aws-staging-runtime.yml:2-6,92`. |
| DB | Staging RDS (`L:infra/lib/staging-database-stack.ts`, 1-day backup retention) with the `database/aws` ledger 001–037. The DB **lease** (cost/time-boxed availability) renewal workflow lives only on M/lease branches. | `M:.github/workflows/aws-staging-database-lease.yml`. |
| Auth / mobile | Cognito web client plus **mobile public client** (`tracepoint://auth`, `tracepoint://logout`), `TRACEPOINT_COGNITO_MOBILE_CLIENT_ID`. | `L:infra/lib/cognito-foundation-stack.ts:48-66`; `L:infra/lib/runtime-stack.ts:62,108`. |
| Email / storage | SES (staging SES worker; alarm patch `f5baf20` 10-08), S3. | |
| Last deployed commit/digest | **Not recorded.** `L:.github/staging-release.json` is stale (`reviewedCommit 5930b53`, last changed `e5efa02` 2026-09-07). Release evidence is collected at runtime (`scripts/collect-staging-release-evidence.mjs`) and not committed. The last committed staging release record is `origin/release-evidence/tracepoint-staging-43cc2be7-20260910:docs/aws-staging-release-43cc2be7-20260910.md` (09-10). The Oct 8 commit burst (`c56a765`…`fc89e38`) suggests repeated native release attempts. Whether one succeeded, and whether `5244bc5`/`555f061` (Oct 9) were deployed, cannot be determined. | |

---

## 3. Task 1b: Native mobile app, Agency Documents, entitlements

### 3.1 Client codebase

Searches covered all 41 remote refs: `git log --all` path filters for `*.swift`, `*.kt(s)`, `*.dart`, `Podfile`, `build.gradle`, `AndroidManifest.xml`, `Info.plist`, `*.xcodeproj`, `capacitor.config*`, `pubspec.yaml`, `app.json`, `eas.json`, `ios/`, `android/`, `mobile/`, `apps/`. `git grep` across every ref looked for TestFlight, App Store Connect, bundle identifier, `com.tracepoint`, expo, react-native, capacitor, SwiftUI, Jetpack, Xcode, Play Store and "iOS app".

Result: **zero hits.** `/home/user/tracepoint-landing` (last commit 2026-09-02) has no mobile code either, and it still links "Sign in" to `https://tracepoint-amber.vercel.app/login`, a Vercel URL that is probably stale. **The native client lives in a repository not attached to this session.** Its name is not referenced anywhere in the repo. The only client hints are the custom scheme `tracepoint://auth` (`L:infra/lib/cognito-foundation-stack.ts:49`) and the comment "The native app is a separate Cognito public client" (`L:src/lib/authentication/cognito-runtime-configuration-core.ts:20`).

### 3.2 Server mobile contract on L (what the server supports)

| Capability | Endpoint(s) on L | Notes |
|---|---|---|
| Bearer session / department / support mode | `POST /api/mobile/session`, `POST /api/auth/mobile/logout` | Cognito access token as bearer, plus `X-TracePoint-Department-Id` and `X-TracePoint-Support-Mode`. Support entry is audited (`server-access.ts:144-160`). Behavioral test: `src/lib/tracepoint/mobile-session-route.test.mjs`. |
| QR resolve | `POST /api/mobile/qr/resolve` `{identifier}` | Opaque handle `^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`. Matched within tenant against **vehicle** id/unit_number/VIN, **equipment** id/asset_number/serial (not removed), and **firearm** id/asset_number/serial (active). Returns `entityType` + `workflow`: `vehicle_inspection`, `equipment_custody` or `firearm_custody` (`src/lib/tracepoint/mobile-workflows.ts:46-58`). No signed or URL QR format. |
| Fleet | `GET /api/mobile/fleet/vehicles`, `GET …/{vehicleId}`, `POST …/inspections`, `POST …/inspections/{id}/evidence` | These re-export the web routes. Evidence is **server-proxied multipart**: JPEG/PNG/WebP, ≤25 MB, S3 via `createObjectStore` (`src/app/api/fleet/…/evidence/route.ts:14-18,76-107`). The mobile-v1 presign initiate/confirm flow is **not** on L. |
| Equipment custody | `GET /api/mobile/equipment/assets`, `GET/POST /api/mobile/equipment/custody` | Re-exports. Atomic checkout/return; structural test `src/lib/equipment/mobile-custody-route.test.ts`. |
| Equipment readiness | `GET /api/mobile/readiness/equipment` | Re-export. |
| Range | `GET /api/mobile/range-days`, `GET …/{rangeDayId}`, `GET/PUT /api/mobile/range-workspace` | **Whole-workspace PUT** on `pilot_range_workspaces` with `updated_at` CAS. The same ARC-K1 lost-update risk now applies to mobile. |
| Drill docs / attachments | `GET /api/mobile/drill-documents/{id}/view`, `GET /api/mobile/attachments/{id}/download` | |
| Inbox | `GET /api/mobile/inbox` | Server `notification_events` (`555f061`, 10-09, latest commit). |
| Firearm custody (web) | `POST /api/armory/firearms/{id}/custody`, storage locations | Native migrations 028–031, 034. There is no dedicated mobile firearm-custody endpoint; QR returns `firearm_custody` as the workflow. |

### 3.3 Agency Documents / entitlements

- **Agency Documents:** absent from all refs. `git grep` for `agency[ _-]?documents?`, `department_documents`, `agency_documents`, `policy_documents` and `AgencyDocument` across 41 refs found nothing, and no commit message matches. What exists instead: fleet **vehicle documents** (`database/aws/033_fleet_vehicle_document_metadata.sql`, `supabase/migrations/202610020001_vehicle_document_metadata.sql`, `de3437b`), **drill documents**, and policy metadata. If the owner says Agency Documents shipped, that code was never pushed to this repo.
- **Entitlements:** present on L. `database/aws/015_platform_entitlements.sql` (from `c58ee06` 09-10 on line B; ported in `e7020c4` 09-22) defines `get_platform_entitlements()` / `set_platform_entitlement()` over `feature_catalog` and `department_features`. They are restricted to the `tracepoint_runtime` session user and platform admins. UI: `src/app/super-admin/page.tsx`, `src/app/api/super-admin/route.ts`, `src/lib/platform/*`. `5d5b3ac` "Fix super admin feature entitlement display". This is feature toggling per agency, not billing/licensing.

---

## 4. Task 1c: Source-of-truth risk

- **No branch equals production.** The best candidate for production source is CU `564ff78`, or an L commit from 09-29/30, built with `buildspec.aws-native-production.yml`. The best candidate for staging is L at or near `fc89e38`/`555f061`. Neither is tagged, and no deployed digest is committed after 09-28.
- **main is stale by about 404 commits and 3 weeks.** It is the base for the Oct-20 audit, so every audit finding about "Supabase-only runtime", "Cognito dormant", "Brevo only" or "SES not selectable" describes the **bridge** code path, not what production probably runs.
- **Divergence hazards:**
  - (1) L lacks the DB-lease workflow from M, so merging L→M must keep `aws-staging-database-lease.yml`.
  - (2) The mobile-v1 presign/range-mutation contract diverges from L.
  - (3) Two migration ledgers are maintained in parallel: `supabase/migrations/*` (still receiving 2026-10-02 files) and `database/aws/001–037`. Drift between them is a real risk while bridge mode is kept as a rollback.
  - (4) Line-B-only evidence and CDK (Route 53, production SES, production DB stacks) is not on L. If live resources were created from TLS code, L cannot reproduce or diff them.
  - (5) L carries 11 stray root `.txt` snapshots (`range-days-page.txt` etc., from 09-07) and 36 `.bak`/`.backup-*` files.
  - (6) Production migration application is blocked by the wrapper, so production schema may lag production image features.
- **Recommendation:** tag the commit and digest actually running in each environment (from ECS describe-services), merge L plus the lease commits into main, and commit an explicit cutover-completion or acceptance record.

---

## 5. Task 2: Appendix F re-classification against current state

Prior status = Appendix F status (IV/INV/P/NI/S/CD). Current status uses the requested vocabulary. Evidence is on L unless noted.

| ID | Recommendation (short) | Prior | Current status | Evidence | Still relevant? | Remaining action |
|---|---|---|---|---|---|---|
| ARC-01 | Replace browser-local workspaces | P | Partially resolved | Off-duty/inbox server-side; mobile inbox `api/mobile/inbox/route.ts`. Range still localStorage `range-days/page.tsx:424,441` | Yes | Server-only Range Days; drop localStorage fallback |
| ARC-02 | Single RangeDay type | P | Still open | `src/app/lib/tracepoint/types.ts:109`, `range-day-types.ts:88` | Yes (low) | Collapse types |
| ARC-03 | Stable role codes | IV | Resolved | Unchanged; legacy `UserRole` still `types.ts:1-7` | Cleanup only | Delete `UserRole` |
| ARC-04 | One scoring_format enum | P | Still open | `types.ts:96-100` (4 values) | Yes | Align UI enum |
| ARC-05 | Normalize array fields | P | Still open | `api/mobile/range-workspace/route.ts` PUT writes JSON blob to `pilot_range_workspaces` | Yes (mobile widens it) | Normalized writes |
| ARC-06 | Remove hard-coded current-user | IV | Resolved | No import; stray `current-user.txt` at repo root | No | Delete root `.txt` snapshots |
| ARC-07 | Analytics from normalized source | P | Still open | Depends on ARC-05; training alerts localStorage | Yes | After ARC-05 |
| ARC-08 | Pilot data import + acceptance | P | Partially resolved | Importer rehearsals/classification `docs/production-final-import-acceptance-classification-20260928.md`; 96 Cognito identities linked `final-completion-ledger-20260924.md:14`; final import inferred 09-28/29 | Yes | Record post-import acceptance |
| ARC-09 | Register missing permissions | IV | Resolved | Unchanged | No | — |
| ARC-10 | Remove role-name shortcuts | IV | Resolved | Unchanged | No | — |
| ARC-11 | Only `administrator` inherits | IV | Resolved | Unchanged | No | — |
| ARC-12 | Restore member-role validation triggers | IV | Resolved | Bootstrap + `scripts/validate-lineage-upgrades.mjs`; still not in CI | CI part only | Add db validators to PR gate |
| ARC-13 | Certification false denial (service role) | INV | Superseded by AWS-native architecture | Native path: `set local role authenticated` + `tracepoint_auth.subject_id()` (`src/lib/database/postgres-authorization-core.ts`; `database/aws/004_remove_supabase_authorization_runtime.sql`) | Bridge only | Behavioral test on native path |
| ARC-14 | Agency-training writes need manage_training | IV | Resolved | `database/aws/008_training_closeout_authorization.sql` | No | — |
| ARC-15 | Remove dead permission codes | IV | Resolved | Unchanged | No | — |
| ARC-16 | Settings via tenant-bound API | INV | Partially resolved | `src/lib/settings/browser-data-client.ts` → `api/settings/data/route.ts` table/RPC allowlist | Yes | UI/E2E test; review generic proxy |
| ARC-17 | Gate ungated endpoints | INV | Still open | Still mostly structural; 130 `route.ts` handlers | Yes | Behavioral 401/403/cross-tenant tests |
| ARC-18 | Controlled 401/403 | IV | Resolved | Plus native 503 fail-closed `server-access.ts:196` | No | — |
| ARC-19 | Remove client authority module | IV | Resolved | — | No | — |
| ARC-20 | Lint debt | NI | Still open | No lint step in any `.github/workflows/*.yml` | Yes | Burn down + gate |
| ARC-21 | Legacy test parsing | S | Not applicable | `run-application-tests.mjs` | No | — |
| ARC-22 | Migrations before app | CD | Partially resolved | Lane B `scripts/migrate-db.ps1`, same-SHA migration image (`757551a`, `88f3104`); `docs/release-runbook.md`. Production apply rejected | Yes | Authorized production migration path; record ledger state |
| ARC-23 | G1 separate accounts/SCPs | IV | Resolved | Unchanged | No | — |
| ARC-24 | G2 threat model sign-off | P | Still open | No owner sign-off committed | Yes | Dated sign-off |
| ARC-25 | G3 break-glass, drop AdministratorAccess | NI | Requires runtime verification | No evidence on L | Yes | Rehearse + record |
| ARC-26 | G4 signed image, SBOM, dep scan | P | Partially resolved | ECR scan zero findings in cutover docs; digest provenance check `0c02894`; no SBOM/signing/Dependabot | Yes | SBOM, signing, dependency scan |
| ARC-27 | G5 TLS + security headers | P | Partially resolved | TLS/ALB live; **still no HSTS/CSP/XFO** in `next.config.ts` or `infra/lib` (grep empty) | Yes (High) | Add headers; external test |
| ARC-28 | G6 tenant-negative suite | P | Partially resolved | `src/app/api/internal/rehearsal-tenant-negative/route.ts`, `scripts/phase3c-fixed-tenant-negative.cjs`, `rehearsal-tenant-negative-contract.test.mjs`; ledger: 1 UI negative PASS, API/bidirectional **pending** (`final-completion-ledger-20260924.md:19`); not in CI | Yes (Critical) | Per-route behavioral suite in CI |
| ARC-29 | G7 secret rotation/revocation | NI | Partially resolved | Real credential-epoch retirement/revocation executed (`docs/production-credential-epoch-preflight-20260928.md`, retry3/retry4); AWS-native keyring rotation not rehearsed (`compute-foundation-stack.ts:136`) | Yes | Rehearse native keyring rotation |
| ARC-30 | G8 migration rehearsals, PITR, remove browser queries | P | Partially resolved | RDS PITR restore drill (`final-cutover-proof-addendum-20260926.md:7`); final RDS 35-day retention + PITR (`retry4`); settings browser queries proxied; remaining browser Supabase client only `login/LoginForm.tsx` (bridge) + `.bak` files | Partly | Restore drill on **final** production RDS; RTO record |
| ARC-31 | G9 checksums, malware, retention | P | Partially resolved | Checksum/hash reconciliation in import; no malware scanning in `infra/lib` | Yes | Malware scan + retention |
| ARC-32 | G10 auth cutover, MFA, recovery | P | Partially resolved | Cognito wired (`request-session-core.ts:32-37`); production pool MFA ON (`final-completion-ledger-20260924.md:54`); admin reset guard `d84d740`; identity recovery "PENDING" (`ledger:15`) | Yes | Production recovery/disablement tests |
| ARC-33 | G11 Security Hub etc. routing | P | Requires runtime verification | No new evidence | Yes | Re-inventory |
| ARC-34 | G12 alarms + on-call | P | Still open | Staging SES worker alarms `f5baf20`; human escalation untested | Yes | Human delivery test |
| ARC-35 | G13 load/capacity | IV | Requires runtime verification | New runtime (RDS pool max 20, `postgres-pool-core.ts`) not load-tested | Yes | Retest on native stack |
| ARC-36 | G14 cost/budget | INV | Partially resolved | Cost models; owner approval not committed | Low | Record approval |
| ARC-37 | G15 change set + rollback | P | Partially resolved | **Real pre-authority production rollback executed** (`docs/production-cutover-abort-20260928-retry3.md`); post-authority (AWS→Supabase after writes) not evidenced; `deploy-app.ps1 -RollbackTaskDefinitionArn` | Yes | Prove native→native ECS rollback in production |
| ARC-38 | G16 data owner/agency approval | NI | Still open | Owner "explicit cutover approval" in retry3/4; no agency approval record | Yes | Record agency approval |
| ARC-39 | Create production account/foundation | IV | Resolved | — | No | — |
| ARC-40 | Production runtime/control stacks | IV | Resolved | — | No | — |
| ARC-41 | ACM ISSUED | IV | Resolved | — | No | — |
| ARC-42 | PITR/backup restore | NI | Partially resolved | Supabase PITR superseded; RDS PITR drill on rehearsal (`final-cutover-proof-addendum-20260926.md:7`); AWS Backup plan `infra/lib/backup-recovery-stack.ts` ("vault lock deferred until production restore evidence exists", line 29) | Yes (Critical) | Restore drill of final production RDS + S3 |
| ARC-43 | On-call SNS human test | P | Still open | No evidence | Yes | Run test |
| ARC-44 | 8 Security Hub gaps | CD | Requires runtime verification | — | Yes | Re-inventory |
| ARC-45 | Production DNS cutover/rollback | NI | Requires runtime verification | www alias → ALB (`production-public-maintenance-response-20260926.md:11`); www→apex redirect implies apex on ALB (`infra/changesets/production-www-apex-redirect-20260929/redirect.json`); DNS change record only on TLS (`TLS:docs/aws-route53-live-deployment-20260912.md`) | Yes | Commit DNS state + rollback |
| ARC-46 | Merge integration branch to main | IV | Still open (inverted) | main lacks 404 L commits; L lacks 6 lease commits | **Yes (High)** | Reconcile L + lease → main |
| ARC-47 | pg_dump rehearsal | NI | Superseded by AWS-native architecture | Replaced by snapshot/PITR restore + atomic importer | No | — |
| ARC-48 | Classify 2 log events / WAF logs | NI | Still open | No evidence | Low | — |
| ARC-49 | Remove generic service-role exposure | P | Superseded by AWS-native architecture | Native `context.admin` = `PostgresDataClient` under `set local role authenticated` (`postgres-authorization-core.ts`); service role only in bridge | Bridge only | Retire bridge after rollback window |
| ARC-50 | Session theft / cookie tests | P | Partially resolved | Cognito opaque-session cookie code live; tests `request-session-core.test.ts`, `cognito-transport.test.ts`, `src/app/components/idle-session-core.test.ts` | Yes | Live cookie-flag test |
| ARC-51 | Role-change race tests | P | Still open | — | Yes | Concurrency test |
| ARC-52 | Upload size/type/MIME | P | Partially resolved | Evidence route allowlist + 25 MB (`api/fleet/…/evidence/route.ts:14-18,99`); no content sniffing | Yes | Magic-byte check, malware |
| ARC-53 | Audit retention/restore | P | Still open | — | Yes | Review |
| ARC-54 | Webhook replay | NI | Not applicable | No partner webhooks | No | — |
| ARC-55 | Independent tenant review | NI | Still open | — | Yes | Commission |
| ARC-56 | Abuse-case tests | P | Partially resolved | Support-mode audit failure test (`mobile-session-route.test.mjs`); others missing | Yes | One test per case |
| ARC-57 | Wave 1 contracts | IV | Resolved | — | No | — |
| ARC-58 | Wave 2 email adapter | IV | Superseded by AWS-native architecture | SES selected in aws-native (`src/lib/email/provider.ts:24-38`; `notification-mode.ts:20-27`) | No | Retire Brevo after bridge |
| ARC-59 | Wave 3 S3 storage | IV | Resolved | `object-store.ts:10` forces S3 in native | No | — |
| ARC-60 | Wave 4 read repositories | P | Superseded by AWS-native architecture | `src/lib/database/postgres-data-client.ts` executes the `.from()` API on RDS under RLS | Partly | Parity tests for shim |
| ARC-61 | Wave 5 transactional writes | NI | Partially resolved | Writes via shim in RLS transaction; DB triggers for audit; no domain write repositories | Yes | Transactional domain writes for multi-table ops |
| ARC-62 | Wave 6 remove browser queries | NI | Resolved | Only `login/LoginForm.tsx` (bridge) + `.bak` files import `@/lib/supabase/client` in client components; settings via `/api/settings/data` | Cleanup | Delete `.bak`; bridge login retire |
| ARC-63 | Wave 7 auth coexistence/cutover | P | Resolved (code); Requires runtime verification (production) | `request-session-core.ts:32-37`; `api/auth/cognito/*`; production pool pinned `cognito-runtime-configuration-core.ts:91-95` | Verify | Confirm production running cognito tuple |
| ARC-64 | Route-level tests | NI | Partially resolved | 2 test files under `src/app`; 16 `src/lib` tests reference routes, mostly regex; 1–2 behavioral (`mobile-session-route.test.mjs`); 130 handlers | Yes (Critical) | Route harness |
| ARC-65 | Storage deferrals | P | Still open | — | Yes | Policy |
| ARC-66 | Define attachments bucket | IV | Superseded by AWS-native architecture | `infra/lib/private-storage-stack.ts` | No | — |
| ARC-67 | Keep Supabase UUIDs as subject | IV | Resolved | 96/96 subject links (`final-completion-ledger-20260924.md:14`); `0ac7235`/`4817ca0` accept Cognito UUIDs | No | — |
| ARC-68 | Email-dispatch caller/schedule | CD | Still open; Requires runtime verification | Route supports Postgres (`email-dispatch/route.ts:233-237`) but no EventBridge/ECS schedule in `infra/lib` or changesets; Supabase cron paused at fence (`production-authoritative-writer-inventory-20260927.md:29`) | **Yes (High→Critical)** | Confirm live caller; codify scheduler |
| ARC-69 | Export Supabase metadata | P | Superseded by AWS-native architecture | Source catalog capture `scripts/inspect-production-source-catalog.mjs`, capture artifacts | Archive only | Archive final capture |
| ARC-70 | Partner /api/v1 | NI | Not applicable | Deferred | No | — |
| ARC-71 | No internal routes via v1 | IV | Resolved | — | No | — |
| ARC-72 | Defer attachment bucket | S | Superseded by AWS-native architecture | — | No | Update README |
| ARC-73 | Staging security services | P | Still open | — | Low | Decide |
| ARC-74 | Review cdk diff | IV | Resolved | Reviewed change sets `infra/changesets/*`; Lane C (`AGENTS.md`) | No | — |
| ARC-75 | Run pilot checklist | CD | Still open | `docs/readington-pilot-checklist.md`: 0 `[x]`, 156 `[ ]` (unchanged since 09-07) | Yes (Critical) | Execute + record |
| ARC-76 | Freeze new modules | NI | Still open | More modules added: inventory (`7ed929d`), custody (`96fb939`), mobile API, vehicle docs | Yes | Reaffirm or retire |
| ARC-77 | Server persistence of alert state | P | Still open | `TrainingAlertsClient.tsx:177,253,262` | Yes | Server alert state |
| ARC-78 | Role persona tests | P | Partially resolved | `scripts/smoke-staging.ps1` Golden Path (generated identities); no per-role E2E | Yes | Persona E2E |
| ARC-79 | Builds pass | INV | Partially resolved | `next build` in CodeBuild/release only; Vercel paused at cutover (retry4) | Yes | PR build |
| ARC-80 | Clean demo/test data | CD | Requires runtime verification | Synthetic acceptance tenants remain (`final-completion-ledger-20260924.md:42`) | Yes | Cleanup |
| ARC-81 | Server-protected /training-alerts | INV | Partially resolved | Unchanged; no route test | Low | Test |
| ARC-82 | Six training-alert permissions | S | Superseded by AWS-native architecture | Retired, mapped (n/a) | No | — |
| ARC-83 | Server alert workflow | NI | Still open | localStorage | Yes | Implement |
| ARC-K1 | Range JSON blob lost update | new | Still open (widened) | Web + `api/mobile/range-workspace/route.ts` PUT whole blob; client sends no loaded version | Yes (High) | Versioned or per-operation writes (port mobile-v1 operationId design) |
| ARC-K2 | No PR/main quality gate | new | Still open | `aws-staging-foundation.yml` PR runs **infra** tests/build/synth only (`infra/**`); app tests/tsc only in release workflows; no lint | Yes (Critical) | App PR workflow: test, tsc, lint, build, db validators |
| ARC-K3 | MFA setting not enforced | new | Superseded by AWS-native architecture (partial) | Cognito pool MFA REQUIRED for everyone (`cognito-foundation-stack.ts:27`); department `require_mfa_policy` toggle still cosmetic (`settings/page.tsx:4356`) | UI misleading | Remove or relabel the toggle |
| ARC-K4 | No email-dispatch scheduler | new | Still open; Requires runtime verification | As ARC-68 | **Yes (Critical if native live)** | Scheduled ECS task/EventBridge |
| ARC-K5 | `.bak` files / giant pages | new | Still open | 36 backup files; pages 7,698 / 7,399 / 5,077 lines; plus 11 root `.txt` snapshots | Yes | Delete; split |

### Counts

ARC-01..83, primary status (83 items):

| Current status | Count | IDs |
|---|---:|---|
| Resolved | 21 | 03, 06, 09, 10, 11, 12, 14, 15, 18, 19, 23, 39, 40, 41, 57, 59, 62, 63, 67, 71, 74 |
| Partially resolved | 22 | 01, 08, 16, 22, 26, 27, 28, 29, 30, 31, 32, 36, 37, 42, 50, 52, 56, 61, 64, 78, 79, 81 |
| Still open | 22 | 02, 04, 05, 07, 17, 20, 24, 34, 38, 43, 46, 48, 51, 53, 55, 65, 68, 73, 75, 76, 77, 83 |
| Superseded by AWS-native architecture | 9 | 13, 47, 49, 58, 60, 66, 69, 72, 82 |
| Not applicable | 3 | 21, 54, 70 |
| Requires runtime verification | 6 | 25, 33, 35, 44, 45, 80 |
| **Total** | **83** | |

Two items also carry a secondary "requires runtime verification" flag: ARC-63 (is production really running the Cognito/Postgres tuple?) and ARC-68 (is there a live email-dispatch caller?).

K-items: 4 still open (K1, which has widened to mobile; K2; K4; K5). K3 is partly superseded by Cognito MFA REQUIRED.

Net change versus the Oct-20 audit: about 13 items move because the audit read main. These are 13, 30, 32, 42, 49, 58, 60, 62, 63, 66, 69, 72, K3. Three items got **worse or wider**: ARC-46 (main stale), ARC-68/K4 (dispatcher with Supabase cron paused), K1 (mobile PUT). The critical product-quality items are unchanged: 28, 64, 75, K2.

---

## 6. Short summary

1. L = `codex/staging-mobile-api-release-20261007@555f061` (10-09) is the newest code. It forked from main's `6588576` and re-implemented the Sep 8–22 AWS line (TLS/mobile-v1) instead of merging it, so patch-id comparison shows hundreds of "missing" commits.
2. Content comparison: about 22–34% of TLS/mobile-v1 files are absent from L. Mostly superseded production CDK and docs, but the mobile-v1 presign evidence and operationId range-mutation contract were never ported.
3. Truly unmerged into L: 6 staging DB-lease commits on main and the lease branches (`aws-staging-database-lease.yml`).
4. main lacks about 404 commits: all AWS-native runtime, cutover, Cognito, `database/aws` 001–037, mobile, custody and inventory. The Oct-20 audit therefore assessed the bridge code path.
5. Production: last committed checkpoint retry4 (09-28 ~21:20) = maintenance 503, Supabase frozen, pre-authority. Retry3 was a real, successful rollback.
6. Post-retry4 commits (09-28 23:00 → 09-30) strongly imply an AWS-native cutover: final RDS, Cognito pool `us-east-1_diFmWDMe9`, ECS public task, SES, S3, www→apex ALB. No completion or acceptance record exists.
7. Production deployed commit/digest after the first native task (`cf19c988…`, source `2a92bcc`) is unrecorded. Production migrations beyond 024 are unverified because the wrapper blocks production apply.
8. Staging is AWS-native (ECS, Cognito with mobile client, RDS, SES, S3). The last committed staging release record is 09-10, and the release-lane fixes run through 10-08. The deployed commit is unknown.
9. Native mobile client: no iOS/Android/Expo/Capacitor/Flutter code or bundle IDs in any of the 41 refs or the landing repo. It lives elsewhere; only the `tracepoint://` scheme hints at it.
10. Server mobile API on L covers session/support mode, QR resolve (vehicle/equipment/firearm by id/asset/serial/unit/VIN), fleet inspection plus multipart evidence (≤25 MB images), equipment custody, range read plus whole-workspace PUT, drill docs, attachments and inbox.
11. Entitlements exist (`database/aws/015`, super-admin UI). Agency Documents does not exist in any pushed branch.
12. Appendix F re-check: Resolved 21, Partially 22, Still open 22, Superseded 9, N/A 3, Runtime-verify 6. Among the K-items, 4 are still open and K3 is partly superseded by Cognito MFA.
13. Worsened: there is no AWS email-dispatch scheduler while the Supabase cron was paused at cutover (ARC-68/K4), and the range lost-update risk now also applies to mobile (K1).
14. Still critical: no app PR quality gate (K2), route-level and tenant-negative behavioral tests (64/28), pilot checklist 0/156 (75), production final-RDS restore drill (42), and no security headers (27).
15. The deployed state of either environment after 2026-09-30 (production) or 2026-10-08 (staging) cannot be verified from the repo. Tag the running digests and merge L plus the lease work into main.
