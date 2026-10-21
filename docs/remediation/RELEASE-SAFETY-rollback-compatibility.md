# Release safety: image rollback compatibility of migrations 038–053

Base: integration head `59f6aa0`. Its code is identical to release candidate `8574db3`. Branches:
- **Expand:** `claude/fix-b8a-expand-contract`. This branch is the release.
- **Contract:** `claude/fix-b8a-contract-054`. It is not part of this release.

Owner directive: "Confirm that the staging deployment's automatic rollback cannot return the application to an image incompatible with migrations 052/053. Resolve that release-safety concern before requesting deployment authorization."

**Result:**
- **053 was the only incompatible migration.** It is now edited in place to an expand-only form, and its contract step moved to a separate `054`. 053 has never been applied anywhere: the staging and production ledgers stop at 037 (precedent: F6a/046, B8a/052).
- **043/046: duplicate fleet audit rows (now fixed in the database).** After a rollback and a later re-upgrade, an inspection the old image made would have got a second audit row. **046 is edited in place again** (unapplied anywhere; it already redefines the outbox delivery function), so delivery links the audit row the old image wrote instead of writing another. No runbook step is needed.
- **JSON documents: range correction history and ammunition actors (now fixed in the database).** The previous image read-modify-writes two JSON documents whose new content it does not know. Its range save dropped `workspace.resultRevisions`, and its ammunition page dropped the activity and count actor fields. That happens on its first save after an automatic rollback, or on any save it serves during a rolling deployment. **042 and 052 are edited in place** (unapplied anywhere) with `BEFORE` triggers that keep that data and account for the previous image's own changes (§2a). The "export `resultRevisions` and freeze range edits" caution is withdrawn.
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
| 042 | `protect_pilot_range_workspace_mutation`, `protect_range_day_drill_history`: Ready no longer locks. **Edited in place (§2a):** new trigger `pilot_range_workspaces_keep_result_revisions` | Loosened only. The old range save no longer removes `resultRevisions`, and its corrections get a revision marked `recordedBy: "database"` (§2a). | **yes** |
| 043 | New `fleet_audit_outbox` with an AFTER INSERT trigger on `fleet_vehicle_inspections` (queues the audit entry; a Critical inspection takes the vehicle Out of Service) | The old inspection route writes its own `fleet_vehicle_inspected` audit row. The queued entry stays pending under the old image. After a re-upgrade, the new image's `deliver_pending_fleet_audit` writes a **second** row (harness §3: 2 rows for one inspection). **Fixed by the 046 edit:** delivery now links the existing row (harness: 1 row). | **yes** (after the 046 edit; without it: duplicate audit row) |
| 044 | Personnel-import function bodies: blank cells keep stored values; Officer is added only to a new membership; only an Administrator may change an Administrator in the import lifecycle | Same signatures. The old import keeps working, preserves data it would have blanked, and is refused on Administrator targets by non-administrators. | **degraded-but-safe** (pause imports while rolled back, §5) |
| 045 | `can_submit_fleet_inspection`; additive inspection, issue and read policies; the guard's inspector branch uses the helper | The 037 `fleet_inspections_insert` policy is unchanged, so policies only add. Note: the §5 "F2 under the old image" caution is not a regression from 037. Members without an inspection permission were already refused by the 037 policy. | **yes** |
| 046 | Clearance columns and their guard (fires only when the clearance columns change). `enqueue_fleet_inspection_audit` puts critical vehicles Out of Service whatever the automation settings. Outbox `work_order_id`. | The old code never writes clearance columns. The F3 hold rule lives in the new app, so under the old image holds behave as at 037. | **yes** |
| 048 | SELECT policies narrowed to own-or-authorized: certifications, agency-training attendee/requirement/certificate tables, qualification and drill results, range roster and packets, remediation recommendations, qualification attachments | Officers see only their own rows (intended, TRN-26). Every 037 write policy's permission appears in the matching read list, so no read-then-write path sees fewer rows. The runtime role has no direct grants. | **degraded-but-safe** (intended) |
| 049 | Equipment trigger bodies loosened; `profiles` policy widened (drops `is_active`) | Additive | **yes** |
| 050 | Closeout refuses Completed/Passed without Present; issue date in the department zone; superseded tracking | Same wrapper RPCs. The refused case raises before any write. | **degraded-but-safe** |
| 051 | Range trigger loosened; new evidence insert policies; `attachments_select` recreated | Loosens what 048 narrowed | **yes** |
| 052 | Guards: off-duty self-decision, rifle self-review/reinstatement, ammunition self-certification. `ammunition_reconciliations_update` WITH CHECK widened. Rifle history triggers. `revoke insert, update, delete` and `drop policy` on `personal_rifle_status_history`. Off-duty function: `P0002`, and Fail sets Non-Compliant. | **Rifle history:** `authenticated` was already SELECT-only at 037, and no insert policy existed, so the revoke and drop are no-ops against 037. The old route updates the rifle, then inserts history directly. At 037 that returns **500 after the change, with no history row** (pre-existing). On 052 the trigger writes exactly one row with the change; the old insert is still refused (500); a retry gets 409; there are no duplicates. **Reconciliation:** a self-certify is refused (500; the row stays Submitted), and a second-person certify now works (was 500). **Off-duty:** Fail sets Non-Compliant; a missing request is still 404 from the old pre-read. | **degraded-but-safe** (rifle history improved from missing to present). **Edited in place (§2a):** new trigger `pilot_ammunition_workspaces_keep_actors` keeps the ammunition actors the old page drops. |
| 053 as reviewed (`8574db3`) | `drop policy firearm_status_history_insert_managers`; `revoke insert, update, delete … from authenticated` | The old status route updates `firearms`, then inserts `firearm_status_history` and reverts the status if that fails. Harness: **500**; the status is reverted by a second, separate write; no history. Every firearm status change fails. If the revert write fails, the status is changed with **no history row**. The status is also changed without history between the two writes. | **UNSAFE** |
| 053 expand (this branch) | Adds `change_firearm_status` and `armory_member_identities` only; firearm history grants and policy stay exactly as at 037 | Harness identical to 037 | **yes** |

