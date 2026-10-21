# Follow-up batch F6b — QR resolution owner decisions

Base: `claude/integration-defects-20261020` (B0–B5, F1–F5, DC). Follows `B5-qr-resolve.md`, `F4-qr-disclosure.md` and `F5-qr-inspection-eligibility.md`.

No schema change and no migration. Label printing is unchanged. Response changes are additive: no field is removed or renamed, and the statuses, messages and HTTP codes are the same.

## Owner decisions

1. A hidden record must not change the QR response. Ambiguity is evaluated only over records the caller can read:
   - exactly one visible match resolves;
   - more than one visible match returns 409 with the unchanged, ID-free body;
   - no visible match returns the same `unknown` body as a value that does not exist.
2. A non-UUID handle can be duplicated. For one visible match, the response carries what the user needs to confirm the physical item, and nothing more.
3. Authorized firearm custody workflows are preserved, without showing records the caller has no authority over and without widening RLS.

## Defects addressed

| ID | Defect | Change |
|---|---|---|
| F6b-1 (decision 1) | **Bridge mode.** F4 returned 409 when one match was readable and another was hidden. With no hidden duplicate, the same value resolved, so the 409 disclosed the hidden record. Three related leaks: (a) each table query used `limit 2`, so two hidden rows could crowd out the readable one and turn a resolution into `unknown`; (b) the `firearm_assignments` read ran only when the handle matched a firearm, so a hidden firearm added a sequential query (a timing difference); (c) the read was filtered by the matched IDs. In aws-native mode, RLS already removes hidden rows before the limit, so these leaks did not apply there. | `lookupQrRecords` (`src/lib/tracepoint/mobile-workflows.ts`): ambiguity is `visible.some((m) => m.length > 1)`. Hidden rows are never counted. The table lookups have no limit. A handle equality match within one department is naturally small: vehicles have unique unit and VIN, firearms have a unique serial, and equipment has a unique asset number. The caller's firearm scope queries (own active assignments, and the restriction read below) now run in parallel with the lookups. They are issued from the caller's permissions and the label kind only, never from what the handle matched, so the same statements run whether or not a hidden row exists. |
| F6b-2 (decision 2) | A response for a serial, asset number, unit number or VIN gave the client nothing to confirm that the resolved record is the item in hand. | `qrDecision` adds `matchedField` and `matchedValue` to an **allowed** response when the handle matched a non-`id` column. Example: `{"matchedField":"serial_number","matchedValue":"A-SN-1"}`. The value is the identifier the user scanned or typed. Vehicles and equipment already return `displayName`. A firearm response gains `displayName` (make and model) only alongside the confirmation fields. Every caller who can receive an allowed firearm can already read that row under `firearms_select_scoped`: the reader permissions, or the active assignee. Bare-UUID and label responses are unchanged. `denied` and `unknown` gain nothing. |
| F6b-3 (decision 3) | `qrDecision` allowed `firearm_custody` only for `firearm_custody.check_out`, `firearm_custody.check_in` or `manage_firearms`. The only custody action the application exposes, `POST /api/armory/firearms/[id]/custody` → `operate_restricted_firearm_custody` (031, SECURITY DEFINER), authorizes other callers: the **assignee**, and holders of **`manage_restricted_firearm_custody`**, on an actively assigned firearm with an active, effective `duty_only` restriction. Those callers got `denied`. This includes an officer scanning their own Duty Only firearm. | `lookupQrRecords` evaluates the 031 operator rule read-only. It reads active `firearm_possession_restrictions` and active `firearm_assignments` for the caller's department, under the caller's RLS in aws-native mode. It returns `firearmCustodyEligible` for the selected firearm, and `qrDecision` allows the firearm when that is true. The route sets `restrictedFirearmCustody` only on AWS-native (`TRACEPOINT_DATA_PROVIDER=postgres`), because the 028–031 tables and functions do not exist in the Supabase lineage. A `no_carry`, not-yet-effective, expired or unassigned restriction does not qualify, which matches the function. The rule never widens beyond the function's own authority. |

## Firearm custody authority (decision 3, determined precisely)

