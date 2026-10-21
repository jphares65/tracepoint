# Staging verification package: claude/integration-defects-20261020

**Status:** Ready for owner review. Nothing in this package has been executed.

**Candidate code commit:** the merge commit of `claude/fix-b8a-expand-contract` (`8c9ac59`, 042/052 JSON preservation, expand-only 053, 046 outbox delivery) into `claude/integration-defects-20261020`, which already contains `claude/fix-safety-hold-rollback` (`9e8c659`, 046 status guard) and `claude/fix-staging-release-order` (`ef5122f`, release tooling). The exact SHA is recorded in `INTEGRATION.md` (final entry). Later commits must be documentation-only. Before building, confirm `git diff --stat <candidate> <deploy-sha> -- . ':!docs'` prints nothing, and record the deploy SHA in G1. **The deploy SHA must not contain `database/aws/054_*`.**

**Contents:** B0, B1, B1a, B2, B3, B4, B5, F1–F6b, DC, TV, B9, B7, B10, B8, B11, ADM-07, DC2, B8a (source commits in `INTEGRATION.md`). **Not included:** B6 (separate authorization) and the hotfix candidate branch.

**Pending migration set:** `038`–`046` and `048`–`053` (15 files). `047` is reserved for B6 and is absent; the runner accepts the gap.

**Scope:** staging only (AWS account `559054714699`). Production is out of scope and needs a separate authorization.

**Preconditions for approval:**
- integration CI green on the exact commit to be deployed;
- owner sign-off on this document.

## 0. Roles and evidence

| Role | Responsibility |
|---|---|
| Operator (owner or delegate) | Runs `migrate-db.ps1`, `deploy-app.ps1` and the acceptance steps under the staging SSO role `TracePointMigrationStaging` |
| Evidence recorder | Fills the evidence table in §6 for every step: time, commit, image digest, result, screenshot or response body |

Rules for the run:
- Use only generated synthetic tenants and users (`acceptance-<UUID>`, the pattern of `scripts/smoke-staging.ps1`).
- No real agency data.

## 0a. Readiness gates

Every gate must be satisfied and recorded before the owner approves the staging deployment.

| Gate | Requirement | Evidence |
|---|---|---|
| G1 CI | `Application quality gate` green on the **exact** integration commit to be deployed. All steps must pass: app tests with no file running zero tests, script tests, infra tests, `tsc`, `db:validate-bootstrap`, `next build`. | Run URL and commit SHA |
| G2 Migration ledger | `migrate-db.ps1 staging -Action status`: ledger present, no drift, **001–037 applied**, exactly the 15 files 038–046 and 048–053 pending (no 047). Needs the published image (§2 step a: ECR and CodeBuild only, no ECS change), so the owner must approve step a before this gate. | Status output |
| G3 Hard schema dependencies | 028–031 (custody, used by the F6b QR lookup and the custody API) and 033–037 already applied. **All of 038–046 and 048–053 applied before the image.** These fail outright without their migration: 039 (B1 first-login activation); 045 (every QR scan calls `can_submit_fleet_inspection`, F5); 049 (separated holders show as "Unnamed Officer"); 051 (instructor attendance and walk-ups are refused by the trigger); 052 and 053 (rifle actions, firearm status changes and the armory name lookup call database functions that only they create, B8/B8a). **Rollback compatibility:** the previous image also runs on this schema. 053 is expand-only for that reason, and the contract `054` is not in this package (§5a; `RELEASE-SAFETY-rollback-compatibility.md`). | Ledger rows |
| G4 Data-impact previews (read-only) | Run and record: (a) the 046 safety-hold preview query (F6a record): vehicles newly held when 046 lands; (b) the equipment lifecycle constraint check (§1.4); (c) the date-defect checks Q1–Q9 (hotfix record), including **Q3 queued false-"Expired" emails**; (d) B10: `scripts/qualification-status-snapshot.sql` + `scripts/qualification-status-diff.mjs`, and close out completed range days first; (e) B7: the upcoming-event drift review query (TRN-02); (f) DC2: the R0 session-settings check (`timezone` UTC, `DateStyle` ISO, `IntervalStyle` postgres) and the impact queries in the DC2 record; (g) `notification_email_queue` Pending rows, before and after (DC fixes and the DC2 fingerprint change can add rows). **The email dispatcher stays off.** | Query outputs |
| G5 Snapshot | Manual RDS snapshot taken and `available` | Snapshot ARN |
| G6 Native client | A native client build pointed at staging is available, with synthetic accounts for the roles in S1–S24. It must parse the DC date (`YYYY-MM-DD`) and DC2 timestamp (`…[.f0–6]+00:00`, including whole seconds) formats (S17, S24). Without it, S2–S5, S17 and S24 can only be run on the web, and the native client checklist (C1–C32) stays **unverified**. | Build ID |
| G7 Owner approval | The owner approves this package and the exact commit | Written approval |

## 0b. Defect status tracking

Each defect moves through four separate stages:

1. **Found:** evidence in the reconciliation.
2. **Fixed in code:** branch, commit and CI.
3. **Validated in staging:** the S-step "after" result, recorded in §6.
4. **Confirmed resolved in production:** a post-deployment check, only after separate production authorization.

