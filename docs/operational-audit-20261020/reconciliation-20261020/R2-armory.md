# Armory findings (ARM-01..ARM-36) checked against the current code line

**Audit baseline:** `docs/operational-audit-20261020/appendix-a-armory.md`, written against `origin/main @ a3677a6` (Oct 7).
**Re-checked against:** `origin/codex/staging-mobile-api-release-20261007 @ 555f061` (Oct 9). This is a read-only worktree at `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current`. In this file, "worktree" means that path, and every `path:line` is relative to it.
**Other branches:** all 41 `refs/remotes` were scanned for fix markers. The script is `work-armory/branchscan.sh` and its output is `work-armory/branchscan.txt`.
**Method:** I re-read the code statically. I also ran isolated tests against a throwaway local PostgreSQL 18.4. It was started from the `embedded-postgres` binaries in the runtime `node_modules`, bound to `127.0.0.1:55491`, and stopped afterwards. Each test imports worktree code read-only. No external network service was contacted, and nothing in `/home/user/tracepoint` or the worktree was modified.

## How the current line runs (this affects several classifications)

- **Two runtime modes.** These are set in `src/lib/tracepoint/server-access.ts:136-210`:
  - `TRACEPOINT_RUNTIME_PROVIDER_MODE=aws-native`: Cognito login, RDS PostgreSQL. `context.admin` and `context.db` are both a `PostgresDataClient`, which runs every statement inside `withPostgresAuthorization`. That means `set local role authenticated` plus `tracepoint.subject_id` and `tracepoint.department_id` GUCs (see `src/lib/database/postgres-authorization-core.ts:39-45`).
  - `bridge`: Supabase. `admin` is the Supabase service-role client, which bypasses RLS.
- **Production is most likely AWS-native.** `infra/lib/runtime-stack.ts:97` sets aws-native. `docs/application-deployment-workflow.md:3,21` (2026-09-30) says production runs on "existing AWS-native ECS services" with an `-aws-native-production` image suffix. The latest Supabase cutover record, `docs/production-cutover-execution-20260928-retry4.md`, says the legacy anon JWT keys were revoked (public-anon probe moved from 200 to 401) and email sign-in and signup were disabled. **Requires runtime verification:** confirm the Supabase projects `izlkwggluhlhzlumtzes` (prod) and `wztqqqashilusoppddxi` (staging Preview) are retired or paused.
- **How RDS schema is built.** RDS takes a snapshot of the production Supabase schema (final import) and then applies `database/aws/NNN_*.sql` through `scripts/run-aws-native-migrations.mjs:17-21`. A clean environment built from the repo would use `supabase/migrations` + `database/aws`.
- **Mobile authentication.** Mobile bearer tokens are accepted only on `/api/mobile/*` (`server-access.ts:143`). Any other route that sees an `Authorization` header in aws-native mode returns 401 (`server-access.ts:167-169`).

## Summary counts (36 findings)

| Classification | Count | IDs |
|---|---|---|
| Confirmed applicable defect | 28 | 02, 03, 05, 06, 08, 09, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29, 31, 32, 33, 34 |
| Partially resolved | 5 | 01, 04, 07, 14, 35 |
| Requires runtime verification | 1 | 27 |
| Enhancement rather than defect | 2 | 30, 36 |
| Already resolved | 0 | none |
| Not applicable to the current architecture | 0 | none |

**Priority changes:**
- ARM-02: Critical → High. Live environments run on an imported schema. Clean and DR builds are still broken.
- ARM-04: Critical → Low on AWS-native. It stays Critical for any Supabase project that still serves PostgREST.

**New findings: 5** (NEW-ARM-A to E, below).
- NEW-ARM-A is High: the ammunition API and reconciliation crash in aws-native mode.
- NEW-ARM-B is High: the QR resolver returns HTTP 500 for any identifier that is not a UUID.

**Fixed on other branches but not on the latest line:**
- ARM-02 tables: `202609100001_complete_module_tables.sql`, commit `b465a33`.
- NEW-ARM-A: the profiles-based name lookup.

Both exist on `codex/production-tls-20260919` and the Sep 8–19 AWS branch family. That family is `aws-main-integration-final-20260908`, `aws-staging-cutover-readiness-20260911`, `aws-controlled-consolidation-20260911`, `desktop-native-checkpoint-20260911`, `aws-production-cutover-readiness-20260912`, `aws-production-ses-authorized-20260912`, `aws-route53-dns-preparation-20260912`, `aws-precutover-completion-20260913` and `mobile-v1-backend-integration-20260914`. Neither branch is an ancestor of 555f061.

