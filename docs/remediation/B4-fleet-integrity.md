# Remediation batch B4: fleet integrity

Base: `claude/fix-b0-proof-foundation`, which is stacked on `codex/staging-mobile-api-release-20261007` @ `555f061`. Evidence for the findings is in `docs/operational-audit-20261020/reconciliation-20261020/R5-fleet-equipment.md` (T1–T4 and T8) and `evidence/fleet-equipment.recon.test.ts`.

This batch makes no schema change, and it does not change any policy, grant or audit authorization. Batch B2 owns AWS RLS for fleet field writes (NEW-01).

## Defects addressed

| ID | Defect | Change |
|---|---|---|
| FLT-01 (Critical) | Any manual status change sets `status_override_active = true`, and nothing in normal use clears it. `refreshFleetVehicle` then skipped all automation, so a later Critical inspection defect left the vehicle **Available**. The fleet-list PATCH did not run readiness at all. | `refreshFleetVehicle` (`src/lib/tracepoint/fleet-server.ts`): while an override is active, automation can now only **escalate**. If an overridden vehicle is Available or Attention and there is an open critical condition (a Critical or availability-affecting work order, or critical equipment that is Missing or Out of Service), it is set to Out of Service. A manager's Maintenance, Out of Service or Retired status is left unchanged. The override flag is never cleared automatically, so automation never makes a vehicle more available than the manager set. The fleet-list PATCH (`src/app/api/fleet/vehicles/route.ts`) now runs `refreshFleetVehicle` after the audited write, as the `[vehicleId]` PATCH already did. |
| FLT-02 (High) | Work-order POST and PATCH, including officer Issue reports, overwrote `current_mileage` and `current_hours` with the work order's reading. An edit to an old work order rolled the odometer back (T2: 19,200 → 18,000). | `updateVehicleService` (`work-orders/route.ts`) now reads the vehicle and only moves mileage and hours **forward**. The work order keeps its own reading. When a work order is completed, `last_service_mileage` and `last_service_hours` come from the saved work order, not from the request body, so a PATCH that omits mileage no longer clears them. Manager edits on the vehicle itself (both vehicle PATCH endpoints) can still lower the odometer, so that typing errors can be corrected. |
| FLT-09 (Medium) | Blank or null mileage was saved as 0. Affected: the inspection record (mobile `mileage: null`), the vehicle odometer through an Issue report with `mileage: ""`, and the vehicle PATCH endpoints. | New `optionalNumeric()` in `fleet-server.ts` returns `null` for blank, null or non-numeric input. The inspection route uses the vehicle's current reading when no reading is supplied, which is the same as the existing behaviour for an omitted field. Work orders do not touch the odometer when no reading is supplied. In the `[vehicleId]` PATCH and the list PATCH, a blank `currentMileage` or `currentHours` keeps the stored value. `numeric()` itself is unchanged, because other fleet routes depend on its fallback. |
| FLT-08 (High) | The inspection write was not atomic. Errors from the equipment updates, the work-order insert and the vehicle update were all discarded. The officer got 201 with `workOrder: null`, or the audit threw after everything had committed (Next 500, partial state; T8). | The data clients (supabase-js and `PostgresDataClient`, which runs each statement in its own transaction) cannot span statements in one transaction, so this is fixed with compensation instead. Each side effect is now checked: equipment and vehicle updates must return their row (this also catches a write that RLS silently filters out), the work-order insert must succeed, readiness must refresh, and the audit must succeed. On the first failure, the earlier steps are reversed: the vehicle readings, due date, status and open-issue count are restored, the work order and inspection are deleted, and equipment statuses are restored. The response is a 500 with `{ error }` that names the failed step. It says either "No changes were kept; submit the inspection again" or, if a reversal also failed, "Some changes could not be reversed; tell a fleet manager". Readiness now runs before the audit, so that a refresh failure can also be reversed. `refreshFleetVehicle` now throws on read or update errors. Before, a failed work-order read counted as "no open work" and could mark the vehicle Available. |
| (new, found while fixing FLT-01) | The fleet-list PATCH wrote `status_override_active: existing.status_override_active`, but `VEHICLE_SELECT` does not include that column. On the AWS path, `pg` sends `undefined` as NULL into a NOT NULL column. So every list edit that kept the status would fail with "The vehicle could not be updated", and on supabase-js the key was silently dropped. | The column is written only when the status changes. Reasoned from `node_modules/pg/lib/utils.js` `prepareValue` (null and undefined both become NULL) and `supabase/migrations/202608242100_fleet_v1.sql:51` (`not null`). It was not reproduced on a live database. |
| FLT-19 (Low) | Open Issues is manually editable and conflicts with the computed count. | **Partly fixed as a side effect:** the list PATCH now runs readiness, so the stored count is always recomputed from open work orders. The field is still shown in the web edit form (`fleet-management/page.tsx:1040`); removing it is a UI change and was left out. |
| FLT-20 (Low) | The two vehicle PATCH endpoints behave differently. | **Partly aligned:** both now run readiness and both treat a blank reading as not provided. Still different: the `[vehicleId]` PATCH does not validate `status` against the five fleet statuses, and the endpoints accept different field sets. These were not changed, because doing so would change request contracts beyond the defects. |

