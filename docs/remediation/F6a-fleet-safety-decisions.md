# Follow-up batch F6a: fleet safety hold owner decisions

Base: `claude/integration-defects-20261020` @ `97a4710`. This batch implements the owner's decisions on the questions F3 left open (`docs/remediation/F3-fleet-safety-hold.md`, *Owner decision needed*). Defect correction only; no new features. Nothing here is deployed.

**Migration policy.** `database/aws/046_fleet_safety_hold_clearance.sql` has **not** been applied to any environment: the staging and production ledgers stop at 037, and the integration package is not deployed. On the owner's instruction 046 is therefore **edited in place** instead of adding a new migration. 038–045 are not touched, and 047 (reserved by another branch) is not used. If any environment had applied F3's 046, the hash-checked ledger would report `MIGRATION_DRIFT` for it; that environment would need a new forward migration instead. `STAGING-VERIFICATION.md` (migration table, S12, rollback) is updated.

## Owner decisions and how they are met

| # | Decision | Change | Test |
|---|---|---|---|
| 1 | Critical safety holds operate independently of the agency's automation and notification settings | `findSafetyHold` no longer returns null when `status_automation_enabled` or `critical_issue_out_of_service` is false (its `rules` parameter is removed). `refreshFleetVehicle`: an open critical work order or a recorded hold takes the vehicle Out of Service whatever the settings. With automation off, it escalates only Available/Attention (as for a manual override) and changes nothing else; non-critical automation (Attention/Maintenance/Available derivation) and critical *equipment* still follow the settings. 046 redefines `enqueue_fleet_inspection_audit` (043's trigger function) without the settings check. The fleet settings page now says critical holds always apply. | Handler F6a-2; SQL 2; route harness |
| 2 | 046 must not clear a vehicle unless the data reliably supports it | The one-time baseline marks a vehicle cleared **only** when an inspection with no critical defects was recorded strictly after its latest critical condition (critical inspection, or Critical/availability work order in any status) **and** no Critical/availability work order is open. A completed or cancelled work order alone is not evidence. Each baseline clearance writes an `audit_events` row (below). | SQL 1; full-schema baseline run |
| 3 | No clearance while an unresolved critical work order is open | Route: 409 "The safety hold cannot be cleared while a critical work order is open ("<title>"). Complete or cancel it first." before anything is written. 046 guard: a new or later clearance is rejected with `55000` while an open Critical/availability work order exists for the vehicle (the route maps a `55000` to the same 409). Reversing a clearance (failed audit) is still allowed. | Handler F6a-1; SQL 3; route harness |
| 4 | Auditable resolution | Unchanged: a clearance needs a reason and writes `fleet_safety_hold_cleared`; the baseline writes the same action with actor null. The vehicle detail page shows the hold reason, its source (critical inspection defect / critical work order) and the date held since; when an open critical work order blocks clearance it names the work order(s) and disables *Clear Safety Hold*. | UI (type-checked; no browser run) |

### Baseline audit row

For each vehicle the baseline clears, in the same statement:

| Column | Value |
|---|---|
| `department_id`, `entity_type`, `entity_id` | the vehicle's agency, `fleet_vehicle`, the vehicle |
| `actor_user_id` | null (system; the history tab shows "System / legacy record") |
| `action` | `fleet_safety_hold_cleared` (same as a manager clearance) |
| `summary` | `Safety hold marked cleared by migration 046 (system): a later inspection recorded no critical defects.` |
| `details` | `{baseline: "046", reason, hold: {since, source, record_id}, evidence: {inspection_id, inspected_at, open_critical_work_orders: 0}}` |

`audit_events` was checked on the full schema: `department_id`, `action`, `entity_type` are not null, `actor_user_id` is nullable (FK `auth.users`, set null), `details` defaults to `{}`; the RLS insert policies apply only to `authenticated`, not to the migration role. The baseline still runs only on the application that adds the columns, so a re-run neither clears nor audits again.

Note: a vehicle the baseline clears is also released by the app's own rule (the later passing inspection), so the baseline changes no readiness; it records the determination. The vehicles whose readiness changes are the **newly held** ones below.

### Preview before applying 046 (read-only)

Run on staging/production **before** applying 046 (it does not reference the 046 columns) and record the result per agency:

```sql
with vehicles as (
  select v.id, v.department_id, v.status,
    (select max(c.created_at) from (
       select i.created_at from public.fleet_vehicle_inspections i
       where i.department_id = v.department_id and i.vehicle_id = v.id and i.critical_defect_count > 0
       union all
       select w.created_at from public.fleet_work_orders w
       where w.department_id = v.department_id and w.vehicle_id = v.id and (w.priority = 'Critical' or w.affects_availability)) c) as condition_at,
    exists (select 1 from public.fleet_work_orders w
      where w.department_id = v.department_id and w.vehicle_id = v.id
        and w.status not in ('Completed', 'Cancelled') and (w.priority = 'Critical' or w.affects_availability)) as open_critical
  from public.fleet_vehicles v
), classified as (
  select vehicles.*, condition_at is not null and exists (select 1 from public.fleet_vehicle_inspections i
      where i.department_id = vehicles.department_id and i.vehicle_id = vehicles.id
        and i.critical_defect_count = 0 and i.created_at > vehicles.condition_at) as verified
  from vehicles
)
select department_id,
  count(*) as vehicles,
  count(*) filter (where condition_at is not null) as with_critical_history,
  count(*) filter (where open_critical) as held_by_open_critical_work,
  count(*) filter (where condition_at is not null and not open_critical and verified) as baseline_cleared,
  count(*) filter (where condition_at is not null and not open_critical and not verified) as newly_held,
  count(*) filter (where condition_at is not null and not open_critical and not verified and status in ('Available', 'Attention')) as newly_held_now_available_or_attention
from classified
group by department_id
order by department_id;
```

- `held_by_open_critical_work`: already Out of Service under the previous rules; unchanged.
- `baseline_cleared`: marked cleared and audited by 046.
- `newly_held`: no open critical work and no later passing inspection. These go Out of Service on their next readiness refresh (any inspection, work-order, equipment or vehicle change, or a fleet-list status edit) and stay held until a passing inspection or a manager clearance. `newly_held_now_available_or_attention` is the subset that will visibly change status.
- Join `public.departments` for names if needed. The query only reads.

On the synthetic full schema (below) it returned, for the one agency: 6 vehicles, 6 with critical history, 1 held by open critical work, 1 baseline-cleared, 4 newly held (3 currently Available/Attention), which matched what 046 then did.

## Behaviour notes for the owner

- **Automation off and a released hold.** With `status_automation_enabled = false`, a vehicle taken Out of Service by a critical hold is not returned to Available automatically once the hold is released (passing inspection or clearance); the manager sets the status, as for every other status in that mode. With automation on, it returns to Available as before.
- **`critical_issue_out_of_service` is now inert** for critical defects and availability-affecting work, which always hold. The toggle remains (no redesign); its description says so. `inspection_critical_out_of_service` still decides whether the defect work order is marked availability-affecting, but its priority is Critical either way, so it holds. Whether to remove or relabel these toggles is a product decision, not made here.
- **Critical equipment** (`critical_equipment_out_of_service`) is unchanged and still follows the settings; it was not part of the decision.

## Verification (local, synthetic; no remote systems)

PostgreSQL 16 on 127.0.0.1:55641, non-root, disposable.

**Handler tests** (`src/lib/fleet/fleet-integrity.test.ts`, in-memory client). F3's "open critical work order still holds after a clearance" test encoded the old behaviour and is replaced by F6a-1.

| Test | Before (base code) | After |
|---|---|---|
| F6a-1 clearance with an open critical work order → 409 naming it, nothing written or audited; an open availability-affecting (High) work order also → 409; mechanic completes → still Out of Service; clearance → 200, Available, audited | Fails: 200 | Passes |
| F6a-2 with `{automation off, critical off}` and `{automation on, critical off}`: a recorded hold (completed critical WO) and an open critical WO take an Available vehicle Out of Service with the hold reason; a critical inspection holds an Attention vehicle; the vehicle GET returns the hold. With automation off: non-critical work leaves Available/Maintenance unchanged; a manager-set Maintenance is kept; a passing inspection releases the hold without changing the status | Fails: Available | Passes |
| The other 14 fleet-integrity tests and F2's 5 authorization tests | Pass | Pass (21/21 in the two files) |

**SQL tests** (`src/lib/fleet/fleet-safety-hold-native.test.ts`, embedded-postgres repo style, 043 then 046; run against the local server with the F3/B4 runner technique, because embedded PostgreSQL cannot start as root here):