No other ARM fix was found on any branch. The markers checked were:
- revoke on `update_firearm_with_audit` in `supabase/migrations`
- lockout evaluator call
- Revoke action for off-duty requests
- self-review guards
- `canCertify` split
- restore reason
- inspection result enum
- caliber `??` bug
- firearm QR kind

## Findings table

| ID | Title (short) | New classification | Priority (orig → revised) | Current evidence (worktree path:line, quote) | Note |
|---|---|---|---|---|---|
| ARM-01 | QR labels unresolvable; firearms unlabeled | **Partially resolved** | High → High | `src/app/api/mobile/qr/resolve/route.ts:6` `opaqueHandle = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/`; `:14-16` `.or(\`id.eq.${value},unit_number.eq.…\`)`; `src/lib/tracepoint/qr-identifiers.ts:1,6` still `"vehicle" \| "equipment"`, `tracepoint://${kind}/…`; label used only in `equipment/page.tsx:27`, `fleet-management/page.tsx:23` | A server resolver now exists and returns vehicle, equipment or firearm. However, it rejects every label the web app prints (HTTP 400) and returns HTTP 500 for any identifier that is not a UUID (reproduced, T5). Firearms are still unlabelled. Scanning on the native client **requires runtime verification**. See the deep-dive. |
| ARM-02 | Tables missing from tracked migrations | **Confirmed applicable defect** | Critical → High | No `create table` for `firearm_status_history`, `ammunition_*`, `attachments` or `pilot_ammunition_workspaces` in `supabase/migrations` or `database/aws`. `supabase/migrations/202610020001_vehicle_document_metadata.sql:4` `alter table public.attachments`. `scripts/validate-clean-bootstrap.mjs:25` `expectedMigrationCount = 75` against 78 files. | Reproduced (T1): a clean bootstrap fails at migration #76 (`relation "public.attachments" does not exist`), and 7 tables are absent. The AWS chain applied on top (T3) does not create them either. Fixed on `codex/production-tls-20260919` (b465a33), not on the latest line. Live RDS and Supabase prod have the tables via import (**runtime verify**). |
| ARM-03 | Two disconnected ammo ledgers | **Confirmed** | High → High | `src/app/firearms/ammunition/page.tsx:280,313` fetch `/api/pilot/ammunition`; `src/app/api/pilot/ammunition/route.ts:87-95` upsert blob; reconciliation reads `ammunition_lots` (`reconciliations/route.ts:244` `expectedQuantity: lot.quantity_on_hand`) | Unchanged. The new `inventory_*` module (`database/aws/035`) does not cover ammunition. In aws-native mode the relational side also crashes (NEW-ARM-A). |
| ARM-04 | `update_firearm_with_audit` SECURITY DEFINER, PUBLIC execute | **Partially resolved** | Critical → Low (AWS-native); Critical (any live Supabase project) | `database/aws/017_bound_armory_rpc_authorization.sql:11,18,176-200` renames it to `_internal` and revokes all. The new wrapper checks `tracepoint_auth.department_id()`, `subject_id()` and `has_department_permission(...,'manage_firearms')`, and is granted to `authenticated` only. `supabase/migrations/20260822184500_add_missing_make_attention.sql:16` is still `security definer` with no grant or revoke anywhere in `supabase/migrations`. | Reproduced both ways. On the Supabase lineage, `anon` and `authenticated` from another tenant can rewrite the serial and forge the `audit_log` actor (T2). On the AWS chain, all abuse attempts get 42501 and the legitimate call succeeds (T4). See the deep-dive. |
| ARM-05 | No lost/stolen lifecycle; two status columns | **Confirmed** | High → High | `src/app/api/armory/firearms/[firearmId]/status/route.ts:15-21` same five statuses | The new `firearm_possession_restrictions` (`no_carry` / `duty_only`, `custody/route.ts:50`) is a restriction, not a disposition. |
| ARM-06 | Archive requires fictitious return | **Confirmed** | High → High | `archive/route.ts:100-117` "Return it before archiving it."; `src/app/firearms/page.tsx:1353,2518`; PATCH return has no close reason (`assignments/route.ts:236-239`) | Unchanged. |
| ARM-07 | Chain of custody never shown | **Partially resolved** | High → High | `src/app/firearms/[firearmId]/page.tsx:195,596` loads `/custody` and shows the last 5 `firearm_custody_events`. `read-repository-supabase.ts:28` is still `.is("returned_at", null)`. | Custody events only cover physical storage↔officer transfers (`database/aws/028:68-87`), and that table exists only in the AWS chain. Assignment, status, inspection and edit history are still not shown, and there is no assignment-history report. |
| ARM-08 | Deactivation ignores issued firearms | **Confirmed** | High → High | `supabase/migrations/202606260003_settings_administration.sql:649` `is_active = p_is_active`; `src/app/api/settings/onboarding/personnel/route.ts:244,285` `is_active: active`; `read-repository-core.ts:73` `?? "Unknown User"` | `database/aws/009_cognito_membership_lifecycle.sql` adds no firearm check. In aws-native mode, `transfer_firearm_custody` rejects inactive officers (`028:116`), but an open assignment is left orphaned. |
| ARM-09 | Qualification lockout never enforced | **Confirmed** | High → High | `src/lib/tracepoint/firearm-qualification-lockout.ts:41` is the only reference, with no importers; issue handler `assignments/route.ts:99-174` | The issue path also ignores the new possession restrictions. Only `transfer_firearm_custody` checks `no_possession_permitted` (`028:121`). |
| ARM-10 | Range malfunctions never reach firearm | **Confirmed** | Medium → Medium | `src/lib/range/workspace-mutation.ts:70,84,102` and `workspace-write-policy.ts:25` only treat `firearm_malfunctions` as a JSON key alias; no `from("firearm_malfunctions")` writer exists in `src` | The JSON copy is now protected against deletion, but it is still not linked to the firearm. |
| ARM-11 | Status change while issued | **Confirmed** | Medium → Medium | `status/route.ts:76-115` has no `firearm_assignments` query; `inspections/route.ts:231-240` | Unchanged. |
| ARM-12 | Return records no observed condition | **Confirmed** | Medium → Medium | `assignments/route.ts:322-323` `condition_at_return: firearm.condition_status ?? null`; body `:236-239` | The original label was "usability". It is an integrity defect, because the field asserts a condition that nobody observed. |
| ARM-13 | Restore wipes archive disposition | **Confirmed** | Medium → Medium | `restore/route.ts:84-89` `archived_at: null … archive_reason: null` | Unchanged. |
| ARM-14 | Record page read-only / loads entire inventory | **Partially resolved** | Medium → Medium | `[firearmId]/page.tsx:163-186` still fetches `/api/armory/firearms?includeArchived=true` then `records.find(...)`; it now has a custody transfer form (`:256,613`). `[firearmId]/route.ts:33` is PATCH only, with no GET. `firearms/page.tsx:1786` copy unchanged. | Issue/return, status, edit and documents are still only in the list view. |
| ARM-15 | Inspection form defaults to Pass/Passed | **Confirmed** | High → High | `src/app/firearms/inspections/new/page.tsx:111…` `status: "Pass"` (15 items); `:324` `useState<…>("Passed")`; `:327` `"Remain In Service"` | Line numbers shifted; the behaviour is unchanged. |
| ARM-16 | Inspection result rules client-only | **Confirmed** | Medium → Medium | `src/app/api/armory/inspections/route.ts:135` `if (!body.result)`; `:186` `result: body.result`; `scripts/staging-extended-workflows.mjs:50` `result:'Pass'` | Unchanged. |
| ARM-17 | Inspection status change bypasses history; not atomic | **Confirmed** | Medium → Medium | `inspections/route.ts:44-50` Passed → `null`; `:223` "Inspection was created, but checklist items could not be saved"; `:231-240` updates `condition_status` with `.eq("id", body.firearmId)` only | In aws-native mode each data-client statement is its own transaction, so it is still not atomic. |
| ARM-18 | No inspection due dates | **Confirmed** | High → High | `last_inspection_date` / `next_inspection_due` are read or written only for equipment (`src/app/api/equipment/assets/route.ts:176`); `notifications/route.ts:283-284` reacts to status only | Unchanged. |
| ARM-19 | Armorer certification only on off-duty | **Confirmed** | Medium → Medium | `evaluateCertificationCapability(` sole caller `src/app/api/off-duty-firearms/[requestId]/inspections/route.ts:176` | Unchanged. |
| ARM-20 | Inspection history capped at 100 | **Confirmed** | Medium → Medium | `src/lib/armory/read-repository-supabase.ts:33` `.limit(100)` (shared by Postgres source `read-repository-postgres.ts:17`); `api/armory/ammunition/route.ts:42` | Unchanged. |
| ARM-21 | Ammo JSON last-write-wins, no actor, no feature gate | **Confirmed** | High → High | `src/app/api/pilot/ammunition/route.ts:87-95` upsert `onConflict: "department_id"` with no version check; there is no `requireServerFeature` in the file (only `:24,59` permission checks); `src/lib/tracepoint/ammunition-workspace.ts:60-73` `AmmoActivity` has no user field | Unchanged. |
| ARM-22 | Physical count silently overwrites; Adjust decrease-only | **Confirmed** | Medium → Medium | `src/app/firearms/ammunition/page.tsx:624` `currentOnHand: physical`; `api/armory/ammunition/route.ts:216` `quantity <= 0`, `:247` `"Issue" \|\| "Adjust" ? -quantity` | Unchanged. |
| ARM-23 | Reconciliation single-person, client-supplied expected | **Confirmed** | High → High | `reconciliations/route.ts:285,355` `canCertify: canManage`; `:443-452` `item.expectedQuantity`, `lot_id: item.lotId`; delete/reinsert `:475` before certify at `:520` | Unchanged. In aws-native mode the GET path crashes first (NEW-ARM-A). |
| ARM-24 | Off-duty cannot be revoked/suspended | **Confirmed** | High → High | `src/app/api/off-duty-firearms/[requestId]/route.ts:368,390` actions `["Resubmit","Approve","Deny","Return"]`; `:508` pending-only | The `database/aws/017` wrapper keeps the same internal RPC. |
| ARM-25 | No renewal; serial unique blocks re-request | **Confirmed** | High → High | `[requestId]/route.ts:424` "Only requests returned for correction may be resubmitted."; `supabase/migrations/202608180004_off_duty_serial_unique.sql:1`; `route.ts:233` computed "Expired" | Unchanged. |
| ARM-26 | Reviewer approves own request | **Confirmed** | Medium → Medium | `[requestId]/route.ts:502-516` checks `isCommandReviewer` and status only. The `database/aws/017:150-154` wrapper checks the actor is the session subject but not that `actor ≠ officer`. | Unchanged. |
| ARM-27 | Qualification override bypasses policy; not firearm-specific | **Requires runtime verification** | Medium → Medium | `[requestId]/route.ts:548-568` `if (!qualificationOverride) { if (await requiresOffDutyQualification(...` | The code behaviour is confirmed. Whether it violates policy depends on each agency's policy, which has to be checked with the agency. |
| ARM-28 | Failed off-duty inspection leaves authorization | **Confirmed** | Medium → Medium | `supabase/migrations/202608170005_record_off_duty_inspection_rpc.sql:54` `else 'Not Inspected'`; `src/app/api/off-duty-firearms/route.ts:125` `return "Not Inspected"`; detail route `:114` `"Failed"` | The AWS wrapper (`017:21-44`) only adds authorization checks. |
| ARM-29 | Personal rifle self-review; non-atomic history | **Confirmed** | Medium → Medium | `src/app/api/armory/personal-rifles/[rifleId]/route.ts:232-262` has no owner check in the armorer or chief branches (the only `owner_user_id` check is at `:89`, the owner-edit path); `:472-490` `update(updates)` then `recordPersonalRifleHistory` | Unchanged. |
| ARM-30 | "Qualification verified" is a checkbox | **Enhancement rather than defect** | Medium → Medium | `[rifleId]/route.ts:256-262` `body.qualificationVerified !== true`; `:279-283` | This works as designed and is an attested control. Linking it to range data is an improvement, not a fix. |
| ARM-31 | Rifle approvals never Expired; alerts stop; no resubmit | **Confirmed** | Medium → Medium | `src/app/firearms/personal-rifles/page.tsx:35-36` UI-only `"Expired"`; `inbox/route.ts:130-131` `expiration >= today && expiration <= sixtyDays`; `personal-rifles/route.ts:154-165` `.ilike("serial_number", …)` | Unchanged. |
| ARM-32 | Attachment list open to any member; cross-module archive | **Confirmed** | Low → Low | `src/app/api/armory/firearms/[firearmId]/attachments/route.ts:20-31` GET has no feature or permission check; `src/app/api/attachments/[attachmentId]/route.ts:10` allows `manage_range_days`; `:14` `ALLOWED_TYPES` excludes HEIC | In aws-native mode, `admin` is RLS-bound (`authenticated`), but `attachments` has no tracked table or RLS. Whether production RLS narrows the listing **requires runtime verification**. |
| ARM-33 | Empty caliber → raw DB error | **Confirmed** | Low → Low | `src/app/api/armory/firearms/[firearmId]/route.ts:27-31` returns `""`; `:113` `cleanOptionalText(body.caliber) ?? "TBD / Unknown"` | Reproduced (T2): `23502 null value in column "caliber"`. This happens on both lineages, because the AWS wrapper delegates to the same body. |
| ARM-34 | Command staff can't use ammo reports/alerts | **Confirmed** | Low → Low | `src/lib/reports/report-definitions.ts:19` `permissions:["manage_firearms","view_command_dashboard"]`; `api/armory/ammunition/route.ts:87` requires `manage_firearms`; `notifications/route.ts:950` calls `/api/pilot/ammunition`; `src/app/api/command-dashboard/` has no armory reads | In aws-native mode the report fails for everyone (NEW-ARM-A). |
| ARM-35 | listUsers(1000) per request; off-duty per-row reloads | **Partially resolved** | Low → Low | `src/lib/armory/read-repository-postgres.ts:18-25` resolves names from `profiles` by id, and `src/lib/tracepoint/personal-rifle-server.ts:66-72` is aws-aware. Ammo `route.ts:43` and `reconciliations/route.ts:115` still call `listUsers`. `off-duty-firearms/route.ts:199` still calls readiness per row. | The armory inventory is fixed in aws-native mode. Bridge mode is unchanged, and the ammo routes regressed into a crash (NEW-ARM-A). |
| ARM-36 | Almost no handler tests | **Enhancement rather than defect** | Medium → Medium | New: `src/lib/armory/custody-native*.test.ts`, `restricted-use-simple-custody.test.ts`, `storage-location-*.test.ts`. There is still no test for status, archive, ammunition, reconciliation, rifle transitions or off-duty decisions, and `qrDecision` has only 3 asserts (`mobile-workflows.test.ts:13-16`). | The bootstrap validator is also stale (ARM-02). |