### Proposals (not implemented; owner decision)

- **Old rifle route 500 (pre-existing at 037).** Returning 200 to the old image needs an INSERT grant on `personal_rifle_status_history`, plus a trigger that absorbs a direct row matching the one the database just wrote and refuses anything else. That grant would go beyond the 037 state, which the owner excluded, so it is not done. Under the expand schema the old route's change and its history are both stored; only the response is wrong, as it already is today. The reviewer's note is kept on the rifle row (`chief_decision_notes` etc.); the trigger row's `notes` is null because the old route does not send `workflow_note`.

## 2a. JSON documents the previous image reads, modifies and writes

**Method.**
- Every JSON or JSONB column the app writes was listed from `jsonColumns` in `postgres-data-client.ts`.
- For each one, the `555f061` writers were read: the route, its server normaliser, and the page or client normaliser that builds the body (`git show 555f061:<file>`). Each was compared with what the integration release (`70717ba` code plus 038–053) stores.
- The question for each key: does the previous image drop it on save, either as a top-level key or as a field inside a stored item?

| Document | Key added by the release | Previous image on save | Consequence if dropped | Class | Fix |
|---|---|---|---|---|---|
| `pilot_range_workspaces.workspace` | top-level `resultRevisions` (B3: previous version of every corrected or replaced result and malfunction, with revisedAt/revisedByUserId) | Web `PUT /api/pilot/range-workspace`: `normalizeWorkspace` keeps six collections, so the key is **dropped**. Mobile `PUT`: stores the client body as sent; the key is kept only if the native client echoes it. | Correction history lost from the live record (only `audit_events.previous_value` keeps it) | **CORRUPTING** | 042 trigger |
| same | (accountability) a correction **made by** the previous image | Edits a result in place and writes no revision (the old authorizer refuses removals, so it cannot replace one) | That correction never appears in the history the current image shows | **missing history** | 042 trigger adds a revision marked `recordedBy: "database"` |
| same | `results[].firearmTypeSnapshot` (B10, set on new results; `qualification-readiness.ts` reads it for the firearm type) | The server keeps result items verbatim. The old page loads them with `setResults(stored)`, edits by spreading, and its batch save keeps every other result object (a same-key re-save with new IDs is refused 409 by the old authorizer) | Would change a qualification's firearm type | benign: harness shows 0 lost keys | — |
| same | `rangeRoster[]` attendance and walk-ups (B10), stable result and malfunction IDs and kept malfunction reporter/date (B3) | Existing fields. The old page spreads roster entries; its range-day normalisation only adds defaults (as at 037) | — | benign | — |
| `pilot_ammunition_workspaces.workspace` | `activity[].recordedByUserId`, `recordedByName` (ARM-21) | The server keeps rows verbatim. The old page's `normalizeAmmoWorkspace` rebuilds each row from a fixed field list, so both are **dropped** on its next save | Who recorded an issue or adjustment is lost | **CORRUPTING** | 052 trigger |
| same | `reconciliations[].countedByUserId`, `countedByName` (ARM-21) | Same | Who counted is lost | **CORRUPTING** | 052 trigger |
| same | (accountability) rows **added by** the previous image | Stored without an actor (the current image stamps one) | The row stays unattributed after the re-upgrade, because the current image carries the stored value | **missing history** | 052 trigger stamps the session subject |
| same | `reconciliations[].expectedQuantity`, `variance`, `notes` (ARM-22 rules) | Existing fields, kept by the old normaliser. The old image does not enforce the variance reason or the stored expected quantity, as at 037 | — | benign (= 037) | — |
| `ammunition_reconciliation_items` (relational, ARM-23) | not a JSON key | The old submit and certify delete and re-insert items with browser values, as at 037. A self-certify is refused by 052 after that rewrite (the 037 non-atomic pattern, §2 052 row) | — | pre-existing | — |
| `pilot_remediation_workspaces.remediations` | none (route and library unchanged) | — | — | benign | — |
| `personal_rifles.armorer_checklist`; `personal_rifles.workflow_note` (052, text) | no new checklist keys; `workflow_note` is always null at rest | The old route writes the checklist it receives (as at 037) and never writes `workflow_note` | — | benign | — |
| `personal_rifle_status_history.metadata` | written by the 052 trigger | The old image never updates history rows | — | benign | — |
| `notification_preferences.source_preferences` | no new server keys (the Inbox panel edits the same map) | The old route stores the map as sent | — | benign | — |
| `fleet_rules.inspection_checklist`, `fleet_vehicle_inspections.checklist`, `range_days.outline`, `ai_migration_workspaces.state`, `department_rules` | none | Inspections are insert-only; the others are unchanged | — | benign | — |
| `audit_events.details/new_value/previous_value`, `fleet_audit_outbox.details` | written by the database or the current image | The old image only inserts its own rows | — | benign | — |

