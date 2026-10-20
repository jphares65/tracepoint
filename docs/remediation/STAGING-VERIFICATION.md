# Staging verification package: claude/integration-defects-20261020

**Status:** Ready for owner review. Nothing in this package has been executed.

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
| G2 Migration ledger | `migrate-db.ps1 staging -Action status`: ledger present, no drift, **001–037 applied**, only 038–046 and 048–050 pending | Status output |
| G3 Hard schema dependencies | 028–031 (custody, used by the F6b QR lookup and the custody API) and 033–037 applied **before** the image. 045 applied **before** the image: every QR scan calls `can_submit_fleet_inspection` (F5) and returns 500 without it. 039 applied before the image (B1 first-login activation). | Ledger rows |
| G4 Data-impact previews (read-only) | Run and record: (a) the 046 safety-hold preview query (F6a record), which counts vehicles newly held when 046 lands; (b) the equipment lifecycle constraint check (§1.4); (c) the date-defect checks Q1–Q9 (hotfix record), including **Q3 queued false-"Expired" emails**. The email dispatcher stays off. | Query outputs |
| G5 Snapshot | Manual RDS snapshot taken and `available` | Snapshot ARN |
| G6 Native client | A native client build pointed at staging is available, with synthetic accounts for the roles in S1–S17. Without it, S2–S5 and S17 can only be run on the web, and the native client checklist (C1–C24, `api-contract-changes` inventory) stays **unverified**. | Build ID |
| G7 Owner approval | The owner approves this package and the exact commit | Written approval |

## 0b. Defect status tracking

Each defect moves through four separate stages:

1. **Found:** evidence in the reconciliation.
2. **Fixed in code:** branch, commit and CI.
3. **Validated in staging:** the S-step "after" result, recorded in §6.
4. **Confirmed resolved in production:** a post-deployment check, only after separate production authorization.

This package can move items to stage 3 only. Nothing in this document moves any defect to stage 4.

## 1. Pre-flight (read-only)

1. Record the current staging state:
   - ECS task definition revision and image digest: `aws ecs describe-services --cluster tracepoint-staging --services tracepoint-staging`. This is the **rollback target**.
   - `scripts/migrate-db.ps1 staging -Action status`. Expected: ledger present, 001–037 applied, 038–046 and 048–050 pending, no `MIGRATION_DRIFT`.
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
| 042 | `range_packet_ready_is_not_final` | B3 | Ready no longer locks the day in the DB triggers | — | |
| 043 | `fleet_inspection_audit_outbox` | B4 | Audit outbox, its trigger and delivery/reconciliation functions | 040 | |
| 044 | `personnel_import_preservation` | F1 | Blank fields keep stored values; no automatic Officer role; Administrator-only rule on import lifecycle | 039 | Restates 039's function with one added check |
| 045 | `fleet_inspection_eligibility` | F2 | `can_submit_fleet_inspection`; aligned inspection and issue policies; guard uses the helper | 040 | |
| 046 | `fleet_safety_hold_clearance` | F3, F6a | Safety-hold clearance columns and guard (managers only, reason required, refused while a critical work order is open); critical inspections take the vehicle Out of Service whatever the automation settings; outbox stores the inspection's work order; reconciliation skips entries under 5 minutes old that were never attempted | 043 (045 optional) | **Edited in place by F6a** (never applied anywhere; staging and production stop at 037). **One-time data baseline on first apply:** only vehicles with a later passing inspection after their latest critical condition, and no open critical work order, are marked cleared, each with an `audit_events` row (actor null). Vehicles whose only evidence is a completed or cancelled work order are **held** until re-inspection or a manager clearance. Run the per-agency preview query in the F6a record **before** applying. |
| 048 | `training_record_visibility` | TV | Own-row-or-permission read policies on certifications, agency-training attendee/requirement/certificate tables, qualification results, drill results, range roster, remediation recommendations, range packets and qualification attachments | — | 047 is reserved for the separate B6 branch; the gap is allowed by the runner (strictly increasing versions only) |
| 049 | `equipment_separated_holder` | B9 | Equipment trigger validates the holder only when it changes (items held by separated members can go out of service, be removed or returned; new assignments to inactive members are still refused); removal reason recorded in history; **profiles read policy:** `manage_users`, `manage_equipment` or `administer_department` holders can read a former member's profile in their agency (owner decision pending) | 038 | Apply before or with the image, or separated holders show as "Unnamed Officer" |
| 050 | `training_closeout_records` | B7 | Closeout refuses Completed/Passed without Present; issue date is the event date in the department zone; records which credentials a closeout superseded (`training_certifications.superseded_by_training_event_id`) so reopen restores exactly those | — | Additive. Before deploy, run the B7 record's upcoming-event drift review query (TRN-02) |
| 051 | `range_instructor_line_actions` | B10 | Ready-day trigger lets `score_range_days` holders change attendance and add present walk-ups on open days (removal, officer and firearm changes stay planning-only); instructors may insert qualification evidence and its audit row; `attachments_select` lets the officer of an imported result read its evidence | 042, 048 | **Before applying:** run `scripts/qualification-status-snapshot.sql` and `scripts/qualification-status-diff.mjs` (B10 record) and record per-agency status changes. Close out completed range days first, or open-day passes stop counting |
| 052 | `armory_separation_of_duties` | B8 | Triggers block self-decision of off-duty requests, self-review/reinstatement of personal rifles and self-certification of ammunition reconciliations; a second person may now certify (update policy); `authenticated` may insert its own personal-rifle history rows (narrow policy, **owner review**); a failed off-duty inspection marks the request Non-Compliant | — | Apply with or before the image: without it, second-person certification and every personal-rifle action fail on AWS-native |