### Why this FLT-01 option

- Option (a), "escalate despite the override", is the only one that guarantees that a vehicle with an open critical condition is never left Available. That guarantee covers an override that is already active in production today and needs no data fix.
- Option (b), "clear the override when the manager picks the automatic status", would still leave every vehicle that already carries an override exposed. It would also need a definition of the automatic status at the moment of the click.
- With (a), the override flag is kept: once the critical work is closed, an escalated vehicle stays Out of Service until a manager sets it back. This is conservative: it never makes a vehicle more available than a person decided.
- A manager can no longer set Available while a Critical work order is open. To return such a vehicle to service, close the work order or lower its priority or `affects_availability`. That is the intent of the finding.
- Department rules are still respected. `status_automation_enabled = false`, `critical_issue_out_of_service = false` and `critical_equipment_out_of_service = false` turn the escalation off, as before.

## Verification (local, synthetic; no remote systems)

Regression tests are in `src/lib/fleet/fleet-integrity.test.ts`. They are handler-level: the real route modules run against an in-memory data client. Only `server-only` and `resolveServerAccess` are replaced, through the CommonJS require cache. The in-memory client returns copies of rows, projects the selected columns, and can inject per-table errors. To get the "before" column, the test was run with `src/app` and `src/lib/tracepoint` stashed.

