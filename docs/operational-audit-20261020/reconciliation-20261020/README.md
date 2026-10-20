# TracePoint current-state reconciliation and defect-remediation plan

**Date:** 2026-10-20 (follow-up to the operational audit in [`../README.md`](../README.md))
**Purpose:**
- Establish what TracePoint actually is today.
- Classify every audit finding against it.
- Lay out the shortest defensible, **defect-only** path to a stable, commercially viable product.

Sequence: **verify what exists → fix what is broken → prove it works → improve it.**

| Document | Contents |
|---|---|
| **This file** | Bottom line, deployed state, verification method, results, priority-area evidence, remediation plan, owner decisions, staging runbook, effort |
| [finding-status.md](finding-status.md) | All 200 findings (186 audit + 14 new) with status and disposition |
| [R1 – Provenance & architecture](R1-provenance-and-architecture.md) | Branch topology, environment provenance, mobile/Agency Documents/entitlements search, Appendix F re-classification (83 items) |
| [R2 Armory](R2-armory.md) · [R3 Range](R3-range.md) · [R4 Training & notifications](R4-training-notifications.md) · [R5 Fleet & equipment](R5-fleet-equipment.md) · [R6 Admin & onboarding](R6-admin-onboarding.md) | Per-finding reconciliation with current evidence (path:line) |
| [R7 – Database verification](R7-database-verification.md) | Real SQL against the actual AWS-native policies on a disposable local PostgreSQL 16 |
| [evidence/](evidence/) | Test scripts and raw output for every executed reproduction |

---

## 1. Bottom line

1. **The October 7 `main` baseline did not represent the product.**
   - The current code line is `origin/codex/staging-mobile-api-release-20261007` @ `555f061` (2026-10-09). It is 404 commits ahead of `main` and includes:
     - the AWS-native runtime (Cognito, RDS with the `database/aws` ledger 001–037, SES, S3);
     - the server-side mobile API, custody, inventory and entitlements.
   - **`main` is stale and should not be used as a base for any work.**
2. **Production most likely runs AWS-native since 2026-09-28/29, but that is inferred, not recorded.**
   - The stack is ECS, RDS, Cognito (MFA required), SES and S3.
   - The last committed checkpoint is "pre-authority, maintenance 503". Subsequent commits act on a live AWS-native production.
   - No deployed commit or image digest is recorded for either environment.
3. **The native iOS/Android app and Agency Documents are not in any pushed branch.**
   - The owner confirmed they are local or unpushed.
   - The server-side mobile API was reviewed. Everything client-side is classified *Unverified – requires testing*.
4. **Very little of the audit has been corrected.** Of 200 findings:

   | Status | Count |
   |---|---|
   | Verified defect | 131 |
   | Verified defect, partly corrected | 24 |
   | Enhancement (defer) | 38 |
   | Unverified (requires testing) | 6 |
   | Outdated / not applicable | 1 |

   - **The AWS migration fixed one serious item:** ARM-04, the unprotected firearm-edit function. It is fixed only on AWS-native.
   - **It introduced new defects that block field use under AWS:**
     - Inspectors and officers cannot complete fleet inspections or equipment custody (NEW-01, EQP-06).
     - **Newly invited users cannot complete first sign-in** (NEW-ADM-A).
     - Ammunition pages crash (NEW-ARM-A).
     - Module entitlements cannot be changed from the UI (NEW-ADM-C).
     - **No queued email is sent at all** (TRN-08).
5. **Not every reviewer-confirmed defect is in scope.** 47 of them are really missing capabilities and are deferred under the no-new-features rule. That leaves **93 defects to fix**, plus 15 where the owner must first state the intended behaviour.
   - **11 are Critical, all verified by execution or by direct code reading.**
   - The fixes are organised into **12 small batches**. The defect-only effort is **≈ 50–73 engineer-days**.
   - The **commercial-readiness critical path** (batches B0–B6 and B9) is **≈ 30–43 engineer-days**.

---

## 2. What is actually deployed (evidence, not live observation)

This session had **no live access**: the AWS credentials were invalid, and the network policy blocks `*.tracepointhq.com`. Everything below comes from committed evidence; R1 cites each item.