This package can move items to stage 3 only. Nothing in this document moves any defect to stage 4.

## 1. Pre-flight (read-only)

**Read-only kit:** `docs/remediation/preflight/` on branch `claude/staging-preflight-20261020` (SQL and README, rehearsed locally on the 037 and 053 states). Staging RDS has no workstation path: running the kit needs an owner-approved one-shot read path (README, "Connection"). Staging runs PostgreSQL 18.4; the rehearsal ran on 16.15.

1. Record the current staging state:
   - ECS task definition revision and image digest: `aws ecs describe-services --cluster tracepoint-staging --services tracepoint-staging`. This is the **rollback target**.
   - `scripts/migrate-db.ps1 staging -Action status`. Expected: ledger present, 001–037 applied, 038–046 and 048–053 pending (15 files, no 047), no `MIGRATION_DRIFT`. It refuses until the reviewed image is in ECR, so run it as §2 step b, after `deploy-app.ps1 staging -PublishOnly` (step a). Step a does not change ECS.
2. Take a manual RDS snapshot of the staging database: `tracepoint-staging-pre-integration-<date>`.
3. Confirm the migration role owns `public.equipment_assets` and `public.equipment_asset_assignments`, which 041's `SECURITY DEFINER` function requires:

   ```sql
   select tableowner from pg_tables where tablename in ('equipment_assets','equipment_asset_assignments');
   ```

4. Confirm the production-only repair is mirrored or absent on staging:

   ```sql
   select pg_get_constraintdef(oid) from pg_constraint where conname='equipment_assets_lifecycle_status_check';
   ```

   038 normalises it either way.
5. Run the **baseline** acceptance pass (§4, "before" column) against the current staging image, to confirm each defect reproduces on staging.

## 2. Migration order (staging only)

**Release sequence.** G3 requires the migrations before the new image serves traffic. `migrate-db.ps1` refuses to run until the reviewed image exists in ECR with a clean scan, so the image is published first and rolled out last. Run every step from one clean checkout whose `HEAD` is the deploy SHA (G1), as `TracePointMigrationStaging`. Do not pass `-ImageCommit`: `migrate-db.ps1` always uses `HEAD`.

| Step | Command | Changes | Expected |
|---|---|---|---|
| a. Publish | `.\scripts\deploy-app.ps1 staging -PublishOnly` | ECR only: CodeBuild builds `<sha>-aws-native-staging` (canonical suite and mobile-route contract run in the build); S3 source upload | `PUBLISH ONLY SUCCEEDED - ECS unchanged: staging commit <sha>, image <sha>-aws-native-staging (…@sha256:…)`. Record the digest. `aws ecs describe-services` still shows the §1 revision. |
| b. Status | `.\scripts\migrate-db.ps1 staging -Action status` | See "Footprint" below | G2: 001–037 applied; 038–046 and 048–053 pending; no `MIGRATION_DRIFT` |
| c. Apply | `.\scripts\migrate-db.ps1 staging -Action apply`, then `-Action status` again | Database: the 15 pending files | No pending files, no drift |
| d. Roll out | `.\scripts\deploy-app.ps1 staging` (§3) | ECS: one new task revision; service update | `Reusing existing immutable application image <sha>-aws-native-staging`, then `DEPLOYMENT SUCCEEDED`. The digest equals step a. |
| e. Acceptance | §4 | — | — |

`054` is not part of this sequence. It needs separate approval after acceptance (§5a).

If step a, b or c fails, ECS is unchanged and the previous image keeps serving. After c, the previous image runs on the migrated schema; this is compatible (below).

**Footprint of `migrate-db.ps1` (status, as well as apply).** Status is read-only in the database: the runner's `status` action only reads the ledger. It is not read-only in AWS. Each run:
- reads the application image and its scan (read-only);
- on the first run for a commit, builds `migration-<sha>-aws-native-staging`: it uploads a source archive to the versioned `source/tracepoint-staging-source.zip` (each build is pinned to its own `VersionId`) and runs a CodeBuild build of up to 45 minutes. Later runs reuse that image;
- on every run, registers a **new revision** of the migration task family (copied from `tracepoint-staging-database-bootstrap:27`, with the migration image digest, the runner command and the migrator database secret);
- on every run, starts one Fargate task in the service's subnets and security groups, and waits for it to stop.

It never updates the ECS application service. Expect two extra migration task revisions from b and c (three with the post-apply status). They do not affect the application family's rollback targets.

Apply with `scripts/migrate-db.ps1 staging -Action apply`, which applies only the pending files, in order:

- each file runs in its own transaction;
- the run holds an advisory lock;
- each applied file is recorded in the hash-checked ledger.

All files are idempotent and wrapped in `begin;` and `commit;`.

