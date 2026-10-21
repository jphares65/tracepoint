# Follow-up batch B8a: armory audit history and access gaps

Base: `claude/integration-defects-20261020` @ `e19e84c` (B0–B11 except B6; migrations 038–046 and 048–052). Context: `B8-armory-integrity.md` (its "Deferred / owner decisions" and its pre-existing AWS read gaps) and `B9-separated-custody.md`. Migrations: **052 edited in place; unapplied anywhere** (staging and production stop at 037, as with the F6a precedent for 046), and new **053**.

Scope: defects only. The owner wanted no over-wide history policy to exist at any point, so the B8 history INSERT policy was removed from 052 itself instead of being revoked by a later file. Nothing new is configurable. The profiles, memberships, role-permission and off-duty request read policies are **not** widened.

## Expand/contract amendment (release safety)

The previous staging image is the automatic rollback target (`deploy-app.ps1`, ECS circuit breaker). Its firearm status route inserts `firearm_status_history` directly. As reviewed, 053 revoked that write, so after a rollback every firearm status change would return 500. The status was reverted by a second, separate write, and if that write failed the status stayed changed with no history row.

**053 is now edited in place** (never applied anywhere) to the expand form:
- it adds `change_firearm_status` and `armory_member_identities` as before;
- it **keeps** the 037 `firearm_status_history_insert_managers` policy and the 037 INSERT, UPDATE and DELETE grants for `authenticated`.

The contract step is `054_armory_history_contract.sql`, on `claude/fix-b8a-contract-054` only. It is applied after the B8a image is verified and the owner closes the rollback window (STAGING-VERIFICATION §5a). After 054, an image rollback below B8a requires the forward restore migration first.

**Until 054:** B8a-2's closure of forged direct inserts is deferred. A manager can still insert a history row as themselves, as at 037. The B8a image itself never does: on AWS it calls `change_firearm_status`.

**Unchanged:** 052's rifle-history lockdown. It matches 037, where `authenticated` was SELECT-only.

**Validator (`scripts/validate-local-armory-integrity.sql`) on this branch:**
- An armorer inserting firearm history as themselves → ok (037 policy). As another user, as an officer, or from another agency → 42501. Update and delete → 0 rows (no policy).
- `change_firearm_status` writes exactly one row; a forced history failure leaves the status and the history unchanged; a stale change writes nothing.
- Rifle history stays non-writable (42501 for insert, update and delete).

The three B8a "firearm history write refused" cases moved to the 054 branch.

**Fail before / pass after:**
- the new validator against the reviewed 053 fails at "armorer inserts firearm history as self (037 policy)" (42501, expected ok);
- the reviewed validator against the expand 053 fails at "armorer inserts firearm history directly" (ok, expected 42501).

The full previous-image audit of 038–053 is in `RELEASE-SAFETY-rollback-compatibility.md`.

## Defects addressed