### New findings (not in the Oct-20 appendix)

| ID | Title | Classification | Priority | Evidence | Note |
|---|---|---|---|---|---|
| NEW-ARM-A | `/api/armory/ammunition` and `/api/armory/ammunition/reconciliations` crash in aws-native mode | Confirmed applicable defect | **High** | `api/armory/ammunition/route.ts:43` and `reconciliations/route.ts:115` call `admin.auth.admin.listUsers(...)`. In aws-native mode `admin` is a `PostgresDataClient` (`server-access-postgres.ts:91,125`), which has no `.auth`. | Reproduced (T6): `TypeError: Cannot read properties of undefined (reading 'admin')`, which the routes return as HTTP 500 (`route.ts:93-99`, `reconciliations/route.ts:305-311`). This breaks the reconciliation page, the "Ammunition Inventory" report and import/export reads. Fixed on `codex/production-tls-20260919`, which uses `admin.from("profiles")`, but not on the latest line. `settings/users/password-reset`, `settings/users/invite`, `settings/onboarding/personnel` and `ai-importer/server/execution.ts` use the same pattern (out of armory scope). |
| NEW-ARM-B | QR resolver returns 500 for every identifier that is not a UUID | Confirmed applicable defect | **High** | `qr/resolve/route.ts:14-16` builds `id.eq.<value>` alongside `asset_number` / `serial_number` / `unit_number` / `vin`. With a text value, the uuid comparison fails with `22P02`. | Reproduced (T5) through the real `PostgresDataClient`: `"FA-0001"` and `"SN-LEGIT"` give `{"http":500,"errors":["22P02","22P02","22P02"]}`, while a bare UUID gives 200. Supabase PostgREST also fails on a uuid `eq` with non-UUID input. Asset-tag, serial, unit-number and VIN matching therefore never works. |
| NEW-ARM-C | Clean-bootstrap validator stale | Confirmed applicable defect | Medium | `scripts/validate-clean-bootstrap.mjs:25` expects 75 migrations; 78 exist | `npm run db:validate-bootstrap` would throw before applying anything. Even with the count fixed, the chain fails at #76 (ARM-02). |
| NEW-ARM-D | The QR "firearm_custody" workflow has no mobile-callable endpoint | Requires runtime verification | Medium | `mobile-workflows.ts:57-58` returns `workflow: "firearm_custody"`. There is no `/api/mobile/**` firearm route (`grep -rl firearm src/app/api/mobile` finds only `qr/resolve`). `/api/armory/firearms/[id]/custody` calls `resolveServerAccess()` without `request`, and aws-native returns 401 for any `Authorization` header (`server-access.ts:167-169`). | A bearer-token client cannot act on a resolved firearm. It may work if the native client opens a cookie-session webview, which is client code and not in the repo. |
| NEW-ARM-E | QR decision leaks existence; equipment has no permission check | Confirmed applicable defect | Low | `mobile-workflows.ts:57-60`: an unauthorized firearm gets `"denied"`, while an absent one gets `"unknown"`. `:54-56`: equipment checks only the feature flag. | Reproduced (T5 §3). |

