# DB authorization verification: real SQL against real policies

Code line: worktree `current` = origin/codex/staging-mobile-api-release-20261007 @ 555f061 (read only). Nothing in /home/user/tracepoint or the worktree was modified. No network calls and no AWS access were made.
Work dir: /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/verify-db/ (scripts, raw outputs `*.out`, PG data dir `pg/`). The server has been stopped.

## 1. Environment and schema build

- Server: PostgreSQL 16.15 from `/usr/lib/postgresql/16/bin`. It was started with `unshare --user --map-user=1000` (initdb with trust auth), listened on 127.0.0.1:55493 plus a unix socket in `verify-db/pg`, and was stopped with `pg_ctl stop -m fast`.
- Prerequisites: `scripts/postgres-bootstrap-prerequisites.mjs` `supabasePrerequisites` was imported verbatim (roles anon/authenticated/service_role, `auth.users`, `auth.uid()`, `storage.*`), plus `supabase_migrations.schema_migrations`, the same as `validate-clean-bootstrap.mjs`. These are the only stubs.
- Order: all `supabase/migrations/*.sql` plus `202609100001_complete_module_tables.sql` (from origin/codex/production-tls-20260919, saved to `verify-db/`), sorted by version, then `database/aws/001..037`. Each file ran in its own transaction. Script: `verify-db/build.mjs`. Log: `verify-db/build.out`.