| | Production (acct 193644343389) | Staging (acct 559054714699) |
|---|---|---|
| Hosting | ECS `tracepoint-production` behind ALB; the Vercel project was paused during cutover | ECS `tracepoint-staging` (`staging.tracepointhq.com`) |
| Runtime mode | AWS-native (inferred, strong) | AWS-native (release lane forces `-aws-native-staging` image, Cognito, S3) |
| Deployed source / image | **Not recorded.** The first native task was image `sha256:cf19c988…` built from `2a92bcc`; the likely later candidate is `564ff78`/`8c4c032` (09-29) | **Not recorded.** `.github/staging-release.json` is stale (09-07); the last committed release record is 09-10 |
| Database | RDS PostgreSQL 17.9 `tracepoint-production-final-cutover-20260926`. Migrations through AWS 024 are evidenced; **025–037 (custody, inventory, vehicle documents) are unknown** | Staging RDS with the `database/aws` 001–037 ledger |
| Authentication | Cognito pool `us-east-1_diFmWDMe9`, MFA required, web app-session cookie; mobile bearer only on `/api/mobile/*` | Cognito with a separate mobile client (`tracepoint://auth`) |
| Email | SES; **no scheduler for `email-dispatch`** (the Supabase pg_cron invoker was paused at cutover) | SES |
| Storage | S3 (KMS, versioned) | S3 |
| Supabase | Project `izlkwggluhlhzlumtzes` was frozen at cutover; **retirement not recorded** | Project `wztqqqashilusoppddxi` still backs Vercel Preview |
| Native client | Not in any accessible repository | Mobile Cognito client exists in staging infrastructure only |

**The owner must confirm these facts** (each takes minutes in the AWS console):

1. The running task-definition image digest and source commit for both ECS services. Tag those commits in git.
2. Whether production RDS has AWS migrations 025–037 applied: `select * from public.tracepoint_aws_schema_migrations order by 1`.
3. Whether either Supabase project still serves any request. If so, ARM-04 is an open Critical there: anonymous callers can rewrite firearm records and forge audit authors (reproduced, R2).
4. Whether any EventBridge schedule or other job calls `/api/notifications/email-dispatch` in either account.
5. Where the native client lives, so its scan, offline and payload behaviour can be verified.

---

## 3. How findings were verified

| Evidence level | Meaning | Used for |
|---|---|---|
| **E1: code read** | The current code at `555f061` shows the failure path (path:line in R2–R6) | Most findings |
| **E2: isolated execution** | The real TypeScript module or route handler was executed under `tsx`, with dependencies stubbed, against synthetic input | Range save authorizer (25 scenarios), fleet and equipment handlers (10), training time/alert logic (4), admin activation and import (13), armory QR and ammunition (6) |
| **E3: local real-PostgreSQL** | A disposable PostgreSQL 16 built from the repo's own migrations (76/78 Supabase + 37/37 `database/aws`). Tests used the app's exact session context: role `tracepoint_runtime` → `set local role authenticated` with subject and department settings | Fleet/inspector writes, custody, entitlements, department creation, firearm RPC, equipment lifecycle CHECK, training read exposure, Cognito first sign-in (R7) |
| **E4: staging** | Not available in this session | §8 runbook, for the owner to run |

No production or staging system was contacted. No production data was read or changed, and nothing was deployed.

---

## 4. Priority areas: reproduction evidence

Each item lists the steps, the expected result, the actual result and the evidence.

### 4.1 Database authorization and tenant isolation

