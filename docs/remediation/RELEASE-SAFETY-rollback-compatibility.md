# Release safety: image rollback compatibility of migrations 038–053

Base: integration head `59f6aa0`. Its code is identical to release candidate `8574db3`. Branches:
- **Expand:** `claude/fix-b8a-expand-contract`. This branch is the release.
- **Contract:** `claude/fix-b8a-contract-054`. It is not part of this release.

Owner directive: "Confirm that the staging deployment's automatic rollback cannot return the application to an image incompatible with migrations 052/053. Resolve that release-safety concern before requesting deployment authorization."

**Result:**
- **053 was the only incompatible migration.** It is now edited in place to an expand-only form, and its contract step moved to a separate `054`. 053 has never been applied anywhere: the staging and production ledgers stop at 037 (precedent: F6a/046, B8a/052).
- **One item in 038–051 needs a runbook step: 043.** After a rollback and a later re-upgrade, the old image's fleet inspections end up with a duplicate audit row. It is not edited; the step is in "Re-upgrade after a rollback" below.
- Nothing else in 038–053 breaks the previous image or corrupts its records.

## 1. Why the previous image matters

| Mechanism | Where | What it does |
|---|---|---|
| Script rollback | `scripts/deploy-app.ps1`, the `catch` after `Test-Deployment` | Steady state, ALB health, `/api/health`, image digest and the staging HTTP smoke test all run. If any of them fails, the script runs `ecs update-service` back to `$previousHealthyTaskArn`. That is the revision running when the deploy started. |
| ECS circuit breaker | `infra/lib/runtime-stack.ts`: `circuitBreaker: { rollback: true }`, `minHealthyPercent: 100` | If new tasks never become healthy, ECS returns the service to the last completed deployment. During a normal rolling deploy, old and new tasks also serve **together** for a while. |
| Manual rollback | `deploy-app.ps1 -RollbackTaskDefinitionArn` | Accepts any older ACTIVE revision of the family. Earlier revisions are retained on purpose (`runtime-stack.ts`). |
| Migration order | `scripts/migrate-db.ps1 -Action apply` → `run-aws-native-migrations.mjs` in the reviewed image | Applies **every** pending `database/aws` file in that image, **before** the new image takes traffic (STAGING-VERIFICATION §2–3). |

So the previous image runs on the 038–053 schema in three cases:
- between the migration and the deploy;
- during the rolling deploy;
- for as long as either rollback leaves it in place.

**The previous image:** staging is believed to run `555f061` (`codex/staging-mobile-api-release-20261007`) or a commit close to it.
- The earlier release-line commits `2a92bcc`, `564ff78` and `8c4c032` exist locally and are ancestors of `555f061`.
- Every route and library file that touches an object changed by 038–053 is byte-identical between them and `555f061`. That covers the firearm status route, the rifle routes and `personal-rifle-server.ts`, off-duty inspections, ammunition reconciliation, the fleet inspection route and `fleet-server.ts`, agency-training closeout, the personnel import writer, the membership lifecycle, the setup page and the settings data route.
- The files that do differ (custody, storage locations, vehicle documents, the UUID regex in `postgres-data-client.ts`) touch only objects from 028–037.
- The analysis therefore covers all four commits. If staging turns out to run something else, re-run §3 against it.

## 2. Audit: every 037 object that 038–053 drop, revoke, replace or tighten

**Method:**
1. Two local databases were built from the Supabase lineage plus `database/aws`: one with 001–037, one with 001–053.
2. Their catalogs were diffed: policies with their expressions, table and column grants, function signatures, ACLs and body hashes, triggers, constraints, columns and RLS flags.
3. Every removed or changed object was traced to its callers in the `555f061` tree on the AWS-native path (`PostgresDataClient`: runtime role → `authenticated` with the subject set).
4. The previous image's route modules were then run on real PostgreSQL (§3).

Nothing in 038–053 renames an object or changes a function signature or return type.