| ID | Defect (re-verified at `e19e84c`) | Change |
|---|---|---|
| B8a-1 (052 history policy) | The B8 policy `personal_rifle_history_insert_actor` let any rifle owner or reviewer insert history rows directly. A row needed only `actor = self` and `to_status` = the rifle's current status. It could have any `from_status`, `action`, notes or metadata, any `created_at` (back-dated), and could be repeated with no transition at all. Shown on the base schema: a reviewer's fabricated row and an owner's back-dated "Owner Saved Draft" row were both accepted (`ok`). The rifle update and its history row were also two statements, so a failed second statement left a status change without history. | **052 (edited in place).** The INSERT grant and policy are gone: `revoke insert, update, delete … from authenticated` and `drop policy if exists`. The database writes the history itself with `record_personal_rifle_status_history()` (security definer, `search_path = public,tracepoint_auth`). It runs as a **before insert/update** trigger, `personal_rifles_status_history`, and an **after insert** trigger, `personal_rifles_status_history_created`. The row is written in the same statement as the change: actor = `tracepoint_auth.subject_id()`, from/to = `OLD.status`/`NEW.status`, and an action derived from the transition, for example "Chief Approved" or "Approval Reinstated". An armorer approval also gets the B8 metadata, taken from the stored checklist, inspection date and qualification flag. A row is written only for a creation ("Draft Created" or "Owner Submitted"), a status change, or an owner's draft edit that actually changes the row ("Owner Saved Draft"). An update that changes nothing else, or changes fields without changing the status, writes nothing. **Note:** a new nullable column, `personal_rifles.workflow_note`, carries the route's free-text note. The trigger moves it into the history row and clears it, so it is always null at rest. A transaction-local setting was not possible, because each `PostgresDataClient` call is its own transaction. The trigger is named to run after the other before-update triggers (they fire in name order). |
| B8a-1 (route) | On AWS the rifle routes inserted history themselves, which 052 now refuses. | `recordPersonalRifleHistory()` is a no-op when `TRACEPOINT_RUNTIME_PROVIDER_MODE=aws-native`, so there is no duplicate. The PATCH route sends `workflow_note: <notes>` on AWS. **Bridge is unchanged:** it still inserts history with the Supabase service role, because the AWS trigger does not exist on Supabase. |
| B8a-2 (firearm history) | `changeFirearmStatus` changed `firearms` and then inserted `firearm_status_history`, reverting the change if the insert failed. That compensation was itself a separate write. The AWS policy `firearm_status_history_insert_managers` also let any firearm or inspection manager insert any history row. That includes notes starting "Inspection result …", which the ARM-17 rule trusts when it decides to return a firearm to service. No existing RPC or trigger writes firearm status history: `update_firearm_with_audit` does not touch `condition_status`. | **053:** a new function, `change_firearm_status(dept, firearm, from, to, notes)` (security definer). It checks that the subject is set, that the agency matches the session agency, and that the caller holds `manage_firearms`, `manage_inspections` or `administer_department`. It validates the target status, updates only from the status read, inserts the history row as the subject and returns true; it returns false if the firearm changed underneath. Both writes are one statement, so they commit or roll back together. The removal of `firearm_status_history`'s insert policy and its INSERT, UPDATE and DELETE grants for `authenticated` moved to **054** (see the amendment above); UPDATE and DELETE had no policy, so they were already denied. **App:** on AWS the helper makes that one call; bridge keeps its current path. |
| B8a-3 (ARM-06 ordering) | The archive route closed the assignment as "Not Returned" **before** archiving. If the archive failed, a lost or stolen firearm was left active and unassigned, so it appeared available to issue. | The route now archives first, then closes the assignment. If the close fails, the firearm stays archived and cannot be issued, and its holder is still shown, which is the conservative state. To retry: restore, then archive again. If the assignment changed in between, the 409 says the firearm was archived and asks for a check of its custody record. A single-transaction archive would need a new RPC, which is not minimal; see "Deferred". |
| B8a-4 ("Unknown User") | Under AWS RLS, an armorer with only `manage_firearms` cannot read other members' profiles or memberships. The armory list therefore showed "Unknown User" for every holder, and the issue picker was empty. Rifle reviewers who are not user administrators saw "Unknown User" for owners and actors in the same way. | **053:** a new function, `armory_member_identities(dept, user_ids default null)` (security definer, stable). It returns only `user_id, full_name, rank_title, badge_number, unit_name, is_active`, with no email, phone or other profile data, and only for the session's own agency. A member is returned only when: (a) they are active and the caller holds `manage_firearms` (the issue picker); (b) they hold an open firearm assignment and the caller sees the firearm list (`manage_firearms`, `manage_inspections`, `view_command_dashboard` or `administer_department`); (c) they own a personal rifle or acted in its history and the caller is a rifle reviewer; or (d) they acted on the caller's own rifle. **App (AWS only):** `PostgresArmoryReadDataSource` merges these rows into members, inactive holders and profiles. The rows it reads directly win, so administrators still get email. `getPersonalRifleUsers` does the same. **The profiles policy is not widened.** |
| B8a-5 (off-duty inspector) | An inspection manager without `review_off_duty_requests` got **404** recording an off-duty inspection on AWS. The route read the request first, and `off_duty_requests_select` hides the request from them. The database function was never the problem: `record_off_duty_firearm_inspection` (017) already allows `manage_inspections` and `manage_firearms`, and it checks that the request exists in the agency. | On AWS the POST route skips the pre-read and relies on the function. **052 (edited in place):** the function raises "not found" with errcode `P0002`, so the route returns 404, and `42501` returns 403. No read access was added. Bridge keeps its pre-read. |
| B8a-6 (rifle reviewer) | `getPersonalRifleAccess` re-read `department_membership_roles` and `department_role_permissions`. On AWS only user administrators can read those, so a chief or armorer who is not an administrator resolved to no review permission (403). | `getPersonalRifleAccess(permissions)` uses the session's effective permissions (`context.permissions`). On AWS those are resolved through `public.has_department_permission` (`server-access-postgres.ts`); on bridge, through the same `effectiveDepartmentPermissions`. The four rifle routes pass them. Nothing in the database changed. **Side effect:** in Support Mode the session holds `administer_department`, so a platform supporter now has rifle reviewer and configuration rights. Every other armory route already treats Support Mode this way. |