| # | File | Batch | Purpose | Depends on | Notes |
|---|---|---|---|---|---|
| 038 | `equipment_out_of_service_lifecycle` | B0 | Allow `out_of_service` in the equipment lifecycle CHECK | — | No-op on a DB already repaired |
| 039 | `account_access_remediation` | B1 | First-login activation function (runtime-only); fixes the 42702 bug in `prepare_cognito_membership_operation`; revokes `create_department_with_owner` | — | Must be applied **before** the new image |
| 040 | `fleet_field_write_authorization` | B2 | Inspector, mechanic and audit policies; fleet field guard (override → Out of Service only) | — | |
| 041 | `equipment_self_custody` | B2 | Custody pool read policy; `operate_equipment_self_custody` | 038 | Needs the table ownership checked in §1 step 3 |
| 042 | `range_packet_ready_is_not_final` | B3 | Ready no longer locks the day in the DB triggers; trigger `pilot_range_workspaces_keep_result_revisions` keeps `resultRevisions` append-only and records a revision (`recordedBy: database`) for a change that a write makes without one | — | **Edited in place (release safety, never applied anywhere):** the previous image's range save no longer drops the correction history (`RELEASE-SAFETY-rollback-compatibility.md` §2a). sha256 `3dee6dcb…` |
| 043 | `fleet_inspection_audit_outbox` | B4 | Audit outbox, its trigger and delivery/reconciliation functions | 040 | |
| 044 | `personnel_import_preservation` | F1 | Blank fields keep stored values; no automatic Officer role; Administrator-only rule on import lifecycle | 039 | Restates 039's function with one added check |
| 045 | `fleet_inspection_eligibility` | F2 | `can_submit_fleet_inspection`; aligned inspection and issue policies; guard uses the helper | 040 | |
| 046 | `fleet_safety_hold_clearance` | F3, F6a | Safety-hold clearance columns and guard (managers only, reason required, refused while a critical work order is open); critical inspections take the vehicle Out of Service whatever the automation settings; outbox stores the inspection's work order; reconciliation skips entries under 5 minutes old that were never attempted | 043 (045 optional) | **Edited in place by F6a** (never applied anywhere; staging and production stop at 037). **One-time data baseline on first apply:** only vehicles with a later passing inspection after their latest critical condition, and no open critical work order, are marked cleared, each with an `audit_events` row (actor null). Vehicles whose only evidence is a completed or cancelled work order are **held** until re-inspection or a manager clearance. Run the per-agency preview query in the F6a record **before** applying. **Edited in place again (release safety):** outbox delivery links an existing audit row for the same inspection instead of writing a second one (new column `fleet_audit_outbox.delivered_by_existing_audit`). This covers inspections the previous image audited itself while rolled back; `RELEASE-SAFETY-rollback-compatibility.md` §5. **Edited in place a third time (rollback safety hold):** trigger `fleet_vehicles_safety_hold_status_guard` keeps a held vehicle Out of Service when any write (including the previous image's work-order completion refresh or status override) would leave it Available or Attention, and audits `fleet_safety_hold_status_kept`; that record §5b. |
| 048 | `training_record_visibility` | TV | Own-row-or-permission read policies on certifications, agency-training attendee/requirement/certificate tables, qualification results, drill results, range roster, remediation recommendations, range packets and qualification attachments | — | 047 is reserved for the separate B6 branch; the gap is allowed by the runner (strictly increasing versions only) |
| 049 | `equipment_separated_holder` | B9 | Equipment trigger validates the holder only when it changes (items held by separated members can go out of service, be removed or returned; new assignments to inactive members are still refused); removal reason recorded in history; **profiles read policy:** `manage_users`, `manage_equipment` or `administer_department` holders can read a former member's profile in their agency (owner decision pending) | 038 | Apply before or with the image, or separated holders show as "Unnamed Officer" |
| 050 | `training_closeout_records` | B7 | Closeout refuses Completed/Passed without Present; issue date is the event date in the department zone; records which credentials a closeout superseded (`training_certifications.superseded_by_training_event_id`) so reopen restores exactly those | — | Additive. Before deploy, run the B7 record's upcoming-event drift review query (TRN-02) |
| 051 | `range_instructor_line_actions` | B10 | Ready-day trigger lets `score_range_days` holders change attendance and add present walk-ups on open days (removal, officer and firearm changes stay planning-only); instructors may insert qualification evidence and its audit row; `attachments_select` lets the officer of an imported result read its evidence | 042, 048 | **Before applying:** run `scripts/qualification-status-snapshot.sql` and `scripts/qualification-status-diff.mjs` (B10 record) and record per-agency status changes. Close out completed range days first, or open-day passes stop counting |
| 052 | `armory_separation_of_duties` | B8, B8a | Triggers block self-decision of off-duty requests, self-review/reinstatement of personal rifles and self-certification of ammunition reconciliations; a second person may certify (update policy); a failed off-duty inspection marks the request Non-Compliant (a missing request raises `P0002`). Personal-rifle history is written only by a trigger in the same statement as a real change, with the signed-in actor; users have **no** insert, update or delete on history; note via `personal_rifles.workflow_note` (always null at rest) | — | **Edited in place by B8a** (never applied anywhere). **Edited in place again (release safety):** trigger `pilot_ammunition_workspaces_keep_actors` keeps the ammunition actor fields that the previous image's page drops, and stamps rows it adds (§2a of the release-safety record). sha256 `798422b9…`. Apply with or before the image |
| 053 | `armory_audit_and_access` | B8a | `change_firearm_status` (status and history in one call, agency and permission checked); `armory_member_identities` (name, rank, badge, unit, active flag only, own agency, role-scoped). Profiles and memberships read policies are **not** widened. **Expand only:** it no longer revokes direct writes on `firearm_status_history`, so the 037 grants and `firearm_status_history_insert_managers` stay for the previous image, which is the automatic rollback target. | 052 | **Edited in place** (never applied anywhere; `RELEASE-SAFETY-rollback-compatibility.md`). Apply with or before the image. The contract step is `054` (§5a), and it is **not** in this package. |