## Deep-dives

### ARM-04: exposure of `update_firearm_with_audit` in each environment

**AWS-native DB (`database/aws`): the AWS-native path is fixed and verified.**
- `017_bound_armory_rpc_authorization.sql:11` renames the original to `update_firearm_with_audit_internal`.
- `:18` revokes it from `public, anon, authenticated, service_role, tracepoint_runtime`.
- `:176-194` adds a SECURITY DEFINER wrapper. It raises `42501` unless `p_department_id = tracepoint_auth.department_id()` and `p_user_id = tracepoint_auth.subject_id()` and `has_department_permission(p_department_id,'manage_firearms')`.
- `:196,201` revoke it from `public, anon, service_role, tracepoint_runtime` and grant EXECUTE to `authenticated` only.

**Who can execute it (T4, live catalog after applying all 37 AWS migrations on top of the Supabase lineage):**

| Function | anon | authenticated | service_role | tracepoint_runtime (direct) | ACL |
|---|---|---|---|---|---|
| `update_firearm_with_audit` | false | **true** | false | false | `{postgres=X/postgres,authenticated=X/postgres}` |
| `update_firearm_with_audit_internal` | false | false | false | false | `{postgres=X/postgres}` |

**How the app reaches it.**
- The app logs in as `tracepoint_runtime`. Per `003_runtime_role_and_auth_state.sql:8-32`, this role has `noinherit` and `nobypassrls`, and `grant authenticated to tracepoint_runtime`. The DB secret is in Secrets Manager.
- Each request runs `begin; set local role authenticated; set_config('tracepoint.subject_id',…); set_config('tracepoint.department_id',…)` (`postgres-authorization-core.ts:39-45`). The subject comes from the verified Cognito principal. `context.userId` is that same subject, so `p_user_id: context.userId` (`[firearmId]/route.ts:107`) always passes, and a forged value fails.

