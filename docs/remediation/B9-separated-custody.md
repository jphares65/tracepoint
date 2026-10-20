# Remediation batch B9: custody held by a separated officer

Base: `claude/integration-defects-20261020`. The evidence is in `docs/operational-audit-20261020/reconciliation-20261020/R5-fleet-equipment.md` (EQP-01, EQP-04, EQP-12), in `appendix-d-fleet-equipment.md` (EQP-01, EQP-04, EQP-05) and in `R2-armory.md` (ARM-08). The plan is `plan-b7-b11.md`, section B9.

Scope: defects only. There is no offboarding workflow, clearance checklist or deactivation block. EQP-05 and the ARM-08 workflow are deferred capabilities.

## Defects addressed

| ID | Defect | Change |
|---|---|---|
| EQP-01 (Critical) | Equipment held by a deactivated member was shown as **Unassigned**: the holder lookup used active members only. It also disappeared from the per-officer view, because `groupCurrentOfficerAssignments` dropped holders who were not active. Items on a Retired vehicle, or on any vehicle for a non-manager viewer, were also shown as Unassigned. | The asset directory (`GET /api/equipment/assets`, also served at `/api/mobile/equipment/assets`) adds `inactiveHolders`: separated members who hold a non-removed item, with `isActive: false` and `deactivatedAt`. The read is tenant-scoped (`department_id`, `is_active = false`, `user_id in` the holders). `members` is unchanged and stays active-only, because it feeds the assignment pickers. The web list, the per-officer grouping, search and the CSV/report exports resolve holders from `members` plus `inactiveHolders` and show **"Name (inactive)"** in red. `equipmentCustodyLabel` returns "Unassigned" only when no officer, vehicle or location is set: an unresolved holder shows "Unrecognized holder", and a vehicle outside the active list shows "Assigned vehicle". The edit form lists the current separated holder as an option, so it no longer shows "Unassigned" while submitting the old ID. |
| ARM-08 (display part only) | The armory list showed a firearm held by a former member as held by "Unknown User". | `getFirearmInventory` also resolves names for assignment holders whose membership is inactive. `assigned_to_name` becomes "Name (inactive)" and `assigned_to_is_active: false` is added. The returned `members` list (the issue picker) stays active-only. |
| EQP-04 (High) | An item held by an inactive member, or by a Retired vehicle, could not be marked out of service or removed. The PATCH always revalidated the unchanged holder ("Assigned officer must be an active department member"). The DB guard `validate_equipment_asset_assignment` also rejected any update that listed `assigned_user_id`, which the route always did. | **API:** the active-member and in-service-vehicle checks run only when the holder **changes**. Unchanged custody columns are no longer written. Removal writes `assigned_user_id = null` explicitly, so the history trigger closes the assignment. **DB (`049`):** the guard checks the officer or vehicle only on insert or when it changes. A **new** assignment to an inactive member or a Retired vehicle is still refused by both the API and the DB, and the history insert policy also still requires an active member. |
| EQP-04 history | When an item was removed, its assignment closed with the note "Equipment removed from active inventory" but without the reason. | `049` appends the removal reason: "Equipment removed from active inventory: Lost - not returned". Return and reassignment notes are unchanged ("Equipment returned / unassigned", "Equipment reassigned"). |
| EQP-12 (Low) | Asset edits took no reason, and dates were not validated (an invalid date reached PostgreSQL as a raw 500). | **Dates:** on POST and PATCH, `issueDate`, `expirationDate`, `lastInspectionDate` and `nextInspectionDate` must be real calendar dates in `YYYY-MM-DD` form, or blank to clear. An expiration date before the issue date is rejected when either of those dates is supplied. Errors are 400s with a clear message. **Reason:** changing `lifecycle_status` to `out_of_service` or `removed` requires `removalReason`. It is stored in the existing `removal_reason` column (now for out of service too), kept across later edits, and cleared when the item returns to active. The existing `equipment_assets_accountability_audit` trigger records it in `audit_events.new_value`. The web OOS and Remove actions ask for the reason, and so does the edit form when its status is changed. |
| Silent "unassigned" (verification) | Owner concern: does deactivation clear custody anywhere? | **No path does.** `update_department_member` (Settings), `prepare_cognito_membership_operation` (Settings under Cognito, and personnel import; 044), the bridge personnel import and the AI importer change only `department_memberships` and the session tables. There is no trigger on `department_memberships` that touches custody. The equipment re-import is enrich-only and never clears `assigned_user_id`. A real-PG test pins this down for both SQL paths, covering equipment assignments, open history rows and firearm assignments. Readiness and the Command Dashboard have no "unassigned" count. They evaluate required gear for active members only, and the operational pool (`scope=operational`) requires `assigned_user_id is null`, so an item a separated member holds is never counted as available. No change was needed there. |