**After applying**, run `migrate-db.ps1 staging -Action status` again. Expected: no pending files, no drift. Then run `select tgname from pg_trigger where tgname in ('pilot_range_workspaces_keep_result_revisions','pilot_ammunition_workspaces_keep_actors')` → 2 rows.

**Previous image on this schema:** the previous image runs on the migrated schema in three cases: between apply and deploy, during the rolling deploy, and after an automatic rollback (`deploy-app.ps1` or the ECS circuit breaker). Every migration in this set was audited against it (`RELEASE-SAFETY-rollback-compatibility.md` §2), and so was every JSON document it reads, modifies and writes (§2a): 038–053 (expand) are compatible or degraded-but-safe. No runbook step is needed on re-upgrade: 046 settles the outbox (§5), and 042/052 keep range correction history and ammunition actors (§2a).

## 3. Image deployment (staging only)

This is step d of §2. Run it only after `migrate-db.ps1 staging -Action status` reports no pending files.

1. Roll out the image published in step a, from the same checkout:

   ```powershell
   .\scripts\deploy-app.ps1 staging
   ```

   It does not rebuild. It reuses the immutable `<sha>-aws-native-staging` image, after checking it again for a clean scan, and registers a task revision that changes only the image.
2. The script enforces ECS steady state, healthy ALB targets, `/api/health` 200 and the exact image digest. On failure, it rolls back automatically to the revision recorded in §1, as does the ECS circuit breaker. That previous image runs on the migrated 038–053 schema (`RELEASE-SAFETY-rollback-compatibility.md` §2, §4).
3. Record the new task-definition revision and image digest. The digest must equal the one recorded in step a.

## 4. Acceptance tests (S1–S10, plus supplementary S11–S24)

Run every step **before** (current staging image and schema) and **after** (migrations and new image). A step passes only when the "after" result matches the expected result.