**Behaviour (T4):**

| Attempt | Result |
|---|---|
| Cross-tenant user, own context | 42501 |
| Cross-tenant user who spoofs the department GUC (needs raw SQL) | 42501 (not a member) |
| Same-tenant armorer forging `p_user_id` | 42501 |
| Direct call of `_internal` | 42501 permission denied |
| `anon` | 42501 permission denied |
| Legitimate armorer | succeeds |

**Can an end user reach Postgres?** No. RDS is private: `publiclyAccessible: false` (`infra/lib/staging-database-stack.ts:82`; the production RDS is described as private in `docs/production-rollback-execution-evidence-20260928.md`). No RDS Data API or HTTP endpoint is configured (grep of `infra/` finds no `enableDataApi` or `EnableHttpEndpoint`), and there is no PostgREST in front of RDS. The only route to it is the Next.js app through the parameterized `PostgresDataClient`.

**Residual risk on AWS:** the GUC-based identity is only as strong as the app tier. Anyone holding the `tracepoint_runtime` credentials, or any future SQL injection, could set `tracepoint.subject_id` to an armorer's UUID. This is inherent to the design and is not specific to this function. **Revised priority on AWS-native: Low**, for hygiene only.

**Supabase lineage (`supabase/migrations`, bridge mode and any surviving Supabase project): still vulnerable.**
- No `revoke`/`grant` for this function exists anywhere in `supabase/migrations`.
- After a clean bootstrap (T1), `has_function_privilege` returns true for both `anon` and `authenticated`, with `proacl = NULL`, which means the default PUBLIC grant applies.
- T2 exploit: as `authenticated`, with a JWT `sub` of an Agency-B user who has no membership in Agency A, calling `update_firearm_with_audit(firearmA, deptA, p_user_id = AgencyA_armorer, …)` returned `{"ok":true,"changed_fields":["serial_number"]}`. The same call as `anon` also succeeded.
- `audit_log.changed_by_user_id` recorded the forged Agency-A armorer for both rows.
- The internal body only checks `department_id = p_department_id` (`20260822184500_add_missing_make_attention.sql:36-41`). The attacker needs to know or guess the department UUID and the firearm UUID, which narrows the exposure somewhat.