**After applying**, run `migrate-db.ps1 staging -Action status` again. Expected: no pending files, no drift.

## 3. Image deployment (staging only)

1. Build from the exact integration commit with the existing native staging lane:

   ```powershell
   .\scripts\deploy-app.ps1 staging
   ```

   This produces the SHA-tagged `-aws-native-staging` image.
2. The script already enforces ECS steady state, healthy ALB targets, `/api/health` 200 and the exact image digest, and rolls back automatically on a deployment-safe smoke failure.
3. Record the new task-definition revision and image digest.

## 4. Acceptance tests (S1–S10, plus supplementary S11–S22)

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
| **S9** | As a plain officer, request another officer's certification and qualification data through the API. | *Pending owner decision in plan §6. Record the result only.* | TRN-26 |
| **S10** | Run the tenant-negative suite (`/api/internal/rehearsal-tenant-negative` harness), plus the cross-tenant checks from S2–S4 with a user in a second synthetic agency. | Every cross-tenant attempt is denied or returns `unknown`; no data from the other agency | Tenant isolation |
| S11 | Simulate an audit outage on staging only. The ops procedure in the B4 record makes the delivery function fail for the synthetic tenant. Submit a Critical inspection, then restore. | 201 with `audit.status` `pending`; vehicle Out of Service; the next inspection or a manager's fleet-list load reconciles; exactly one audit row, with the correct `work_order_id` (F3) | B4, F3 |
| S12 | Critical hold: a fleet manager tries to clear the hold while the Critical work order from S2 is open; then a mechanic completes or cancels it. Repeat S2 with the agency's automatic vehicle status and critical-issue settings turned off. | Clearance refused (409, the detail page names the open work order). Vehicle stays Out of Service after completion. It is released only by a passing re-inspection, or by a manager's clearance with a reason (audited). A clearance without a reason is rejected. With the settings off, the vehicle still goes Out of Service (F3, F6a). | F3, F6a |
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

## 5. Rollback

The primary rollback is the **image**. Run `deploy-app.ps1 staging -RollbackTaskDefinitionArn <pre-flight revision>`.

The migrations are additive and were designed to stay in place under the previous image. Schema rollback SQL for each migration is in its batch record. The ledger is hash-checked, so any schema rollback is a **new** forward migration; applied files are never edited.

