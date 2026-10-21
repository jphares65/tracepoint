# Remediation batch B8: armory integrity

Base: `claude/integration-defects-20261020` @ `9ba56a3` (B0–B5, F1–F6b, DC, TV, B9, B7, B10; migrations through 051). Evidence: `docs/operational-audit-20261020/reconciliation-20261020/R2-armory.md` and `appendix-a-armory.md`. Plan: `plan-b7-b11.md`, section B8. Migration number `052`.

Scope: defects only. The server now enforces rules that were browser-only, and enforces separation of duties. There is no ledger redesign. The ammunition workspace stays one JSON document in `pilot_ammunition_workspaces`, and the reconciliation tables are unchanged. Nothing new is configurable.

Every defect was re-checked against `9ba56a3` before it was changed. All were still present (see "Before" in the verification tables). None was already fixed.

## Defects addressed

| ID | Defect (re-verified) | Change |
|---|---|---|
| ARM-06 (High) | To archive an issued weapon that was lost or stolen, the armorer had to record a "return": `archive` answered 409 "Return it before archiving it." | `PATCH /api/armory/firearms/[id]/archive` accepts an optional **`notReturnedReason`**. If the firearm has an open assignment and no reason is given, it returns **400**: "This firearm is currently assigned. Return it before archiving it, or record why it was not returned (for example lost or stolen)." With a reason, the route closes the assignment as not returned, then archives the firearm. The closed assignment gets `returned_at`/`returned_by_user_id` (who closed it, and when), `condition_at_return = 'Not Returned'`, `magazines_returned = 0` and `magazine_discrepancy_reason = 'Not returned: <reason>'`. The archive form asks for the reason when the firearm is issued. An unassigned firearm archives as before. |
| ARM-13 | Restore set `archived_at`, `archived_by_user_id` and `archive_reason` to null, so the disposition was lost. | Restore sets only `is_active = true`. The archive record (when, by whom, why) stays on the row. The pages show it only while the firearm is archived, so nothing changes on screen. A later archive overwrites it, and `audit_events` keeps the earlier one. |
| ARM-11 | Status could change while the weapon was issued, including to Retired. | The status route refuses **Retired** while an assignment is open (409 "This firearm is currently issued. Return it before retiring it."). Out of Service, Maintenance and Inspection Required are still allowed on an issued weapon, because an unsafe weapon in an officer's hands must still be flagged. Every status change goes through one helper (`src/lib/armory/firearm-status-change.ts`). The helper changes the row only from the status it read, writes the `firearm_status_history` row, and reverts the change if that history write fails. |
| ARM-16 | The inspection result rules existed only in the browser. The server stored any `result` string, and a "Passed" result with a failed critical item. | `POST /api/armory/inspections` validates on the server. `result` must be `Passed`, `Failed`, `Needs Maintenance` or `Removed from Service`. Each checklist item needs a label and a status of `Pass`, `Fail` or `N/A`. `Passed` is refused while a `critical` item is `Fail`. Each failure is a 400 with a message, and nothing is written. The staging smoke script posted `result:'Pass'`; it now posts `'Passed'`. |
| ARM-17 | Inspection status changes bypassed the status history, and a Passed result never restored service. | The status change an inspection causes goes through the same helper, so it writes a history row noted `Inspection result <result> (inspection <id>).`. A **Passed** result returns the firearm to **In Service** only when the latest history row for that firearm was written by an inspection and matches the current status. A manual change (for example "Out of Service: sent to the manufacturer") is never undone by an inspection. Retired is never undone. A Passed result with the recommendation "Maintenance Required" or "Remove from Service" restores nothing. `updatedFirearmStatus` in the response is now the status actually applied, or null. |
| ARM-21 (High) | Ammunition activities had no actor. The browser sent the whole document and the server stored it as sent. | `PUT /api/pilot/ammunition` reads the stored document first. Each **new** activity gets `recordedByUserId`/`recordedByName` from the session, and each new count gets `countedByUserId`/`countedByName`. **Existing** rows keep the stored values, so a browser can neither omit nor rewrite them. The history list shows "by <name>". The concurrency (last write wins) and feature-gate parts of ARM-21 are not in the plan's minimal fix; see "Deferred". |
| ARM-22 | A physical count silently replaced the on-hand quantity. No reason was needed. | A new count (and its Physical Count activity) with a non-zero variance needs an explanation, otherwise 400 "Explain the count variance …". The page enforces the same rule. The expected quantity is the **stored** on-hand quantity. If the count was taken against a stale figure, the save returns 409 ("… on-hand quantity changed to N since this count was started. Reload and count again."). Stored variance is recomputed on the server. |
| ARM-23 (High) | Seasonal reconciliation took the expected quantities from the browser and `lot_id` was not checked. One person could count, submit and certify. Certify deleted and re-inserted the items before it checked the status. On AWS-native the update policy allowed only the submitter to write a submitted row, so **only** the submitter could certify. | **Expected quantities** come from `ammunition_lots.quantity_on_hand` (department-scoped) when a lot is first counted in the reconciliation, and stay at that value on later saves. Browser `expectedQuantity` is ignored. A lot outside the department returns 400. **Submit** requires a count and an explanation for every non-zero variance (400). **Certify** is read-only over the submitted items: it never rewrites counts, it requires the status to be Submitted, and the **submitter cannot certify** (403 "You submitted this count, so another person must certify it."). GET returns `canCertify: false` to the submitter, so the page shows "Submitted for command certification". **DB (052):** a trigger refuses certification by the submitter. The update policy now also lets a certifier write the row when they certify it as themselves. |
| ARM-26 | A reviewer could approve their own off-duty request. | **API:** a decision (Approve, Deny, Return) on one's own request returns 403. **DB (052):** a `before update` trigger on `off_duty_firearm_requests` refuses a decision status whose `reviewed_by_user_id` is the officer. It covers the RPC and direct updates. |
| ARM-29 | A personal-rifle owner who is also a reviewer could review their own rifle. | **API:** `request_correction`, `armorer_approve`, `armorer_deny`, `chief_approve`, `chief_deny` and `reinstate` on one's own rifle return 403. Suspend and revoke stay allowed, because they only restrict. **DB (052):** a trigger refuses an armorer or chief review recorded by the owner, and an owner moving their own rifle from Suspended to Approved. **Found while verifying (AWS-native):** `personal_rifle_status_history` granted `authenticated` SELECT only, because history used to be written with the Supabase service role. On AWS-native **every** rifle action therefore changed the rifle and then returned 500 with no history row. 052 grants INSERT with a narrow policy: the row's actor must be the user; the user must own or review rifles (`manage_inspections`, `approve_personal_rifles` or `administer_department`) in that agency; and `to_status` must equal the rifle's current status. The update and the history row are still two statements; see "Deferred". |
| ARM-28 | A failed off-duty inspection left the authorization in force: the list showed compliance "At Risk", and nothing stored "not compliant". | Existing status values only. The list route reports `compliance: "Non-Compliant"` while the latest inspection is a Fail, in both runtimes. The stored `compliance_status` becomes `Non-Compliant` on a Fail: on AWS through `record_off_duty_firearm_inspection_internal` (052; same body plus the compliance update); on bridge through the inspection route, after the RPC (the Supabase function is untouched). Approval was already blocked by the detail route's readiness check ("Failed"). |
| ARM-33 (Low) | An empty caliber on edit reached PostgreSQL and failed with a raw `23502` (bridge) or "PostgreSQL data operation failed." (AWS). | 400 "Caliber is required. Enter TBD / Unknown if it is not known." The RPC is not called. |