**Exposure by environment:**

| Environment | Exposure |
|---|---|
| AWS-native staging and production RDS | Not exposed. Fixed by 017. |
| Bridge (Supabase) staging or Preview, if `NEXT_PUBLIC_SUPABASE_URL` still points at `wztqqqashilusoppddxi` (`infra/lib/runtime-stack.ts:113,126`) | Exposed to any holder of the publishable key plus a valid user JWT (and to anon if anon keys are active). **Requires runtime verification.** |
| Supabase production `izlkwggluhlhzlumtzes` | Anon is mitigated: legacy JWT keys were revoked and the probe returned 401 (retry-4 doc). Email sign-in is disabled. A user still holding a valid ECC-signed session JWT could call it while the project is reachable. **Requires runtime verification** that the project is retired or paused. |

**Recommendation:** add a Supabase-lineage migration that revokes from `public, anon, authenticated`, or retire the Supabase projects. Also note that `scripts/validate-clean-bootstrap.mjs` would reproduce the vulnerable state in any new Supabase environment.

### ARM-01: QR

**Server side: `src/app/api/mobile/qr/resolve/route.ts` accepts:**
- `POST {identifier}`, with a bearer token on `/api/mobile/*` in aws-native mode. Bridge mode uses `getServerAuthenticatedUser` with the bearer token.
- `identifier` is trimmed and capped at 2048 characters (`:5`). It must match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$` (`:6,10`), otherwise the response is 400 "This QR code is not valid."
- The value is then looked up in the caller's tenant across `fleet_vehicles` (id/unit_number/vin), `equipment_assets` (id/asset_number/serial_number, not removed) and **`firearms` (id/asset_number/serial_number, active)** (`:14-16`).
- `qrDecision` returns, in order: vehicle (perm `perform_fleet_inspections` / `view_fleet` / `manage_fleet` + `fleet` feature), then equipment (only the `equipment_readiness` feature), then firearm (`firearm_custody.check_out` / `check_in` / `manage_firearms`) (`mobile-workflows.ts:46-61`).

**Does it resolve `tracepoint://` payloads? No.** The `/` character is not in the allowed set, so `tracepoint://vehicle/<uuid>` and `tracepoint://equipment/<id>`, which are exactly what `buildTracePointQrValue` prints, get HTTP 400 (T5 §1). An HTTPS deep link is also rejected. Nothing on the server strips the scheme. If the native client strips `tracepoint://<kind>/` and URL-decodes before posting, labels for UUID-identified records would resolve. **That is client code and requires runtime verification.**