| Mig | Change to a 037 object | Previous image (555f061) on AWS | Compatible? |
|---|---|---|---|
| 038 | `equipment_assets_lifecycle_status_check` widened to add `out_of_service` | Writes only values the old CHECK already allowed | **yes** |
| 039 | `create_department_with_owner`: EXECUTE revoked from `authenticated`. `prepare_cognito_membership_operation` body gets the 42702 fix. New function `activate_cognito_identity_on_first_login`. | The only caller is `auth/setup/page.tsx`, which redirects to `/login` under `aws-native` before the call; the settings RPC allow-list does not include it. The lifecycle calls the same signature: it failed with 42702 at 037 and now works. | **yes** |
| 040 | New permissive fleet policies. New guard triggers on `fleet_vehicles` and `fleet_vehicle_equipment`. | The guards return immediately for `manage_fleet`/`administer_department`, the only roles that could update these tables at 037. Old inspector writes that matched 0 rows at 037 now succeed for workflow fields only. | **yes** (improved) |
| 041 | New custody pool SELECT policy and `operate_equipment_self_custody` | Additive | **yes** |
| 042 | `protect_pilot_range_workspace_mutation`, `protect_range_day_drill_history`: Ready no longer locks | Loosened only. The B3 `resultRevisions` caution (STAGING-VERIFICATION §5) is app JSON, not schema. | **yes** |
| 043 | New `fleet_audit_outbox` with an AFTER INSERT trigger on `fleet_vehicle_inspections` (queues the audit entry; a Critical inspection takes the vehicle Out of Service) | The old inspection route writes its own `fleet_vehicle_inspected` audit row. The queued entry stays pending under the old image. After a re-upgrade, the new image's `deliver_pending_fleet_audit` writes a **second** row (harness §3: 2 rows for one inspection). | **degraded: duplicate audit row on re-upgrade.** Safe with the runbook step below (harness: 1 row). |
| 044 | Personnel-import function bodies: blank cells keep stored values; Officer is added only to a new membership; only an Administrator may change an Administrator in the import lifecycle | Same signatures. The old import keeps working, preserves data it would have blanked, and is refused on Administrator targets by non-administrators. | **degraded-but-safe** (pause imports while rolled back, §5) |
| 045 | `can_submit_fleet_inspection`; additive inspection, issue and read policies; the guard's inspector branch uses the helper | The 037 `fleet_inspections_insert` policy is unchanged, so policies only add. Note: the §5 "F2 under the old image" caution is not a regression from 037. Members without an inspection permission were already refused by the 037 policy. | **yes** |
| 046 | Clearance columns and their guard (fires only when the clearance columns change). `enqueue_fleet_inspection_audit` puts critical vehicles Out of Service whatever the automation settings. Outbox `work_order_id`. | The old code never writes clearance columns. The F3 hold rule lives in the new app, so under the old image holds behave as at 037. | **yes** |
| 048 | SELECT policies narrowed to own-or-authorized: certifications, agency-training attendee/requirement/certificate tables, qualification and drill results, range roster and packets, remediation recommendations, qualification attachments | Officers see only their own rows (intended, TRN-26). Every 037 write policy's permission appears in the matching read list, so no read-then-write path sees fewer rows. The runtime role has no direct grants. | **degraded-but-safe** (intended) |
| 049 | Equipment trigger bodies loosened; `profiles` policy widened (drops `is_active`) | Additive | **yes** |
| 050 | Closeout refuses Completed/Passed without Present; issue date in the department zone; superseded tracking | Same wrapper RPCs. The refused case raises before any write. | **degraded-but-safe** |
| 051 | Range trigger loosened; new evidence insert policies; `attachments_select` recreated | Loosens what 048 narrowed | **yes** |
| 052 | Guards: off-duty self-decision, rifle self-review/reinstatement, ammunition self-certification. `ammunition_reconciliations_update` WITH CHECK widened. Rifle history triggers. `revoke insert, update, delete` and `drop policy` on `personal_rifle_status_history`. Off-duty function: `P0002`, and Fail sets Non-Compliant. | **Rifle history:** `authenticated` was already SELECT-only at 037, and no insert policy existed, so the revoke and drop are no-ops against 037. The old route updates the rifle, then inserts history directly. At 037 that returns **500 after the change, with no history row** (pre-existing). On 052 the trigger writes exactly one row with the change; the old insert is still refused (500); a retry gets 409; there are no duplicates. **Reconciliation:** a self-certify is refused (500; the row stays Submitted), and a second-person certify now works (was 500). **Off-duty:** Fail sets Non-Compliant; a missing request is still 404 from the old pre-read. | **degraded-but-safe** (rifle history improved from missing to present) |
| 053 as reviewed (`8574db3`) | `drop policy firearm_status_history_insert_managers`; `revoke insert, update, delete … from authenticated` | The old status route updates `firearms`, then inserts `firearm_status_history` and reverts the status if that fails. Harness: **500**; the status is reverted by a second, separate write; no history. Every firearm status change fails. If the revert write fails, the status is changed with **no history row**. The status is also changed without history between the two writes. | **UNSAFE** |
| 053 expand (this branch) | Adds `change_firearm_status` and `armory_member_identities` only; firearm history grants and policy stay exactly as at 037 | Harness identical to 037 | **yes** |