### Reviewed, not changed

- **History immutability.** After 052, `authenticated` holds only SELECT on `personal_rifle_status_history`. On `firearm_status_history` it holds only SELECT **after 054**; until then the 037 state remains. The real-PG cases below show 42501 for each write; on the expand branch the firearm write cases show the 037 behaviour instead (see the amendment's validator note). `service_role` grants are unchanged (bridge/Supabase concern).
- **B9's `049` profile widening.** `049` lets `manage_users`, `manage_equipment` and `administer_department` read profiles of former members in their agency. Narrowing it to an equipment version of `armory_member_identities` would mean rewriting the equipment read repository and its holder lookups, plus a new function scoped to equipment holders. That is not trivial, so **it is not changed here; owner decision** (recommended for consistency: an `equipment_member_identities` function, then return 049's policy to its pre-B9 form).

## Native client contract

Native client code is not available. No `/api/mobile/**` route changed. Only web routes changed; on AWS a bearer token is refused outside `/api/mobile/*`.

| Route | Change | Old clients |
|---|---|---|
| `GET /api/armory/firearms` | On AWS, holders and the issue picker carry real names for `manage_firearms`-only armorers (was "Unknown User" / empty). Members added this way have `email: ""`. | Compatible (same fields) |
| `GET /api/armory/personal-rifles`, `…/inbox` | Owner and actor names resolve for reviewers and owners on AWS. Rifle rows gain `workflow_note` (always null) on AWS. `access` reflects the session permissions. | Additive field |
| `PATCH /api/armory/personal-rifles/[id]`, `POST /api/armory/personal-rifles` | Non-administrator reviewers now get 200 instead of 403 on AWS. Response unchanged. | Compatible |
| `PATCH /api/armory/firearms/[id]/status`, `POST /api/armory/inspections` | Response unchanged; on AWS one database call. | Compatible |
| `PATCH /api/armory/firearms/[id]/archive` | Same responses; a 409 after a concurrent assignment change now says the firearm was archived. | Compatible |
| `POST /api/off-duty-firearms/[id]/inspections` | On AWS, inspection managers without review permission get 200 (was 404). Missing request: 404. Database refusal: 403. | Compatible |

## Verification (local, synthetic; PostgreSQL 16 on 127.0.0.1:55663)

Before = `e19e84c` source on its schema (Supabase lineage + `database/aws` 001–052 as committed, 130 files). After = this branch (131 files: edited 052 + 053). 052 and 053 were each applied twice more with no error (idempotent).

### Handler tests: fail before, pass after

The changed source files were reverted from a saved patch; the test files stayed unchanged.