Relational columns added by 038–053 are outside this inventory: 046 (fleet clearance, handled on its own branch) and 050 `superseded_by_training_event_id` (maintained by the 050 functions the old image also calls).

**042: `keep_range_result_revisions()`, trigger `pilot_range_workspaces_keep_result_revisions` (BEFORE UPDATE).**
1. Takes the stored `resultRevisions` (or `result_revisions`).
2. Appends only those sent entries whose id (or value) is not already stored. A write therefore cannot shorten or rewrite the history. If the write omits the key, the stored history comes back.
3. For every stored result or malfunction that the write changes or removes, it checks for a sent revision of exactly that stored version. If there is none, it appends one with the current image's shape (`collection`, `recordId`, `rangeDayId`, `replacedById` = the id if the item is still present, else `""`, `revisedAt` = the row's `updated_at`, `revisedByUserId` = the session subject or else `updated_by_user_id`, `previous`). It adds `recordedBy: "database"` and the id `revision-<revisedAt>-db-<position>`.
4. The current image always sends its own revision for each change, against the version it compare-and-swapped, so its writes are stored byte-for-byte as sent.

Properties:
- Removals stay removals; only their last version is kept.
- A document that has no history and has no change gains no key.
- Write order does not matter: `protect_pilot_range_workspace_mutation` does not read the history.