| Item | Rollback | Caution |
|---|---|---|
| Image (any batch) | Previous task-definition revision | — |
| B3 under the old image | — | The old web code drops `resultRevisions` on its next pilot save. **Before** an image rollback, export `pilot_range_workspaces.workspace->'resultRevisions'` for the synthetic tenants, and freeze range edits until re-upgrade. |
| B1/B1a/F1 under the old image | — | 039 fixes the import lifecycle, but the old image's import ignores the Active safeguards. **Pause personnel imports** while rolled back. |
| B4 under the old image | — | 043's trigger keeps queuing audit entries and holding critical vehicles Out of Service (the safe direction). Pending entries reconcile after re-upgrade (ops SQL in the B4 record). |
| F2 under the old image | — | The old API admits all members to inspections when the role list is empty, but 045 refuses them in the DB. The request fails cleanly before any write. |
| 038 | None needed (superset) | |
| 039 | `grant execute on function public.create_department_with_owner(text,text,text,text,text,text) to authenticated;` and `drop function tracepoint_auth.activate_cognito_identity_on_first_login(text,text,uuid);` | Leave the 42702 correction in place |
| 040, 041 | SQL in `B2-field-write-authorization.md` § Rollback | |
| 042 | Re-run the old trigger bodies as a new migration (B3 record) | Re-locks Ready days |
| 043 | SQL in `B4-fleet-integrity.md` § Rollback, after delivering or exporting pending outbox rows | |
| 044 | Re-run the `010`/`039` function bodies as a new migration (F1 record) | |
| 045 | New migration restoring the 040 definitions, then drop the 045 objects (F2 record) | |
| 046 | New migration: drop `fleet_vehicles_safety_hold_clearance_guard` and its function, and re-run 043's `enqueue_fleet_inspection_audit` and three outbox function definitions (F3, F6a records). The columns and baseline audit rows can stay, inert. | Vehicles held under the new rule keep their status until changed |
| 051 | New migration: re-run 042's `protect_pilot_range_workspace_mutation()` body, drop `attachments_insert_qualification_evidence` and `audit_events_insert_qualification_evidence`, recreate 048's `attachments_select` (B10 record) | Statuses revert with the image; stored `firearmTypeSnapshot` is inert |
| 052 | New migration: drop the three triggers and functions, drop `personal_rifle_history_insert_actor` and revoke the insert grant, recreate the earlier `ammunition_reconciliations_update`, re-run the 202608170005 body of `record_off_duty_firearm_inspection_internal` (B8 record) | Restores the AWS defects: second-person certification and rifle history fail |
| Whole database | Restore the §1 snapshot to a new instance and repoint (last resort) | Loses staging changes made after the snapshot |

## 6. Evidence template

| Step | Before: date / commit / digest | Before result | After: date / commit / digest | After result | Evidence link | Pass/Fail | Tester |
|---|---|---|---|---|---|---|---|
| Pre-flight 1–5 | | | | | | | |
| Migrations 038–046 | | | | | | | |
| S17 | | | | | | | |
| S18 | | | | | | | |
| S19 | | | | | | | |
| S20 | | | | | | | |
| S21 | | | | | | | |
| S22 | | | | | | | |
| S1 … S16 | | | | | | | |

## 7. Known open items: not covered or not yet decided

- Notification delivery (B6 TRN-01/TRN-08) needs the separate infrastructure proposal and authorization.
- TRN-26 data visibility is pending an owner decision.
- Notification fixes that do not need infrastructure (TRN-10, 13, 16, 19 silent failure, 35, and constant-time secret comparison) are on the separate branch `claude/fix-b6-notification-delivery`. That branch is **not** in this package; it waits for the B6 infrastructure decision.
- **DC date contract:** if production is AWS-native, valid certifications currently show as expired. Consider prioritising S17, and check production read-only for this symptom.
- The native client's behaviour has to be verified in S2–S5, because the client code is not in the repository.