| ID | Scenario (synthetic users) | Expected after | Covers |
|---|---|---|---|
| **S1** | Invite a new user. On the website they set a password of at least 14 characters, enrol in MFA, and complete first sign-in. | Lands in the app; identity link becomes `active`; one `account_activated` audit row per membership | NEW-ADM-A, F1 password |
| **S2** | An inspector-only user (role with `perform_fleet_inspections`, not an administrator) submits an inspection with a Critical defect on a vehicle a manager set to Available (override active). Test web and native app. | 201; Critical work order exists; vehicle Out of Service with override kept; `audit.status` `recorded`; one `fleet_vehicle_inspected` audit row | NEW-01, FLT-01, B2 amendment |
| **S3** | An officer checks out an unassigned pool item, then returns it as `damaged`, through the native app. Then a second officer looks up the first officer's held item. | Check-out 200 and check-in 200; lifecycle becomes `out_of_service`; the second officer gets 404 | EQP-06, EQP-09, custody privacy |
| **S4** | Through the native app: scan a printed vehicle label, an equipment label, then a unit number, a serial, a duplicated serial, a firearm serial as an officer without firearm read, and a firearm the officer holds. Repeat the vehicle scan as: (a) an inspector; (b) an officer eligible only through a configured inspection role; (c) a `view_fleet` viewer outside the configured roles. | Labels and unit number resolve to the exact item; duplicate gives 409 and the app opens **no** item; no-read firearm gives a body identical to a non-existent value; held firearm gives `denied`. Vehicle scan: (a) and (b) get `vehicle_inspection` `allowed:true`; (c) gets `denied`. Before F5, every vehicle scan returned `denied`. | NEW-02, FLT-04, F4, F5 |
| **S5** | Range day: save 3 scores; correct one and save again; set Packet = Ready, then enter a new score; save from a second browser with a stale page. | Correction saved and visible in `resultRevisions`; scoring works after Ready; the stale save gets a 409 reload prompt and nothing is silently overwritten. On the native app, confirm it tolerates `resultRevisions` and, if supported, sends `baseUpdatedAt`. | RNG-01, RNG-03, RNG-13 |
| **S6** | Notifications: *deferred to B6.* Infrastructure is not authorized in this package. Record the current behaviour only. | Documented as known open (TRN-01, TRN-08) | — |
| **S7** | A platform admin in Support Mode toggles a module off and on for a synthetic agency, then reloads. Then, outside Support Mode, opens the agency page. | Toggle persists, with a `department_feature_events` row; outside Support Mode the page shows the Support Mode guidance | NEW-ADM-C, F1 guidance |
| **S8** | Open Ammunition and Reconciliation as an armorer. | 200 with data and actor names | NEW-ARM-A |
| **S9** | As a plain officer, request another officer's certification and qualification data through the API. | Superseded by **S18** (owner decision applied in TV): own records only. Run S18. | TRN-26 |
| **S10** | Run the tenant-negative suite (`/api/internal/rehearsal-tenant-negative` harness), plus the cross-tenant checks from S2–S4 with a user in a second synthetic agency. | Every cross-tenant attempt is denied or returns `unknown`; no data from the other agency | Tenant isolation |
| S11 | Simulate an audit outage on staging only. The ops procedure in the B4 record makes the delivery function fail for the synthetic tenant. Submit a Critical inspection, then restore. | 201 with `audit.status` `pending`; vehicle Out of Service; the next inspection or a manager's fleet-list load reconciles; exactly one audit row, with the correct `work_order_id` (F3) | B4, F3 |
| S12 | Critical hold: a fleet manager tries to clear the hold while the Critical work order from S2 is open; then a mechanic completes or cancels it. Repeat S2 with the agency's automatic vehicle status and critical-issue settings turned off. | Clearance refused (409, the detail page names the open work order). Vehicle stays Out of Service after completion. It is released only by a passing re-inspection, or by a manager's clearance with a reason (audited). A clearance without a reason is rejected. With the settings off, the vehicle still goes Out of Service (F3, F6a). **Previous-image check (if a staging task of the previous revision can be run against the migrated schema, for example during the rollback drill):** with the hold in place, complete or cancel the critical work order and set the vehicle Available through the *previous* image. Both requests succeed, but the vehicle stays **Out of Service**, and `audit_events` has `fleet_safety_hold_status_kept` rows by those users (query in the release-safety record §5b). Then, on the new image, a passing re-inspection or a manager clearance with a reason releases it. | F3, F6a, release safety §5b |
| S13 | Re-import a personnel CSV for existing synthetic members: blank badge/rank/unit cells, no Active column, one explicit `Active=No`, one row for the agency's only Administrator with `Active=No`, and one row run by a `manage_users` non-administrator targeting an Administrator. | Stored values kept; roles unchanged and no Officer added; the explicit No deactivates the member and disables their Cognito account; the final-Administrator and non-administrator cases are refused | ADM-04, F1 |
| S14 | Assign Password with 13 and with 14 characters; an existing user with an older shorter password signs in. | 13 rejected with a clear message; 14 accepted; the existing user signs in without a forced reset | F1 |
| S15 | An inspector (not a maintenance user) opens vehicle detail, the mobile vehicle view and the inspection response; a fleet manager does the same. | No `labor_cost`, `parts_cost` or `total_cost` for the inspector; costs present for the manager | F2 |
| S16 | An eligible officer (`view_fleet`, empty inspection-role list) reports a Critical issue. Then configure the inspection-role list without that officer's role and retry. | First: 201, vehicle Out of Service, no management access gained. Second: refused in both the API and the DB | F2 |
| S17 | A synthetic member holds a certification valid until next year. Open My Home, the inbox, `/training/certifications` and the readiness views on the website. Through the native app, open any view with a date (equipment expiry, inspection due date). | Shows **current** with the correct expiry date. Before the DC fix it showed **expired** with no date. The native app parses `YYYY-MM-DD` dates correctly. If it does not, **stop**: the native client needs an update before deploy. | DC (date contract) |
| S18 | As a plain officer, through the API and the pages: list certifications, open an agency-training roster, `/api/qualifications`, the range workspace GET and another officer's evidence download. Repeat as `manage_certifications`, `manage_training`, a range scorer and `view_command_dashboard`. | Officer sees only their own records (the workspace response has `recordScope: "own"`), and another officer's evidence returns 403/404. Each permitted role sees what the TV record's mapping table lists. An officer's workspace PUT still returns 403 and erases nothing. | TRN-26, RNG-28 |
| S19 | Deactivate a synthetic officer who holds equipment and a firearm. As an equipment manager, view the asset list, the per-officer view and the CSV export, then mark one item out of service and remove another, each with a reason. Try to assign a new item to the deactivated officer. As an armorer, view the firearm list. | Items show "Name (inactive)", never "Unassigned". Out of service and removal succeed and require a reason, and the history closes with the reason. A new assignment is refused. The armorer sees "Name (inactive)", or "Unknown User" if they hold `manage_firearms` only (known limitation). Deactivation removes no assignment. | EQP-01, EQP-04, EQP-12, ARM-08 (display) |
| S20 | Agency training, in a tenant whose timezone differs from the tester's browser (full steps in the B7 record, "S19-B7"). Create an 18:00 event and edit it three times; closeout attendance rules; Complete Event blocked while edits are unsaved; reopen restores the superseded credential; roster with a deactivated officer; certification edit rules. | Time stays 18:00 department time. A no-show cannot be Completed. Closeout issues the credential dated the local event date. Reopen restores the earlier credential. The roster saves with the inactive officer, and their recorded row cannot be removed. A closeout-issued credential's issue date and officer cannot be changed. | TRN-02, 03, 04, 11, 12, 18, 27, 29, 30 |
| S21 | Range, as an Instructor holding only `score_range_days` (full steps in the B10 record, "Staging" step 4): mark Present on a scheduled and an open day; add a walk-up from Scoring; upload a target photo on a saved result and on an imported record's evidence (as a range manager); save a score above the drill maximum; save a Points drill toggled Incomplete. Compare two officers flagged by the pre-apply diff report. | Attendance and walk-up save; removal, Add Officer and firearm selection stay disabled. Photo upload returns 201 and lists. An impossible score is refused (400, "Save failed: Score … is above the maximum …"). Incomplete is stored as incomplete. Statuses match the diff report's "after": only Completed/Locked days count, "Any" drills count, a same-day re-shoot clears Failed. S5 and S10 still pass. | RNG-07, 09, 10, 12, 14, 15, 24 |
| S22 | Armory integrity, on a synthetic agency with two armorers (A1, A2), a chief who also submits off-duty requests and owns a personal rifle (C1), a second reviewer (C2, administrator) and an officer (O1). (a) A1 issues firearm F1 to O1, then archives it with only an archive reason; then with "Reported stolen, case 26-0142" as the not-returned reason. Restore F1. (b) Issue F2 to O1; set Retired; set Out of Service. (c) Inspect F3 with a failed critical item: try Passed; save Failed; then save a Passed re-inspection. Mark F4 Out of Service by hand, then save a Passed inspection. (d) Edit F3 with an empty caliber. (e) C1 submits an off-duty request and tries to decide it; C2 returns it. Record a Fail inspection on an approved request. (f) C1 tries to approve and to reinstate C1's own rifle; C2 approves it. (g) Reconciliation: A1 counts with one variance, tries to submit without an explanation, submits with one, tries to certify; A2 certifies. (h) Ammunition page: confirm a count that differs from the expected without notes, then with notes; open History. | (a) The first archive is refused with "…record why it was not returned…". The second succeeds; the assignment is closed "Not Returned" with the reason, and no magazine return is asserted. After restore, the archive reason is still on the row. (b) Retired → 409 "Return it before retiring it"; Out of Service → 200 with a status-history row. (c) Passed is refused (critical item); Failed → Inspection Required with a history row; the re-inspection → In Service with a history row; F4 stays Out of Service. (d) 400 "Caliber is required…". (e) C1 → 403 on every decision; C2's Return works; after the Fail, the list shows Non-Compliant and `compliance_status = 'Non-Compliant'`. (f) C1 → 403 on both; C2's approval → 200 with a history row. (g) Submit without explanation → 400; A1 sees "Submitted for command certification" and a certify attempt → 403; A2 certifies; expected quantities equal the lots' on-hand quantities, and the counts are unchanged by certify. (h) Without notes → refused; with notes → saved; History shows "by <name>". | ARM-06, 11, 13, 16, 17, 21, 22, 23, 26, 28, 29, 33 |
| S22a | Synthetic agency with: K1 (armorer role granted only `manage_firearms`), C1 (chief, `approve_personal_rifles`, not an administrator), I1 (granted only `manage_inspections`), O1 (officer, badge 4410), A1 (administrator). (a) A1 issues firearm F1 to O1. K1 opens the armory list and the issue picker. (b) K1 sets F2 Out of Service with a note. (c) O1 submits a personal rifle. A1 records the armorer approval with a note. C1 approves with "Meets spec". O1 opens the rifle history. (d) In SQL as the runtime role, try to insert a `personal_rifle_status_history` row and a `firearm_status_history` row, and to update or delete either. (e) I1 records a Fail inspection on O1's approved off-duty request. (f) K1 archives F1 with "Reported stolen" as the not-returned reason. | (a) F1 shows O1's name and badge (not "Unknown User"); the picker lists active members. (b) 200; exactly one history row, `changed_by_user_id` = K1, with the note. (c) Both approvals → 200. History rows: Owner Submitted, Armorer Approved (A1, note), Chief Approved (C1, "Meets spec"), each with the correct from/to and no duplicates. O1 sees the reviewers' names. `workflow_note` is null. (d) Rifle history: every write → permission denied. Firearm history until 054 (the 037 state, kept for the previous image): K1 inserting a row as K1 → accepted. Insert as another user, or by O1 → permission denied. Update/delete → 0 rows. After 054 (§5a): every write → permission denied. (e) 200; the request becomes Non-Compliant, and I1 still cannot read the request row directly. (f) 200; the assignment is closed "Not Returned" and the firearm is archived. | B8a-1 … B8a-6 |
| S23 | Admin correctness (full sub-steps 1–10 in the B11 record, "S23"): officer opens My Notifications and saves preferences; Help copy; Cognito Forgot password: run **S23-3 (revised)** from the ADM-07 record instead of B11's step 3 (invited never signed in, invited signed in, Assign Password before first sign-in, normal user); Command Dashboard with `/api/readiness/certifications` blocked; multi-line CSV import and `=1+1` exports; re-invite an existing member and another agency's person; refused combined member save, then an Administrator's combined save; Support Mode nav with Analytics on and Range & Training off; an unknown invite failure; S10. | Officer preferences persist and Help links to `/notifications`. Help matches the screens. S23-3 (revised) matches the ADM-07 record: no step sets `email_verified` true except a code the user entered; record step 2 for the ADM-07c decision. The blocked card shows "Data unavailable" with a banner; no banner for a module that is off. The note imports as one row; exported formulas are text (`'=1+1`). Re-invites return 409 and change nothing. The refused save leaves the officer active with old roles; the Administrator's save applies all changes together. No nav entries for disabled modules; direct URLs unchanged. Unknown failure: 500 "The user could not be added.", detail in the log. S10 passes. | ADM-06, 07, 08, 10, 19, 20, 23, 25, 32 |
| S24 | Timestamp contract (full steps 1–8 in the DC2 record): Command Dashboard upcoming training and training attention; audit log rows and CSV times; native custody history ordering; native Inbox and fleet detail raw JSON including a whole-second timestamp; native live scoring with a stale pre-deploy `baseUpdatedAt`; web range save after a microsecond `updated_at`; My Home firearm alert time and the email queue; R0 session settings. | Lists populate; audit rows show time, appear once and export with time; custody history is newest first by time; timestamps are `…[.ffffff]+00:00` and the app parses them, whole seconds included (if not, **stop**: hold DC2 for a native update); stale save gets 409 `stale_workspace`, current save 200; web save 200 (before: false 409); alert shows a time; one-time acknowledgement/snooze reset as listed, new Pending emails reviewed with the B6 owner; R0 values match. | DC2 |

## 5. Rollback

The primary rollback is the **image**. Run `deploy-app.ps1 staging -RollbackTaskDefinitionArn <pre-flight revision>`.

The migrations are additive and were designed to stay in place under the previous image. Schema rollback SQL for each migration is in its batch record. The ledger is hash-checked, so any schema rollback is a **new** forward migration; applied files are never edited.

| Item | Rollback | Caution |
|---|---|---|
| Image (any batch) | Previous task-definition revision (manual, or automatic by `deploy-app.ps1` or the circuit breaker) | **Compatible with 038–053 as packaged** (audit table in `RELEASE-SAFETY-rollback-compatibility.md`). No schema step before the rollback or the re-upgrade. Fleet inspections made while rolled back keep exactly one audit row: 046's delivery links the old image's row (that record §5 has a read-only diagnostic). Critical safety holds stay in force under the previous image: 046's status guard keeps held vehicles Out of Service (that record §5b). No runbook step is needed for them. **Once 054 is applied (§5a)**, a rollback below B8a first needs the forward restore migration in that record §4 step 9. |
| B3/B8 JSON documents under the old image | — | No step needed. The old range save would drop `resultRevisions`, and the old ammunition page would drop activity and count actors. The 042 and 052 triggers keep both, and they account for the old image's own corrections and new rows (release-safety record §2a and §7: automatic rollback, mixed fleet and concurrent writes). The earlier "export `resultRevisions` and freeze range edits" step is withdrawn. |
| B1/B1a/F1 under the old image | — | 039 fixes the import lifecycle, but the old image's import ignores the Active safeguards. **Pause personnel imports** while rolled back. |
| B4 under the old image | — | 043's trigger keeps queuing audit entries and holding critical vehicles Out of Service (the safe direction). Pending entries reconcile after re-upgrade (ops SQL in the B4 record). The old image also audits its own inspections; reconciliation links that row instead of writing a second (046). |
| F2 under the old image | — | The old API admits all members to inspections when the role list is empty, but the DB refuses members without an inspection permission. The 037 policy already did this, so it is not a regression. The request fails cleanly before any write. |
| 038 | None needed (superset) | |
| 039 | `grant execute on function public.create_department_with_owner(text,text,text,text,text,text) to authenticated;` and `drop function tracepoint_auth.activate_cognito_identity_on_first_login(text,text,uuid);` | Leave the 42702 correction in place |
| 040, 041 | SQL in `B2-field-write-authorization.md` § Rollback | |
| 042 | Re-run the old trigger bodies as a new migration (B3 record). Keep `pilot_range_workspaces_keep_result_revisions`. | Re-locks Ready days |
| 043 | SQL in `B4-fleet-integrity.md` § Rollback, after delivering or exporting pending outbox rows | |
| 044 | Re-run the `010`/`039` function bodies as a new migration (F1 record) | |
| 045 | New migration restoring the 040 definitions, then drop the 045 objects (F2 record) | |
| 046 | New migration: drop `fleet_vehicles_safety_hold_status_guard` and `fleet_vehicles_safety_hold_clearance_guard` with their functions, and re-run 043's `enqueue_fleet_inspection_audit` and three outbox function definitions (F3, F6a records). The columns and baseline audit rows can stay, inert. | Vehicles held under the new rule keep their status until changed |
| 051 | New migration: re-run 042's `protect_pilot_range_workspace_mutation()` body, drop `attachments_insert_qualification_evidence` and `audit_events_insert_qualification_evidence`, recreate 048's `attachments_select` (B10 record) | Statuses revert with the image; stored `firearmTypeSnapshot` is inert |
| 052, 053 | New forward migration per the B8 and B8a records: drop the three B8 guard triggers, the rifle history triggers and `record_personal_rifle_status_history()`, `change_firearm_status` and `armory_member_identities`; recreate the earlier `ammunition_reconciliations_update`; re-run the 202608170005 body of `record_off_duty_firearm_inspection_internal` | **No forward migration is needed for an image rollback while 054 is not applied.** 053 keeps the 037 firearm-history grants, so the old status route works as at 037. Rifle history needs nothing: `authenticated` held only SELECT at 037, so the old rifle routes already returned 500 after saving, with no history row. On 052 the trigger writes that row, and a retry gets 409 with no duplicate. After 054, see §5a. |
| B11 (no migration) | Revert the B11 commit and redeploy the image (B11 record) | Removed backup files and page copies come back; nothing imports them |
| DC2 (image only) | Previous image | Timestamps return to `Date` objects: the DC2 symptoms come back. Acknowledgements reset by the fingerprint change do not return |
| Whole database | Restore the §1 snapshot to a new instance and repoint (last resort) | Loses staging changes made after the snapshot |

## 5a. Deferred contract step: 054 (post-acceptance, separately approved)

`database/aws/054_armory_history_contract.sql` is on branch `claude/fix-b8a-contract-054` only. It is **not** in the release image, so `migrate-db apply` cannot run it during this release. It drops `firearm_status_history_insert_managers` and revokes INSERT, UPDATE and DELETE on `firearm_status_history` from `authenticated`. Until it is applied, a firearm or inspection manager can still insert a firearm history row directly as themselves, as at 037. That includes a forged "Inspection result …" note (B8a-2 and ARM-17 stay open until 054). 054 does **not** drop the 042/052 JSON-preservation triggers. They are cheap and keep range history append-only for any writer, so they stay.

**Preconditions:**
- the B8a (or later) image is verified on staging (§4, S22a);
- the owner closes the image rollback window in writing;
- separate approval.

**Order:**
1. Merge the 054 branch.
2. `deploy-app.ps1 staging` with that commit. The code is unchanged, and its automatic rollback target is the B8a image, which is compatible with 054.
3. `migrate-db.ps1 staging -Action apply` (054 only).
4. Verify: `has_table_privilege('authenticated','public.firearm_status_history','insert')` → false; S22a (d) → permission denied.

**After 054, an image rollback below B8a requires the forward restore migration first** (`RELEASE-SAFETY-rollback-compatibility.md` §4 step 9). Every later image must contain 054.

## 6. Evidence template

| Step | Before: date / commit / digest | Before result | After: date / commit / digest | After result | Evidence link | Pass/Fail | Tester |
|---|---|---|---|---|---|---|---|
| Pre-flight 1–5 | | | | | | | |
| Migrations 038–046, 048–053 | | | | | | | |
| 054 contract (§5a, separate approval) | | | | | | | |
| S17 | | | | | | | |
| S18 | | | | | | | |
| S19 | | | | | | | |
| S20 | | | | | | | |
| S21 | | | | | | | |
| S22 | | | | | | | |
| S22a | | | | | | | |
| S23 (with S23-3 revised) | | | | | | | |
| S24 | | | | | | | |
| S1 … S16 | | | | | | | |

## 7. Known open items: not covered or not yet decided

- Notification delivery (B6 TRN-01/TRN-08) needs the separate infrastructure proposal and authorization.
- **Release safety (owner decisions).** (1) Resolved: 043 outbox duplicates after a re-upgrade are prevented by 046 (edited in place again). (2) The previous image's rifle routes return 500 after saving, on 037 as well. Fixing that for the old image needs a grant beyond 037, so it is not done. (3) The preflight kit on `claude/staging-preflight-20261020` still expects the reviewed 053. Update it before G2/G3: the 053 hash is now `76f6af92b373f89051473064581bd9e71f0935209749045ce1a357324800067c` and the 046 hash `5f4916fdbd8969e1da5ad176fe995b31e5d2ff1b1a7e326fbba7d4a2369a6991` (after the §5b status guard edit; previously `c00da25e…`); A.3 firearm insert after apply → `t` until 054; G3.6 after apply keeps `authenticated` INSERT/UPDATE/DELETE on `firearm_status_history`. Details: `RELEASE-SAFETY-rollback-compatibility.md`.
- TRN-26 data visibility: decided (own records; others within responsibilities) and implemented by TV; verified by S18.
- Notification fixes that do not need infrastructure (TRN-10, 13, 16, 19 silent failure, 35, and constant-time secret comparison) are on the separate branch `claude/fix-b6-notification-delivery`. That branch is **not** in this package; it waits for the B6 infrastructure decision.
- **DC/DC2 date and timestamp contract:** if production is AWS-native, valid certifications show as expired, and the DC2 symptoms (empty dashboard training lists, blank audit times, false range-save conflicts) are live. The hotfix candidate (`claude/hotfix-date-contract-candidate`) covers DC; folding DC2 in is recommended subject to S24. Not deployed.
- **ADM-07c:** how invited users get a verified email is an owner decision after S23-3 (revised) step 2.
- Information-disclosure items still open are in the audit branch's `security-backlog.md`.
- The native client's behaviour has to be verified in S2–S5, because the client code is not in the repository.
