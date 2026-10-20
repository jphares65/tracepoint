# Remediation batch F2: fleet authorization owner decisions

Base: `claude/integration-defects-20261020` (B0–B5 merged, `d5b8ea8`). This batch applies the owner decisions on the residual items B2 left open: inspection by role code, the empty inspection-role list, and issue reporting. It also withholds maintenance cost data from inspectors. It changes authorization only. The fleet safety-hold logic (`refreshFleetVehicle`, the vehicle PATCH clearance, the 043 outbox) belongs to the parallel batch F3 (migration 046) and is not touched here.

## Defects addressed

| # | Defect | Change |
|---|---|---|
| 1 | **Inspection eligibility differed between the API and the database.** The inspection route admitted holders of `fleet_rules.inspection_role_codes` and `manage_fleet_rules`, and admitted **every member** when the list was empty. RLS (018 insert, 040 field workflows and guard) allowed only `perform_fleet_inspections`/`manage_fleet`/admin. On AWS a role-code inspector got 404 or 500. In Supabase mode, any member could inspect. | One rule. An active member is eligible with `manage_fleet`, `administer_department` or `perform_fleet_inspections`. Otherwise: if the agency lists inspection roles, the member must hold one of them; if it lists none, the member needs Fleet access (`view_fleet`). The rule is implemented once in SQL, as `public.can_submit_fleet_inspection(department_id)` in `database/aws/045_fleet_inspection_eligibility.sql`, and mirrored in the API as `canSubmitFleetInspection(context, rules)` in `src/lib/tracepoint/fleet-server.ts`, which the inspection route now uses. Under 045, eligible members can read (session agency only) the rules, vehicles, required equipment and inspections. They can insert their own inspection on an agency vehicle. The 040 grants (`audit_events_insert_fleet`, `fleet_work_orders_read_inspectors`, `fleet_work_orders_insert_inspection_defects`, `fleet_equipment_update_inspectors`, `fleet_vehicles_update_field_workflows`) and the inspector branch of `guard_fleet_field_vehicle_update` now key on the helper instead of `perform_fleet_inspections`. The guard is otherwise unchanged; 040 is not edited. |
| 2 | **Inspectors received maintenance cost data.** The vehicle detail (web and mobile), the inspection response's `workOrder`, the issue response and the fleet report returned `labor_cost`, `parts_cost` and `total_cost`. Vehicle history returned the same fields inside audit `details` (`work_order`, `previous`, `current`). | Cost data goes only to callers with `manage_fleet`, `manage_fleet_maintenance` or `administer_department` (`canViewFleetCosts`; also platform administrators, as in the existing helpers). For everyone else, work orders are selected with the explicit non-cost column list `FLEET_WORK_ORDER_FIELDS_WITHOUT_COST`, and cost keys are also removed from the rows and from history details (`withoutFleetCosts`). This covers `GET /api/fleet/vehicles/[id]` (and its mobile re-export), `GET /api/fleet/report`, inspection `POST` and work-order `POST`. Work-order `PATCH` already requires maintenance access. **`vendor` is kept**: it says where the vehicle is being serviced, not what the service cost. |
| 3 | Equipment custody of another officer must stay private. | No change was needed. The new SQL suite confirms that an eligible inspector cannot see another officer's held equipment or its custody history, and cannot check it in. The holder still sees their own history. |
| 4 | **Issue reporting** was open in the API to anyone who could see the vehicle, but the database allowed it only for `manage_fleet_maintenance`/admin. Issue reporters could also send `nextServiceDate`/`nextServiceMileage`/`nextServiceHours`, which the route applied to the vehicle. | The work-order `POST` for `Issue` now requires maintenance access or the inspection rule (403 otherwise). Next-service fields are applied only for maintainers, and the response omits cost columns for non-maintainers. In the database, `fleet_work_orders_insert_inspection_defects` now allows `record_type in ('Inspection','Issue')` for eligible members. The row must be `Open`, self-authored, unassigned (`assigned_user_id`, `mechanic_name`, `vendor` null), and have no `scheduled_for`/`due_date`, costs, resolution or start/completion/return times. The odometer rules stay as they were: the route only moves the reading forward, and the guard refuses any decrease. The readiness refresh after a critical issue (Out of Service and open-issue count, including on an overridden Available vehicle) passes the guard for these users. Updating or deleting work orders still needs `manage_fleet_maintenance` or admin. |