### Not changed (as instructed, or no defect-only fix)

- **ARM-15, ARM-25/31, ARM-09/RNG-17, ARM-24:** owner decisions or missing capabilities (plan §6). Not touched.
- **"Unknown User" holder name for `manage_firearms`-only armorers (B9 known limitation).** A defect-only fix exists: add `manage_firearms` to `profiles_select_self_or_department_admin` and `department_memberships_select_self_or_admin` (or a narrower, assignment-holder-only lookup). Both are **read-policy widenings**, so this is an owner decision. It is not implemented here.

### Migration `database/aws/052_armory_separation_of_duties.sql`

It is idempotent (applied three times locally), has `begin;`/`commit;`, and uses `create or replace`, `drop … if exists`/`create` and `grant`. Contents:

- `guard_off_duty_request_self_decision()` and trigger `off_duty_requests_self_decision_guard` (ARM-26).
- `guard_personal_rifle_self_review()` and trigger `personal_rifles_self_review_guard` (ARM-29).
- `grant insert on personal_rifle_status_history to authenticated` and policy `personal_rifle_history_insert_actor` (ARM-29, AWS history writes). **Superseded by B8a:** 052 was edited in place (it is unapplied anywhere). The grant and policy are gone, and the database writes the history with the change. See `B8a-armory-audit-and-access.md`.
- `guard_ammunition_reconciliation_certifier()` and trigger `ammunition_reconciliations_certifier_guard`. Policy `ammunition_reconciliations_update` is recreated with the certifier clause (ARM-23).
- `record_off_duty_firearm_inspection_internal(...)`: the 202608170005 body, plus `compliance_status = 'Non-Compliant'` on Fail. Its EXECUTE stays revoked from every role (ARM-28).

