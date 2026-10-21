# Remediation batch B4: fleet integrity

Base: `claude/fix-b0-proof-foundation`, which is stacked on `codex/staging-mobile-api-release-20261007` @ `555f061`. Evidence for the findings is in `docs/operational-audit-20261020/reconciliation-20261020/R5-fleet-equipment.md` (T1–T4 and T8) and `evidence/fleet-equipment.recon.test.ts`.

There are two commits:

1. `ff921c2`: FLT-01, FLT-02, FLT-08 (first version) and FLT-09.
2. The owner rework, which is approved for integration and testing but **not for deployment**. It covers:
   - an inspection audit outbox (AWS migration `043`);
   - safety-preserving handling of critical inspections;
   - audited odometer corrections.

B4 adds no RLS policy on existing tables and changes no grant or audit authorization. Batch B2 owns those (`040`/`041`; see *Integration with B2*).

## Owner requirements (rework)

| # | Requirement | How it is met |
|---|---|---|
| 1 | A failed audit-log operation must never return a vehicle with an unresolved critical defect to Available. | Audit failures no longer reverse anything (2). In the same transaction as the inspection, the outbox trigger takes an Available or Attention vehicle Out of Service when the inspection has a critical defect. `refreshFleetVehicle` treats a critical inspection that has no defect work order as an unresolved critical defect, so a later refresh cannot release the vehicle either. |
| 2 | Preserve the inspection and safety status, and clearly report any audit failure. | The inspection route returns **201** with `audit: { status: "pending", message }` (queued) or `audit: { status: "unrecorded", message }` (bridge mode, nothing could queue it). It returns `audit: { status: "recorded" }` only when the audit row exists. Failures are logged on the server. |
| 3 | Durable retry and reconciliation, preferably a transactional outbox. | `public.fleet_audit_outbox`. An `AFTER INSERT` trigger on `fleet_vehicle_inspections` writes the pending row in the inspection's transaction. `deliver_fleet_audit_outbox(inspection_id, details)` is idempotent. `deliver_pending_fleet_audit(department_id)` reconciles. Both are called by the app (see below) and can be run by ops. |
| 4 | Never silently discard an audit failure or report the workflow as audited. | Each failed delivery increments `attempts` and stores `last_error` on the outbox row. The response says pending or unrecorded, and the server logs the failure. |
| 5 | Managers can still correct odometer errors, with validation and auditing. | Both manager vehicle PATCH endpoints validate readings: whole-number mileage, hours from 0 to 10,000,000. Lowering either reading requires `mileageCorrectionReason`, and the change is audited as `fleet_odometer_corrected` with the previous and new values and the reason. The web edit form asks for the reason only when a reading is lowered. Increases are unchanged. |
| 6 | Regression tests for audit failures, safety status and recovery. | See *Verification*. |

## Defects addressed

| ID | Defect | Change |
|---|---|---|
| FLT-01 (Critical) | Any manual status change set `status_override_active = true`, and nothing cleared it. `refreshFleetVehicle` then skipped automation, so a later Critical inspection defect left the vehicle **Available**. The fleet-list PATCH never ran readiness. | While an override is active, `refreshFleetVehicle` can only **escalate**: an overridden Available or Attention vehicle with an open critical condition becomes Out of Service. Manager-set Maintenance, Out of Service and Retired are kept, and the override is never cleared automatically. The list PATCH now runs readiness. `043` also applies the escalation inside the inspection transaction (see the deviation below). |
| FLT-02 (High) | Work orders and issue reports overwrote the odometer; an old work-order edit rolled it back. | Work orders only move mileage and hours forward. The work order keeps its own reading. `last_service_*` comes from the saved work order. |
| FLT-09 (Medium) | Blank or null mileage was saved as 0. | `optionalNumeric()`: blank means not provided, for inspections, work orders and both vehicle PATCH endpoints. |
| FLT-08 (High) | The inspection write was not atomic and failures were hidden. | Every side effect is checked. **Critical inspections are never reversed.** If equipment status, the defect work order, the vehicle readings or the readiness refresh fails, the inspection is kept and the vehicle is held Out of Service: `holdOutOfService` writes only `status`, `status_reason` and `updated_at`, and only to move Available or Attention to Out of Service. The audit entry is still delivered. The response is `500 { ok:false, error, inspection, workOrder, vehicleOutOfService, audit }`, and its message says what was saved and "Do not submit the inspection again". If the hold also fails, the message says not to use the vehicle. **Non-critical inspections** keep the earlier reversal. On AWS, subjects cannot delete inspections, so the record stays; in that case the response says so and the inspection's audit entry is still delivered. |
| (new) | The list PATCH wrote an unselected `status_override_active` as NULL on PostgreSQL. | It is written only when the status changes. |
| FLT-19 / FLT-20 (Low) | Editable open-issue count; the two PATCH endpoints differ. | Partly fixed: the count is recomputed, and both endpoints now refresh readiness, treat blank readings the same way, and validate and audit corrections. `[vehicleId]` still does not validate `status`. The Open Issues form field remains. |