Owner decisions taken while implementing (please confirm):

- **"Fleet access" is `view_fleet`**, as the instruction defines it. The `/fleet-management` page gate in `permissions.ts` also admits `manage_fleet_maintenance` and `manage_fleet_rules` on their own. Holders of only those permissions are **not** eligible inspectors when the list is empty. The default mechanic role has `view_fleet`, so mechanics are eligible inspectors when no roles are listed, and can then write the inspection due date. B2's validator previously asserted that a mechanic may not do this. That one assertion was removed from `validate-local-field-write-authorization.sql`; the new suite covers the listed-roles case, where a mechanic is still refused.
- **`view_fleet`-only viewers** (for example command staff) also no longer see costs in vehicle detail or the fleet report, because the cost rule names only `manage_fleet`, `manage_fleet_maintenance` and `administer_department`.
- `manage_fleet_rules` alone no longer passes the inspection route when inspection roles are configured. The database never allowed it.
- At the database level, eligible inspectors can still read work-order cost columns, because the 040 read policy is row-level. Only the API withholds them, and clients have no direct SQL access.

## Verification (local, synthetic; no remote systems)

PostgreSQL 16 on 127.0.0.1:55622, running as a non-root user. The schema is 79 Supabase migrations plus 44 AWS migrations, built with `bootstrap.mjs --aws`. 045 was applied twice to show it is idempotent. App sessions use `tracepoint_runtime` → `authenticated` with a subject and agency set for each transaction.