| Test | Before (stashed fix) | After |
|---|---|---|
| FLT-01: refresh with an override and an open Critical work order (Available, Attention, Maintenance, Out of Service and Retired overrides) | Fails: `'Available' !== 'Out of Service'` | Passes. Available and Attention become Out of Service; Maintenance, Out of Service and Retired are unchanged; the override stays set; a non-critical order never relaxes an overridden Out of Service. |
| FLT-01: `[vehicleId]` PATCH to Available, then a Critical brake inspection (mobile path) | Fails: vehicle Available | Passes: 201, `readiness.status` and the stored status are both Out of Service |
| FLT-01/FLT-19: list PATCH to Available with an open Critical order; then an edit to comments only | Fails: Available; the override flag is lost on the second edit | Passes: Out of Service; `open_issue_count` is recomputed to 1; the override flag is kept |
| FLT-02: PATCH an old work order (18,000 mi, 90 h) to Completed, then a new Issue at 19,400 | Fails: `18000 !== 19200` | Passes: the odometer stays at 19,200 and the hours at 100; the work order keeps 18,000; `last_service_mileage` is 18,000; the later 19,400 reading advances the odometer |
| FLT-09: Issue with `mileage: ""` and `hours: null`; inspection with `mileage: null` and `hours: ""` | Fails: `0 !== 19200` | Passes: the vehicle keeps 19,200 and 100; the inspection records 19,200 and 100; `optionalNumeric` returns null for `""`, `null`, whitespace, `undefined` and `"x"` |
| FLT-08: the work-order insert is denied, then the audit insert is denied, for a Critical inspection | Fails: 201 (`workOrder: null`, partial state) | Passes: 500 with "…not saved because creating the defect work order failed (permission denied). No changes were kept…" (and the same for the audit); no inspection or work-order rows; vehicle status, mileage and due date unchanged |

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 562 tests, 558 pass. The 4 failures are the `xlsx`-stub tests in the AI importer (CSV/XLSX parse and structured inference), and they are environmental. The 11 embedded-PostgreSQL files ran no tests because PostgreSQL cannot start as root in this sandbox: `armory/custody-native-schema`, `authentication/{cognito-establish,postgres-mapping,postgres-refresh-sessions,postgres-session-state,rehearsal-first-login}`, `email/ses-feedback`, `fleet/vehicle-documents-native`, `inventory/inventory-native-schema`, `notifications/postgres-read-contract`, `tracepoint/postgres-home-read-contract`. This matches B0. |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 348/349 pass. The one failure is the SheetJS round trip (`xlsx` stub). |
| `npx eslint` on changed files | The new test file, `inspections/route.ts` and `vehicles/route.ts` are clean. `fleet-server.ts`, `[vehicleId]/route.ts` and `work-orders/route.ts` have the same 16 existing `no-explicit-any` errors before and after; none were added. |
| SQL | Not touched, so no bootstrap or validator run is needed. |

## Compatibility notes

- Successful responses are unchanged: inspection 201 `{ ok, inspection, workOrder, readiness }`; work order 200/201 `{ ok, item, readiness }`; `[vehicleId]` PATCH `{ ok, vehicle }`. The list PATCH `item` now carries the recomputed `status` and `open_issue_count`. Errors use the existing `{ error }` JSON shape.
- An inspection that used to "succeed" with missing side effects now returns 500. On AWS-native staging and production, before B2 lands, inspector-only users get a denied work-order insert and audit insert (NEW-01, T8). With this batch alone, their inspections will be **rejected and rolled back** instead of being half-saved. **Deploy B4 together with, or after, B2.**
- `refreshFleetVehicle` now throws on a database error. The inspection route and both vehicle PATCH routes catch this and return a JSON 500. The work-order and equipment routes still let it reach Next, which returns a generic 500 after their record has been written and audited. Before, they returned 2xx with a possibly wrong readiness. Wrapping those routes was left out to keep the diff small.
- Compensation is best-effort. A crash between steps can still leave partial state, which needs a real transaction or an RPC. Retries also still create duplicates (no idempotency key, FLT-07); both are out of scope.

## Staging and production

There are no migrations and nothing to apply to the database. Deploy only through the normal image pipeline, after B2 (see above).

Staging runbook (reconciliation README §8), using `acceptance-<UUID>` tenants only:

1. **S2:** as an inspector-only user, submit an inspection with a Critical defect on a vehicle a manager has just set to **Available**. Expect a 2xx response, a Critical work order, and the vehicle Out of Service. If B2 is not deployed yet, expect a 500 that names the failed step, and **no** new inspection row.
2. As a mechanic, edit an older work order to Completed with a lower mileage. The vehicle odometer must not decrease.
3. Report an Issue with the mileage field left blank. The odometer must not change.
4. As a fleet manager, edit only the comments of a vehicle whose status was set manually, through the fleet list. The save must succeed and the vehicle must keep its status.

## Rollback

Revert the batch commit. There is no data or schema migration. Vehicles that automation escalated to Out of Service keep that status; a manager can set them back with a reason, as before.
