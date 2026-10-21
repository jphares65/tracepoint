# Release safety: image rollback compatibility of migrations 038–053

Base: integration head `59f6aa0`. Its code is identical to release candidate `8574db3`. Branches:
- **Expand:** `claude/fix-b8a-expand-contract`. This branch is the release.
- **Contract:** `claude/fix-b8a-contract-054`. It is not part of this release.

Owner directive: "Confirm that the staging deployment's automatic rollback cannot return the application to an image incompatible with migrations 052/053. Resolve that release-safety concern before requesting deployment authorization."

**Result:**
- **053 was the only incompatible migration.** It is now edited in place to an expand-only form, and its contract step moved to a separate `054`. 053 has never been applied anywhere: the staging and production ledgers stop at 037 (precedent: F6a/046, B8a/052).
- **043/046: duplicate fleet audit rows (now fixed in the database).** After a rollback and a later re-upgrade, an inspection the old image made would have got a second audit row. **046 is edited in place again** (unapplied anywhere; it already redefines the outbox delivery function), so delivery links the audit row the old image wrote instead of writing another. No runbook step is needed.
- **046: critical safety hold under the previous image (now enforced in the database).** The previous image releases a hold when the work order is closed: its readiness refresh writes Available. **046 is edited in place a third time** (unapplied anywhere): a trigger keeps a held vehicle Out of Service whoever writes it, and audits the prevented change. The safety restriction no longer depends on a runbook instruction during an automatic rollback (§5b).
- Nothing else in 038–053 breaks the previous image or corrupts its records.

## 1. Why the previous image matters