| Permission / relation | What it governs | Row visibility under `firearms_select_scoped` (aws-native) | QR after F6b |
|---|---|---|---|
| `manage_firearms`, `administer_department` | `qrDecision` custody set and 028 `transfer_firearm_custody` | All department firearms | allowed (unchanged) |
| Assignee of a Duty Only firearm | 031 `operate_restricted_firearm_custody` (the live API) | Own assigned firearm | **allowed** (was `denied`) |
| `manage_restricted_firearm_custody` **plus** a firearm reader permission (`manage_inspections`, `view_command_dashboard`) | 031 live API, on other officers' Duty Only firearms | All department firearms | **allowed** for Duty Only firearms (was `denied`). Other firearms stay `denied` with no ID. |
| `manage_restricted_firearm_custody` **without** a firearm reader permission | 031 live API: verified working on real Postgres | **None.** RLS returns 0 firearm rows | `unknown`. **NOT fixed. See below.** |
| `firearm_custody.check_out` / `check_in` without a reader permission | Only 028 `transfer_firearm_custody`, which **no route calls**. The live API refuses them (`restricted custody permission required`, verified). | None | `unknown` (unchanged since F4) |
| No custody authority | — | Own assignments only | `unknown`, or `denied` for one's own non-restricted firearm (unchanged) |

**Not fixed: a restricted custodian without firearm read, on AWS-native.**

- The firearms select policy hides every firearm row from this caller, and `firearm_assignments` hides other officers' assignments.
- A serial or asset number exists only on `firearms`. So no read-only query the route can issue under the caller's RLS can map the handle to a firearm.
- The 031 function takes a firearm UUID. There is no eligibility function to reuse.
- Resolving this needs a new read-only SECURITY DEFINER function, for example `qr_restricted_custody_firearm(handle)`, that applies the 031 rule. That is a migration, and none was allocated, so per the batch instructions it was not built.
- The `eligible` set already counts as visibility in `qrVisible`, so once such a function or policy returns the row, the application rule needs no further change.
- In practice, this caller also cannot find these firearms in the web armory list, which is RLS-scoped. The custody API is not bearer-callable either (B5 NEW-ARM-D).
- **Owner decision:** add the function (one migration), or grant restricted custodians a reader permission.

**`firearm_custody.check_out` / `check_in` alone** has database authority through `transfer_firearm_custody`, but no application path. Making it resolve would expose every department firearm to a role that cannot act on any of them through the app, so it was left as F4 set it.

**Bridge mode** has no firearm custody tables or functions. The custody API fails there for every caller, so bridge QR firearm behaviour is F4's rule plus decisions 1 and 2.

## Residual risk and data quality (decision 2)

- A visible record can share a non-UUID identifier with a record the caller cannot see. For example, equipment serial `RAD-3` is held by the scanning officer, and another `RAD-3` is held by someone else. Under decision 1, the visible one resolves. If the item in hand is actually the hidden one, the user is offered the wrong record.
- `matchedField` and `matchedValue` reduce this risk only partly: they confirm the identifier, not the specific physical item. The printed TracePoint label (`tracepoint://{vehicle|equipment}/{uuid}`) is always unique and remains the safe path.
- Where duplicates can occur, given the schema constraints:
  - equipment `serial_number` is not unique;
  - firearm `asset_number` is not unique;
  - a cross-column collision is possible: one row's serial equals another row's asset number, or a unit number equals a VIN;
  - a cross-table collision is possible, resolved by the B5 precedence: vehicle, then equipment, then firearm.
- The code has **no** duplicate-identifier report. The AI importer only flags duplicates within one import file (`duplicateIssue`).
- **Recommendation (not built):** an administrator data-quality report that lists, for each department, identifier values shared by more than one active record across `fleet_vehicles.unit_number`/`vin`, `equipment_assets.serial_number`/`asset_number` and `firearms.serial_number`/`asset_number`. Each listed record should get a printed TracePoint label.

## Behaviour notes for the owner

