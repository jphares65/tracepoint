# Follow-up batch F3: fleet safety hold and audit outbox decisions

Base: `claude/integration-defects-20261020` (B0–B5) @ `d5b8ea8`. This batch implements the owner's decisions on B4's critical-inspection handling and the inspection audit outbox (`043`). B4 is in `docs/remediation/B4-fleet-integrity.md`. Migration: `database/aws/046_fleet_safety_hold_clearance.sql`.

> **Superseded in part by F6a** (`F6a-fleet-safety-decisions.md`): the owner chose option (b) for the automation settings, a conservative audited baseline, and no clearance while a critical work order is open. 046 was edited in place. The *Owner decision needed* section below is resolved there.

The owner approved B4's four outbox deviations, subject to testing; the tests below cover them. Nothing here is deployed.

## Owner decisions and how they are met

| # | Decision | How it is met |
|---|---|---|
| 1 | A critical defect must continue to prevent an unsafe return to service. | The 043 trigger, B4's override escalation and the open-critical-work-order rule are unchanged. A *recorded* critical condition now also holds the vehicle (2). |
| 2 | Closing or cancelling a work order alone must not release a critical safety hold. Release requires a verified resolution or an authorized clearance. | `findSafetyHold` (`src/lib/tracepoint/fleet-server.ts`) is used by `refreshFleetVehicle`. See *Safety hold*. |
| 3 | Delayed audit reconciliation must keep the right work-order id. | The outbox row stores the inspection's defect work order. Reconciliation leaves entries that are still in flight to their own request. See *Outbox*. |
| 4 | Audit entries pending indefinitely must be detected and resolved. | The existing notifications feed carries a Fleet alert, `fleet_audit_pending`, for managers and administrators when entries are more than 24 hours old. The ops query and the reconciliation call are below. Attempts and the last error stay on each row. |
| 5 | Department automation settings | Not changed. The current behaviour and the owner's options are documented under *Owner decision needed*. |

## Safety hold

**Definition** (`findSafetyHold`, read-only):

- **Start.** The hold starts at the most recent critical condition recorded for the vehicle. A critical condition is either:
  - an inspection with `critical_defect_count > 0`, or
  - a work order with `priority = 'Critical'` or `affects_availability`, in any status, including Completed and Cancelled.
  The start time is the record's `created_at`.
- **Release.** The hold is released when either of these is recorded strictly after that start:
  - **Verified resolution:** a later inspection of the vehicle with `critical_defect_count = 0`.
  - **Authorized clearance:** the vehicle's `safety_hold_cleared_at`.
- **Open critical work orders.** They hold the vehicle independently, as before, whether or not a clearance exists.
  - A clearance recorded after such a work order was created releases the recorded hold. The vehicle is still held until that work order is closed.
  - Closing it afterwards then releases the vehicle, because the clearance came later than the hold's start.
- **Scope.** The hold applies only when `fleet_rules.status_automation_enabled` and `critical_issue_out_of_service` are not `false`. This is the same gate that already applies to critical issues (decision 5).

**In `refreshFleetVehicle`**: `outOfService = critical_issue_out_of_service && (open critical work || safetyHold) || critical equipment`. All the existing override rules apply unchanged: an overridden Available/Attention vehicle is escalated, and manager-set Maintenance, Out of Service and Retired are kept.

- B4's narrower rule (latest inspection critical and no defect work order since) is now covered by the hold and was removed.
- The refresh reads the vehicle with `select("*")`, so the app keeps working before 046 is applied. Without the columns, no clearance exists.
- The refresh result gains `safetyHold` (`{ since, source, reason } | null`). The inspection and work-order responses already return `readiness`, so the field is additive there.

**Manager clearance**: `PATCH /api/fleet/vehicles/[vehicleId]` with `{ clearSafetyHold: true, clearanceReason }`.