## Tests added

| Test | What it proves |
|---|---|
| `src/lib/armory/armory-integrity-route.test.ts` (new, 12) | The real handlers on an in-memory client: archive as not returned and the 400 without a reason (ARM-06), the unassigned archive regression guard, restore keeps the disposition (ARM-13), Retired refused while issued and history on every change (ARM-11), inspection rules (ARM-16), inspection history and restore-only-what-an-inspection-removed (ARM-17), caliber (ARM-33), off-duty self-decision (ARM-26), failed inspection → Non-Compliant in the list and stored on bridge (ARM-28), rifle self-review and reinstate (ARM-29), ammunition actor stamping, forged actors ignored, variance reason, stale expected → 409 (ARM-21/22), reconciliation server-side expected quantities, foreign lot, unexplained variance, self-certify refused with items untouched, certify by another person (ARM-23). |
| `scripts/validate-local-armory-integrity.sql` (validator AWS stage, after the range-instructor-line suite) | 14 cases on AWS-native RLS and triggers (`tracepoint_runtime` → `authenticated`, subject and agency set), listed under "Database" below. |

## Verification (local, synthetic; no remote systems)

### Handler tests: fail before, pass after

The test file ran against the pre-fix source. The changed source files were reverted from a saved patch, and the new helper was moved aside. The test file itself was unchanged.

| Test | Before | After |
|---|---|---|
| ARM-06 issued archive | **fail** (409, not 400) | pass |
| ARM-06 unassigned archive (guard) | pass | pass |
| ARM-13 | **fail** (`archive_reason` null) | pass |
| ARM-11 | **fail** (Retired → 200) | pass |
| ARM-16 | **fail** (`'Pass'` → 200) | pass |
| ARM-17 | **fail** (no history row) | pass |
| ARM-33 | **fail** (RPC called with `""`) | pass |
| ARM-26 | **fail** (self Deny → 200) | pass |
| ARM-28 | **fail** (compliance "At Risk") | pass |
| ARM-29 | **fail** (self chief_approve → 200) | pass |
| ARM-21/22 | **fail** (unexplained variance → 200) | pass |
| ARM-23 | **fail** (expected 480 from the browser kept) | pass |
| Total | 1 pass, **11 fail** | 12/12 |

### Database (PostgreSQL 16, user ubuntu, 127.0.0.1:55661)

Before = Supabase lineage + `database/aws` 001–051 (129 migrations). After = + `052` (130). The validation script stops at its first failure, so the per-case table below comes from a reporting copy of the same script.

| Case (as the named user under AWS RLS) | Before 052 | After 052 |
|---|---|---|
| Reviewer approves own off-duty request (RPC) | ok | **42501** |
| Reviewer denies own off-duty request (RPC) | ok | **42501** |
| Reviewer approves own request by direct UPDATE | ok | **42501** |
| Another reviewer approves the request | ok | ok |
| Owner approves own rifle as chief | ok | **42501** |
| Owner records own armorer review | ok | **42501** |
| Owner reinstates own suspended rifle | ok | **42501** |
| Another reviewer approves / reinstates the rifle | ok / ok | ok / ok |
| Reviewer records rifle history for the rifle's current status | **42501** (no insert grant) | **ok** |
| Rifle history for a status the rifle does not have / by a member without rifle permission | 42501 / 42501 | 42501 / 42501 |
| Submitter certifies own ammunition count | ok | **42501** |
| Another armorer certifies the count | **42501** (update policy) | **ok** |
| Failed off-duty inspection → stored compliance | At Risk | **Non-Compliant** |