| Item | Steps | Expected | Actual | Level / evidence |
|---|---|---|---|---|
| **ARM-04**: firearm edit RPC (AWS) | As a Dept-B admin, call `update_firearm_with_audit` for a Dept-A firearm, forged actor, and internal function | Denied | **Denied** (42501) in all 4 variants; legitimate Dept-B update succeeds | E3: `evidence/db-t5t6t8.out`, `evidence/arm-t4.out` |
| **ARM-04**: same, Supabase schema | As `anon` / another tenant, call the RPC | Denied | **Succeeded**: serial rewritten, forged actor in `audit_log` | E3: `evidence/arm-t2.out`. **Relevant only if a Supabase project still serves traffic** |
| **ADM-03**: `create_department_with_owner` | Authenticated user with no membership calls it on the AWS schema | Denied | **Succeeds**: caller becomes Administrator of a new tenant. No AWS-runtime UI path calls it today | E3: `evidence/db-t5t6t8.out` |
| **TRN-26 / RNG-28**: training data visibility | As a plain officer, select other officers' certifications, qualification scores, attendance | Own rows only (or a need-to-know role) | **All department rows readable**; other tenants see nothing | E3: `evidence/db-t5t6t8.out` |
| Cross-tenant reads | Same queries from a Dept-B user | No Dept-A rows | **No Dept-A rows** (tenant isolation held in every test) | E3 |
| **NEW-ADM-G**: isolation test coverage | Inspect test runners and CI | The tenant-negative SQL suite runs against `database/aws` on every PR | Suite never applies `database/aws`; app tests do not run on PRs; two `*.test.mjs` files are never executed | E1: R6 |

### 4.2 Range score persistence and premature locking

All of these are E2: the real `src/lib/range/workspace-mutation.ts` was executed with synthetic workspaces (`evidence/verify-range.ts`, `.out`). The mobile `PUT /api/mobile/range-workspace` uses the same authorizer, so **the web and native clients are both affected**.

| Item | Steps | Expected | Actual |
|---|---|---|---|
| **RNG-01** | Save 2 scores, then correct one (the page regenerates `result-${now}-${index}` IDs) as instructor, Range Master and admin | Accepted, with a correction trail | **409** "Saved scores … cannot be removed" for every role; the web page swallows the error and shows "Saved". The same correction keeping the original ID is accepted |
| **RNG-03** | Range Master sets Packet Status = Ready, then the first score is entered | Score accepted | **409** for every role, including administrator. Reverting Ready also returns 409, so the day is permanently locked |
| **RNG-04** | Set status Completed, then edit, reopen or un-archive | Confirmation before finalize; a controlled amendment path | Completed accepted in one write; **every later change returns 409**; no amendment path |
| **RNG-13** | Two devices: device B saves without device A's new results; manager B makes a stale planning write | Conflict detected and surfaced | Score save 409 (lockout). **The stale planning write is accepted and silently overwrites manager A** |

### 4.3 Fleet status automation and field writes

| Item | Steps | Expected | Actual | Level / evidence |
|---|---|---|---|---|
| **FLT-01** | Manager sets the status manually, then an inspection reports a Critical brake defect | Vehicle Out of Service | Stays **Available**: `status_override_active` is set by every manual change and no UI or mobile route clears it | E2: `evidence/fleet-test-output.txt` |
| **FLT-02 / FLT-09** | Edit an older work order; submit an issue with blank mileage | Odometer unchanged | Odometer **19,200 → 18,000**; blank or `null` mileage saved as **0** | E2: same file |
| **NEW-01** | Inspector-only user submits a Critical inspection through the real RLS policies | Inspection, work order, vehicle status and audit all saved | **Only the inspection row saves.** Work order and audit insert are refused; vehicle and equipment updates affect 0 rows; the route returns **500** with the inspection already committed, and the vehicle stays Available | E3: `evidence/db-t1.out` |
| NEW-01 (manager) | Fleet manager without `administer_department` performs any fleet write | Saved and audited | Writes succeed, **the audit insert is refused, so 500**; the status refresh never runs | E3: `evidence/db-t2.out` |
| **EQP-06** | Officer checks equipment in or out through mobile custody | Works for the assigned officer | Check-out **404** (cannot see unassigned stock); check-in updates **0 rows** and returns 409 | E3: `evidence/db-t3.out` |
| **NEW-02 / NEW-ARM-B** | QR resolve with a unit number, asset number or serial | Resolved | **500**: `invalid input syntax for type uuid`. Printed `tracepoint://` labels get **400**. Only bare UUIDs work | E3 + E2: `evidence/pg-output.txt`, `evidence/arm-t5.out` |
| **EQP-09** | Set `lifecycle_status='out_of_service'` on a clean schema | Accepted | **CHECK violation**. Production was patched by a one-off cutover script; a clean or DR rebuild is still broken | E3: `evidence/db-t4t7.out` |