- **Cross-table matches keep the B5 precedence** (vehicle, then equipment, then firearm). They are not treated as ambiguous. Hidden rows in other tables still never change the answer, because they are filtered out first. If the owner wants a 409 when visible records in two different tables share a handle, that is a one-line change, but it would also stop unit-number scans for any unit number that equals a visible equipment asset number.
- In aws-native mode, the restriction read is a new query. It requires `database/aws` 028–031 to be applied, which the custody API, and F5's 045, already require. If the restriction table is missing, scoped callers get a 500 for firearm-capable lookups, rather than a silently wrong answer.

## Native client (not available — contract)

- New optional fields appear on allowed responses only:
  - `matchedField` (`unit_number`, `vin`, `asset_number`, `serial_number`) and `matchedValue`;
  - `displayName` on a firearm response that carries them.
- A strict decoder that rejects unknown keys would need updating. Every existing key and value is unchanged.
- Recommended client behaviour: when `matchedField` is present, show "Matched {field}: {value} — {displayName}" and ask the user to confirm before opening a custody or inspection workflow.

## Verification (local, synthetic; no remote systems)

### Unit tests (bridge mock: service-role client, no RLS)

These are in `src/lib/tracepoint/mobile-workflows.test.ts`. Before = integration HEAD source with the new tests (source reverted from a saved patch, no stash): 9 pass, 7 fail. After: 16/16 pass.

