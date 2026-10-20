# Staging verification package: claude/integration-defects-20261020

**Status:** DRAFT for owner approval. Nothing in this package has been executed.

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

## 1. Pre-flight (read-only)

1. Record the current staging state:
   - ECS task definition revision and image digest: `aws ecs describe-services --cluster tracepoint-staging --services tracepoint-staging`. This is the **rollback target**.
   - `scripts/migrate-db.ps1 staging -Action status`. Expected: ledger present, 001–037 applied, 038–046 pending, no `MIGRATION_DRIFT`.
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
| 046 | `fleet_safety_hold_clearance` | F3 | Safety-hold clearance columns and guard (managers only, reason required); outbox stores the inspection's work order; reconciliation skips entries under 5 minutes old that were never attempted | 043 (045 optional) | **One-time data baseline on first apply:** vehicles with no outstanding critical condition are marked cleared, so historic, already-resolved critical work orders do not re-hold them. Preview the impact with the query in the F3 record **before** applying. |

**After applying**, run `migrate-db.ps1 staging -Action status` again. Expected: no pending files, no drift.

## 3. Image deployment (staging only)

1. Build from the exact integration commit with the existing native staging lane:

   ```powershell
   .\scripts\deploy-app.ps1 staging
   ```

   This produces the SHA-tagged `-aws-native-staging` image.
2. The script already enforces ECS steady state, healthy ALB targets, `/api/health` 200 and the exact image digest, and rolls back automatically on a deployment-safe smoke failure.
3. Record the new task-definition revision and image digest.

## 4. Acceptance tests (S1–S10, plus supplementary S11–S16)

Run every step **before** (current staging image and schema) and **after** (migrations and new image). A step passes only when the "after" result matches the expected result.

| ID | Scenario (synthetic users) | Expected after | Covers |
|---|---|---|---|
| **S1** | Invite a new user. On the website they set a password of at least 14 characters, enrol in MFA, and complete first sign-in. | Lands in the app; identity link becomes `active`; one `account_activated` audit row per membership | NEW-ADM-A, F1 password |
| **S2** | An inspector-only user (role with `perform_fleet_inspections`, not an administrator) submits an inspection with a Critical defect on a vehicle a manager set to Available (override active). Test web and native app. | 201; Critical work order exists; vehicle Out of Service with override kept; `audit.status` `recorded`; one `fleet_vehicle_inspected` audit row | NEW-01, FLT-01, B2 amendment |
| **S3** | An officer checks out an unassigned pool item, then returns it as `damaged`, through the native app. Then a second officer looks up the first officer's held item. | Check-out 200 and check-in 200; lifecycle becomes `out_of_service`; the second officer gets 404 | EQP-06, EQP-09, custody privacy |
| **S4** | Through the native app: scan a printed vehicle label, an equipment label, then a unit number, a serial, a duplicated serial, a firearm serial as an officer without firearm read, and a firearm the officer holds. | Labels and unit number resolve to the exact item; duplicate gives 409 and the app opens **no** item; no-read firearm gives a body identical to a non-existent value; held firearm gives `denied` | NEW-02, FLT-04, F4 |
| **S5** | Range day: save 3 scores; correct one and save again; set Packet = Ready, then enter a new score; save from a second browser with a stale page. | Correction saved and visible in `resultRevisions`; scoring works after Ready; the stale save gets a 409 reload prompt and nothing is silently overwritten. On the native app, confirm it tolerates `resultRevisions` and, if supported, sends `baseUpdatedAt`. | RNG-01, RNG-03, RNG-13 |
| **S6** | Notifications: *deferred to B6.* Infrastructure is not authorized in this package. Record the current behaviour only. | Documented as known open (TRN-01, TRN-08) | — |
| **S7** | A platform admin in Support Mode toggles a module off and on for a synthetic agency, then reloads. Then, outside Support Mode, opens the agency page. | Toggle persists, with a `department_feature_events` row; outside Support Mode the page shows the Support Mode guidance | NEW-ADM-C, F1 guidance |
| **S8** | Open Ammunition and Reconciliation as an armorer. | 200 with data and actor names | NEW-ARM-A |
| **S9** | As a plain officer, request another officer's certification and qualification data through the API. | *Pending owner decision in plan §6. Record the result only.* | TRN-26 |
| **S10** | Run the tenant-negative suite (`/api/internal/rehearsal-tenant-negative` harness), plus the cross-tenant checks from S2–S4 with a user in a second synthetic agency. | Every cross-tenant attempt is denied or returns `unknown`; no data from the other agency | Tenant isolation |
| S11 | Simulate an audit outage on staging only. The ops procedure in the B4 record makes the delivery function fail for the synthetic tenant. Submit a Critical inspection, then restore. | 201 with `audit.status` `pending`; vehicle Out of Service; the next inspection or a manager's fleet-list load reconciles; exactly one audit row, with the correct `work_order_id` (F3) | B4, F3 |
| S12 | Critical hold: a mechanic completes or cancels the Critical work order from S2. | Vehicle stays Out of Service. It is released only by a passing re-inspection, or by a manager's clearance with a reason (audited). A clearance without a reason is rejected (F3). | F3 |
| S13 | Re-import a personnel CSV for existing synthetic members: blank badge/rank/unit cells, no Active column, one explicit `Active=No`, one row for the agency's only Administrator with `Active=No`, and one row run by a `manage_users` non-administrator targeting an Administrator. | Stored values kept; roles unchanged and no Officer added; the explicit No deactivates the member and disables their Cognito account; the final-Administrator and non-administrator cases are refused | ADM-04, F1 |
| S14 | Assign Password with 13 and with 14 characters; an existing user with an older shorter password signs in. | 13 rejected with a clear message; 14 accepted; the existing user signs in without a forced reset | F1 |
| S15 | An inspector (not a maintenance user) opens vehicle detail, the mobile vehicle view and the inspection response; a fleet manager does the same. | No `labor_cost`, `parts_cost` or `total_cost` for the inspector; costs present for the manager | F2 |
| S16 | An eligible officer (`view_fleet`, empty inspection-role list) reports a Critical issue. Then configure the inspection-role list without that officer's role and retry. | First: 201, vehicle Out of Service, no management access gained. Second: refused in both the API and the DB | F2 |

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
| 046 | New migration: drop `fleet_vehicles_safety_hold_clearance_guard` and its function, and re-run 043's three outbox function definitions (F3 record). The columns can stay, inert. | Vehicles held under the new rule keep their status until changed |
| Whole database | Restore the §1 snapshot to a new instance and repoint (last resort) | Loses staging changes made after the snapshot |

## 6. Evidence template

| Step | Before: date / commit / digest | Before result | After: date / commit / digest | After result | Evidence link | Pass/Fail | Tester |
|---|---|---|---|---|---|---|---|
| Pre-flight 1–5 | | | | | | | |
| Migrations 038–046 | | | | | | | |
| S1 … S16 | | | | | | | |

## 7. Known open items: not covered or not yet decided

- Notification delivery (B6 TRN-01/TRN-08) needs the separate infrastructure proposal and authorization.
- TRN-26 data visibility is pending an owner decision.
- QR resolution for officers eligible only through a listed inspection role:
  - A vehicle scan returns `denied`, because the QR decision uses the permission list rather than `can_submit_fleet_inspection` (F2 note).
  - This needs a small alignment fix before S4/S16 sign-off.
- The native client's behaviour has to be verified in S2–S5, because the client code is not in the repository.