| Check | Before (no 045 / route code reverted) | After |
|---|---|---|
| New `scripts/validate-local-fleet-inspection-eligibility.sql` (run by the validator's AWS stage after the field-write suite) | Fails. Run block by block: "Eligible officer cannot read the fleet rules" (listed-role officer); an RLS error on the issue insert; "Issue reporter lowered the odometer" (no update rights at all); an RLS error on the eligible mechanic's inspection | Passes |
| Mutations of 045 (empty list admits everyone; role list ignored; cost check dropped; Inspection type dropped; guard keyed on the 040 permission) | — | Each fails with the matching assertion |
| `validate-local-field-write-authorization.sql` (B2) | — | Passes, with the mechanic due-date assertion removed as explained above |
| `db:validate-bootstrap` through the local shim | Control without 045: fails with "AWS-native fleet inspection eligibility failed: function public.can_submit_fleet_inspection(uuid) does not exist" | Passes: "79 ordered migrations and 44 AWS-native migrations" |
| New `src/lib/fleet/fleet-authorization-decisions.test.ts`, 5 tests on the real route handlers with an in-memory client | 5/5 fail (`canSubmitFleetInspection` missing; empty list admitted a no-access officer (201); cost fields present; issue accepted (201) without eligibility) | 5/5 pass |
| `fleet-integrity.test.ts` FLT-09 | Its issue report signed in with no permissions | Signs in with `view_fleet` (eligible), intent unchanged; passes |
| `npx tsc --noEmit` | — | 0 errors |
| `node scripts/run-application-tests.mjs` | — | 618 tests, 614 pass. The 4 failures are the `xlsx`-stub importer tests (environment). 14 embedded-PostgreSQL files ran no tests (cannot start as root), as on the integration branch |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | — | 348/349. The failure is the SheetJS round trip (environment) |
| `eslint` on changed files | — | Clean, except existing `no-explicit-any` errors in `fleet-server.ts` (12) and `work-orders/route.ts` (4). These are the same 16 B4 recorded; none are new |

The SQL suite covers:

- **Rule matrix:** `view_fleet` with no roles listed; a member with no Fleet access; a mechanic; an inactive member; a listed role; `view_fleet` with roles listed but the member not listed; a mechanic who is not listed; `perform_fleet_inspections`; a chief who is not listed; an inactive member with a listed role; a listed role held in another agency.
- **Positive flows:** a listed-role officer completes the full inspection side-effect sequence; issue reports with a forward reading and a readiness refresh to Out of Service (including on an overridden vehicle), in both agencies.
- **Negatives:**
  - every cost, assignee, schedule, resolution and time field on an issue;
  - closed issues, a forged author, a repair type;
  - updating or deleting work orders;
  - lowering the odometer, setting service dates, renaming the vehicle, returning an overridden vehicle to Available;
  - a forged inspector;
  - an ineligible subject inspecting, reporting, auditing or updating;
  - a foreign member in a forged session, an eligible member in another agency's session;
  - visibility of foreign vehicles or work orders, and an issue attached to a foreign vehicle;
  - a mechanic who is not listed changing the due date or inspecting.
- **Custody:** as described in item 3.

## Staging and production

- Runtime change: the inspection, work-order, vehicle detail and report routes. Schema change: `045` (new; `begin`/`commit`; `create or replace` and `drop policy if exists`/`create policy`).
- Ordering with F3: F3 adds `046`. If 046 re-creates `guard_fleet_field_vehicle_update`, it must keep `v_inspector := public.can_submit_fleet_inspection(old.department_id)`. Otherwise 046 would silently restore the 040 key.
- Apply to staging with `scripts/migrate-db.ps1 staging -Action status` (expect 045 pending after 040–043), then `apply`. Deploy the image.
- Reconciliation README §8, with `acceptance-<UUID>` tenants only:
  1. **S2:** an inspector-only user submits a Critical inspection. Expect 201, the vehicle Out of Service, and a work order with no cost keys in the response.
  2. Set `inspection_role_codes = {officer}` and submit as an officer without Fleet permissions. Expect 201, and the vehicle visible in the list.
  3. As a `view_fleet` user who is not listed, submit. Expect 403.
  4. Clear the list and submit as an officer without Fleet access. Expect 403 (404 under RLS). As a `view_fleet` user, expect 201.
  5. The eligible officer reports a Critical issue. Expect 201 and the vehicle Out of Service. Sending `totalCost`/`nextServiceDate` has no effect.
  6. Open vehicle detail and the fleet report as the inspector: there are no `labor_cost`/`parts_cost`/`total_cost` keys. As a fleet manager, the costs are present.
  7. **S10** (`rehearsal-tenant-negative`): still all-deny.
- Production needs separate authorization.

## Rollback

- Application: revert the commit.
- Schema: the ledger is hash-checked, so roll back with a **new** forward migration. It restores the 040 definitions (copy the `audit_events_insert_fleet`, `fleet_work_orders_read_inspectors`, `fleet_work_orders_insert_inspection_defects`, `fleet_equipment_update_inspectors` and `fleet_vehicles_update_field_workflows` policies and the `guard_fleet_field_vehicle_update` function from `database/aws/040_fleet_field_write_authorization.sql`), then runs:

  ```sql
  drop policy if exists fleet_rules_read_inspection_eligible on public.fleet_rules;
  drop policy if exists fleet_vehicles_read_inspection_eligible on public.fleet_vehicles;
  drop policy if exists fleet_equipment_read_inspection_eligible on public.fleet_vehicle_equipment;
  drop policy if exists fleet_inspections_read_inspection_eligible on public.fleet_vehicle_inspections;
  drop policy if exists fleet_inspections_insert_inspection_eligible on public.fleet_vehicle_inspections;
  drop function if exists public.can_submit_fleet_inspection(uuid);
  ```

  Records written under 045 stay valid.

## Process note

During the fail-before run, this batch used `git stash`. The stash is shared by every worktree, and F3 stashed at the same time, so the two batches' uncommitted changes were swapped. F2's worktree was restored from saved patches, and the patch was checked to be identical to the F2 changes that had landed in F3's worktree. The coordinator confirmed that both worktrees are separated again. Fail-before runs no longer use the stash.