| Test | Before (F3's 046) | After |
|---|---|---|
| 1 Baseline: clears only the vehicle with a completed critical WO **and** a later passing inspection, with one audit row (actor null, `fleet_safety_hold_cleared`, summary, reason, hold source, evidence inspection id). Not cleared: completed critical WO only; open critical WO even with a later passing inspection; critical inspection without a later passing one; passing inspection older than the critical condition. Re-application neither clears nor audits again | Fails (completed-only vehicle cleared; no audit row) | Passes |
| 2 With `fleet_rules` automation and critical-issue both false, an inspector's critical inspection takes the Available vehicle Out of Service in the trigger; a passing one changes nothing | Fails: Available | Passes |
| 3 Guard: a manager's clearance with an open critical WO → `55000`; after the WO is completed → allowed; an open availability-affecting WO blocks a later clearance; reversing to null is allowed | Fails: no rejection | Passes |
| 4–6 F3's guard, outbox and grants tests | Pass | Pass |

`fleet-audit-outbox-native.test.ts` (043) still passes 5/5.

**Full schema, real routes** (Supabase lineage + `database/aws` 001–046, 125/125, synthetic seed; scratch harness drives the inspection, work-order and vehicle routes through `PostgresDataClient`, `tracepoint_runtime` → `authenticated`). Inspector Critical inspection → manager clearance with the work order open (API and direct DB) → mechanic completes → manager clears:

| Settings | Before (base code + F3's 046) | After |
|---|---|---|
| automation off, critical off | Inspection leaves the vehicle **Available**; clearance 409 "no safety hold"; direct DB clearance **succeeds**; Available throughout | Out of Service; hold shown in GET; API 409 naming the open WO; DB `55000`; still Out of Service after completion; clearance 200, hold null, status stays Out of Service (manager sets status) |
| automation on, critical off | Inspection → **Attention**; completion → Available | Out of Service; 409 / `55000` while open; Out of Service after completion; clearance 200 → Available |
| defaults | Clearance with the WO open → **200**; completion → Available | 409 / `55000` while open; Out of Service after completion; clearance 200 → Available |

Three `fleet_safety_hold_cleared` audit rows by the manager after; one (the early clearance) before.

**Baseline on the full schema**: the 046 columns and guard trigger were dropped to simulate a pre-046 database, five vehicles were given history (completed critical WO only; completed critical WO + later passing inspection; open critical WO + later passing inspection; critical inspection only; passing inspection before a cancelled availability WO), the preview query was run, then 046 was applied twice. Only the second vehicle was cleared, with one audit row carrying the evidence inspection; the re-application added nothing.

**Repository checks**

| Check | Result |
|---|---|
| Clean apply (`bootstrap.mjs --aws`) | 125/125 (79 Supabase + 46 AWS) |
| `db:validate-bootstrap` via the local shim | Passes: "79 ordered migrations and 46 AWS-native migrations", including B2's field-write and F2's eligibility SQL. Two AWS-stage assertions added: `fleet_critical_inspection_hold_ignores_automation_settings` and `fleet_safety_hold_clearance_refused_with_open_critical_work`; with F3's 046 both fail |
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 637 tests, 633 pass; the 4 failures are the `xlsx`-stub tests (environment). 16 files ran no tests (embedded PostgreSQL cannot start as root): `armory/custody-native-schema`, `authentication/{cognito-establish, cognito-membership-lifecycle-sql, first-login-activation, postgres-mapping, postgres-refresh-sessions, postgres-session-state, rehearsal-first-login}`, `email/ses-feedback`, `fleet/{fleet-audit-outbox-native, fleet-safety-hold-native, vehicle-documents-native}`, `inventory/inventory-native-schema`, `notifications/postgres-read-contract`, `onboarding/personnel-import-native`, `tracepoint/postgres-home-read-contract`. The two fleet native files were run separately (above) |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 348/349: the SheetJS round trip (environment) |
| `npx eslint` on changed files | `[vehicleId]/route.ts`, both test files and `validate-clean-bootstrap.mjs` clean. `fleet-server.ts` (12), `[vehicleId]/page.tsx` (13) and `FleetRulesPanel.tsx` (6) have the same existing counts as the base; none added |

## Compatibility

- Server contracts are unchanged in shape: `safetyHold` / `readiness.safetyHold` as in F3. The clearance PATCH can now return 409 in a new case (open critical work order). The mobile client only re-exports GET.
- `findSafetyHold(context, vehicleId, vehicle)` lost its `rules` argument (internal; all call sites updated). New internal helper `findOpenCriticalWorkOrders`.
- App before 046: refresh, GET and the 409 checks work; clearance returns 500 naming the missing column, as in F3.

## Staging (reconciliation README §8; `acceptance-<UUID>` tenants only)

1. `scripts/migrate-db.ps1 staging -Action status`: 046 pending (with 038–045).
2. **Before applying**, run the preview query above and record the per-agency counts with the evidence. Apply; confirm `select count(*) from public.audit_events where details ? 'baseline'` equals the recorded `baseline_cleared` total.
3. S12 in `STAGING-VERIFICATION.md`: clearance refused while the critical work order is open (409; the detail page names it and disables the button); held after completion; manager clearance with a reason → Available, audited.
4. Set the synthetic agency's *Automatic vehicle status* and *Critical issues remove vehicles from service* off; repeat S2: the vehicle still goes Out of Service and the detail page shows the hold source and date. Restore the settings.

## Rollback

- **Application:** revert the commit. The F3 code again lets the settings switch holds off in the app (the 046 trigger still takes critical inspections Out of Service), and the 046 guard still refuses clearances while a critical work order is open (the F3 route reports that as a 500).
- **046:** not applied anywhere, so before deployment the F3 version can simply be restored. After deployment, a new forward migration: drop the guard trigger and function, and re-run 043's `enqueue_fleet_inspection_audit` and three outbox function definitions. Baseline audit rows stay (they are history); the columns can stay, inert.