| Test | Before | After | What it proves |
|---|---|---|---|
| "QR responses are identical whether or not a hidden record shares the handle" | **fail** | pass | Four cases compare responses and the full list of SQL statements, with and without hidden rows: a pool item plus a hidden duplicate; two hidden rows that would fill the old two-row page; a held firearm plus a hidden firearm with the same asset number; only hidden matches versus none (`unknown`). |
| "QR handles that match more than one visible record are ambiguous" | pass (guard) | pass | Two visible pool items give 409, and so does a firearm serial that equals another visible firearm's asset number. |
| "QR resolution follows the restricted firearm custody operator rule (031) on AWS-native" | **fail** | pass | A custodian with `manage_restricted_firearm_custody` and the assignee are allowed. No authority and `check_out` only give `unknown`, identical to a missing value. `no_carry`, future, expired and unassigned restrictions give `unknown`. A reader without authority gets an ID-free `denied`. The other agency's records give `unknown`. Bridge mode never queries the restriction table. |
| "QR confirmation fields name only the matched identifier, and only on an allowed match" | **fail** | pass | VIN, asset and serial matches carry the field and value. UUID matches add nothing. `denied` and `unknown` bodies are unchanged. |
| Updated F4/B5 tests ("SQL never binds…", "honours the label kind…", "unreadable in-agency firearm…", "ambiguity…") | fail (expected) | pass | The result object gained `firearmCustodyEligible`. The lookup no longer uses `limit` (asserted). One readable plus one hidden match now resolves the readable one (decision 1, replacing F4's fail-safe 409). The held-assignment fixture now names the assignee, because the read is no longer filtered by matched IDs. |

### Real PostgreSQL (aws-native path)

- **Server:** disposable PostgreSQL 16 on 127.0.0.1:55642.
- **Schema:** clean apply of the supabase lineage plus `database/aws` 001–046 (125/125), `verify-db` seed.
- **Extra rows:**
  - Dept A firearms `A-SN-1/FA-0001` (unassigned), `A-SN-2/FA-0002` (assigned to Officer A2, active `duty_only` restriction, current custody with A2) and `A-SN-3/FA-0003` (assigned to Officer A1, no restriction);
  - a vault;
  - equipment `RAD-3` held by A2.
- **Role grants:** supervisor (Inspector) gets `manage_inspections` and `manage_restricted_firearm_custody`; a new Custodian (`range_master`) gets `manage_restricted_firearm_custody` only; fleet manager gets `firearm_custody.check_out`.
- **Session:** calls went through the real `PostgresDataClient` as `tracepoint_runtime`, with `set local role authenticated` and the subject and department GUCs.
- **Inputs:** permissions were derived as `resolvePostgresAccess` does (subject session, `has_department_permission`, `effectiveDepartmentPermissions`). Vehicle eligibility came from the 045 RPC. **After** sets `restrictedFirearmCustody` as the route does on AWS-native.

| Caller (aws-native) | `FA-0002` / `A-SN-2` (Duty Only, held by A2) | `A-SN-1` | `FA-0003` (A1's, unrestricted) | `NOPE-1` | `B-SN-1` (Dept B) |
|---|---|---|---|---|---|
| Officer A2 (assignee) | `denied` → **allowed** `[Glock 19 asset_number=FA-0002]` | `unknown` | `unknown` | `unknown` | `unknown` |
| Inspector (reader + restricted custody) | `denied` → **allowed** | `denied` | `denied` | `unknown` | `unknown` |
| Custodian (restricted custody, no read) | `unknown` (RLS: 0 firearm rows; **not fixed**, see above) | `unknown` | `unknown` | `unknown` | `unknown` |
| Fleet manager (`check_out` only) | `unknown` | `unknown` | `unknown` | `unknown` | `unknown` |
| Officer A1 (no authority) | `unknown` | `unknown` | `denied` | `unknown` | `unknown` |
| Dept A admin / armorer (`manage_firearms`) | allowed `[Glock 19 asset_number=FA-0002]` | allowed | allowed | `unknown` | `unknown` |
| Dept B admin (cross-agency) | `unknown` | `unknown` | `unknown` | `unknown` | allowed (own) |

Custody authority was checked directly under the same session shape, inside a transaction that was rolled back:

| Caller | `operate_restricted_firearm_custody` CHECK_IN on FA-0002 | `transfer_firearm_custody` |
|---|---|---|
| Custodian | ok | refused |
| Officer A2 | ok | refused |
| Inspector | ok | refused |
| Officer A1 | refused (42501) | refused |
| Fleet manager | refused | ok |

`transfer_firearm_custody` has no route caller.

**Hidden duplicate on real PostgreSQL.** After the first run, three rows were added:

- a hidden firearm `A-SN-9` sharing asset number `FA-0002`;
- equipment `RAD-3`/`EQ-9` held by A1, which is hidden from A2;
- a second pool radio sharing `RAD-1` (visible to every officer).

Of 160 before/after response pairs, 134 were identical and 26 changed. Every change is explained by a record that is **visible** to that caller:

- `RAD-1` returns 409 for every officer.
- `FA-0002` and `RAD-3` return 409 for the readers who see both rows (admin, armorer, inspector).
- Officer A1 now resolves `RAD-3` to their own `EQ-9`.

Officer A2's responses for `FA-0002` and `RAD-3` were unchanged, with both hidden duplicates present.

In aws-native mode, RLS removes hidden rows before the lookup, so this invariance held before the fix too. The disclosure fixed by decision 1 was a bridge-mode defect, and the unit tests show it.

### Required checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 640 tests, 636 pass. The 4 failures are the xlsx-stub tests in `src/lib/ai-importer/workbook.test.ts` (environment). 16 files ran no tests; all are embedded-PostgreSQL files (environment). |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 349 tests, 348 pass. The only failure is the SheetJS round trip (xlsx stub). |
| `npx eslint` on the changed files | Clean |
| SQL | Not touched, so no validator run |

## Staging and production

- Runtime change only (application image). There is no migration. AWS-native requires `database/aws` 028–031, which the custody API already needs.
- Extend reconciliation README §8 **S4**:
  1. Create two equipment assets that share a serial. Hold one as Officer X; another officer holds the other. Officer X types the serial: the response must equal the response with the second asset absent (200, Officer X's item, `matchedField: "serial_number"`). Put both in the pool: expect 409 with no ID.
  2. Set a Duty Only restriction on an officer's assigned firearm. That officer types its serial: expect `allowed:true`, `workflow: firearm_custody`, `matchedField: "serial_number"` and the make and model. A user with `manage_inspections` plus `manage_restricted_firearm_custody` gets the same. A user with `manage_restricted_firearm_custody` only gets `unknown` (the known limitation above).
  3. A member with no firearm authority types the same serial: expect the exact `NOPE-1` body.
- **S10** (tenant-negative suite): Dept B identifiers scanned from Dept A must return `unknown`.

## Rollback

Revert the commit and redeploy the previous image. There is no data or schema change.