| Test | Before | After |
|---|---|---|
| `armory-integrity-route.test.ts` "B8a ARM-06: if the archive fails, the assignment is not closed" | **fail** (assignment closed, `returned_at` set) | pass |
| "B8a ARM-29: rifle review permission comes from the session" | **fail** (403) | pass |
| "B8a ARM-29: on AWS the route leaves rifle history to the database…; bridge still writes it" | **fail** (direct history insert on AWS) | pass |
| "B8a ARM-11/17: on AWS a firearm status change and its history row are one database call" | **fail** (two writes) | pass |
| "B8a off-duty: … inspection manager … records the inspection; missing 404, forbidden 403" | **fail** (404) | pass |
| `read-repository.test.ts` "B8a Unknown User: … holder's name from the identity lookup, without email" | **fail** ("Unknown User") | pass |
| Existing B8 tests (12) and read-repository tests (6) | pass | pass |

The B8 ARM-29 test now passes the reviewer's permissions in the session instead of role-table rows, because it encoded the old resolution mechanism. Total: before 18 pass / **6 fail**; after 24/24.

`postgres-home-read-contract.test.ts` (embedded PostgreSQL) gained a test copy of `armory_member_identities`, because the armory Postgres source now calls it. It "runs no tests" in this root sandbox. It was run on a separate disposable local cluster: 3/3 pass.

### Database: `scripts/validate-local-armory-integrity.sql` (validator AWS stage)

Each case runs as `tracepoint_runtime` → `authenticated` with the subject and agency set. The three B8 cases that expected a direct history insert to succeed were removed. The per-case table comes from a reporting copy of the script.

| Case | Before | After |
|---|---|---|
| Reviewer inserts rifle history directly | **ok** | 42501 |
| Owner inserts a back-dated history row with no transition | **ok** | 42501 |
| Reviewer updates / deletes rifle history | 42501 / 42501 | 42501 / 42501 |
| Armorer inserts firearm history directly (forged "Inspection result" note) | **ok** | 42501 |
| Armorer updates / deletes firearm history | no rows / no rows (RLS) | 42501 / 42501 |
| `change_firearm_status` by an officer / another agency / another agency claiming agency A | (no function) | 42501 / 42501 / 42501 |
| `change_firearm_status` to the same status | (no function) | 22023 |
| `manage_firearms`-only armorer reads the holder's profile or membership directly | no rows | no rows (not widened) |
| Officer, or an inspection manager, looks up a member who holds nothing | (no function) | no rows |
| Another agency looks up agency A names (own session; claiming agency A) | (no function) | no rows / no rows |
| Another agency updates an agency A rifle | no rows | no rows |
| Inspection manager reads the off-duty request directly | no rows | no rows (not widened) |
| Inspection manager records an off-duty inspection (function) | ok | ok |
| Inspection of a missing request | P0001 | **P0002** |
| Officer / another agency records an inspection | 42501 / 42501 | 42501 / 42501 |
| **Check blocks:** an armorer approval writes exactly one row (actor = session, Pending Armorer Review → Pending Chief Approval, note, metadata), and `workflow_note` is null at rest. A field-only update writes nothing. A failed history insert (forced check constraint) rolls back the approval. An invalid status rolls back its history row. An owner's no-op draft save writes nothing; an owner's real edit writes "Owner Saved Draft" and a submit writes "Owner Submitted". Creating a rifle writes "Draft Created". A firearm change writes one row as the session actor, and a stale change returns false and writes nothing. A `manage_firearms`-only armorer sees the holder's name and badge and the active roster; an inspection manager sees holders only. | fail (column and functions absent) | pass |

### Route harness on real PostgreSQL (AWS-native, `PostgresDataClient`)

Scratch file `b8a/harness.cjs`. Before = `e19e84c` source and schema; after = this branch.