### 4.4 Notifications

| Item | Steps | Expected | Actual | Level / evidence |
|---|---|---|---|---|
| **TRN-08** | Search infrastructure and proxy for an email-dispatch invoker; call dispatch with only the bearer secret in AWS mode | A schedule exists; the call is accepted | **No schedule** in `infra/`; the proxy answers **401** before the route runs | E1 + E2: `evidence/trn08.out` |
| **TRN-01 / FLT-05** | Find what creates alert rows | A server-side process | Created only inside `GET /api/notifications` for the requesting user. The mobile inbox only reads existing rows, so **mobile-only users never get alerts generated** | E1: R4 |
| **TRN-10** | Fingerprint an expired-item alert on consecutive days | Stable | Changes daily, which **resets snooze and queues a new email every day** | E2: `evidence/trn10.out` |
| **TRN-05** | Default preferences, item due soon | Due-soon email | **None**; only expired (Critical) items are emailed | E2: `evidence/trn05-13.out` |
| **TRN-02** | Save an 18:00 Pacific event three times | 18:00 | 11:00, then 04:00, then 21:00 the previous day | E2: `evidence/trn02.out` |

### 4.5 Account activation

| Item | Steps | Expected | Actual | Level / evidence |
|---|---|---|---|---|
| **NEW-ADM-A** | Run the real invite flow, then the sign-in identity lookup | User can complete first sign-in | Identity link stays `pending`, so the lookup returns **0 rows**. Only an admin "Assign Password" makes it active | E3: `evidence/db-t9.out` |
| **NEW-ADM-D** | Cognito import of a previously inactive member | Member re-enabled and notified | Membership re-enabled, then the **legacy activation email throws** (Supabase-only path) | E2: `evidence/admin-test-output.txt` |
| **ADM-01** (Supabase path) | Import, then activate | Activation works | Rejected ("no longer requires activation"). Relevant only if a Supabase environment is still used | E2: `evidence/admin-test-output.txt` |
| **NEW-ADM-B** | Password policy | App and pool agree | App min 10 vs. staging pool min 14. Production pool was patched to 10 on 09-29, so this affects **staging only** unless infra is re-deployed | E1 |
| **ADM-07** | Forgot password under Cognito | Works | The Cognito hosted page has the link, but invited users lack a verified email, so reset delivery **must be tested** | Unverified |

---

## 5. Remediation plan (defects only)

Each batch below meets these rules:

- **One branch** `claude/fix-<batch>`, cut from `555f061`. If the owner identifies the staging commit, cut from that instead.
- **One concern.**
- **Regression tests** that fail before the fix and pass after.
- **No new features**, and no change to working behaviour beyond the defect.
- **No deployment** by Claude: staging validation follows the §8 runbook, and production needs explicit authorization.

Ordering follows security → data integrity → workflow blockers → correctness.