| Group | Applied | Failed |
|---|---|---|
| supabase/migrations (78 files) | 76 | **2**: `202610020002_inventory_phase1.sql` → `42601 syntax error at end of input` (single simple-query execution through node-pg; psql's statement splitter parses the file); `202610020003_inventory_checkout_phase2a.sql` → `42P01 relation "public.inventory_transactions" does not exist` (cascades from the previous failure) |
| complete_module_tables (other branch) | 1 | 0. It provides `attachments` etc., so the earlier agent's attachments stub was **not** needed. |
| database/aws 001–037 | 37 | 0. 035/036 recreate the inventory schema, so the two inventory failures did not block anything later. |

Finding (low): the two Supabase inventory migrations fail under a single-statement-batch runner. The AWS chain does not depend on them because aws/035 and aws/036 supersede them. I did not dig further.

- Runtime role: `tracepoint_runtime` (aws/003: NOLOGIN, NOINHERIT, member of `authenticated`). The deployment bootstrap enables LOGIN after migrations, and I did the same here (`alter role tracepoint_runtime login`). **All tests ran with `session_user = tracepoint_runtime`.** This matters: `tracepoint_auth.is_platform_supporting()`, `set_platform_entitlement()`, the invite and activation functions and others check `session_user = 'tracepoint_runtime'`. As a control, the same support-mode context under session_user=postgres gives `is_platform_supporting = f`.
- Session context reproduced exactly from `src/lib/database/postgres-authorization-core.ts` (`withPostgresAuthorization`), which `PostgresDataClient` uses per query:
  `begin; set local role authenticated; select set_config('tracepoint.subject_id',$1,true); select set_config('tracepoint.department_id',$2,true); [support: select set_config('tracepoint.support_department_id',$2,true)]; <query>; commit;`
  Every app `.from()/.rpc()` call is its **own transaction**, so each statement below runs in its own tx, as in the app. `resolvePostgresAccess` and the `beginSubject` paths set only `subject_id`. The generated SQL shapes come from `postgres-data-client.ts`: insert/update/delete add `returning <cols>` only when `.select()` is chained.

## 2. Seed (`verify-db/seed.sql`)

There is no global "fleet inspector" or "equipment manager" role. Global roles: administrator, armorer, chief, command_staff, fleet_manager, instructor, mechanic, officer, range_master, supervisor. Both were therefore modelled the way a department admin configures them, through the per-department matrix `department_role_permissions`. `seed_department_configuration` copies `role_permissions` (except administrator) into each new department.

| Actor | Dept | Role(s) | Effective relevant permissions |
|---|---|---|---|
| ADMA a…a1 | A | administrator | all (administrator short-circuit in `has_department_permission`) |
| FM a…f1 | A | fleet_manager | manage_fleet, manage_fleet_maintenance, manage_fleet_rules, perform_fleet_inspections, view_fleet (no administer_department) |
| INSP a…e1 | A | supervisor + dept grant `perform_fleet_inspections` | perform_fleet_inspections, submit_off_duty_requests, view_analytics |
| OFF a…c1, OFF2 a…c2 | A | officer | submit_off_duty_requests |
| EQM a…d1 | A | armorer + dept grant `manage_equipment` | manage_equipment, manage_firearms, manage_inspections, … |
| ADMB, OFFB | B | administrator / officer | |
| PA 9…01 | none | `platform_admins` row (active) | |
| NM 8…01 | none | none | |

Data: fleet vehicle A-101 with a required, critical equipment item (AED), default `fleet_rules` row, equipment assets EQ-1 and EQ-2 (type Radio), a Dept B firearm, training certifications, qualification results and an agency training attendee for OFF and OFF2.

## 3. Results

| Test | Finding | Verdict | Key evidence |
|---|---|---|---|
| T1 NEW-01 inspector inspection | Only the inspection insert succeeds. The equipment status update and the vehicle mileage/due-date update affect 0 rows silently. The work order insert fails RLS (the route ignores the error, so workOrder=null). The `auditFleet` insert fails RLS and the route throws → HTTP 500 **after** the inspection row was committed. The critical defect never takes the vehicle out of service. | **Defect confirmed** | `INSERT 0 1` (inspection); `UPDATE 0` (fleet_vehicle_equipment); `ERROR: new row violates row-level security policy for table "fleet_work_orders"`; `UPDATE 0` (fleet_vehicles); `ERROR: … policy for table "audit_events"`. Post-state: vehicle `Available`, mileage 1000, due date null, AED `Current`, 0 work orders, 0 audit events. |
| T2 fleet manager audit | Every fleet write succeeds (inspection, equipment → Out of Service, work order, vehicle update), but the `auditFleet` insert into `audit_events` fails RLS → route 500 and `refreshFleetVehicle` never runs. The `audit_events_insert_managers` WITH CHECK lists only manage_users/manage_firearms/manage_inspections/manage_range_days/manage_qualifications/review_off_duty_requests/administer_department, with no fleet permission. Control: dept admin's identical insert → `INSERT 0 1`. | **Defect confirmed** | `UPDATE 1`, `INSERT 0 1` (work order), `UPDATE 1`, then `ERROR: new row violates row-level security policy for table "audit_events"`. Only trigger-written `fleet_vehicles insert/update` audit rows exist for FM, with no `fleet_vehicle_inspected` event. Every fleet route that calls `auditFleet` will 500 for non-admin fleet roles. |
| T3 EQP-06 officer custody | Officers cannot use self-service custody at all. Check-out: `select` of an unassigned asset returns 0 rows (SELECT policy = assigned to self OR manage_equipment/admin) → route 404. The conditional update gives `UPDATE 0`. Check-in of an asset assigned to the officer: the row is visible, but `UPDATE 0` (UPDATE policy is managers only) → route 409 "custody changed before check-in completed". `annotateAssignment` gives `UPDATE 0`. | **Defect confirmed** (functional: the endpoint cannot work for its intended users; no privilege escalation) | `(0 rows)` / `UPDATE 0` ×3. Post-state: EQ-2 is still assigned to the officer and active. |
| T4 NEW-ADM-C support-mode entitlement | In support mode `is_platform_supporting = t` and `has_department_permission(A,'administer_department') = t`, but the PATCH's direct `department_features` upsert → `ERROR: permission denied for table department_features`, and `department_feature_events` insert → `permission denied` (authenticated has only SELECT). So `/api/super-admin` PATCH always 500s in support mode, and returns 403 outside support mode for a membership-less platform admin ("No active department membership"). `set_platform_entitlement()` works: the state row is written and an event is recorded. It works for **any** department (Dept B while supporting Dept A), which looks intended for a platform function. It rejects a non-platform dept admin (`platform administrator access required`). The working wrapper `PlatformAdminRepository.setEntitlement` (src/lib/platform/admin-access.ts:156) has no caller in src. | **Defect confirmed** (PATCH broken; correct RPC exists but is unused) | `ERROR: permission denied for table department_features`; `set_platform_entitlement` returned; rows `(A, equipment_readiness, f, PA)` and `(B, firearms, f, PA)` plus 2 events. |
| T5 ADM-03 create_department_with_owner | An authenticated subject with no membership and no platform role creates a department and becomes its administrator. The only check is `subject_id() is not null`. EXECUTE is granted to `authenticated`. | **Defect confirmed at DB layer** (reachability inconclusive) | `new_department_id 94a537f2…`; `Rogue Agency | t | administrator | admin_perm t`. Caveat: the only caller, `src/app/auth/setup/page.tsx`, uses the Supabase client (`@/lib/supabase/server`), and `resolvePostgresAccess` refuses membership-less users before a `PostgresDataClient` exists. I found no AWS-runtime HTTP path that issues this RPC for a membership-less user. |
| T6 ARM-04 update_firearm_with_audit | The wrapper denies every cross-tenant variant: wrong p_department_id, own dept with a foreign firearm id, forged `tracepoint.department_id`, and spoofed p_user_id. The `_internal` function is not executable by authenticated. Positive control (Dept B admin) succeeds. | **Not reproduced** (fixed) | `ERROR: firearm update forbidden` ×3; `Firearm not found for this department.`; `permission denied for function update_firearm_with_audit_internal`; control `ok t`; Dept B firearm unchanged. |
| T7 EQP-09 out_of_service | `equipment_assets_lifecycle_status_check` allows only active/maintenance/expired/removed. Setting `out_of_service` fails even as superuser. The custody check-in route (condition ≠ serviceable) writes `lifecycle_status='out_of_service'`, so it would fail with a 500 even for a manager. No aws/*.sql changes the constraint. | **Defect confirmed** | `ERROR: new row for relation "equipment_assets" violates check constraint "equipment_assets_lifecycle_status_check"` (as EQM under RLS, and as postgres). |
| T8 TRN-26 officer reads others' training | A plain officer reads other officers' training_certifications, qualification_results (scores and pass/fail) and agency_training_attendees. SELECT policies are `is_department_member(department_id)` only, as on every agency_training_* table. Cross-tenant is blocked (Dept B officer sees 0 rows from Dept A). | **Defect confirmed** (intra-department over-exposure) | OFF sees `Officer A2 private cert`, `c2 | 71.00 | f`, and the attendee row for c2; Dept B officer counts are 0/0. |
| T9 NEW-ADM-A invited user sign-in | Invite flow run with the real functions (prepare_cognito_invite 13-arg → confirm_cognito_provider_username → commit_cognito_invite → finish_cognito_invite(true)). The invitee ends with link `state='pending'`, membership `is_active=t, activation_status='activation_sent'`. `PostgresIdentityMappingStore.findActive` SQL (requires `state='active'`) returns **0 rows**, and the `registerVerified` mapping lock also returns 0 rows. The row exists, but as pending. Only two DB functions move a link to active: `finalize_cognito_activation` (no caller in src) and `finish_cognito_password_operation` (admin "assign password"). After assign_password, findActive returns the user. The only other path is the hard-coded rehearsal promotion for 2 fixed subjects in `postgres-sessions.ts` and `postgres-mapping.ts`. | **Defect confirmed** (an invitee who completes the Cognito invitation cannot be mapped or signed in until an admin assigns a password) | `pending | …` row; findActive `(0 rows)`; after assign_password `70000000-…-0001` returned. |

## 4. Raw output files

All in /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/verify-db/:
- `build.out`: per-file migration status
- `t1.out`: T1 as inspector
- `t2.out` and `t2-auditlog.out`: T2 as fleet manager
- `t3.out`: T3 custody, plus the T2 admin control
- `t4t7.out`: T4 and T7
- `t5t6t8.out` and `t6control.out`: T5, T6 and T8
- `t9.out`: T9
- Scripts: `ctx.sh` (session helper), `t1t2.sh`, `t3.sh`, `t4t7.sh`, `t5t6t8.sh`, `t9.sh`, `seed.sql`, `build.mjs`
- Templates: `tpseed` (DB snapshot right after seeding) and `tpverify` (post-test state), both inside the stopped cluster

## 5. Caveats

- The fleet "inspector" is the supervisor role with a department-granted `perform_fleet_inspections`, and the "equipment manager" is the armorer role with a department-granted `manage_equipment`. No global role exists for either. Results depend only on the permission codes, not on the role names.
- T1 and T2 ran on the same vehicle in sequence: T1 changed nothing, and T2 started from the same state.
- `auth.users` and `storage` are the minimal stubs from the repo's own bootstrap prerequisites. Production AWS may differ in non-authorization details, such as the real `auth.users` columns.