| Mechanism | Where | What it does |
|---|---|---|
| Script rollback | `scripts/deploy-app.ps1`, the `catch` after `Test-Deployment` | Steady state, ALB health, `/api/health`, image digest and the staging HTTP smoke test all run. If any of them fails, the script runs `ecs update-service` back to `$previousHealthyTaskArn`. That is the revision running when the deploy started. |
| ECS circuit breaker | `infra/lib/runtime-stack.ts`: `circuitBreaker: { rollback: true }`, `minHealthyPercent: 100` | If new tasks never become healthy, ECS returns the service to the last completed deployment. During a normal rolling deploy, old and new tasks also serve **together** for a while. |
| Manual rollback | `deploy-app.ps1 -RollbackTaskDefinitionArn` | Accepts any older ACTIVE revision of the family. Earlier revisions are retained on purpose (`runtime-stack.ts`). |
| Migration order | `deploy-app.ps1 -PublishOnly`, then `scripts/migrate-db.ps1 -Action apply` → `run-aws-native-migrations.mjs` in a migration image of the reviewed commit | Applies **every** pending `database/aws` file of that commit, **before** the new image takes traffic (§4; STAGING-VERIFICATION §2–3). |

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
| 043 | New `fleet_audit_outbox` with an AFTER INSERT trigger on `fleet_vehicle_inspections` (queues the audit entry; a Critical inspection takes the vehicle Out of Service) | The old inspection route writes its own `fleet_vehicle_inspected` audit row. The queued entry stays pending under the old image. After a re-upgrade, the new image's `deliver_pending_fleet_audit` writes a **second** row (harness §3: 2 rows for one inspection). **Fixed by the 046 edit:** delivery now links the existing row (harness: 1 row). | **yes** (after the 046 edit; without it: duplicate audit row) |
| 044 | Personnel-import function bodies: blank cells keep stored values; Officer is added only to a new membership; only an Administrator may change an Administrator in the import lifecycle | Same signatures. The old import keeps working, preserves data it would have blanked, and is refused on Administrator targets by non-administrators. | **degraded-but-safe** (pause imports while rolled back, §5) |
| 045 | `can_submit_fleet_inspection`; additive inspection, issue and read policies; the guard's inspector branch uses the helper | The 037 `fleet_inspections_insert` policy is unchanged, so policies only add. Note: the §5 "F2 under the old image" caution is not a regression from 037. Members without an inspection permission were already refused by the 037 policy. | **yes** |
| 046 | Clearance columns and their guard (fires only when the clearance columns change). `enqueue_fleet_inspection_audit` puts critical vehicles Out of Service whatever the automation settings. Outbox `work_order_id`. Status guard `fleet_vehicles_safety_hold_status_guard` (§5b). | The old code never writes clearance columns. Without the status guard, the old refresh released a hold when the work order was closed (Available), as at 037. With it, the old writes succeed but the held vehicle stays Out of Service, with a `fleet_safety_hold_status_kept` audit row (§5b). | **yes** (hold enforced by the database) |
| 048 | SELECT policies narrowed to own-or-authorized: certifications, agency-training attendee/requirement/certificate tables, qualification and drill results, range roster and packets, remediation recommendations, qualification attachments | Officers see only their own rows (intended, TRN-26). Every 037 write policy's permission appears in the matching read list, so no read-then-write path sees fewer rows. The runtime role has no direct grants. | **degraded-but-safe** (intended) |
| 049 | Equipment trigger bodies loosened; `profiles` policy widened (drops `is_active`) | Additive | **yes** |
| 050 | Closeout refuses Completed/Passed without Present; issue date in the department zone; superseded tracking | Same wrapper RPCs. The refused case raises before any write. | **degraded-but-safe** |
| 051 | Range trigger loosened; new evidence insert policies; `attachments_select` recreated | Loosens what 048 narrowed | **yes** |
| 052 | Guards: off-duty self-decision, rifle self-review/reinstatement, ammunition self-certification. `ammunition_reconciliations_update` WITH CHECK widened. Rifle history triggers. `revoke insert, update, delete` and `drop policy` on `personal_rifle_status_history`. Off-duty function: `P0002`, and Fail sets Non-Compliant. | **Rifle history:** `authenticated` was already SELECT-only at 037, and no insert policy existed, so the revoke and drop are no-ops against 037. The old route updates the rifle, then inserts history directly. At 037 that returns **500 after the change, with no history row** (pre-existing). On 052 the trigger writes exactly one row with the change; the old insert is still refused (500); a retry gets 409; there are no duplicates. **Reconciliation:** a self-certify is refused (500; the row stays Submitted), and a second-person certify now works (was 500). **Off-duty:** Fail sets Non-Compliant; a missing request is still 404 from the old pre-read. | **degraded-but-safe** (rifle history improved from missing to present) |
| 053 as reviewed (`8574db3`) | `drop policy firearm_status_history_insert_managers`; `revoke insert, update, delete … from authenticated` | The old status route updates `firearms`, then inserts `firearm_status_history` and reverts the status if that fails. Harness: **500**; the status is reverted by a second, separate write; no history. Every firearm status change fails. If the revert write fails, the status is changed with **no history row**. The status is also changed without history between the two writes. | **UNSAFE** |
| 053 expand (this branch) | Adds `change_firearm_status` and `armory_member_identities` only; firearm history grants and policy stay exactly as at 037 | Harness identical to 037 | **yes** |

### Proposals (not implemented; owner decision)

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
| After re-upgrade reconciliation | — | **1 audit row**. The outbox entry is delivered with `delivered_by_existing_audit = true`, linked to the old image's row. Before the 046 edit there were **2**. |

Raw outputs are in `scratchpad/expand/harness-*.txt`.

## 4. Release order

The migrations must land before the new image serves traffic. `migrate-db.ps1` refuses to run until the reviewed application image is in ECR with a clean scan. Before this release, `deploy-app.ps1` could only publish **and** roll out in one run. `deploy-app.ps1 -PublishOnly` now stops after the scan-checked publish, before any task registration or ECS change. Run every step from one clean checkout whose `HEAD` is the deploy SHA.