1. The existing `canManageFleet` gate applies (`manage_fleet`, `administer_department` or super admin); anyone else gets 403.
2. A blank `clearanceReason` returns 400.
3. If there is no recorded hold to clear, the response is 409.
4. The route writes `safety_hold_cleared_at`, `safety_hold_cleared_by` and `safety_hold_clearance_reason` (plus `updated_by_user_id` and `updated_at`).
5. It audits `fleet_safety_hold_cleared` through `auditFleet`, with the reason, the hold being cleared and the previous clearance.
6. If the audit fails, the clearance is reversed and the response is 500 "the safety hold was not cleared".
7. Readiness is then recalculated. The clearance never sets a status or an override.

Other PATCH bodies behave as before.

**Web UI**: on the vehicle detail page (`src/app/fleet-management/[vehicleId]/page.tsx`), the *Manage Status* card shows "Critical safety hold" with its reason (from the new `safetyHold` field of the vehicle GET). Fleet managers also get a *Clear Safety Hold* button, which prompts for the reason.

### Migration 046 (schema choice)

Three nullable columns on `fleet_vehicles` hold the latest clearance. Columns, not a table, because:

- only the latest clearance matters to the rule;
- every clearance is already in `audit_events`;
- the existing vehicle RLS update policies and the 040 field guard apply without new policies or grants;
- readers that select `*` tolerate their absence before 046.

The migration also contains:

- **Trigger `fleet_vehicles_safety_hold_clearance_guard`** (`BEFORE UPDATE`; not `SECURITY DEFINER`; applies only to `current_user = 'authenticated'`, the app's role):
  - Any change to the clearance columns requires `manage_fleet` or `administer_department` in the vehicle's agency. Otherwise it raises 42501.
  - A *new or later* clearance must name the subject as `cleared_by` and have a non-blank reason, or it raises 22023. Its time is overwritten with the database `now()`, so the client clock cannot backdate or future-date it.
  - Moving the clearance earlier or setting it to null only restores holds. It is allowed for managers, and the route uses it to reverse a clearance whose audit failed.
  - Residual: a manager can rewrite the reason or attribution of an *older* clearance through that path. Every clearance is still in `audit_events`.
- **One-time baseline**, run only on the application that adds the columns, so a repeated run does nothing.
  - Vehicles the previous rules had already released get `safety_hold_cleared_at = now()`, a null `cleared_by` and a reason beginning `Baseline at migration 046`. "Already released" means no open critical work order, and no latest critical inspection still waiting for its defect work order.
  - Without the baseline, every vehicle with any historical Critical or availability work order and no later passing inspection would go Out of Service the next time it is refreshed. In agencies that do not use inspections, that is the whole fleet history. **Owner decision needed** (below).
- **B2's 040 guard is not redefined.** It allow-lists the columns a non-manager may change (`v_changed <@ v_allowed`), so the new columns are already unwritable by inspectors and mechanics.
  - This was verified on the full schema: inspector and mechanic direct updates fail with `42501 fleet vehicle change forbidden`.
  - It was also verified with F2's `045` (`3de7ee7`, which redefines the guard) applied before 046: same results.
  - The 046 trigger is an independent second check, so it does not depend on how F2 changes 040/045.

## Outbox

**Defect.** `deliver_pending_fleet_audit` called the internal delivery function with no work order, so reconciliation recorded `work_order_id: null`.

There was also a race. Between the inspection insert and the defect work-order insert, any manager's reconciliation (run at the start of every inspection POST and on the fleet list) could deliver the brand-new entry first. The route's own delivery then found it already delivered, and the work-order id was lost.

**Change in 046.** This is the least invasive option: no route change and no new client RPC.

- `fleet_audit_outbox.work_order_id` is a nullable foreign key to `fleet_work_orders`, `on delete set null`.
- `deliver_fleet_audit_outbox` stores the caller's `work_order_id` on the row *before* the delivery attempt, so it is kept even when the audit write fails.
  - It is stored only if the work order is an `Inspection` work order of the same agency and vehicle, was created by the entry's actor, and was created at or after the inspection. First write wins.
  - The route already calls this function, with the work order, on every path where one exists.
- `fleet_audit_outbox_deliver_internal` uses the stored work order, re-validated at delivery time.
- `deliver_pending_fleet_audit` skips entries that have never been attempted and are less than 5 minutes old; those belong to the request still running.
  - Everything else is unchanged: authorization, managers handling up to 100 entries, members handling only their own, and the `{delivered, failed, pending}` result.
  - An entry whose request crashed is reconciled after 5 minutes, without a work order, exactly as before.

I chose this over a separate `attach_fleet_audit_work_order` RPC called after the work-order insert. The RPC would need a route change and a bridge-mode fallback, and would only narrow the crash window, not close it. The race fix is what makes reconciliation keep the right id.

## Stale-entry alert

`collectFleetNotifications` (`src/lib/tracepoint/fleet-notifications.ts`) builds the alert for subjects with `manage_fleet` or `administer_department` (or super admin). These are the same people the outbox read policy admits.

- **Query:** the agency's undelivered entries created more than 24 hours ago.
- **Alert:** one per user, key `fleet-audit-pending-<user>`, kind `fleet_audit_pending`, priority High, linked to `/fleet-management`.
  - Title: the count.
  - Detail: the date and age in days of the oldest entry, and the last error when delivery is failing.
  - The detail does not include the attempt count. The notification fingerprint is the whole alert, so every retry would otherwise reset acknowledgement.
- **Not alerted:** mechanics, inspectors and `manage_fleet_rules`-only users.
- **Without 043:** a missing table (`42P01`/`PGRST205`) is ignored.

### Ops: finding and resolving pending entries

```sql
-- Pending entries per agency, with repeated failures
select department_id, count(*) as pending,
       count(*) filter (where created_at < now() - interval '24 hours') as older_than_24h,
       min(created_at) as oldest, max(attempts) as max_attempts,
       (array_agg(last_error order by created_at) filter (where last_error is not null))[1] as oldest_error
from public.fleet_audit_outbox where delivered_at is null group by department_id;

-- Entries of one agency, oldest first
select id, inspection_id, work_order_id, actor_user_id, created_at, attempts, last_error
from public.fleet_audit_outbox where department_id = '<agency uuid>' and delivered_at is null order by created_at;
```

**To reconcile**, run the B4 procedure as a real fleet manager of the agency: `set local role authenticated`, set the subject and agency, then `select public.deliver_pending_fleet_audit('<agency uuid>')`. Repeat while `pending > 0`.

- Entries that have never been attempted and are less than 5 minutes old are skipped on purpose.
- A persistent `last_error` means the audit write itself fails. Fix the cause first. Never delete outbox rows.

## Owner decision needed

### 1. Automation settings (decision 5; behaviour unchanged)

**When `status_automation_enabled = false`:**

- the 043 trigger does not take a critical-inspection vehicle Out of Service;
- `refreshFleetVehicle` changes no status;
- `findSafetyHold` returns no hold, so the UI shows none and a clearance returns 409.

The vehicle keeps whatever status it had, and no automatic Out of Service happens.

**When automation is on but `critical_issue_out_of_service = false`:**

- the trigger does not act;
- critical work orders and recorded holds do not take the vehicle out of service;
- only critical equipment does (`critical_equipment_out_of_service`).

**Options:**

- **(a) Keep this.** The agency setting governs every automatic status change, including the hold.
- **(b) Make the critical safety hold apply regardless.** The trigger, `findSafetyHold` and the refresh would ignore both flags for critical conditions, and the settings would govern only non-critical automation.

**Recommendation: (b).** Decision 1 says a critical defect must prevent an unsafe return to service, and today a single settings toggle silently removes that protection. If (b) is chosen:

- the settings page should say that critical holds always apply;
- the change is a small edit to `findSafetyHold`/`refreshFleetVehicle` plus the 043 trigger, in a new migration.

### 2. The 046 baseline

Should 046 keep the one-time baseline (recommended, described above), or drop it so historical critical conditions re-hold vehicles on their next refresh?

To preview the impact on staging, count the vehicles the baseline would clear before applying 046:

```sql
select count(*) from public.fleet_vehicles v
where not exists (select 1 from public.fleet_work_orders w
  where w.vehicle_id = v.id and w.status not in ('Completed','Cancelled') and (w.priority = 'Critical' or w.affects_availability))
  and exists (select 1 from public.fleet_work_orders w
  where w.vehicle_id = v.id and (w.priority = 'Critical' or w.affects_availability));
```

### 3. Clearing ahead of an open work order

A clearance recorded while a critical work order is still open lets the vehicle return to service when that order is closed, with no further step. This follows the definition: the clearance came after the hold started. If the owner wants a clearance to count only once no critical work is open, the route can refuse it (409) while open critical work orders exist.

## Verification (local, synthetic; no remote systems)

The local server was PostgreSQL 16 on 127.0.0.1:55623, non-root.

**Handler tests**: `src/lib/fleet/fleet-integrity.test.ts`, +4 tests, run on the in-memory client. The test double gained `gt`, `lt` and `is`.

| Test | Before (base code) | After |
|---|---|---|
| Completing or cancelling the critical work order (with its critical inspection) keeps the vehicle Out of Service with the hold reason; a later passing inspection releases it | Fails: Available after completion | Passes |
| Clearance tests:<br>• mechanic, inspector or rules-only user → 403<br>• blank or missing reason → 400<br>• audit failure → 500, clearance reversed<br>• manager with reason → 200, Available, no override, `cleared_by`, `fleet_safety_hold_cleared` audit with reason and hold<br>• second clearance → 409 | Fails: the clearance is not handled | Passes |
| Open critical work order + clearance → 200, audited, still Out of Service | Fails | Passes |
| Stale-entry alert: managers and administrators get one alert (count 2: excludes fresh, delivered and other-agency entries; shows the oldest date, 2 days, and the last error); mechanic, rules-only, inspector and none get nothing | Fails: no alert | Passes |
| The 11 existing B4 tests | Pass | Pass |

**SQL tests**: `src/lib/fleet/fleet-safety-hold-native.test.ts`, embedded-postgres in the repo style, applying 043 then 046. They ran against the local server with the B4 runner technique (embedded PostgreSQL cannot start as root here). **4/4 pass:**

- **Migration:** 046 is repeatable. The baseline clears only the released vehicle, not the open-critical or unrecorded-inspection ones, and does not run again on re-application. The guard trigger exists.
- **Clearance guard:** inspector, mechanic, another agency's manager and a reason-only edit get 42501. A null, blank or whitespace reason, or a forged `cleared_by`, gets 22023. A manager's clearance with a client time of 2099 is stamped with the database time. Reversing to null is allowed.
- **Outbox link:** with an audit outage, a fresh never-attempted entry is skipped by reconciliation. Another user's work order is not linked. The route-style delivery stores the work order and records the failure (attempts 2). After the outage, the manager reconciles and the audit row has the right `work_order_id` and `reconciled_by_user_id`.
- **Crash case and grants:** an unattempted entry older than 5 minutes is reconciled. `authenticated` cannot execute the guard or the internal function, and `anon` cannot reconcile.

Control run: with 046 removed, all 4 fail.

The existing `fleet-audit-outbox-native.test.ts` (043) still passes 5/5.

**Full schema, real routes**: the schema was the Supabase lineage plus `database/aws` 001–043 and 046, with the synthetic seed. The scratch harness `route-harness.cjs` drives the real inspection, work-order and vehicle routes and `collectFleetNotifications` through `PostgresDataClient` (`tracepoint_runtime` → `authenticated`).

| Scenario | Before (base code, 043 only) | After |
|---|---|---|
| Inspector Critical inspection; mechanic completes the defect work order | Available | **Out of Service**, hold reason in the response and in the manager's GET |
| Mechanic or inspector clearance via the API | 403 | 403 |
| Mechanic or inspector clearance via the DB | (no columns) | `42501 fleet vehicle change forbidden` (040 allow-list) |
| Manager clearance without a reason (API / DB) | 400 (generic reason) / — | 400 / `22023` |
| Manager clearance with a reason | 400 | 200, Available, DB-stamped, one `fleet_safety_hold_cleared` audit; a second clearance gets 409 |
| New critical inspection → mechanic cancels the work order → passing inspection | Available after the cancel | Out of Service after the cancel; Available after the passing inspection |
| Open critical work order + clearance | — | 200, still Out of Service; Available once the work order is completed |
| Audit outage on a Critical inspection → manager reconciliation | Audit `work_order_id` **null** | Outbox linked (attempts 1); audit has the **right work order** and is reconciled by the manager |
| Entry pending for 30 hours | No alert | Manager: "1 inspection audit entry not recorded … Delivery is failing: … f3_outage"; mechanic and inspector: none |

The same harness on the full schema **plus F2's 045** (`3de7ee7`) applied before 046 (124/124 migrations) gives identical results.

**Repository checks**:

| Check | Result |
|---|---|
| Clean apply (`bootstrap.mjs --aws`) | 122/122 (79 Supabase + 43 AWS); 046 applied twice cleanly. With F2's 045: 124/124 |
| `db:validate-bootstrap` via the local shim | **Passes**: "79 ordered migrations and 44 AWS-native migrations", including B2's field-write SQL with the 046 trigger present |
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 618 tests, 614 pass. The 4 failures are the `xlsx`-stub tests (environment). The 15 files that ran no tests are the embedded-PostgreSQL files, including the new `fleet-safety-hold-native.test.ts`, which was run separately (above) |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 348/349: the SheetJS round trip (environment) |
| `npx eslint` on changed files | The two test files and `[vehicleId]/route.ts` are clean. `fleet-server.ts` (12), `fleet-notifications.ts` (5) and `[vehicleId]/page.tsx` (13) have the same existing `no-explicit-any` counts as the base, and none are added |

## Compatibility

- **Additive response fields:** `readiness.safetyHold` (inspection, work-order and vehicle PATCH responses) and `safetyHold` (vehicle GET, web and mobile). The mobile client is not available to check. Existing fields are unchanged.
- **New PATCH body flag** `clearSafetyHold`. It is web only, because mobile re-exports only GET.
- **App before 046:**
  - refresh and GET work (no clearance exists);
  - the stale-alert query works with 043;
  - clearance returns a 500 naming the missing column.
- **Without 043 (bridge mode):** the alert source is skipped.
- **Behaviour change by design:**
  - After deployment, a newly recorded critical condition holds the vehicle until a passing inspection or a manager clearance.
  - Mechanics completing a critical work order no longer return the vehicle to Available.
  - Agencies that do not inspect will need to clear holds explicitly.
- **Cost:** `refreshFleetVehicle` and the vehicle GET run four more indexed single-row reads each.

## Staging (reconciliation README §8; `acceptance-<UUID>` tenants only)

1. `scripts/migrate-db.ps1 staging -Action status`: expect `046` pending, after `043` and F2's `045` if present.
2. Before applying, run the baseline preview query above and record the count. Then `-Action apply`, and confirm with `select tgname from pg_trigger where tgname = 'fleet_vehicles_safety_hold_clearance_guard'`.
3. Deploy the image.
4. Inspector-only user: a Critical inspection, then a mechanic completes the defect work order. Expect the vehicle to stay **Out of Service** with the hold shown on the detail page.
5. A fleet manager clicks *Clear Safety Hold*:
   - Cancel (or a blank reason) changes nothing.
   - With a reason: the vehicle becomes Available, with one `fleet_safety_hold_cleared` audit event.
   - The clear control does not appear for mechanics or inspectors.
6. A new Critical inspection, the work order cancelled, then a passing inspection: Available.
7. Audit outage drill (B4 step 2), Critical inspection, drop the constraint, open the fleet list as a manager. The `fleet_vehicle_inspected` audit row has the inspection work order's `work_order_id`.
8. Leave a drill entry pending and set `created_at` back 25 hours on it. A fleet manager's notifications show "inspection audit entry not recorded"; a mechanic's do not. Reconcile afterwards.

## Rollback

- **Application:** revert the commit. The old refresh ignores the new columns and the stored work-order id.
- **046:** the ledger is hash-checked, so roll back with a new forward migration. The vehicle columns and the outbox column can stay; they are inert to the old code.

  ```sql
  begin;
  drop trigger if exists fleet_vehicles_safety_hold_clearance_guard on public.fleet_vehicles;
  drop function if exists public.guard_fleet_safety_hold_clearance();
  -- restore 043's three outbox functions by re-running their definitions from 043 in the new migration
  commit;
  ```

- Vehicles held by the new rule keep their status after rollback, until a manager or the old automation changes it.
