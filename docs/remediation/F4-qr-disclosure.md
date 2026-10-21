# Follow-up batch F4 — QR resolution disclosure (owner decision on B5 NEW-ARM-E)

Base: `claude/integration-defects-20261020` (B0–B5). Follows `docs/remediation/B5-qr-resolve.md`, "Not changed", NEW-ARM-E.

No schema change and no migration. The response shapes and messages are unchanged. Label printing is unchanged.

## Owner decision

- `denied` is kept only for an in-agency record that the caller is already allowed to know exists, but whose workflow the caller may not use.
- A caller who may not read the record gets the same `unknown` response as for an identifier that does not exist. That covers cross-agency lookups and in-agency lookups without read permission. The status code, body and message are identical.
- The 409 ambiguous response must never select an item. It must not disclose records the caller could not otherwise see.

## What "may know the record exists" means

The rule for each table is its row-level security select policy, as applied by the clean AWS chain (supabase lineage plus `database/aws` 001–043). That chain is what `pg_policies` reports on a fresh bootstrap:

| Entity | Caller may know it exists when | Source policy |
|---|---|---|
| Firearm | The caller has `manage_firearms`, `manage_inspections`, `view_command_dashboard` or `administer_department`, **or** the caller holds an active assignment (`firearm_assignments`, `returned_at is null`) for that firearm | `firearms_select_scoped` |
| Equipment | The caller has `manage_equipment` or `administer_department`, **or** the asset is assigned to the caller, **or** the asset is in the self-custody pool: `active`, not assigned to anyone, Equipment Readiness enabled | `equipment_assets_select_scoped` plus B2's `equipment_assets_select_custody_pool` (041) |
| Vehicle | The caller has any of `view_command_dashboard`, `view_fleet`, `manage_fleet`, `perform_fleet_inspections`, `manage_fleet_maintenance`, `manage_fleet_rules` or `administer_department` | `fleet_vehicles_select_scoped` (`database/aws/005`) |

`denied` therefore means one of the following:

- A visible firearm without `firearm_custody.check_out`, `firearm_custody.check_in` or `manage_firearms`. Examples: an inspector, or an officer scanning the firearm they hold.
- A visible vehicle without a fleet workflow permission, or with Fleet disabled. Example: `view_command_dashboard` only.
- Visible equipment while Equipment Readiness is disabled.

## Defect addressed

| ID | Defect | Change |
|---|---|---|
| NEW-ARM-E (Low, owner decision) | In bridge (Supabase) mode, `admin` is the service-role client, so the resolver saw every in-agency row. Three things leaked as a result. (1) Any member, with no firearm permission at all, got `denied` for an in-agency firearm serial or asset number and `unknown` for a value that does not exist. That is an existence oracle for firearms the member cannot read. (2) The same oracle worked for vehicles (no fleet permission) and for equipment held by someone else, which got `allowed` and the asset ID. (3) A 409 could be produced by records the caller could not see. In aws-native mode RLS already hid these rows. | `lookupQrRecords` now takes the caller's `userId`, `permissions` and `enabledFeatures`. It drops every matched row the caller could not read under the rules above, so a hidden row is treated exactly like an absent one, as RLS does. For firearms without a permission-based read, one extra query reads the caller's own active `firearm_assignments` for the matched IDs. That table's RLS allows the caller to see their own assignments, so this also works in aws-native mode. The equipment lookup also selects `assigned_user_id`, `assigned_vehicle_id` and `assigned_location` to evaluate the pool rule. These columns are not returned to the client. `qrDecision` is unchanged, and it now only receives rows the caller may know about. The route passes the caller's access to the lookup. |
| 409 ambiguous (check) | The 409 body was already a constant `{status:"unknown", message:"This code matches more than one record…"}`, with no identifiers and no selected item. However, it could be triggered by duplicates the caller could not read. | Ambiguity is now reported only when the caller can read at least one of the matches. If every match is hidden, the result is the plain `unknown`. If one match is readable and another is not, the result is still 409 and the readable one is not selected. This fails safe: with `limit 2`, the server cannot prove the readable match is unique. The body stays constant and carries no IDs. |

Cross-agency behaviour is unchanged. Every query, including the new `firearm_assignments` read, is bound to the caller's `department_id`. This is now covered by a test.

## Native client (not available — required behaviour)

The native client source is not in this environment. The server contract is backward-compatible: the same statuses (`unknown`, `denied`), messages and HTTP codes, and the 409 body still has `status: "unknown"` and no `entityId` or `entityType`. The client must do the following:

1. On **HTTP 409**, do not navigate to any item or workflow. Show `message`, which asks the user to scan the TracePoint label. Do not retry with a guessed item. Treat it like a non-2xx error, not like a 200 decision.
2. Never infer an item from a response that does not contain `allowed: true` plus `entityType` and `entityId`. For `unknown` and `denied`, show `message` only.
3. Do not cache an earlier resolution and reuse it after a 409 or `unknown`. The server sends `Cache-Control: no-store`.

Staging test step. Add this to reconciliation README §8 **S4**:

- On staging, create two in-agency equipment assets that share a serial, both in the self-custody pool.
- As an officer on the native app, scan or type that serial. Expect a 409, the "matches more than one record" message, and no item or custody screen opened.
- Then scan the printed `tracepoint://equipment/<id>` label of one of them. Expect that exact item.
- Repeat as an officer without firearm read: type an in-agency firearm serial and expect the same screen and text as for `NOPE-1`.
- As an inspector with `manage_inspections` but no custody permission, expect "You are not authorized to use firearm custody."

## Verification (local, synthetic; no remote systems)

### Unit tests (bridge mode)

These are in `src/lib/tracepoint/mobile-workflows.test.ts`. The fake client stands in for the service-role client: it applies no RLS and returns rows only for the department bound in the statement. The table records results against the pre-fix source with the new tests kept (`git stash` of the two source files): 7 pass and 3 fail. All 10 pass after the fix.

| Test | Before | After | What it proves |
|---|---|---|---|
| "QR resolution answers an unreadable in-agency firearm exactly like a missing one" | **fail** | pass | No read permission: the response is deep-equal to the response for `NOPE-1`. `manage_inspections` without custody gives `denied` with no ID. The officer holding the firearm gets `denied`. `firearm_custody.check_out` alone (no read) gives `unknown`. `manage_firearms` gives allowed. |
| "QR resolution answers another agency's record exactly like a missing one" | pass | pass | A Dept B firearm, vehicle or equipment row scanned from Dept A gives `unknown`. Every statement binds only the caller's department. This was already correct and is kept. |
| "QR resolution hides vehicles and equipment the caller cannot read" | **fail** | pass | A vehicle with no fleet read gives `unknown`; `view_command_dashboard` only gives `denied`. Equipment held by another member gives `unknown`; the caller's own, pool, or `manage_equipment` gives the item. |
| "QR ambiguity is reported only over records the caller can read and never selects one" | **fail** | pass | Two hidden firearms give `unknown`, not 409. Two readable ones give ambiguous. One readable and one hidden give ambiguous, with no selection. The route's 409 body is the constant, ID-free literal, and the route passes `access` to the lookup. |
| The existing B5 tests, including "QR decisions do not disclose an unauthorized firearm" | pass | pass | The tests were only given an admin `access` argument. The "do not disclose" test is unchanged: `qrDecision` still returns an ID-free `denied` for a row it receives, and rows the caller cannot read no longer reach it. |

### Real PostgreSQL (aws-native path)

The environment was a disposable PostgreSQL 16 on 127.0.0.1:55624. The schema was a clean apply of the supabase lineage plus `database/aws` 001–043 (122/122), using the `verify-db` seed and these extra rows:

- Dept A firearms `A-SN-1/FA-0001` and `A-SN-2/FA-0002`. `FA-0002` is actively assigned to Officer A2.
- Equipment `RAD-3`, assigned to Officer A2.
- Equipment Readiness enabled for Dept A.
- The supervisor role granted `manage_inspections`.

Calls went through the real `PostgresDataClient` as `tracepoint_runtime`, with `set local role authenticated` and the subject and department GUCs. **Before** is the HEAD lookup; **after** is the fixed one. Permissions were derived as `effectiveDepartmentPermissions` does. All 40 before/after pairs were identical, so RLS and the app-level rule agree.

| Caller (aws-native) | `A-SN-1` (Dept A firearm) | `FA-0002` (held by A2) | `NOPE-1` | `B-SN-1` (Dept B) | `A-101` vehicle | `RAD-3` (held by A2) |
|---|---|---|---|---|---|---|
| Officer A1, no firearm read | `unknown` (= NOPE-1) | `unknown` | `unknown` | `unknown` | `unknown` | `unknown` |
| Officer A2, holds FA-0002 | `unknown` | `denied` | `unknown` | `unknown` | `unknown` | allowed |
| Inspector, `manage_inspections`, no custody | `denied` | `denied` | `unknown` | `unknown` | allowed | `unknown` |
| Dept A admin | allowed | allowed | `unknown` | `unknown` | allowed | allowed |
| Dept B admin (cross-agency) | `unknown` | `unknown` | `unknown` | allowed (own) | `unknown` | `unknown` |

In aws-native mode the fix changes nothing, as expected: RLS already hid these rows. The aws-native requirement, an officer without firearm read getting `unknown`, holds both before and after. The held-firearm path (A2 → `denied`) works under RLS through the new `firearm_assignments` read.

### Required checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 617 tests, 613 pass. The 4 failures are the xlsx-stub tests in `src/lib/ai-importer/workbook.test.ts` (environment). 14 files ran no tests. All of them are embedded-PostgreSQL test files (environment). |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 349 tests, 348 pass. The only failure is the SheetJS round trip (xlsx stub). |
| `npx eslint` on the changed files | Clean |
| SQL | Not touched, so no validator run |

## Staging and production

- Runtime change only (application image). There is no migration.
- Reconciliation README §8 **S4**: run B5's steps plus the native-client step above.
- **S10** (tenant-negative suite): Dept B identifiers scanned from Dept A must return `unknown`.
- In bridge mode, verify with a member who has no firearm, fleet or equipment-manager permission. An in-agency firearm serial, a unit number and equipment held by someone else must all return the exact `NOPE-1` body.

## Rollback

Revert the commit and redeploy the previous image. There is no data or schema change.