1. Pre-flight and snapshot (STAGING-VERIFICATION §1). Record the current revision: this is the automatic rollback target.
2. `deploy-app.ps1 staging -PublishOnly`. ECR and CodeBuild only. The previous image keeps serving.
3. `migrate-db.ps1 staging -Action status`: expect 038–046 and 048–053 pending.
4. `migrate-db.ps1 staging -Action apply`: 038–046 and 048–053 (expand). **The release commit contains no 054**, so `apply` cannot run the contract step in this release. Then run `-Action status` again: expect nothing pending. From here, the previous image runs on the migrated schema, which is compatible per §2.
5. `deploy-app.ps1 staging`. It reuses the image from step 2 (immutable tag, scan re-checked) and rolls it out. If it fails, the script and the circuit breaker return to the step 1 revision, which is compatible per §2.
6. Acceptance S1–S24 (with S22a amended: direct firearm-history inserts by a manager acting as themselves still succeed until 054).
7. **Rollback window.** The owner decides when to close it, after the B8a image is verified. Until 054, any image rollback is compatible.
8. **Contract (separately approved).**
   - Merge `claude/fix-b8a-contract-054` and build its image. The code is identical, plus `database/aws/054`. Deploy it: its automatic rollback target is the B8a image, which never writes firearm history directly.
   - Then run `migrate-db.ps1 staging -Action apply` with that image to apply 054.
   - Verify `has_table_privilege('authenticated','public.firearm_status_history','insert')` → false, and re-run S22a (d) expecting permission denied.
9. **After 054:** an image rollback **below B8a** requires the forward restore migration first:
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

## 5. Re-upgrade after a rollback: fleet audit outbox (043/046)

**The fix.** `fleet_audit_outbox_deliver_internal` (046, edited in place again) settles an outbox entry from an existing audit row. Both `deliver_fleet_audit_outbox` (each request) and `deliver_pending_fleet_audit` (reconciliation) go through it.
- It locks the entry (`for update`; the callers also lock it) and returns at once if the entry is already delivered.
- It then looks for an `audit_events` row with the same department, action, entity type and entity, whose `details->'inspection'->>'id'` is the entry's inspection. `inspection_id` is unique in the outbox.
- If it finds one, it marks the entry delivered, links that row (`audit_event_id`), sets the new column `delivered_by_existing_audit = true`, and inserts nothing.
- Otherwise it writes the audit row as before, with the F3/F6a `work_order_id`.
- The old image's own audit write is unchanged. The B8a image never writes that row directly on this schema, so its inspections still get exactly one row from the outbox.

**Residual.** An old-image inspection whose own audit write came more than five minutes after the inspection could be reconciled first. That would be the old route's request taking over five minutes between two consecutive statements. Inspections whose old audit write failed are delivered normally, once.

**No runbook step is needed.** The query below is kept only as a **diagnostic**: before a re-upgrade it lists entries an older image already audited. After the upgrade they show `delivered_by_existing_audit = true`. Do not run it as an `update`.

```sql
select o.department_id, o.inspection_id, min(e.id) as existing_audit_event_id
from public.fleet_audit_outbox o
join public.audit_events e
  on e.department_id = o.department_id and e.action = o.action
 and e.entity_type = o.entity_type and e.entity_id = o.entity_id
 and e.details->'inspection'->>'id' = o.inspection_id::text
where o.delivered_at is null
group by o.department_id, o.inspection_id;
```

Other cautions while rolled back are unchanged (STAGING-VERIFICATION §5): export `resultRevisions` and freeze range edits (B3), and pause personnel imports (B1/F1).

## 5b. Critical safety hold under the previous image (046)

Owner directive: "I do not want a critical vehicle safety restriction dependent solely on a runbook instruction during an automatic rollback. Determine whether this can be prevented at the database level or through a reliable rollback safeguard."

**Finding** (rollback harness, previous image `555f061` on 038–053). Completing or cancelling the critical work order of a held vehicle returned it to Available. The 046 clearance guard protected only the clearance columns. The new image put the hold back on its next refresh, but until then, during a rollback or a rolling deploy, the vehicle looked usable.

**Every path that writes a held vehicle's status:**