### Proposals (not implemented; owner decision)

- **043 duplicates.** Either keep the runbook step, or edit 046's `fleet_audit_outbox_deliver_internal` in place (it is unapplied anywhere). The edit would mark an entry delivered, without inserting, when `audit_events` already holds a row for the same action, entity and `details->'inspection'->>'id'`.
- **Old rifle route 500 (pre-existing at 037).** Returning 200 to the old image needs an INSERT grant on `personal_rifle_status_history`, plus a trigger that absorbs a direct row matching the one the database just wrote and refuses anything else. That grant would go beyond the 037 state, which the owner excluded, so it is not done. Under the expand schema the old route's change and its history are both stored; only the response is wrong, as it already is today. The reviewer's note is kept on the rifle row (`chief_decision_notes` etc.); the trigger row's `notes` is null because the old route does not send `workflow_note`.

## 3. Previous-image harness on real PostgreSQL

**Setup:**
- Script: `scratchpad/expand/old-image-harness.cjs`, which runs the `555f061` tree exported with `git archive`.
- It loads the **actual 555f061 route modules** and calls them in `aws-native` mode through `PostgresDataClient`, as `tracepoint_runtime` → `authenticated` with the subject and agency set.
- Only `resolveServerAccess` and the certification capability are stubbed, to supply the session.
- Schemas: Supabase lineage plus `database/aws` 001–037 / 001–053 as reviewed / 001–053 expand / 001–054.

**Firearm status (`PATCH …/status`, In Service → Out of Service, note "Cracked frame"):**

| Schema | Response | Stored | History rows |
|---|---|---|---|
| 037 | 200 | Out of Service | 1 (actor = session, note) |
| 053 as reviewed | **500** | In Service (reverted by a second write) | **0** |
| 053 expand | 200 | Out of Service | 1 (actor = session, note), identical to 037 |
| 054 | **500** | In Service (reverted) | 0 (expected and documented: the contract is applied only after the rollback window closes) |

**The other observations** (the 053-as-reviewed run matches the expand run for all of these):

| Observation | 037 | 053 expand |
|---|---|---|
| Firearm list (armorer) | 200, 2 firearms, holder present | same |
| Rifle create (owner, draft) | **500**; rifle stored; **0 history** | 500; rifle stored; **1 row** "Draft Created", actor = owner |
| Rifle create retried | 409; 1 rifle; 0 history | 409; 1 rifle; 1 history row |
| Rifle chief approval (administrator chief) | **500**; Approved; **0 history** | 500; Approved; **1 row** "Chief Approved", Pending Chief Approval → Approved, actor = reviewer |
| Approval retried | 409; 0 history | 409; 1 history row (no duplicate) |
| Reviewer note | `chief_decision_notes` | same |
| Off-duty Fail inspection | 200; 1 inspection; compliance At Risk | 200; 1 inspection; **Non-Compliant** (B8) |
| Off-duty missing request | 404 | 404 |
| Reconciliation: submit, then certify by the submitter | 200 / **200** (self-certified) | 200 / **500**; stays Submitted (B8 refusal) |
| Reconciliation: certify by a second armorer | **500** | **200**; certified_by = B |
| Fleet Critical inspection (administrator) | 201; Out of Service; 1 audit row | 201; Out of Service; 1 audit row + 1 pending outbox entry |
| After re-upgrade reconciliation | — | **2 audit rows**. With the runbook step: **1**. |

Raw outputs are in `scratchpad/expand/harness-*.txt`.

## 4. Release order