**Identifiers that are not UUIDs return 500.** The `or()` group always includes `id.eq.<value>`, and `id` is `uuid`. Any asset tag, serial, unit number or VIN raises `22P02 invalid input syntax for type uuid`, and the route returns 500 "TracePoint could not resolve this QR code." (T5 §2, reproduced through the real `PostgresDataClient` against the local AWS-chain DB). The asset/serial/VIN matching the route advertises therefore cannot work in either runtime. A second problem: `.maybeSingle()` returns an error (→ 500) if a value matches more than one row in a table, for example a duplicated serial.

**Are firearms labelable now?**
- Not in the web app. `TracePointQrKind` is still `"vehicle" | "equipment"` (`qr-identifiers.ts:1`), and `src/app/firearms/**` has no QR code.
- A firearm resolves on the server only when the scanned payload is the bare firearm UUID.
- Even then, the returned `workflow: "firearm_custody"` has no bearer-accessible endpoint (NEW-ARM-D).

**Client side:** the native mobile client is out of repo. Camera scanning, scheme handling and how it calls the custody route are **Requires runtime verification**. The web app still has no scanner (no `BarcodeDetector`, `getUserMedia`, `jsqr`, `zxing` or `html5-qrcode` in `src`).

**Classification:** Partially resolved. A server resolver exists and handles firearms. Confirmed server-side defects remain: the printed label format is rejected, non-UUID values return 500, there is no firearm label, the vehicle-dialog copy "Scan with a mobile device to open this vehicle." is still at `TracePointQrLabel.tsx:166`, and there is no mobile firearm custody route. Priority stays High.

### ARM-02: tracked migrations

- **Supabase lineage on the current line: still broken, and now fatally.** A clean bootstrap (T1) applied migrations 1–75 and then failed at **#76 `202610020001_vehicle_document_metadata.sql`** with `42P01 relation "public.attachments" does not exist`.
  - Absent after bootstrap: `firearm_status_history`, `ammunition_lots`, `ammunition_transactions`, `ammunition_reconciliations`, `ammunition_reconciliation_items`, `attachments`, `pilot_ammunition_workspaces`.
  - `pilot_ammunition_workspaces` exists only in `docs/armory-ammunition-v1.sql`, whose header reads "Run in Supabase SQL Editor".
  - The repo's own unit test confirms that the table is presupposed: `scripts/postgres-bootstrap-prerequisites.mjs:24` creates `public.attachments` itself.
  - The repo validator would stop even earlier, on the count check (NEW-ARM-C).
- **AWS lineage (`database/aws` 001–037):** none of the 37 files creates these tables. T3/T4 applied the full chain (with an attachments stub) and the tables were still absent. Only `firearm_custody_events` and the other custody and inventory tables are added.
- **Live environments:**
  - RDS production was seeded from a final import of the Supabase production schema. `scripts/supabase-rest-ledger-core.mjs:21` lists all of these tables as part of the copied set, so existing staging and prod are expected to have them.
  - **Requires runtime verification** that the RDS production catalog contains them, and that their RLS and grants allow `authenticated` to `insert` into `firearm_status_history`. The status route now writes as the `authenticated` role, not service_role, and no tracked policy grants this.