| Path | Image | Session | Columns written | Outcome before (released?) |
|---|---|---|---|---|
| Work order complete or cancel (`work-orders` PATCH), then `refreshFleetVehicle` | old | `authenticated` through RLS (mechanic: 040/045 field policy and guard; manager: `fleet_vehicles_manage`) | `fleet_work_orders` row; `fleet_vehicles` service readings (`updateVehicleService`); then `status`, `open_issue_count`, `updated_at`. The old refresh has no hold rule and ignores the update error. | **Yes:** Available (or Attention or Maintenance when other work is open) |
| Work order create (issue or maintenance), equipment add, inspection: each followed by `refreshFleetVehicle` | old | `authenticated` | same refresh columns | **Yes**, once no critical work order is open |
| Vehicle detail PATCH (status override) | old and new | `authenticated`, `manage_fleet`/`administer_department` | `status`, `status_reason`, `status_override_active = true`, other fields; then the refresh. On audit failure, the previous row is written back. | Old: **yes** (Available with override; the old refresh skips overridden vehicles). New: no, its refresh escalates an overridden Available/Attention vehicle to Out of Service in the next statement |
| Fleet list PATCH (status) | old and new | `authenticated`, manager | `status`, `status_reason`, `status_override_active`, other fields | Old: **yes**. New: refresh escalates |
| Inspection with a critical defect | both | `authenticated`; 043/046 definer trigger | trigger sets Out of Service from Available/Attention | No (safe direction) |
| Inspection without critical defects | both | `authenticated` | inspection row, then the refresh | Releases a hold by design (re-inspection) |
| Clearance (`clearSafetyHold`) | new only | `authenticated`, manager; 046 clearance guard | clearance columns, then the refresh | Releases by design (reason required, audited) |
| Document upload (registration date), AI importer vehicle update | both | `authenticated` | `registration_expiration_date`; importer: any listed column including `status` | Importer: **yes** if it sets Available |
| Automation | — | none: there is no scheduled job; automation is the refresh above | — | — |

**Change (046, edited in place a third time).** A `BEFORE UPDATE` trigger `fleet_vehicles_safety_hold_status_guard` (function `guard_fleet_safety_hold_status()`) runs after the 040/045 field guard and the clearance guard (trigger names fire in alphabetical order). When a write would leave the vehicle **Available or Attention**, it computes the hold as `findSafetyHold`/`refreshFleetVehicle` do:
- held if a Critical or availability-affecting work order is open; or
- held if the latest critical condition (inspection with `critical_defect_count > 0`, or a Critical or availability-affecting work order in any status) is not followed, strictly later, by an inspection without critical defects or by `safety_hold_cleared_at`.

If the vehicle is held, the trigger sets `status = 'Out of Service'` and lets the rest of the write proceed. It writes one `audit_events` row: action `fleet_safety_hold_status_kept`, actor = the session subject (`tracepoint_auth.subject_id()`), details `{attempted_status, previous_status, status, hold: {since, open_critical_work_order}, support_mode}`. Nothing else changes: the hold, the clearance columns, `status_reason` and `status_override_active`.

- **Keep, not refuse.** A refusal would make the old refresh fail silently (it ignores the error), so `open_issue_count` would go stale. The old work-order PATCH would still answer 200, because its work-order update is a separate statement. Keeping the status lets the old work-order completion, its audit and its readings succeed as at 037; only the status change is neutralized.
- **Available and Attention only.** Maintenance, Out of Service and Retired are not in service, and the new image already keeps a manager's Maintenance or Retired on a held vehicle (B2 amendment, F6a). Available/Attention → Out of Service is unaffected.
- **Every writer.** The trigger has no role exception. It is `SECURITY DEFINER`, as 043/046's `enqueue_fleet_inspection_audit`, so the hold is read from every record of the vehicle, whatever the writer may read, and the audit row is written whatever the writer's audit policy. EXECUTE is revoked from `public`, `anon`, `authenticated` and `service_role`. No grant or policy changes.
- **Release paths unchanged.** Only a later inspection without critical defects (either image records it) or a manager clearance with a reason (new image, 046 guard) releases a recorded hold. The new image never writes Available/Attention to a held vehicle, so its flows (S2, S11, S12) write no extra rows. One exception: a manager's status override to Available on a held vehicle now ends Out of Service in the override's own statement, with a `fleet_safety_hold_status_kept` row, instead of in the refresh that follows. The final state is the same: Out of Service, the override and its reason kept.