### Migration `database/aws/043_fleet_inspection_audit_outbox.sql`

The migration is idempotent and wrapped in `begin`/`commit`. It contains:

- **`public.fleet_audit_outbox`**:
  - Columns: `id`, `department_id`, unique `inspection_id` (foreign key with cascade), `vehicle_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `details`, `created_at`, `delivered_at`, `audit_event_id`, `attempts`, `last_error`.
  - A pending index.
  - RLS is on. There are no DML grants. In-agency `manage_fleet` and `administer_department` holders get `select`.
- **Trigger `fleet_vehicle_inspections_audit_outbox`** (`SECURITY DEFINER`, fixed `search_path`):
  - The actor is `inspector_user_id`, or else `tracepoint_auth.subject_id()`.
  - Details are `{inspection}`, matching the old app audit.
  - For a critical inspection, when the department rules allow it (`status_automation_enabled`, `critical_issue_out_of_service`), the trigger sets an Available or Attention vehicle to Out of Service with a `status_reason`.
- **`deliver_fleet_audit_outbox(p_inspection_id, p_details)`**:
  - Allowed when the caller is in the session agency, is a member, and is either the inspection's actor or holds `manage_fleet` or `administer_department`.
  - Locks the row (`FOR UPDATE`). If the row is already delivered, it returns the existing audit id.
  - `work_order_id` is accepted only if it is an Inspection work order for the same agency and vehicle. `support_mode` is computed on the server. `reconciled_by_user_id` is added when the caller is not the actor.
  - If the audit insert fails, it records `attempts` and `last_error` and returns NULL.
- **`deliver_pending_fleet_audit(p_department_id)`**:
  - Works only for the session agency and requires membership.
  - Managers deliver up to 100 pending rows per call; other members deliver only their own rows.
  - Each row is handled in its own exception block. The function returns `{delivered, failed, pending}`.
- **`fleet_audit_outbox_deliver_internal`**: not executable by any client role.
- **Grants**: execute is revoked from `public`, `anon`, `service_role` and `tracepoint_runtime`, and granted to `authenticated` only.

**Deviations from the proposed design, with reasons:**

- **The trigger also takes Available or Attention vehicles Out of Service.** B2's `040` guard allows a non-manager to change `status_reason` only together with the Available or Attention → Out of Service transition, and allows no `status_override_active` writes. So the route alone cannot always record the incomplete step, or keep a vehicle out of service after a failed work order. Doing it in the inspection's transaction makes requirement 1 hold for every role, independent of later steps.
- **`refreshFleetVehicle` counts "latest inspection critical, and no Inspection work order created since" as a critical condition.** This applies only when the department creates defect work orders. It is what stops a later refresh from releasing a vehicle whose defect work order failed. Closing or cancelling the work order still releases the vehicle, as before.
- **`deliver_pending_fleet_audit` lets non-managers reconcile their own entries.** The design restricted it to managers. Inspectors already have this authority row by row through `deliver_fleet_audit_outbox`. Without it, an agency whose fleet managers rarely open the app would never retry inspector entries.
- **`deliver_fleet_audit_outbox` does not take arbitrary details from the caller.** Only a validated `work_order_id` is used, and `support_mode` comes from the database, so the audit cannot be altered by the caller.

### App wiring

- **Inspection POST** (`inspections/route.ts`):
  1. Calls `reconcileFleetAudit` (`deliver_pending_fleet_audit`) first, ignoring and logging failures.
  2. Records the inspection's audit with `recordInspectionAudit` (`deliver_fleet_audit_outbox`).
  3. If the RPC does not exist (`42883` or `PGRST202`, i.e. bridge or Supabase mode, or 043 not yet applied), it falls back to the existing direct `auditFleet` insert. If that fails, the status is `unrecorded`, and nothing is reversed.
- **Fleet list GET**: fleet managers also run `reconcileFleetAudit`.
- **Deploy order**: the app works before 043 is applied, through the fallback.

## Integration with B2 (040/041)

B4 stays on B0. For verification I built a scratch schema of B0 plus B2's pushed `040` and `041` (`b5976f4`) plus `043`; nothing was copied into this branch. I then drove the **real inspection route** as the seeded inspector-only user, through `PostgresDataClient` as `tracepoint_runtime` → `authenticated`. The scratch runner is `inspector-path.cjs`.

| Scenario | B0 + 040/041 + 043 | B0 + 043 only (before B2) |
|---|---|---|
| S1: manager set Available with the override; inspector submits a Critical defect | 201, `audit: recorded`, Critical work order, vehicle Out of Service (override kept), outbox delivered | 500. The inspector cannot update equipment, so the critical path is taken: inspection kept, vehicle Out of Service (trigger), `audit: recorded` through the outbox |
| S2: audit outage during an inspector Critical inspection | **201, `audit: pending`**, inspection and work order kept, vehicle Out of Service, outbox has 1 pending row | 500 (equipment), inspection kept, vehicle Out of Service, `audit: pending` |
| S2b: outage over; next inspector POST | Reconciles first: all 3 inspections have audit rows, 0 pending | Same: 0 pending |
| S3: defect work-order insert fails (Critical) | 500 "inspection and its critical defect were saved … The vehicle is Out of Service. Do not submit …", `audit: recorded`. Later refreshes by the manager **and** the inspector keep Out of Service | Same |
| S4: non-critical defect, work-order insert fails | 500 "could not be completed … the inspection record was kept …", and its audit entry is delivered | Same |

I found no conflicts with B2:

- The trigger runs as the function owner, so the `040` guard (`current_user <> 'authenticated'`) does not block it.
- `holdOutOfService` writes only `status`, `status_reason` and `updated_at`, and only for Available or Attention → Out of Service, which `040` permits.
- The route never restores a status or other columns on the critical path.

Notes for the combined branch:

- B2's `audit_events_insert_fleet` policy is not needed for inspection audits once 043 is applied, because delivery is `SECURITY DEFINER`. It is still needed for the other fleet audits and for the bridge fallback.
- `043` does not touch `audit_events` or fleet policies.

## Verification (local, synthetic; no remote systems)

**Handler tests**: `src/lib/fleet/fleet-integrity.test.ts`, 11 tests. They use the in-memory client, which models the 043 outbox and RPCs when `outbox: true`.

| Test | Before the rework (`ff921c2`) | After |
|---|---|---|
| Audit failure on a critical inspection → 201 `pending`; inspection, work order, mileage and Out of Service kept; outbox `attempts=1`; next POST reconciles; exactly one audit per inspection | Fails: `500 !== 201` | Passes |
| Bridge mode audit failure → 201 `unrecorded`, nothing reversed | Fails: `500 !== 201` | Passes |
| Success → `audit: recorded`, one audit row with `work_order_id`; repeated delivery does not duplicate | Fails: no `audit` field | Passes |
| Critical inspection, work order fails → 500, inspection kept, vehicle Out of Service with reason, `audit: recorded`; later refresh (with and without override) stays Out of Service | Fails | Passes |
| Non-critical inspection, work order fails → reversed; when the inspection cannot be deleted, "record was kept" and its audit is delivered | Fails (second part) | Passes |
| Odometer: lowering without a reason → 400 (both endpoints); −5 or 1920.5 → 400; with a reason → saved, `fleet_odometer_corrected` with previous and new values and the reason; increases stay `fleet_vehicle_updated` | Fails: `200 !== 400` | Passes |
| FLT-01, FLT-02, FLT-09 tests from `ff921c2` | Pass | Pass |

**SQL tests**: `src/lib/fleet/fleet-audit-outbox-native.test.ts`, embedded-postgres, 5 tests, in the repo style. This sandbox cannot start embedded PostgreSQL as root, so the file "ran no tests" in `run-application-tests`. I ran the same file against the local server (127.0.0.1:55614) by swapping `embedded-postgres` for a client of that server (scratch `run-native-on-server.cjs`). **5/5 pass**:

- 043 is repeatable and the trigger exists.
- A rolled-back inspection leaves no outbox row and no status change. A committed one leaves a pending row (correct actor, action and entity) and the vehicle Out of Service with its reason. A Maintenance vehicle is kept.
- `authenticated` cannot insert into or update the outbox. `anon` cannot execute delivery. No one can execute the internal function.
- Delivery is denied for another agency's manager, for a subject outside the agency, for a non-member, and for a member who is neither the actor nor a manager. Two deliveries return the same audit id and create one `audit_events` row with the validated `work_order_id`.
- With an audit outage, the entry stays pending (`attempts=1`, `last_error` set) and the inspection is kept. Reconciliation is denied cross-tenant. An officer reconciles 0 (only their own entries). A manager delivers everything, with `reconciled_by_user_id`, and each inspection has exactly one audit row.

Before 043 these tests fail, because the migration does not exist.

**Clean bootstrap and validator**:

- Full clean apply: 79 Supabase migrations plus 39 AWS migrations (`bootstrap.mjs --aws`). With B2's 040/041 added in scratch: 120/120.
- `db:validate-bootstrap`, through the local shim, with the new AWS-stage assertions `fleet_inspection_audit_outbox_trigger` and `fleet_audit_outbox_privileges`:
  - **Passes.**
  - Control (043 removed): **fails** with "AWS-native schema checks failed: fleet_inspection_audit_outbox_trigger, fleet_audit_outbox_privileges".

**Repository checks**:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 568 tests, 564 pass. The 4 failures are the `xlsx`-stub importer tests. Files that ran no tests: the same 11 embedded-PostgreSQL files as B0, plus the new `fleet/fleet-audit-outbox-native.test.ts` (run separately, above). |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 348/349. The one failure is the SheetJS round trip. |
| `npx eslint` on changed files | The new tests, the inspections route, the vehicles list route, the validator and the permission test are clean. `fleet-management/page.tsx` has the same 2 existing `react-hooks` errors as before. `fleet-server.ts`, `[vehicleId]/route.ts` and `work-orders/route.ts` have the same 16 existing `no-explicit-any` errors as before. |

`permission-controlled-editing.test.ts` checks the source text of the list PATCH. Its regex was widened to accept the conditional `fleet_odometer_corrected` action; the intent of that test (audit with `previous` and `current`) is unchanged.

## Compatibility notes

- The inspection 201 response gains an additive `audit` field. A critical partial failure returns 500 with `ok:false` and the kept records. Mobile clients that treat non-2xx as "not saved" should show the `error` text, which says not to resubmit. The native client code is not available to check this.
- Manager PATCH: an invalid reading now returns 400. Before, it was silently stored as 0 or ignored. Lowering a reading without `mileageCorrectionReason` now returns 400.
- A vehicle whose latest inspection is critical and has no defect work order stays Out of Service through automation and manual Available/Attention, until a defect work order exists (and is closed) or a later inspection passes. That is the intended safety hold.
- `refreshFleetVehicle` throws on database errors. The work-order and equipment routes still let that reach Next as a generic 500.
- Residual risks:
  - Non-critical compensation is still best-effort, and a process crash between steps can leave partial state. Critical inspections are protected by the trigger.
  - There is still no idempotency key against duplicate submissions (FLT-07).

## Operations: inspecting and reconciling queued audit entries

The app retries queued entries automatically:

- at the start of every inspection POST in the agency (managers deliver all entries, other members their own);
- whenever a fleet manager opens the fleet list.

To check the queue or force a run, use a database session as the runtime role or an administrative role:

```sql
-- Pending entries per agency
select department_id, count(*) as pending, min(created_at) as oldest, max(attempts) as max_attempts, max(last_error) as last_error
from public.fleet_audit_outbox where delivered_at is null group by department_id;