### Route harness on real PostgreSQL (AWS-native data client)

Scratch `b8/route-harness.cjs` drives the real routes through `PostgresDataClient` (`tracepoint_runtime` → `authenticated`). Before = base code on the base schema. After = this branch on base + 052.

| Step | Before | After |
|---|---|---|
| Archive issued firearm, archive reason only | 409 | 400 with the message |
| … with `notReturnedReason` | 409; still issued | 200; assignment closed "Not Returned", reason stored, firearm archived |
| Restore | 409 "already active" (the archive had been refused); the nulling itself is shown by the handler test | 200; `archived_at` and `archive_reason` kept |
| Retired while issued, then Out of Service | 200, 200 | **409**, 200 (1 history row) |
| Inspection `result:'Pass'` / Passed with failed critical item | 200 / 200 (stored) | 400 / 400 |
| Failed, then Passed | Inspection Required, no history; stays Inspection Required | Inspection Required → In Service, two history rows |
| Empty caliber | 500 "PostgreSQL data operation failed." | 400 with the message |
| Reviewer denies own off-duty request | 200 (Denied by self) | 403; another reviewer → 200 |
| Failed off-duty inspection | compliance At Risk | Non-Compliant |
| Personal rifle: owner `chief_approve` / another chief | (403 from RLS on role permissions) / **500 after the status changed** (history insert denied) | 403 / **200**, history written |
| Reconciliation save with browser expected 480 (lot holds 500) | stored 480, variance 0 | stored 500, variance −20 |
| Submit without explanation / submitter certifies / another armorer certifies | 200 / 200 / 409 (already certified by the submitter) | 400 / **403** / **200**; counts not rewritten |
| Ammunition count −200 without a reason | 200 | 400 |
| Stored activity actors | `["forged"]`, no counters | the session users; counter stamped |

**Pre-existing AWS-native read-policy gaps seen in the harness (not B8, not changed):**

- An inspection manager without `review_off_duty_requests` cannot read the off-duty request (`off_duty_requests_select`), so recording an off-duty inspection returns 404.
- Personal-rifle review access reads `department_role_permissions`, which only `manage_users`/`administer_department` can read. A chief or armorer who is not an administrator therefore resolves to no review permission.

The harness used an administrator for the second rifle reviewer and a reviewer for the off-duty inspection. These belong with the "Unknown User" read-policy decision above.

### Required checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 703 tests, 699 pass. The 4 failures are the `xlsx`-stub importer tests (`ai-importer/workbook.test.ts`). 18 embedded-PostgreSQL files ran no tests (root sandbox): `training-closeout-native`, `custody-native-schema`, `cognito-establish`, `cognito-membership-lifecycle-sql`, `first-login-activation`, `postgres-mapping`, `postgres-refresh-sessions`, `postgres-session-state`, `rehearsal-first-login`, `ses-feedback`, `separated-custody-native`, `fleet-audit-outbox-native`, `fleet-safety-hold-native`, `vehicle-documents-native`, `inventory-native-schema`, `notifications/postgres-read-contract`, `personnel-import-native`, `postgres-home-read-contract`. None was added or changed by B8. |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 349 tests, 348 pass. The failure is the SheetJS XLSX round trip (environment). |
| `npx eslint` on changed files | No new findings. Per-file counts are identical to the base, for example `off-duty-firearms/route.ts` 14 errors/1 warning before and after. The new files are clean. |
| Clean apply (`bootstrap.mjs --aws`) | 130/130; 052 applied twice more |
| Validator shim (`validate-clean-bootstrap.mjs` against 127.0.0.1:55661) | "Clean bootstrap passed: 79 ordered migrations and 51 AWS-native migrations; permission and retirement matrices passed", including the new armory-integrity stage |