| Step | Before | After |
|---|---|---|
| `manage_firearms`-only armorer: holder name and badge; officer in the issue picker | "Unknown User", null; not listed | "Olive Officer", "4410"; listed, email "" |
| Firearm Out of Service | 200, one history row | 200, one history row (one call), actor = session |
| Non-administrator chief: rifle list `canChiefReview`, owner name | false, owner not listed | true, "Olive Officer" |
| Chief approves | **403** | 200; one history row "Chief Approved", actor = chief, note "Meets spec" |
| Owner sees actor names in their rifle history | — | "Casey Chief" (the fixture creation row has no actor) |
| Inspection manager records a Fail off-duty inspection | **404**, nothing stored | 200; inspection stored, Non-Compliant |
| Missing request / officer | 404 / 403 | 404 / 403 |
| ARM-06 archive with a not-returned reason | 200, closed "Not Returned" | 200, closed "Not Returned" |

### Required checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 734 tests, 730 pass. The 4 failures are the `xlsx`-stub importer tests. 19 embedded-PostgreSQL files ran no tests (root sandbox): `training-closeout-native`, `custody-native-schema`, `cognito-establish`, `cognito-membership-lifecycle-sql`, `first-login-activation`, `postgres-mapping`, `postgres-refresh-sessions`, `postgres-session-state`, `rehearsal-first-login`, `ses-feedback`, `separated-custody-native`, `fleet-audit-outbox-native`, `fleet-safety-hold-native`, `vehicle-documents-native`, `inventory-native-schema`, `notifications/postgres-read-contract`, `personnel-import-native`, `member-save-native`, `postgres-home-read-contract` (the last was run separately: 3/3). |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 351 tests, 350 pass; the failure is the SheetJS XLSX round trip. |
| `npx eslint` on changed files | No new findings: per-file error counts equal or lower than base (`personal-rifle-server.ts` 6 → 3; the other route files unchanged; new and changed library and test files clean). |
| Clean apply (`bootstrap.mjs --aws`) | 131/131; 052 and 053 applied twice more |
| Validator shim (`validate-clean-bootstrap.mjs` against 127.0.0.1:55663) | "Clean bootstrap passed: 79 ordered migrations and 52 AWS-native migrations; permission and retirement matrices passed", including the extended armory-integrity stage |

## Staging (reconciliation README §8)

1. `scripts/migrate-db.ps1 staging -Action status`. Expect `052` and `053` to be pending. Apply both **with or before the image**. The B8a image calls `armory_member_identities` and `change_firearm_status` on AWS. Without 053, the firearm list and status changes fail; without the edited 052, rifle actions on AWS fail.
2. Verify:
   - `select has_table_privilege('authenticated','public.personal_rifle_status_history','insert'), has_table_privilege('authenticated','public.firearm_status_history','insert')` → false, **true** (037 state kept until 054; false, false after 054). **This replaces the S22 step-2 query, which expected true.**
   - `select tgname from pg_trigger where tgname in ('personal_rifles_status_history','personal_rifles_status_history_created')` → 2 rows.
   - `select count(*) from personal_rifles where workflow_note is not null` → 0.
3. Run **S22a** on an `acceptance-<UUID>` tenant. Production needs separate authorization: the same apply, then S22a on a synthetic tenant.

**S22a (staging package text):**

| Step | Scenario | Expected | Covers |
|---|---|---|---|
| S22a | Synthetic agency with: K1 (armorer role granted only `manage_firearms`), C1 (chief, `approve_personal_rifles`, not an administrator), I1 (granted only `manage_inspections`), O1 (officer, badge 4410), A1 (administrator). (a) A1 issues firearm F1 to O1. K1 opens the armory list and the issue picker. (b) K1 sets F2 Out of Service with a note. (c) O1 submits a personal rifle. A1 records the armorer approval with a note. C1 approves with "Meets spec". O1 opens the rifle history. (d) In SQL as the runtime role, try to insert a `personal_rifle_status_history` row and a `firearm_status_history` row, and to update or delete either. (e) I1 records a Fail inspection on O1's approved off-duty request. (f) K1 archives F1 with "Reported stolen" as the not-returned reason. | (a) F1 shows O1's name and badge (not "Unknown User"); the picker lists active members. (b) 200; exactly one history row, `changed_by_user_id` = K1, with the note. (c) Both approvals → 200. History rows: Owner Submitted, Armorer Approved (A1, note), Chief Approved (C1, "Meets spec"), each with the correct from/to and no duplicates. O1 sees the reviewers' names. `workflow_note` is null. (d) Rifle history: every write → permission denied. Firearm history until 054 (the 037 state, kept for the previous image): K1 inserting a row as K1 → accepted. Insert as another user, or by O1 → permission denied. Update/delete → 0 rows. After 054 (§5a): every write → permission denied. (e) 200; the request becomes Non-Compliant, and I1 still cannot read the request row directly. (f) 200; the assignment is closed "Not Returned" and the firearm is archived. | B8a-1 … B8a-6 |