**052: `keep_ammunition_workspace_actors()`, trigger `pilot_ammunition_workspaces_keep_actors` (BEFORE INSERT OR UPDATE, V2 documents only).**
- An `activity` or `reconciliations` row matching a stored row by id gets back only the actor fields the write omits.
- A row with no stored match and neither field is stamped with the session subject (or else `updated_by`) and that profile's name. The current image does the same.
- Values a write sends are never replaced, and rows a write removes are not brought back.
- The previous image saves with an upsert. Its insert pass returns early when the department's row exists, so the update pass does the merge.

**Both functions:**
- `SECURITY INVOKER`, fixed `search_path`, EXECUTE revoked from `public`/`anon`/`authenticated`/`service_role` (a trigger needs no EXECUTE).
- No grant or policy changes, so permissions stay at the 037 state plus 038–053 as reviewed.
- Deterministic and idempotent: the same write applied again adds nothing.

**Edited files** (commit `8c9ac59`; both unapplied anywhere, since the staging and production ledgers stop at 037). A rehearsal or CI database that already ran the earlier text reports `MIGRATION_DRIFT` and must be rebuilt.

| File | sha256 before | sha256 after |
|---|---|---|
| `042_range_packet_ready_is_not_final.sql` | `7f645286aadf9e7985c8cbf59b88e95177ff30e0afd1f6b9105cb55748ad6e7c` | `3dee6dcb1ed3fadf7c4b9b35e0cd10065b7cd6b2b57065a4d8909b9dfce44707` |
| `052_armory_separation_of_duties.sql` | `dd12683cc38a37c24b49a62d17cca66dc652e2535aba3bce521f7eafccae2a65` | `798422b938cde2998c92a137a357c6d9abc4b89b42983c69d1a8ef75b1ae76fd` |

**Contract step.** These triggers do not depend on the 054 contract and are not rollback-only in effect: they keep the history append-only for any writer. `054` does not drop them, and they are harmless to keep after the rollback window closes.

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

Other cautions while rolled back are unchanged (STAGING-VERIFICATION §5): pause personnel imports (B1/F1). The B3 "export `resultRevisions` and freeze range edits" caution is withdrawn, because the 042 trigger covers it (§2a, §7).

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

## 7. JSON preservation tests (042/052 edit; PostgreSQL 16 on 127.0.0.1:55670)

**Validator stage `scripts/validate-local-rollback-json-preservation.sql`** (AWS stage, after the fleet outbox stage). The writes run as `tracepoint_runtime` → `authenticated` with the subject set.

| Case | Before the edit (628b609 042/052) | After |
|---|---|---|
| Range 1: a previous-image save (no `resultRevisions`) corrects a result | **fails**: "previous-image save lost the stored revision history" | history kept; one `recordedBy: database` revision with the old score, actor = subject; `firearmTypeSnapshot` kept |
| Range 2: a current-image correction with its own revision | stored as sent | stored as sent (byte-equal) |
| Range 3: a write that sends a shortened and rewritten history | — | stored history unchanged |
| Range 4–5: a previous-image removal, then the same save again | — | removed; one revision with `replacedById ""`; the repeat adds nothing |
| Range 6: a document with no history and no change | — | no key added |
| Ammunition 1: the old page's upsert drops every actor and adds a row | **fails** (with only 042 applied): actors lost | stored actors back; the new row stamped with the subject and profile name; the explicit null actor kept |
| Ammunition 2: a sent actor value; a removed row | — | sent value wins; removed rows stay removed |
| Ammunition 3: a first save (insert) by the old page | — | rows stamped |