## Native client contract

The native client's code is not available. No `/api/mobile/**` route and no library they call is changed. All the routes below are web routes. On AWS-native a bearer token is refused outside `/api/mobile/*`, so the native client can reach them only through a cookie session, if at all.

| Route | Change | Old clients |
|---|---|---|
| `PATCH /api/armory/firearms/[id]/archive` | New optional `notReturnedReason`. An issued firearm without it: **400** (was 409) with the message. | Unchanged when the firearm is not issued. |
| `PATCH /api/armory/firearms/[id]/restore` | Response unchanged; the archive fields are no longer nulled. | Compatible |
| `PATCH /api/armory/firearms/[id]/status` | Retired while issued: **409** with the message. A concurrent change returns 409. | Other statuses unchanged |
| `POST /api/armory/inspections` | `result` must be one of the four values, checklist items need `label` and a `Pass`/`Fail`/`N/A` status, and Passed with a failed critical item is refused. All are **400** with a message. `updatedFirearmStatus` is the status actually applied (may be "In Service"; null if none). | A client sending `'Pass'` now gets 400 |
| `PATCH /api/armory/firearms/[id]` | Empty or missing `caliber`: **400** (was 500). | Compatible |
| `PATCH /api/off-duty-firearms/[id]` | A decision on one's own request: **403**. | — |
| `POST /api/off-duty-firearms/[id]/inspections` | Unchanged shape; on bridge it also stores Non-Compliant on a Fail. | Compatible |
| `GET /api/off-duty-firearms` | `compliance` is "Non-Compliant" while the latest inspection failed. This is an existing value. | Compatible |
| `PATCH /api/armory/personal-rifles/[id]` | Review or reinstate of one's own rifle: **403**. | — |
| `PUT /api/pilot/ammunition` | New count with variance and no notes: **400**. Count against a stale on-hand quantity: **409**. Stored rows gain `recordedByUserId`/`recordedByName` (activities) and `countedByUserId`/`countedByName` (counts); GET returns them. | Unknown fields are ignored by the web normaliser |
| `GET/POST /api/armory/ammunition/reconciliations` | GET: `active`/`history` gain `submittedByUserId`; `access.canCertify` is false for the submitter. POST: `expectedQuantity` is ignored; foreign lot **400**; submit without counts or explanations **400**; certify by the submitter **403**; certify never rewrites items. | Compatible |

## Staging (reconciliation README §8)

1. Run `scripts/migrate-db.ps1 staging -Action status`. Expect `052` to be pending. Then run `apply`. **Apply 052 with or before the image.** Without it, certification by a second person fails on AWS RLS, and every personal-rifle action still returns 500 after changing the rifle.
2. Verify with these queries:
   - `select tgname from pg_trigger where tgname in ('off_duty_requests_self_decision_guard','personal_rifles_self_review_guard','ammunition_reconciliations_certifier_guard')` → 3 rows.
   - ~~`select has_table_privilege('authenticated','public.personal_rifle_status_history','insert')` → true.~~ **Superseded by B8a:** expect false (and false for `firearm_status_history`).
3. Deploy the image. Run step **S22** below with `acceptance-<UUID>` tenants.
4. Production needs separate authorization: the same apply, then S22 on a synthetic tenant.

**S22 (staging package text):**