| Batch | Defects | Fix approach (minimal) | Acceptance criteria | Regression risk / rollback | Effort |
|---|---|---|---|---|---|
| **B0 Proof foundation** | NEW-ARM-C, NEW-ADM-G, RNG-36 (partial), false-green DB tests, ARM-02 / EQP-09 schema gaps | Add a PR workflow: app tests + `tsc` + `next build` (lint report-only at first, because 398 existing errors). Turn the R7 build script into a reusable local AWS-schema harness. Make DB tests fail when Postgres can't start. Add idempotent `database/aws/038` creating the missing tables and the corrected lifecycle CHECK (ported from `b465a33` and the cutover prep script) | CI red on a deliberately broken test; a clean bootstrap of `supabase/` + `database/aws` succeeds; 038 is a no-op on an already-patched DB | Low; 038 must be idempotent (`if not exists`); revert = drop the workflow file. 038 is applied to staging only via `migrate-db.ps1` | 4–6 d |
| **B1 Account access** | NEW-ADM-A, NEW-ADM-D, NEW-ADM-F, NEW-ADM-B, ADM-03 (revoke grant), NEW-ADM-E | First successful Cognito sign-in of an invited user activates its pending link, using the existing activation function. The Cognito import path stops calling the Supabase activation email. Align the password minimum with the pool. Revoke `create_department_with_owner` from `authenticated`. Settings deactivation calls the existing Cognito disable/revoke used by import | Invited test user signs in end to end on staging; deactivated user's session is rejected; no-membership user cannot create a tenant | **Medium.** Touches sign-in; must not affect existing active users (regression test on the active path). Rollback = revert the image; the grant revoke is re-grantable | 4–6 d |
| **B2 Field-write authorization (AWS)** | NEW-01, EQP-06, NEW-ARM-A, NEW-ADM-C | Add narrowly scoped RLS policies (or `SECURITY DEFINER` wrappers with explicit permission checks, mirroring 017) for: inspector work-order creation; vehicle status / mileage / due-date refresh; audit insert for fleet and equipment permissions; officer custody check-in/out of their own items. Use `profiles` instead of `auth.admin.listUsers` for ammunition (port from `production-tls`). Route the super-admin PATCH through `set_platform_entitlement` | E3 harness: inspector Critical inspection creates the work order and sets Out of Service; officer custody works; **all tenant-negative tests still deny**; ammunition pages 200; module toggle persists | **High (security-sensitive).** Every new policy needs a paired cross-tenant and wrong-role negative test. Rollback = drop the new policies (039) | 4–6 d |
| **B3 Range save integrity** | RNG-01, RNG-03, RNG-08, RNG-11, RNG-22, RNG-23, RNG-04, RNG-13 | Server: treat a result replaced by the same (rangeDay, drill, run, officer, attempt) key as a correction and append a revision. Only Completed/Locked/Archived lock the day, **not** Packet "Ready". Add a client version/ETag so stale planning writes get 409. Web: keep stable IDs; port the save-queue error and retry from `04668a1`; confirm before Completed; stop discarding unsaved scores | All 25 `verify-range` scenarios flip to correct behaviour; a stale write gets 409 with a reload prompt; a native-client payload with regenerated IDs is still accepted | **Medium-High.** Existing JSON workspaces and the **unseen native client** both depend on this contract, so the server must stay backward-compatible. Rollback = revert the image (no schema change) | 6–9 d |
| **B4 Fleet integrity** | FLT-01, FLT-02, FLT-09, FLT-08, FLT-20, FLT-19 | A manual override expires when a later inspection reports a Critical defect (or offer "return to automatic" on the existing control). Odometer only moves forward; blank ≠ 0. Make the inspection, work order and status write atomic. Align the two PATCH endpoints | Fleet handler tests: a Critical defect after an override gives Out of Service; no rollback on an old work-order edit; a failed work order rolls back the inspection | Low-Medium; rollback = image revert | 3–4 d |
| **B5 QR resolve** | NEW-02 / NEW-ARM-B, FLT-04 & ARM-01 (server side), NEW-ARM-E | Compare `id` only when the input is a UUID. Accept the printed `tracepoint://kind/id` and HTTPS forms by stripping to the handle. Uniform "not found" for unauthorized items | Unit number, asset number, serial and the printed label all resolve; a non-member gets the same response for absent and denied items | Low; the native client may rely on the current 400 for slashes, so check with the client owner | 1–2 d |
| **B6 Notification delivery** | TRN-08, TRN-01 / FLT-05, TRN-10, TRN-13, TRN-16, TRN-19 (silent failure), TRN-35 | Allow-list `email-dispatch` for bearer-secret calls in AWS mode. Add a scheduled invocation (EventBridge Scheduler → existing route; infra change, deployed only with authorization). Add a scheduled per-department run of the **existing** alert generator, so alerts exist without the user opening the web app; no new routing rules. Stable fingerprints. Hide Acknowledge where the API rejects it. Add the missing `onConflict` | Staging: an expiring certification creates an alert and an email for a user who never logs in; snooze persists across days; mobile inbox shows the item | **Medium.** Email volume: cap per run and dry-run first on staging. Rollback = disable the schedule | 6–8 d |
| **B7 Training records** | TRN-02, TRN-03, TRN-04, TRN-11, TRN-12, TRN-18, TRN-27, TRN-29, TRN-30 | Department-timezone-aware event times. The editor sends the course's certification type. The outcome no longer forces Present. Preserve recorded-by. Allow saving a roster containing a deactivated attendee. Closeout reads saved state and warns about unsaved edits. Reopen restores superseded credentials. Validate dates | Round-trip an 18:00 local event unchanged; closeout of a UI-created event issues certifications; no-show stays Absent | Medium (existing events have stored UTC values; no data migration, display only). Rollback = image | 4–6 d |
| **B8 Armory integrity** | ARM-06, ARM-11, ARM-13, ARM-16, ARM-17, ARM-21 (actor), ARM-22, ARM-23, ARM-26, ARM-28, ARM-29, ARM-33 | Archive without a fabricated return (existing archive reason). Restore keeps the disposition. Enforce the critical-fail rule and result values server-side. Inspection status goes through the status-history path, and Pass restores service. Record the actor per ammunition activity. Counter ≠ certifier. Block self-approval and self-review. Friendly validation errors | API tests for each rule | Low-Medium; rollback = image | 5–7 d |
| **B9 Equipment holder** | EQP-01, EQP-04, EQP-12 | Show former holders (inactive) instead of "Unassigned". Allow out-of-service / removed for items held by inactive members. Validate dates | Separated officer's gear lists with their name; can be marked out of service | Low | 2 d |
| **B10 Qualification computation & range roles** | RNG-07, RNG-09, RNG-10, RNG-12, RNG-14, RNG-15, RNG-24 | Instructor (`score_range_days`) can mark attendance and upload evidence. "Any" counts toward handgun. Attempt order beats the date. Validate score ranges. Only closed days count | Readiness unit tests for each case | Medium (qualification status for some officers will change; announce it) | 4–5 d |
| **B11 Admin correctness** | ADM-04, ADM-06, ADM-08 (help copy only), ADM-10, ADM-19, ADM-20, ADM-23, ADM-25, ADM-30, ADM-32, ADM-02 (residual) | Re-import never strips roles or reactivates without confirmation. My Notifications reachable by every role. Help text matches the product. Dashboard shows load errors. CSV formula guard. Remove backup and stale files. Sanitize errors | Tests per item | Low | 4–6 d |
| **D Owner-decision items** | ARM-09/RNG-17, TRN-05, TRN-07, FLT-06, ADM-13, ADM-14, ARM-15, ARM-25, ARM-31, EQP-11, TRN-26/RNG-28, FLT-14, ARM-32 | Depends on the decision (§6). The smallest option is usually "hide or label the inert setting" | Per decision | — | 3–6 d |