-- Deliver as a real fleet manager of that agency (recorded as reconciled_by_user_id)
begin;
set local role authenticated;
select set_config('tracepoint.subject_id', '<fleet manager user uuid>', true),
       set_config('tracepoint.department_id', '<agency uuid>', true);
select public.deliver_pending_fleet_audit('<agency uuid>');  -- {"delivered":n,"failed":n,"pending":n}; repeat while pending > 0
commit;
```

A persistent `last_error` means the audit write itself is failing, for example a constraint or a missing `auth.users` row for the actor. Fix the cause, then rerun. Never delete outbox rows to clear the queue.

## Staging and production

The rework is **not approved for deployment**. When it is, apply after B2 (`040`/`041`) using the ledger:

1. `scripts/migrate-db.ps1 staging -Action status`. Expect `043` pending, after B2's 040/041.
2. `scripts/migrate-db.ps1 staging -Action apply`. Then confirm the trigger exists: `select tgname from pg_trigger where tgname='fleet_vehicle_inspections_audit_outbox'`.
3. Deploy the image.

Then run the staging runbook (reconciliation README §8) with `acceptance-<UUID>` tenants only:

1. **S2:** an inspector-only user submits a Critical defect on a vehicle a manager just set to Available. Expect 201, `audit.status = "recorded"`, a Critical work order, and the vehicle Out of Service. One `audit_events` row `fleet_vehicle_inspected` and one delivered outbox row.
2. **Audit outage drill** (staging only): temporarily add `alter table audit_events add constraint b4_drill check (action <> 'fleet_vehicle_inspected') not valid`, then submit a Critical inspection.
   - Expect 201, `audit.status = "pending"`, the vehicle Out of Service, and one pending outbox row with `last_error`.
   - Drop the constraint and open the fleet list as a manager. The row is delivered.
3. Mechanic edits an old work order to a lower mileage. The odometer does not decrease.
4. Report an issue with blank mileage. The odometer does not change.
5. Fleet manager, through the fleet list:
   - edit comments only on a manually set vehicle: saved, status kept;
   - lower the mileage: the browser asks for a correction reason; cancelling does nothing;
   - with a reason: saved and audited as `fleet_odometer_corrected`.

## Rollback

- **Application**: revert the rework commit, or both commits. Before 043 the app falls back to direct audit inserts, so app rollback and DB rollback are independent.
- **043**: the ledger is hash-checked, so roll back with a **new** forward migration. Do not edit 043. First deliver or export pending rows, because dropping the table loses them:

  ```sql
  begin;
  drop trigger if exists fleet_vehicle_inspections_audit_outbox on public.fleet_vehicle_inspections;
  drop function if exists public.deliver_pending_fleet_audit(uuid);
  drop function if exists public.deliver_fleet_audit_outbox(uuid, jsonb);
  drop function if exists public.fleet_audit_outbox_deliver_internal(uuid, uuid);
  drop function if exists public.enqueue_fleet_inspection_audit();
  drop table if exists public.fleet_audit_outbox;
  commit;
  ```

- Vehicles the trigger or automation took Out of Service keep that status. A manager returns them to service as before, once the critical defect is resolved.