### Migration `database/aws/049_equipment_separated_holder.sql`

The migration is idempotent and wrapped in `begin`/`commit`. It does three things:

1. `validate_equipment_asset_assignment()` validates the officer or vehicle only on insert or when it changes. The agency-ownership check is unchanged.
2. `sync_equipment_asset_assignment_history()` is unchanged except for the removal reason in the closing note.
3. The `profiles_select_self_or_department_admin` policy drops the `target_membership.is_active = true` condition. The same roles that can already read the membership row (`manage_users`, `manage_equipment`, `administer_department`, in the target membership's agency) can read a **former** member's profile.
   - **Why it is needed:** without it, under AWS-native RLS the separated holder's name is unreadable and the list shows "Unnamed Officer". The holder is still shown as held (not Unassigned), and the badge still appears.
   - **Owner review:** this lets those roles read a former member's profile row (name, email, phone) in their own agency. They could read it while the member was active, and `get_department_members` already shows inactive members to user administrators.

## Verification (local, synthetic; no remote systems)

**Handler tests:** `src/lib/equipment/separated-custody-route.test.ts`, 8 tests. They run the real `GET`/`POST`/`PATCH` handlers against an in-memory client.

**UI-model and repository tests:**

- `officer-assignments.test.ts`: two new tests, covering grouping, the "(inactive)" label, and never "Unassigned".
- `read-repository.test.ts` (equipment): a new inactive-holder test, plus the adapter contract with the new tenant-scoped query.
- `armory/read-repository.test.ts`: a new ARM-08 display test.
- Two existing tests that encoded the defect were updated. `equipment-type-management.test.ts` used a source regex on `groupCurrentOfficerAssignments(members, ...)`. The read-repository `deepEqual` now includes `inactiveHolders: []`.

**Real-PostgreSQL tests:** `src/lib/equipment/separated-custody-native.test.ts`, 8 tests, embedded-postgres in the repo style. The schema is the Supabase lineage plus `database/aws` 001–046 and 049. Each request runs as `tracepoint_runtime` → `authenticated` with the subject and agency set. This sandbox cannot start embedded PostgreSQL as root, so the file "ran no tests" in `run-application-tests`. It was run against the local server (127.0.0.1:55644) with the F1 shim approach (scratch `b9/shim-test.sh`).

| Test (real PG) | Before (no 049, old code) | After |
|---|---|---|
| Deactivation through `update_department_member` and `prepare_cognito_membership_operation` leaves equipment custody, open history and the firearm assignment intact | Pass (no defect: regression guard) | Pass |
| An equipment manager reads the separated holder's name under RLS; another agency's former member and an officer without permission cannot | **Fail** | Pass |
| Out of service on an item a separated member holds, with the unchanged holder in the SET list; holder kept; audit row has the reason | **Fail** (guard 23514) | Pass |
| Removal closes the assignment with "…: Lost - not returned" | **Fail** (note without reason) | Pass |
| Return from a separated member closes as "Equipment returned / unassigned" | Pass | Pass |
| A new assignment to a separated member (update and insert) is refused; reassignment to an active officer closes and opens history | Pass (regression guard) | Pass |
| An item on a Retired vehicle can change status; nothing new can be placed on that vehicle | **Fail** | Pass |
| 049 is repeatable | **Fail** (file absent) | Pass |

| Handler and unit tests (`tsx --test` on the equipment and armory tests, 43 tests) | Before | After |
|---|---|---|
| Total | 29 pass, **14 fail**: EQP-01 GET, OOS, removal, retired vehicle, reason, dates, ARM-08, grouping/label, and the updated contract tests | 43/43 pass |

**Route harness on real PostgreSQL** (scratch `b9/route-harness.cjs`): the real asset route is driven through `PostgresDataClient` as an `armorer` + `manage_equipment` user, with the separated officer deactivated after issue.

| Step | Before (old code, no 049) | After (new code + 049) | New code, **without** 049 |
|---|---|---|---|
| R1 GET | No holder entry (list showed Unassigned) | `inactiveHolders: [["Sam Separated", false]]` | Holder listed, name "Unnamed Officer" (profile RLS) |
| R2 OOS + reason | **400** "must be an active department member" | 200, holder kept, reason stored | 200 |
| R3 remove + reason | **400**, history open | 200, history closed "…: Lost - not returned" | 200, closed without the reason |
| R4 new assignment to separated | 400 | 400 | 400 |
| R5 return to Quartermaster | 200 | 200, closed "Equipment returned / unassigned", reason cleared | 200 |

**Re-run note:** between about 19:41 and 19:42 UTC, `/dev/null` in the shared sandbox was briefly replaced by a symlink (another batch did it, and it has since been restored). Every fail-before and pass-after run above, and every required check below, was **re-run after the restore**. The results were identical.

**Required checks:**

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 645/649 pass. The 4 failures are the sandbox `xlsx` stub (import parsing and inference). The "ran no tests" files are the embedded-postgres files (17, including the new `separated-custody-native.test.ts`) |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 348/349 pass. The 1 failure is the SheetJS round trip (`xlsx` stub) |
| `npx eslint` on changed files | No new findings. The two pages keep their existing findings, identical before and after; the new files are clean |
| Clean apply (`bootstrap.mjs --aws`) | 126/126 files; 049 applied twice |
| Validator shim (`validate-clean-bootstrap.mjs` against 127.0.0.1:55644) | "Clean bootstrap passed: 79 ordered migrations and 47 AWS-native migrations; permission and retirement matrices passed" |

## Native client contract

- `GET /api/mobile/equipment/assets` gains one field, `inactiveHolders`. `members` keeps its shape and remains active-only.
- `GET /api/armory/firearms` gains `assigned_to_is_active: false` on assignments held by a former member, and `assigned_to_name` carries "(inactive)".
- The PATCH changes (reason, dates) apply only to the web manager route, which is not mounted under `/api/mobile`.

## Staging (reconciliation README §8)

1. Apply `049` with `scripts/migrate-db.ps1 staging -Action status`, then `apply`. Expect one pending file. Apply it before or with the image: without it, items can still be marked out of service, removed and returned, but the separated holder's name shows "Unnamed Officer" and the removal note has no reason.
2. Add the staging step **S18** (before and after):
   1. Issue a radio and a vest to a synthetic officer.
   2. Deactivate the officer in Settings (Cognito lifecycle).
   3. As an equipment manager: the asset list shows "Name (inactive)" for both items, and the per-officer view lists them under that name.
   4. Mark the radio OOS. A reason is required.
   5. Remove the vest with the reason "Lost - not returned".
   6. Try to assign a spare item to the deactivated officer.
   7. In the armory, an issued firearm of the same officer shows "Name (inactive)".
3. Expected: the OOS and removal return 200. `equipment_asset_assignments` for the vest is closed with the reason. The new assignment is refused. The officer's other assignments stay attributed. Before the fix, the items show Unassigned, OOS and removal fail, and the firearm shows "Unknown User".
4. Native app: confirm it tolerates the extra `inactiveHolders` field and, if it displays holders, uses it.

## Residual and owner items

- **Owner review:** the `049` profile-policy widening (former members' profiles readable by the same agency roles); see above.
- Under AWS-native RLS, an armorer with only `manage_firearms` cannot read other members' memberships or profiles. That is pre-existing and affects active holders as well. The armory list therefore still shows "Unknown User" for that role. It is a profile and membership read-policy question for B8 or an owner decision, and B9 does not change it.
- Deferred capabilities, not done: separation clearance, a deactivation warning or block while property is outstanding (EQP-05, ARM-08 workflow), "lost/stolen" lifecycle states (EQP-08), and department alerts (EQP-02).

## Rollback

- Revert the commit; the app change has no data migration.
- `049` needs no rollback for safety: it only relaxes the guard for unchanged holders and widens profile reads to former members. To restore the previous behaviour exactly, re-run the function bodies from `supabase/migrations/202609020001_equipment_assignment_rls_and_targets.sql` and `202608190002_equipment_assignment_sync.sql`, and the policy from `20260822202500_equipment_rls_hardening.sql` (with `auth.uid()` replaced by `tracepoint_auth.subject_id()`), in a new forward migration. Do not edit 049.
- Rows written meanwhile stay valid: `removal_reason` on out-of-service items is ignored by the old code, which clears it on the next edit.
