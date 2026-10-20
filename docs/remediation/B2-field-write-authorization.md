# Remediation batch B2 — field-write authorization (AWS-native)

Base: `claude/fix-b0-proof-foundation` (on `555f061`). Scope and priorities come from `docs/operational-audit-20261020/reconciliation-20261020/README.md` §5 on branch `claude/tracepoint-operational-audit-w567t8`, with evidence in R7 (T1–T4), R5 (NEW-01, EQP-06), R2 (NEW-ARM-A) and R6 (NEW-ADM-C).

In AWS-native mode a route's `admin` client is the subject's RLS-bound PostgreSQL client. This batch grants only the writes the existing routes already authorize, and fixes two routes that assumed Supabase-only APIs. Supabase-mode code paths are unchanged.

## Defects addressed

| ID | Defect | Change |
|---|---|---|
| NEW-01 (Critical) | An inspector's inspection saved only the inspection row. Equipment and vehicle updates touched 0 rows, the work order and the `audit_events` insert were refused, and the route returned 500 after committing. The vehicle stayed Available. Fleet managers without `administer_department` (and mechanics) failed `auditFleet` on every fleet write. | `database/aws/040_fleet_field_write_authorization.sql`, agency-bound to `tracepoint_auth.department_id()`: (1) `audit_events_insert_fleet`: actor = subject, `fleet_*` actions on `fleet_vehicle`/`fleet_rules` entities, for `manage_fleet`, `manage_fleet_maintenance`, `manage_fleet_rules` and `perform_fleet_inspections`. (2) Inspectors may read work orders (the inspection response and the status refresh need the vehicle's open defects; the vehicle detail API already returns them to anyone who can see the vehicle). (3) Inspectors may insert only an `Inspection` work order that is `Open`, authored by themselves, has no assignee, cost, resolution or completion, and references a vehicle of the same agency. (4) Inspectors may update vehicle equipment, and inspectors or mechanics may update vehicles, through new policies. A `BEFORE UPDATE` guard limits subjects without `manage_fleet`/`administer_department` to the columns their workflow writes. Inspectors: status, issue count, mileage and hours (never lowered), inspection due date. Mechanics: status, issue count, readings, last/next service fields. Equipment: status only (Current/Attention/Out of Service). Status can never become or leave `Retired`, nor change while a manual override is active, and `updated_by` cannot be forged. General fleet editing still requires `manage_fleet`. **No handler change** (the transaction structure is B4's, FLT-08). |
| EQP-06 (High) | Officers could not use self-service custody: unassigned stock was invisible (check-out 404) and check-in updated 0 rows (409). | The route authorizes any active member of an agency with Equipment Readiness enabled: check out available active equipment to themselves, check in equipment they hold. `database/aws/041_equipment_self_custody.sql` adds (1) a read policy for available equipment (active, unassigned to anyone, any vehicle or any location; same agency, active member, module enabled), and (2) the `SECURITY DEFINER` function `operate_equipment_self_custody`, which applies exactly the route's transfer and condition note under a row lock and checks subject, session agency, active membership and module. Members get **no** direct update rights on assets or custody history. `src/app/api/equipment/custody/route.ts` (mobile re-exports it) calls the function in aws-native mode after its existing checks. Responses are unchanged. |
| NEW-ARM-A (High) | `/api/armory/ammunition` and `/reconciliations` called `admin.auth.admin.listUsers`, which the PostgreSQL client lacks, so they returned a TypeError 500. | Ported the `codex/production-tls-20260919` approach into `src/lib/armory/ammunition-user-names.ts`: in aws-native mode, names come from `profiles` for the referenced actor ids only. Supabase mode keeps the `listUsers` lookup, as `personal-rifle-server.ts` does. |
| NEW-ADM-C (High) | `/api/super-admin` PATCH upserted `department_features` directly. `authenticated` has only SELECT, so it returned 500 in support mode and 403 outside it (no membership). The read was tenant-scoped. | When `TRACEPOINT_DATA_PROVIDER=postgres` (the same switch as `/api/platform/support-mode`), GET and PATCH resolve access with `resolvePlatformAdminAccess` and use the existing repository: `get_platform_entitlements` and `set_platform_entitlement` (aws/015, platform administrators only). PATCH maps P0002 to 404 and 42501 to 403. The previously unused `setEntitlement` wrapper is now called. Supabase mode is unchanged. |

## Verification (local, synthetic; no remote systems)

The environment was a disposable PostgreSQL 16 on 127.0.0.1 (non-root), with the schema built from `supabase/migrations` plus `database/aws`. App calls ran with `session_user = tracepoint_runtime`, `set local role authenticated` and per-transaction subject/agency, exactly as `withPostgresAuthorization` does. The route-level harness ran the **real route handlers** (inspections, work orders, custody, ammunition, reconciliation) through the real `PostgresDataClient`, with only `resolveServerAccess` stubbed to return the subject's context.

| Check | Before | After |
|---|---|---|
| R7 T1, inspector inspection statements | `INSERT 0 1`, `UPDATE 0`, work-order RLS error, `UPDATE 0`, audit RLS error | All succeed. Vehicle Out of Service, mileage 1200, due date set, AED Out of Service, 1 work order, 1 audit |
| R7 T2, fleet manager | Audit RLS error | All succeed |
| R7 T3, officer custody | `(0 rows)`, `UPDATE 0` ×3 | Pool lookup returns EQ-1. Check-out and damaged check-in succeed with history notes. Other officer gets null / `UPDATE 0`. Cross-tenant gets 42501 |
| Route harness: inspector Critical inspection | 500 (handler threw "Audit record failed"); vehicle Available | 201; work order created; vehicle **Out of Service** |
| Route harness: mechanic completes the work order | (not reachable) | 200; status recomputed and audited |
| Route harness: fleet manager inspection | 500 after commit | 201; vehicle Available after all items pass |
| Route harness: officer custody GET / check-out / damaged check-in | 404 / 404 / 409 | 200 / 200 / 200 (out_of_service) |
| Route harness: second officer on held item | 404 | 404 (unchanged) |
| Route harness: ammunition ledger and reconciliation GET | 500 TypeError | 200 |
| `set_platform_entitlement` as tracepoint_runtime | — | Platform admin writes; agency admin gets 42501; unknown agency gets P0002 |
| New `scripts/validate-local-field-write-authorization.sql` (run by the validator's AWS stage) | Fails: "Inspector equipment condition update failed" | Passes: positive inspector, mechanic, fleet manager and custody flows, and negatives listed below |
| Mutation checks on the SQL test (guard dropped, policy loosened, policy removed) | — | Each fails with the matching assertion |
| `db:validate-bootstrap` via local shim | — | Passes, with 79 + 40 migrations and the field-write stage. With 040/041 removed it fails with "AWS-native field-write authorization failed" |
| Unit tests (`ammunition-user-names.test.ts`, `mobile-custody-route.test.ts`, `super-admin-route.test.ts`) | 3 fail (route code reverted) | Pass |
| `tsc --noEmit` | — | 0 errors |
| `run-application-tests.mjs` | — | 558/562 pass. The 4 failures are the `xlsx`-stub tests (environment). The 11 embedded-PostgreSQL files report "ran no tests" because PostgreSQL cannot start as root here. Same as B0 |
| `scripts/*.test.mjs` | — | 348/349; the SheetJS round trip (environment) |
| `eslint` on changed files | — | Clean (the two ammunition routes gained the file-level legacy `any` disable, as on production-tls) |

The SQL negatives cover:

- Inspector: rename, retire, clear or bypass an override, lower the odometer, change service dates, forge `updated_by`, rename or remove equipment.
- Inspector work orders: repair-type, closed or forged-author work orders; editing existing work orders.
- Inspector audit: non-fleet audit, forged audit actor.
- Cross-tenant: a foreign vehicle, equipment, work order or audit; a work order attached to a foreign vehicle; a foreign inspector in its own session and in a forged session; an inspector acting outside the session agency.
- Inactive inspector and unrelated officer: no vehicle, equipment, work-order or audit access.
- Mechanic: may not change the inspection due date or vehicle details.
- Custody: no visibility of held, out-of-service or foreign equipment. No check-in or check-out of another officer's item. No direct asset or history updates. Cross-tenant and inactive members get 42501. A disabled module gives no pool and 42501. Unserviceable check-out gives 22023.
- Regression: fleet manager general edit still works.

## Residual items (not changed; owner decision or other batch)

- **Inspection by role code or `manage_fleet_rules` only.** The route also admits roles listed in `fleet_rules.inspection_role_codes`, and admits **everyone** when that list is empty, plus `manage_fleet_rules` holders. RLS has never allowed those users to see vehicles or insert inspections, so they get 404/500 before any write; no half-written state results. Matching the DB to this rule, especially the "empty list = everyone" behaviour, is a product decision.
- **Issue reporting** (`work-orders` POST with type Issue) is open in the route to anyone who can see the vehicle. The DB allows it only for `manage_fleet_maintenance`/admin. Unchanged; it fails cleanly before any write.
- **Custody lookup of an item held by someone else** returns 404 in aws-native mode, not `custody: "assigned"`. Members are deliberately not given visibility of other people's equipment.
- **Ammunition names**: under RLS, `profiles` shows other users only to `manage_users`/`manage_equipment`/admin. An armorer with only `manage_firearms` sees "Unknown User" for other actors (the same limitation as production-tls). Widening `profiles` was not done.
- Mechanic mileage may still be lowered (FLT-02, B4). Handler atomicity is B4 (FLT-08).
- Attachment uploads for inspection evidence by inspectors (R5) were not verified here.

## Staging and production

- Runtime change: the four routes above. Schema change: `040` and `041` (new files; idempotent with `drop … if exists` / `create or replace`).
- Apply to staging with `scripts/migrate-db.ps1 staging -Action status` (expect 040 and 041 pending; B0's 038 too if not yet applied), then `apply`. The `SECURITY DEFINER` function relies on the migration role owning `equipment_assets`/`equipment_asset_assignments`, as the 017/031 functions already do.
- Then run README §8: **S2** (inspector-only Critical inspection → work order, Out of Service, 2xx), **S3** (officer check-out then return via mobile; history shows both), **S7** (platform admin toggles a module; persists after reload), **S8** (Ammunition and Reconciliation 200), and **S10** (`rehearsal-tenant-negative` still all-deny). Run each before deploying the image (to confirm the defect) and after.
- Production needs separate authorization.

## Rollback

- Revert the commit (image) to restore the route behaviour.
- Schema rollback, if needed:
  - **040:** `drop trigger fleet_vehicles_field_update_guard on public.fleet_vehicles; drop trigger fleet_vehicle_equipment_field_update_guard on public.fleet_vehicle_equipment; drop function public.guard_fleet_field_vehicle_update(); drop function public.guard_fleet_field_equipment_update(); drop policy audit_events_insert_fleet on public.audit_events; drop policy fleet_work_orders_read_inspectors on public.fleet_work_orders; drop policy fleet_work_orders_insert_inspection_defects on public.fleet_work_orders; drop policy fleet_equipment_update_inspectors on public.fleet_vehicle_equipment; drop policy fleet_vehicles_update_field_workflows on public.fleet_vehicles;`
  - **041:** `drop function public.operate_equipment_self_custody(uuid,uuid,text,text,text); drop policy equipment_assets_select_custody_pool on public.equipment_assets;`
- Dropping only removes the new grants. Existing manager and administrator access is unaffected.

## Integration amendment (B4 compatibility)

B4 (FLT-01) requires that a manual status override never mask a critical defect. The readiness refresh, running as the inspector, therefore has to move an overridden Available/Attention vehicle to Out of Service. As first written, the 040 guard refused any status change on an overridden vehicle for non-managers. Combined with B4, that would have blocked the critical safety status.

The guard now allows exactly one override-crossing change for field workflows: Available/Attention → Out of Service, together with `status_reason`. Every other status or reason change on an overridden vehicle is still refused, including any move back toward availability.

`validate-local-field-write-authorization.sql` covers the change:

- the allowed transition;
- refusal of Maintenance, of a reason-only edit, and of a return to Available.

| Check | Original 040 guard | Amended guard |
|---|---|---|
| Validator shim (79 + 40 migrations) | **Fails**: "fleet vehicle change forbidden" on the Out of Service transition | Passes |