**Dependencies:**
- **B0 precedes everything:** the test gate and the local AWS-schema harness are how every later batch "proves it works".
- **B2 and B9 share RLS work;** B2 first.
- **B3 needs the native client contract.** Server-side compatibility tests must use real client payloads if available.
- **B6 infrastructure** needs a separate staging deployment authorization.
- **B10 changes qualification outcomes,** so it should follow B3.

**Effort:**

| Scope | Batches | Engineer-days |
|---|---|---|
| Total, defect-only | all | ≈ 50–73 |
| Commercial-readiness critical path | B0–B6 + B9 | ≈ 30–43 |
| Remainder | B7, B8, B10, B11, D | ≈ 20–30 |

Estimates assume one engineer familiar with the code, and exclude staging cycles run by the owner.

**Shortest defensible path to commercial readiness:**
1. Confirm the §2 facts.
2. Complete B0 → B1 → B2 → B5 → B4 → B3 → B6 → B9.
3. Run the §8 runbook on staging for each.
4. Run the 156-item pilot checklist on staging, with the native client, against a synthetic tenant.
5. Promote to production with authorization.

Items in B7, B8, B10, B11 and D are real defects, but none blocks an agency from using the core workflows safely. They can follow in the first maintenance releases.

---

## 6. Decisions needed from the owner (before fixing)