Full validator shim: **passes** ("79 ordered migrations and 52 AWS-native migrations"). Control: the same run on the pre-edit 042/052 **fails** with "AWS-native rollback JSON preservation failed: Range: previous-image save lost the stored revision history". 042 and 052 were applied twice more: no error, and the validator still passes.

**Concurrency** (`scratchpad/jsonkeys/conc.mjs`; READ COMMITTED; two sessions on one workspace; the first holds its transaction open and the second blocks on the row lock):

| Interleaving | Before | After |
|---|---|---|
| new then old, both compare-and-swap on `updated_at` (both routes do; B3 `baseUpdatedAt` is checked before that) | second: 0 rows (409); history kept | same |
| new+new compare-and-swap | second: 0 rows; first kept | same |
| new then old, old unconditional (last writer wins) | **history wiped** | new revision kept; the overwritten version (score 60) recorded by the database |
| old then new, new unconditional | old correction unaccounted | old correction's database revision kept; the overwritten version recorded |
| new+new unconditional | **first revision lost** | both kept; overwritten version recorded |
| ammunition: new stamps a row while the old page's stale upsert waits | **actors lost** on the surviving rows | actors kept. The concurrently added row is lost by last-writer-wins (no version check on this document, as at 037 and in the current image; ARM-21 deferral) |

Because the trigger compares against the row it actually replaces (under READ COMMITTED, `OLD` is the row version current when the lock is acquired), interleaving cannot lose history.

**Previous-image harness, rerun** (copied from `scratchpad/oldapp` into `scratchpad/jsonkeys/harness`; the originals are untouched). Real route modules of `555f061` and of this branch run as separate "ECS task" processes on one database: P2 at 037, then migrations, then P3 new writes → P4 rollback → P5 roll-forward → P6 alternating. Added for this edit:
- the ammunition document workflow (GET, the serving task's page normaliser, add an activity and a count, PUT);
- per-save checks for lost keys (top level, and fields of every stored item by id), unintended value changes, whether a correction is accounted for in the history, and unattributed rows;
- capture triggers recording each write as sent and as stored, to prove the current image's writes are not altered.

| Workflow (P3–P6) | Variant B (pre-edit 042/052) | Variant D (this edit) |
|---|---|---|
| Range saves by the previous image on new-written documents (P4 carry; P6 mixed) | **3 saves dropped `resultRevisions`** (2→0, 1→0, 1→0); 5/5 corrections unaccounted | 0 lost keys; history kept (2→3, 0→1, 2→3, 4→5); 5/5 corrections accounted (`database` revisions) |
| Range saves by the current image (8) | stored as sent | stored as sent (capture: 0 altered); roll-forward reads 3 and 4 revisions (B: 0) |
| Ammunition saves by the previous image's page (7) | **16 actor fields lost** (P4 carry, P6 mixed); new rows unattributed (30 row-steps) | 0 lost; 0 unattributed; new rows stamped with the armorer |
| Ammunition saves by the current image (9, including the page from the old task) | stamps as designed | same (capture: 0 altered) |
| Changed values other than the edited score | 0 | 0 |
| Every other step (firearm status and custody, rifles, off-duty, ammunition ledger and reconciliation, fleet and outbox, equipment, training, personnel import, reads; 517 steps) and the phase-end history invariants | — | **identical to B**. Old-image 5xx count unchanged (61 in both, all pre-existing or intended, §3 and harness RESULTS) |

Required checks on `8c9ac59`:
- `npx tsc --noEmit`: 0 errors.
- `node scripts/run-application-tests.mjs`: 744 tests, 740 pass. The 4 failures are the xlsx-stub importer tests; 20 embedded-PostgreSQL files ran no tests (environment).
- `node --test --test-concurrency=1 scripts/*.test.mjs`: 351 tests, 350 pass. The failure is the SheetJS round trip.
- `npx eslint scripts/validate-clean-bootstrap.mjs`: clean.
- Clean apply: 131/131.