1. Pre-flight and snapshot (STAGING-VERIFICATION §1). Record the current revision: this is the automatic rollback target.
2. `migrate-db.ps1 staging -Action apply` with the release image: 038–046 and 048–053 (expand). **The release image contains no 054**, so `apply` cannot run the contract step in this release.
3. `deploy-app.ps1 staging`. If it fails, the script and the circuit breaker return to the previous image, which is compatible per §2.
4. Acceptance S1–S24 (with S22a amended: direct firearm-history inserts by a manager acting as themselves still succeed until 054).
5. **Rollback window.** The owner decides when to close it, after the B8a image is verified. Until 054, any image rollback is compatible.
6. **Contract (separately approved).**
   - Merge `claude/fix-b8a-contract-054` and build its image. The code is identical, plus `database/aws/054`. Deploy it: its automatic rollback target is the B8a image, which never writes firearm history directly.
   - Then run `migrate-db.ps1 staging -Action apply` with that image to apply 054.
   - Verify `has_table_privilege('authenticated','public.firearm_status_history','insert')` → false, and re-run S22a (d) expecting permission denied.
7. **After 054:** an image rollback **below B8a** requires the forward restore migration first:
   ```sql
   create policy firearm_status_history_insert_managers on public.firearm_status_history
     for insert to authenticated
     with check (changed_by_user_id = tracepoint_auth.subject_id()
       and public.has_any_department_permission(department_id,
         array['manage_firearms','manage_inspections','administer_department']));
   grant insert, update, delete on public.firearm_status_history to authenticated;
   ```
   This restores the exact 037 state. Rollbacks to B8a or later need nothing.

Every later image must contain `054` once it is applied: the runner reports `MIGRATION_DRIFT` for a ledger row with no file.

## 5. Re-upgrade after a rollback (043 runbook step)

Before the new image is deployed again after any period on the previous image, run this as the migration role:

```sql
with matched as (
  select distinct on (o.id) o.id, e.id as event_id
  from public.fleet_audit_outbox o
  join public.audit_events e
    on e.department_id = o.department_id and e.action = o.action
   and e.entity_type = o.entity_type and e.entity_id = o.entity_id
   and e.details->'inspection'->>'id' = o.inspection_id::text
  where o.delivered_at is null
  order by o.id, e.id)
update public.fleet_audit_outbox o
set delivered_at = now(), audit_event_id = m.event_id,
    last_error = 'delivered by the old image (rollback window)'
from matched m where o.id = m.id
returning o.id;
```

Entries that it does not match are inspections whose old-image audit write failed. They are delivered normally after the upgrade.

Other cautions while rolled back are unchanged (STAGING-VERIFICATION §5): export `resultRevisions` and freeze range edits (B3), and pause personnel imports (B1/F1).

## 6. Tests and checks (local, synthetic; PostgreSQL 16 on 127.0.0.1:55667)

| Check | Expand branch | 054 branch |
|---|---|---|
| Clean apply (Supabase lineage + `database/aws`) | 131/131 | 132/132; 054 applied twice more (idempotent) |
| Validator shim (`validate-clean-bootstrap.mjs`) | "Clean bootstrap passed: 79 ordered migrations and 52 AWS-native migrations", including the armory stage | Same, with 53 AWS-native migrations; the contract cases pass |
| Catalog diff against 037 | `firearm_status_history`: grants and policies identical to 037. `personal_rifle_status_history`: grants identical (SELECT only), plus the 052 triggers. | `firearm_status_history`: `authenticated` SELECT only; no insert policy |
| Armory validator, fail before / pass after | New cases fail on the reviewed 053 and pass on the expand 053. The reviewed cases fail on the expand 053. | Contract cases pass on 054 |
| Previous-image harness (§3) | Identical to 037 for the firearm status route and the firearm list; other differences as listed | Old firearm status route → 500, reverted, no history (expected after the window closes) |
| `npx tsc --noEmit` | 0 errors | — (no code change) |
| `node scripts/run-application-tests.mjs` | 744 tests, 740 pass. The 4 failures are the `xlsx`-stub importer tests (environment). 20 embedded-PostgreSQL files ran no tests in this root sandbox (environment). | — |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 351 tests, 350 pass; the failure is the SheetJS XLSX round trip (environment) | — |
| `npx eslint` on changed files | No TypeScript or JavaScript files changed (SQL and Markdown only) | — |