| Item | Question | Smallest options |
|---|---|---|
| ARM-09 / RNG-17 | Qualification failure lockout: on by default, never enforced. Enforce it or hide it? | Hide (S) / enforce at issue (M) |
| TRN-05 | Should "due soon" items be emailed by default? | Change the default (S) |
| TRN-07 / FLT-06 / ADM-13 / ADM-14 | Several settings are saved but never applied: reminder schedule, fleet service defaults, MFA / session timeout, timezone. Hide them, or label them "not yet active"? | Hide or label (S each) |
| ARM-15 | Should inspection checklist items start unset instead of "Pass"? | Change the default (S) |
| ARM-25 / ARM-31 | Is renewal of expired off-duty and personal-rifle approvals intended? (The unique serial currently blocks any re-request.) | Relax uniqueness to active records (S) |
| EQP-11 / TRN-26 / RNG-28 / FLT-14 / ARM-32 | Who should read other officers' training, range and readiness data? | Restrict to manager permissions (S–M) |

---

## 7. Deferred (not in this remediation)

- 38 enhancements, and 47 reviewer-confirmed items that are really missing capabilities. Examples:
  - lost/stolen lifecycle;
  - offboarding workflow;
  - supervisor team scoping;
  - offline range scoring;
  - ammunition ledger consolidation;
  - vehicle checkout;
  - per-officer transcripts;
  - range-to-armory malfunction linkage.
- They are listed with disposition "Defer" in [finding-status.md](finding-status.md), to be revisited in the "improve it" phase.

---

## 8. Staging verification runbook (for the owner)

Use only generated `acceptance-<UUID>` tenants and users, as the existing `smoke-staging.ps1` harness does. Do not use real agency data.

| # | Scenario | Pass criteria |
|---|---|---|
| S1 | Invite a new user → sign in through Cognito (with MFA enrolment) | Lands in the app, not in an error or loop (NEW-ADM-A) |
| S2 | Inspector-only user, mobile or web: submit an inspection with a Critical defect | Work order exists, vehicle is Out of Service, response 2xx (NEW-01, FLT-01) |
| S3 | Officer checks out, then returns, an assigned equipment item through mobile | Both succeed and appear in the custody history (EQP-06) |
| S4 | Scan a printed vehicle label; then resolve a unit number and a serial | All resolve (NEW-02, FLT-04) |
| S5 | Range day: save scores, correct one, save again; set Packet Ready, then score | Both saved; no 409 (RNG-01, RNG-03) |
| S6 | Create a certification expiring in 10 days for a user who never logs in; wait one dispatcher interval | Alert row and email exist (TRN-01, TRN-08) |
| S7 | Platform admin toggles a module for an agency | Persists after reload (NEW-ADM-C) |
| S8 | Open Ammunition and Reconciliation | 200, data shown (NEW-ARM-A) |
| S9 | Officer opens another officer's certification and qualification data in the API | Denied once decided in §6 (TRN-26) |
| S10 | Tenant-negative suite (`rehearsal-tenant-negative`) | All denials hold after each batch |

Record for each: date, staging commit and image digest, tester, result and screenshot or response. Run them before the fix (to confirm the defect on staging) and after.

---

## 9. Appendix F (architecture) re-classification summary

Full table: [R1 §5](R1-provenance-and-architecture.md).

| Current status | Count |
|---|---|
| Resolved | 21 |
| Partially resolved | 22 |
| Still open | 22 |
| Superseded by AWS-native architecture | 9 |
| Not applicable | 3 |
| Requires runtime verification | 6 |

- **Resolved since the audit:**
  - Cognito wired;
  - SES selected in AWS-native mode;
  - data access through Postgres under RLS;
  - PITR on, with a restore drill on a rehearsal RDS;
  - browser queries via a server proxy.
- **Still relevant:**
  - no PR quality gate (B0);
  - thin route-level and tenant-isolation tests (B0, B2);
  - no restore drill on the final production RDS;
  - no security headers;
  - pilot checklist 0/156;
  - stale `main`;
  - no deployed-commit traceability.
- **Housekeeping, recommended before any fix merges:**
  - Merge the `555f061` line, plus the 6 staging-DB-lease commits, into `main`.
  - Tag the deployed commits.
  - Commit a cutover-completion record.