| Step | Scenario | Expected | Covers |
|---|---|---|---|
| S22 | Armory integrity, on a synthetic agency with two armorers (A1, A2), a chief who also submits off-duty requests and owns a personal rifle (C1), a second reviewer (C2, administrator) and an officer (O1). (a) A1 issues firearm F1 to O1, then archives it with only an archive reason; then with "Reported stolen, case 26-0142" as the not-returned reason. Restore F1. (b) Issue F2 to O1; set Retired; set Out of Service. (c) Inspect F3 with a failed critical item: try Passed; save Failed; then save a Passed re-inspection. Mark F4 Out of Service by hand, then save a Passed inspection. (d) Edit F3 with an empty caliber. (e) C1 submits an off-duty request and tries to decide it; C2 returns it. Record a Fail inspection on an approved request. (f) C1 tries to approve and to reinstate C1's own rifle; C2 approves it. (g) Reconciliation: A1 counts with one variance, tries to submit without an explanation, submits with one, tries to certify; A2 certifies. (h) Ammunition page: confirm a count that differs from the expected without notes, then with notes; open History. | (a) The first archive is refused with "…record why it was not returned…". The second succeeds; the assignment is closed "Not Returned" with the reason, and no magazine return is asserted. After restore, the archive reason is still on the row. (b) Retired → 409 "Return it before retiring it"; Out of Service → 200 with a status-history row. (c) Passed is refused (critical item); Failed → Inspection Required with a history row; the re-inspection → In Service with a history row; F4 stays Out of Service. (d) 400 "Caliber is required…". (e) C1 → 403 on every decision; C2's Return works; after the Fail, the list shows Non-Compliant and `compliance_status = 'Non-Compliant'`. (f) C1 → 403 on both; C2's approval → 200 with a history row. (g) Submit without explanation → 400; A1 sees "Submitted for command certification" and a certify attempt → 403; A2 certifies; expected quantities equal the lots' on-hand quantities, and the counts are unchanged by certify. (h) Without notes → refused; with notes → saved; History shows "by <name>". | ARM-06, 11, 13, 16, 17, 21, 22, 23, 26, 28, 29, 33 |

## Rollback

- **Application:** revert the commit and redeploy. Stored data stays valid. Closed "Not Returned" assignments are ordinary closed assignments to older code. Kept archive fields are ignored while a firearm is active. The extra actor fields in the ammunition document are dropped by the old normaliser on its next save.
- **052:** the ledger is hash-checked, so roll back with a new forward migration:
  - drop the three triggers and their functions;
  - drop `personal_rifle_history_insert_actor` and `revoke insert on public.personal_rifle_status_history from authenticated`;
  - recreate `ammunition_reconciliations_update` from `202609100001_complete_module_tables.sql`, with `auth.uid()` replaced by `tracepoint_auth.subject_id()`;
  - re-run the 202608170005 body of `record_off_duty_firearm_inspection_internal`.

  Rolling back the policy and the history grant restores the AWS defects described above (second-person certification and rifle history both fail).

## Deferred / owner decisions

- **"Unknown User" for `manage_firearms`-only armorers, the off-duty inspection read for inspection managers, and rifle-review permission resolution on AWS.** All three are read-policy widenings on `profiles`, `department_memberships`, `off_duty_firearm_requests` and `department_role_permissions` (or a narrow security-definer lookup). Owner decision.
- **ARM-21, remaining parts:** last-write-wins (no version check on the JSON document) and the missing `ammunition` feature gate on `/api/pilot/ammunition`. The plan's minimal fix is the actor only. Adding a gate could hide the page from agencies that use it without the flag.
- **ARM-22, remaining part:** the relational Adjust is still decrease-only. Signed adjustments are a capability. Reconciliation variances are not posted to the lots (ARM-23 correction list); that is a ledger change.
- **ARM-17, remaining part:** the inspection insert, its items and the status change are still separate statements, so a failed item insert leaves the inspection without items (pre-existing message). Restoring service from a pre-B8 inspection status: those changes have no history row, so a Passed re-inspection does not restore them. The status must be set by hand once (conservative).
- **ARM-28, remaining parts:**
  - The list still labels a failed inspection "Not Inspected". "Failed" is not an allowed `inspection_status` value, and adding it is a schema and contract decision.
  - A passing re-inspection does not reset the stored `compliance_status`. The list recomputes it, and the next decision sets it.
  - Suspension (ARM-24) stays deferred.
- **ARM-29, remaining part:** the rifle update and its history row are still two statements. 052 makes the history write succeed on AWS, but a failure after the update still leaves the status changed.
- **ARM-06 atomicity:** the assignment closes before the archive update. If the archive fails, the firearm stays active and unassigned, and the armorer can retry the archive.
- **ARM-23:** a draft saved before B8 keeps its stored (browser-supplied) expected quantities. Re-saving does not refresh them. Check open drafts on staging before deploying.