## Rollback

- **Application:** revert the commit and redeploy. Bridge behaviour is identical either way. **Before 054, no schema step is needed.**
  - The old firearm status route works as at 037, because 053 keeps the grants.
  - The old rifle routes behave as at 037: 500 after saving, because `authenticated` was SELECT-only at 037. On 052 they also leave the history row, which the trigger writes. A retry gets 409, with no duplicate. Shown on real PostgreSQL with the 555f061 routes (`RELEASE-SAFETY-rollback-compatibility.md` §3).
  - **After 054,** a rollback below B8a needs the forward restore migration first (that record, §4 step 9).
- **Database (052 edited, 053 new):** the ledger is hash-checked, so use a new forward migration:
  - drop `personal_rifles_status_history` and `personal_rifles_status_history_created`, and drop `record_personal_rifle_status_history()`. `workflow_note` can stay; it is always null.
  - only after 054, and only if the old route code returns: on `firearm_status_history`, re-grant INSERT with `firearm_status_history_insert_managers` (from `202609100001_complete_module_tables.sql`, with `auth.uid()` replaced by `tracepoint_auth.subject_id()`) **and** `grant update, delete` to `authenticated`, which is the exact 037 state. **Do not** re-grant INSERT on `personal_rifle_status_history`: that grant never existed at 037 and would recreate the forgeable B8 policy. (Corrected after the staging rehearsal.)
  - drop `change_firearm_status` and `armory_member_identities`.

  The `P0002` errcode on the off-duty function is harmless to old code, which pre-reads the request.
- Rows written meanwhile stay valid history.

## Deferred / owner decisions

- **Off-duty list for inspection managers on AWS.** They can now record an inspection by request id, but `GET /api/off-duty-firearms` still lists only their own requests. The list needs the request rows, officer identities and qualification readiness under RLS, and `GET …/inspections` also pre-reads the request. Options: a SELECT policy on `off_duty_firearm_requests` for `manage_inspections`/`manage_firearms` (row-level; it exposes every column, including decision notes), or a field-limited security-definer list function. Owner decision.
- **Owner self-approval by direct write (pre-existing, found while reviewing).** `personal_rifles_update_owner_or_reviewer` lets an owner update their own Draft or Correction Requested rifle, including `status`. A direct write could therefore move it to Approved without review. The B8 guard covers reviewer fields and reinstatement, not this. The new trigger now records such a write truthfully (actor = owner, "Owner Submitted" to Approved). Refusing it needs the department rules in the guard, because an agency with no armorer or chief requirement legitimately approves on submit. Owner decision.
- **ARM-06 in one transaction.** It would need an archive RPC. Reordering removes the unsafe failure state (a lost or stolen firearm left issuable); the remaining failure leaves an archived firearm still showing its holder.
- **ARM-17:** a manual status note that starts with "Inspection result " is still treated as inspection-set. This is now possible only through the status route's free-text note, not by forging history. The inspection insert, its items and the status change are still separate statements.
- **Rifle route race:** the PATCH update still filters only by id. History is truthful (from = `OLD.status`), but two concurrent reviewers can both act. This is pre-existing.
- **B9 `049` profile widening:** see "Reviewed, not changed".
- **Off-duty request list names for inspection managers** have the same identity gap as above (part of the list decision).