- **Other branch:** `codex/production-tls-20260919` (and the Sep 8–19 AWS family) has `supabase/migrations/202609100001_complete_module_tables.sql` (commit `b465a33` "Complete AWS PostgreSQL module parity"). It creates all eight tables, including `attachments` and `pilot_remediation_workspaces`. It is not an ancestor of 555f061.
- **Classification:** Confirmed applicable defect, for new environments, disaster-recovery rebuilds and CI bootstrap. **Priority Critical → High**: live tenants are not affected by this specific gap, but nobody can stand up a fresh environment from the repo.

## Isolated test log

All tests are in `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/recon/work-armory/`. `node_modules` there is a symlink to the runtime `node_modules`. Captured output is in the matching `t*.out` files.

**Reproduction steps:**
1. Initialise and start Postgres:
   ```
   unshare --user --map-user=1000 --map-group=1000 <runtime>/node_modules/@embedded-postgres/linux-x64/native/bin/initdb -D work-armory/pg/data -U postgres --auth=trust
   ```
   then the same binary set's `pg_ctl … -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories= -p 55491" start`.
2. Run `NODE_PATH=work-armory/node_modules node t1-bootstrap.mjs`, then `t2…`, `t3…` and `t4…`.
3. Run `tsx t5-arm01-qr.mts` and `tsx t6-ammo-aws-auth.mts`.
4. Stop Postgres with `pg_ctl stop`.

**Deviations from the repo's own runner:**
- The test runner stripped the UTF-8 BOM (as `validate-clean-bootstrap.mjs:74` does).
- It replaced `create extension if not exists pgcrypto` with a comment, because the embedded build ships no pgcrypto and `gen_random_uuid` is core in PG13+.
- It made the prerequisite `create role` statements idempotent.
- T3 skipped `supabase/migrations/202610020002_*` and `…0003_*` (inventory). The embedded run hit a syntax error in 0002, and `database/aws/035`/`036` re-apply inventory. T3 also inserted an `attachments` stub so the chain could continue past #76.

| Test | Finding | Expected | Actual |
|---|---|---|---|
| T1 `t1-bootstrap.mjs` | ARM-02, NEW-ARM-C, ARM-04 grants | All 78 tracked migrations apply. Armory tables exist. The RPC is not executable by anon. | 78 files present against 75 expected by the validator. **FAIL at #76** `202610020001…: 42P01 relation "public.attachments" does not exist`. 7 tables absent. `update_firearm_with_audit`: `authenticated_exec=true`, `anon_exec=true`, `security_definer=true`, `acl=null`. |
| T2 `t2-arm04-supabase-shape.mjs` | ARM-04 (Supabase lineage), ARM-33 | Cross-tenant and anon calls rejected. An empty caliber maps to "TBD / Unknown". | Agency-B `authenticated` → `{"ok":true,"changed_fields":["serial_number"]}`. `anon` → ok. Firearm becomes `SN-TAMPERED-2` / model `19`. Both `audit_log` rows have `changed_by_user_id = dddd…0004` (the forged Agency-A armorer). The `""` caliber that the route sends → `23502 null value in column "caliber"`. |
| T3 `t3-aws-chain.mjs` | ARM-02 (AWS lineage) | n/a (setup) | All `database/aws` 001–037 applied cleanly. `firearm_status_history`, `ammunition_lots` and `pilot_ammunition_workspaces` are still absent; `firearm_custody_events` is present. |
| T4 `t4-arm04-aws.mjs` | ARM-04 (AWS) | Only a same-tenant armorer acting as themself succeeds. | Grants as in the deep-dive table. Cases 1–3, 5 and 6 → `42501`. Case 4 legitimate → ok. Final serial `SN-LEGIT`. |
| T5 `t5-arm01-qr.mts` | ARM-01, NEW-ARM-B, NEW-ARM-E | Printed labels resolve. Asset tag and serial resolve. | `tracepoint://…` and `https://…` → fails `opaqueHandle` → 400. Bare UUID → 200 `firearm_custody`. `"FA-0001"` / `"SN-LEGIT"` → 500 (`22P02` ×3). An unauthorized firearm gives `denied`, not `unknown`. Equipment is allowed with no permission. |
| T6 `t6-ammo-aws-auth.mts` | NEW-ARM-A | The ammo ledger loads in aws-native mode. | `typeof admin.auth = undefined`, then `TypeError: Cannot read properties of undefined (reading 'admin')`, which the routes return as HTTP 500. |

Findings with no executable reproduction were classified from static evidence at the cited lines. Every route handler imports `next/server` and `server-access`, so it cannot be run in isolation without the full app.