**Defense in depth (not required).** The runbook item "no fleet work-order completions on held vehicles while rolled back" is no longer a safety control. It is kept only as advice: the old image's responses report the status it tried to write. For example, the work-order PATCH's `readiness.status` says Available, while every read shows Out of Service. Read-only check after a rollback:

```sql
select v.department_id, v.unit_number, e.created_at, e.actor_user_id, e.details->>'attempted_status' as attempted
from public.audit_events e join public.fleet_vehicles v on v.id = e.entity_id
where e.action = 'fleet_safety_hold_status_kept' order by e.created_at desc limit 50;
```

**Residuals (not changed; owner decision if wanted).**
- In both images, a mechanic or manager can edit a hold's *work order* to priority Normal with `affects_availability` false (work-order PATCH). If that order was the only critical condition (a manual issue report, not a critical inspection), the hold is gone in both `findSafetyHold` and the trigger. A critical inspection still holds, because its row is unchanged. This is the existing new-image rule, not a rollback regression.
- The trigger mirrors the hold rule in SQL. If `findSafetyHold` changes, change both; a comment there says so.

**Verification (local, synthetic; PostgreSQL 16 on 127.0.0.1:55671):**

| Test | Before (046 at `628b609`) | After |
|---|---|---|
| Validator `scripts/validate-local-safety-hold-rollback.sql` (new, AWS stage, after the outbox stage), with the runtime session shape. Mechanic completes vehicle 1's critical work order, then writes Available like the old refresh. Vehicle 2 (critical WO already completed) gets Available. Vehicle 4 (open critical WO, later passing inspection) gets Attention. Manager override Available on vehicle 1. Vehicle 3 has no hold. Then: Maintenance on a held vehicle; a clearance with a blank reason; a clearance with a reason; a passing inspection; completion of vehicle 4's work order. | **Fails:** "HR-1 is Available (override t, open issues 0), 0 kept audit rows" | **Passes:** the work order is Completed; vehicles 1, 2 and 4 stay Out of Service (`open_issue_count` updated); 4 audit rows by the mechanic and the manager; vehicle 3 Attention with none. Maintenance is allowed. The blank-reason clearance gets `22023`. The clearance, the passing inspection and the work-order completion each release (Available) with no further audit row. `authenticated` cannot execute the function. |
| Full validator (`validate-clean-bootstrap.mjs` via the local shim) | Fails at the new stage with the message above | "Clean bootstrap passed: 79 ordered migrations and 52 AWS-native migrations" |
| Clean apply, and 046 applied a second time | — | 131/131; the re-application succeeds |
| Previous-image harness (scratch `holdrb/`, from the rollback harness): 037 template, then 038–053 through the runner shim as `tracepoint_migrator`. The real `555f061` and `628b609` route modules run as `tracepoint_runtime` → `authenticated`. | | |
| ↳ New image: critical inspection on v1, v2, v4. Old image: mechanic completes v1's WO; manager cancels v2's; manager completes v4's | 200 each; v1, v2, v4 **Available** | 200 each; WOs Completed/Cancelled; v1, v2, v4 **Out of Service**; 1 kept row each, actor = the session user |
| ↳ Old admin detail PATCH v4 Available (override), then old list PATCH v4 Attention | 200; Available, then **Attention** | 200; Out of Service (override kept); kept rows by admin and manager |
| ↳ Old manual work order on v1, old equipment add on v2 (both refresh) | v1 Attention, v2 Available | Out of Service both |
| ↳ Old full fleet workflow on v3 (critical inspection, complete WO, manual WO, passing inspection) | Available after the completion | Out of Service after the completion and the manual WO; **Attention** after the passing inspection (released, one Normal WO open) |
| ↳ Mixed fleet: three fleet workflows with old/new alternating per request | every old completion → Available | every old completion → Out of Service; new steps write no kept row; each ends Attention after the passing inspection |
| ↳ New image after rollback: re-inspection pass on v1 | — (already Attention) | Attention (released; one Normal WO open) |
| ↳ New clearance on v2: blank reason / mechanic / manager with reason | 400 / 403 / 200 | 400 / 403 / **200 → Available** |
| ↳ New clearance on v4 (old override active), then clear the override | — | 200, Out of Service (the manager's old override stays, as without the guard), then Available |
| Fleet native tests (`fleet-safety-hold-native`, `fleet-audit-outbox-native`, `vehicle-documents-native`) through the local-server runner | — | 6/6, 5/5, 2/2 |
| Fleet handler tests (`src/lib/fleet/*.test.ts` except native) | — | 40/40 |

## 6. Tests and checks (local, synthetic; PostgreSQL 16 on 127.0.0.1:55667)

| Check | Expand branch | 054 branch |
|---|---|---|
| Clean apply (Supabase lineage + `database/aws`) | 131/131 | 132/132; 054 applied twice more (idempotent) |
| Validator shim (`validate-clean-bootstrap.mjs`) | "Clean bootstrap passed: 79 ordered migrations and 52 AWS-native migrations", including the armory stage | Same, with 53 AWS-native migrations; the contract cases pass |
| Catalog diff against 037 | `firearm_status_history`: grants and policies identical to 037. `personal_rifle_status_history`: grants identical (SELECT only), plus the 052 triggers. | `firearm_status_history`: `authenticated` SELECT only; no insert policy |
| Armory validator, fail before / pass after | New cases fail on the reviewed 053 and pass on the expand 053. The reviewed cases fail on the expand 053. | Contract cases pass on 054 |
| Fleet outbox validator (`scripts/validate-local-fleet-audit-outbox.sql`, new, in the AWS stage), fail before / pass after | Four inspections: two audited directly in the old image's shape, two not. Each goes through reconciliation or the request's delivery, twice. Each ends with exactly 1 audit row and is linked to it; `delivered_by_existing_audit` is true exactly for the directly audited ones. **Before the 046 edit** (previous function bodies): fails with "2 audit rows". | Same |
| `fleet-audit-outbox-native` and `fleet-safety-hold-native` (embedded PostgreSQL) | Not run in this root sandbox (environment). Their stub schemas include `audit_events.details`, which the new lookup reads. | — |
| Previous-image harness (§3) | Identical to 037 for the firearm status route and the firearm list; other differences as listed | Old firearm status route → 500, reverted, no history (expected after the window closes) |
| `npx tsc --noEmit` | 0 errors | — (no code change) |
| `node scripts/run-application-tests.mjs` | 744 tests, 740 pass. The 4 failures are the `xlsx`-stub importer tests (environment). 20 embedded-PostgreSQL files ran no tests in this root sandbox (environment). | — |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 351 tests, 350 pass; the failure is the SheetJS XLSX round trip (environment) | — |
| `npx eslint` on changed files | `scripts/validate-clean-bootstrap.mjs` (runs the new fleet outbox validator): clean. The other changes are SQL and Markdown. | — |
| §5b safety hold status guard (same checks, PostgreSQL 16 on 127.0.0.1:55671) | `npx tsc --noEmit` 0 errors. `run-application-tests.mjs`: 744 tests, 740 pass; the 4 failures are the `xlsx`-stub importer tests, and 20 embedded-PostgreSQL files ran no tests (environment; the three fleet ones ran through the local runner, §5b). `scripts/*.test.mjs`: 350/351 (the SheetJS round trip). `npx eslint scripts/validate-clean-bootstrap.mjs`: clean. `src/lib/tracepoint/fleet-server.ts` (one comment line pointing at the SQL rule) has the same 12 existing `no-explicit-any` errors as the base. | — |
