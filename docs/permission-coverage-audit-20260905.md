# Granular department permission audit — 2026-09-05

> **Production catalog correction:** the subsequent focused audit found six
> manually provisioned production catalog codes and assignments that were not
> represented by the tracked migration chain. See
> `docs/legacy-production-permission-audit-20260905.md`. References below to
> dead Training Alert codes being absent from the catalog mean the reproducible
> migration catalog, not the live production catalog.

## Authority and scope

The saved `department_role_permissions` matrix is authoritative for every active non-Administrator department member. The exact `administrator` role inherits every row in the `permissions` catalog at evaluation time, including permissions added later. No other role name grants authority. Platform administrators retain the existing control-plane and explicitly selected Support Mode paths; they do not become department members and `has_department_permission` returns false without an active membership.

Browser navigation uses the same effective permission set as server access. APIs resolve the authenticated user and active department before using the service client, scope every record query by `department_id`, return 401 for no session and 403 for inactive, unauthorized, or cross-department access, and use RLS/RPC checks for direct authenticated database calls. Member-owned or participant reads are called out below; management permissions do not erase those legitimate self-service reads.

The canonical display name, description, action list, module, route, and table map is exported as `PERMISSION_COVERAGE` in `src/lib/tracepoint/permissions.ts`. The generated test fails when a catalog permission is missing from this map or has no action, route, module, or table surface.

## Complete permission coverage

| Code | Display name and semantic scope | Actions | Enforced surfaces | Direct data boundary | Evidence |
|---|---|---|---|---|---|
| `view_command_dashboard` | **View Command Dashboard.** Department command metrics, readiness, operations, and report views; no editing. | View, Export | Command layout/nav; operations, personnel, notification and report reads | Active tenant context plus route checks; scoped repositories/RLS | Generated catalog and actor matrix; route structural test |
| `view_analytics` | **View Analytics.** Department qualification, drill, firearm, training, equipment, alert, and performance analytics; no editing. | View, Export | Analytics layout/nav; performance summary; readiness/report reads; Training Alerts read | Active tenant context and exact API checks | Generated catalog and actor matrix; exact-permission structural test |
| `manage_users` | **Manage Users.** Non-Administrator memberships, activation, roles, groups, ranks, units, invites, and password workflows. | View, Create, Edit | Settings matrix/personnel controls; settings user and onboarding APIs | `has_department_permission`; member/group/role RPCs; membership RLS; final-Administrator triggers | Generated actor matrix; clean-bootstrap final-admin and RPC tests |
| `manage_firearms` | **Manage Firearms.** Department firearm and ammunition inventory, assignment, archive/restore, documents, and reconciliation. | View, Create, Edit, Delete/Archive | Firearms/ammunition nav, pages, API mutations and reports | Department filters, firearm/ammunition RLS/RPCs, audit triggers | Generated actor matrix; direct-API structural matrix |
| `manage_inspections` | **Manage Inspections.** Firearm inspections, malfunctions, maintenance, and armorer review. | View, Create, Edit, Approve | Inspection pages/APIs; personal-rifle armorer review; off-duty inspection workflow | Department-scoped APIs plus inspection/personal-rifle RLS | Generated actor matrix; personal-rifle policy structural test |
| `approve_personal_rifles` | **Approve Personal Rifles.** Final approval, denial, or revocation after armorer review. | View, Approve | Review nav/page; personal-rifle decision API | Personal-rifle and status-history RLS now use this permission; Administrator inherits | Generated actor matrix; new-policy structural test |
| `manage_range_days` | **Manage Range Days.** Range days, rosters, drill library, drill associations, lifecycle and packets. | View, Create, Edit, Delete/Archive, Configure | Range/drill nav controls and mutation APIs | Workspace mutation guard; range/drill RLS; finalized-record lifecycle checks | Generated actor matrix; permission-controlled editing direct-API/RLS tests |
| `score_range_days` | **Score Range Days.** Enter or update drill and qualification scores while the record is mutable. | View, Score | Range scoring controls and workspace API | Workspace guard and qualification/drill-result RLS; completed/locked protection | Generated actor matrix; range mutation structural tests |
| `manage_qualifications` | **Manage Qualifications.** Standards, course versions, history imports, evidence, results, and exports. | View, Create, Edit, Delete/Archive, Configure, Export | Qualification management controls/APIs and reports | Qualification RLS/RPCs; tenant filters; evidence scope | Generated actor matrix; exact-permission structural test |
| `manage_certifications` | **Manage Certifications.** Types, requirements, officer records, evidence, readiness and exports. | View, Create, Edit, Delete/Archive, Configure, Export | Certification controls/APIs/readiness | Certification RLS corrected from `manage_qualifications`; API checks use authenticated effective permissions | Generated actor matrix; certification route/policy tests |
| `manage_training` | **Manage Agency Training.** Courses, events, rosters, attendance, files, closeout/reopen, remediation and reports. | View, Create, Edit, Delete/Archive, Approve, Export, Configure | Agency Training and Training Alerts management; all training mutations/reports | Agency-training RLS corrected to exact permission; tenant-bound APIs and lifecycle RPCs | Generated actor matrix; exact-permission route/policy tests |
| `manage_equipment` | **Manage Equipment.** Assets, types, requirements, assignment/custody changes, archive/removal and exports. Members keep self-assignment reads. | View, Create, Edit, Delete/Archive, Configure, Export | Equipment nav/buttons/APIs/readiness | Equipment RLS and API checks; assignment-history trigger; referenced-type delete guard | Generated actor matrix; permission-controlled editing direct-API/RLS/history tests |
| `view_fleet` | **View Fleet.** Vehicles, readiness, inspections, maintenance, equipment, documents and reports. | View, Export | Fleet nav/list/detail/report | Tenant-bound read repositories and fleet RLS | Generated actor matrix; fleet structural tests |
| `manage_fleet` | **Manage Fleet.** Vehicle creation/editing, status, assignment, equipment, documents and operational records. | View, Create, Edit, Delete/Archive | Fleet editor and vehicle APIs | Exact server check, tenant filters, audit before/after; fleet write RLS | Generated actor matrix; authorized/denied/cross-tenant/audit/history tests |
| `perform_fleet_inspections` | **Perform Fleet Inspections.** Complete inspections without general Fleet edit access. | View, Create | Fleet inspection controls/API | Exact API check, tenant filters and fleet inspection RLS | Generated actor matrix; direct-API structural test |
| `manage_fleet_maintenance` | **Manage Fleet Maintenance.** Create, assign, update and complete work orders. | View, Create, Edit, Delete/Archive | Maintenance controls/API/report | Exact permission checks replace mechanic/fleet-role shortcuts; tenant filters and audit | Generated actor matrix; shortcut and API structural tests |
| `manage_fleet_rules` | **Manage Fleet Rules.** Inspection templates, readiness, network-field visibility and notification routing. | View, Configure | Fleet Settings nav/panel/rules API | Exact server check and rules RLS | Generated actor matrix; shortcut and route tests |
| `submit_off_duty_requests` | **Submit Off-Duty Requests.** Create, correct and resubmit only the signed-in member's requests. | View, Create, Edit | Off-duty nav, submit/correction UI and APIs | Exact API check plus officer ownership and department-scoped RPC | Generated actor matrix; direct-API structural test |
| `review_off_duty_requests` | **Review Off-Duty Requests.** Department inbox, approve, deny, return, revoke and archive. | View, Approve, Delete/Archive | Department review UI/API and notification inbox/routing | Exact server check; notification recipients derived from configured roles and active memberships | Generated actor matrix; no-role-shortcut structural test |
| `view_audit_log` | **View Audit Log.** Department audit feed and export; no mutation. | View, Export | Settings audit tab, audit APIs and report | Exact server check and department filter; audit RLS | Generated actor matrix; route structural test |
| `administer_department` | **Administer Department.** Profile, security, appearance, rules, permission matrix, imports/exports and Administrator assignments. Reserved for exact Administrator inheritance. | View, Create, Edit, Delete/Archive, Approve, Score, Export, Configure, Administer | Settings administration and import/export; support-mode selected department | Cannot be stored for ordinary roles; exact Administrator inherits; platform path requires active platform admin plus explicit selected department | Generated matrix uses Administrator as positive actor; reserved-row, final-admin and platform-selection bootstrap tests |

## Legitimate member and participant reads

- Equipment members may read their own current assignments and custody-facing readiness. `manage_equipment` controls department-wide management.
- Range-day participants may read their active workspace and their own qualification history. `manage_range_days`, `score_range_days`, and `manage_qualifications` control management, scoring, and standards/history mutations.
- Agency-training attendees may read events and records in which they participate. `manage_training` controls department-wide course, event, roster, closeout, remediation, file and report mutations.
- Off-duty members need `submit_off_duty_requests` for their own request workspace. Department review requires `review_off_duty_requests`.
- The personnel endpoint returns only the signed-in member unless the caller has a command, personnel, range, qualification, scoring, or training permission that requires a department roster.
- Notifications return member-targeted items by default. Department inbox items require a relevant management/readiness permission; off-duty review items require `review_off_duty_requests`.

## Defects and root causes corrected

1. **Catalog drift:** `manage_training`, `manage_certifications`, and `manage_equipment` existed in TypeScript but had no database catalog rows. Settings could not display or persist them. The migration registers all three.
2. **Undocumented role shortcuts:** personal-rifle, off-duty, ammunition, Fleet maintenance/network-detail, and notification paths granted authority from names such as chief, armorer, range master, mechanic, and fleet manager. They now evaluate exact configured permissions. Existing effective behavior is translated once into editable permission rows for compatibility.
3. **Administrator aliases and stale rows:** application and database helpers treated several admin-like names as universal and seeded static Administrator rows. Only exact `administrator` now inherits the live catalog. New departments no longer seed Administrator permission rows, and Settings shows inherited permissions as effective and locked.
4. **RPC regression:** the platform-support migration replaced `set_department_member_roles` and removed validation, audit, and final-Administrator protection. The RPC is restored with tenant authorization, role validation, set-difference updates, audit details and database triggers that also cover direct writes.
5. **Certification false denial:** certification APIs invoked `has_department_permission` through a service-role client, where `auth.uid()` is absent. Configured managers were denied. APIs now evaluate the already authenticated effective permission context; RLS uses `manage_certifications`.
6. **Training overreach:** agency-training policies accepted `manage_certifications` or `manage_range_days`. Every agency-training mutation and report now requires `manage_training`; attendee reads remain scoped.
7. **Dead Training Alert codes:** the UI checked six codes that were absent from the tracked migration catalog but were later found as manually provisioned production rows. Training Alerts now use `manage_training` for management and `view_analytics` for read-only department analysis. The dead codes were not added to the tracked catalog.
8. **Settings save race:** the UI announced success before reloading the saved matrix and used a direct browser RPC. A tenant-bound API now performs atomic replacement, returns the normalized persisted list, then the client reloads Settings and access state before reporting success. Failed saves retain the draft.
9. **Ungated operational endpoints:** performance summary, ammunition pilot mutations, remediation mutation, off-duty submission, attachment download, and full personnel-directory reads had incomplete checks. Exact permissions, owner/assignment checks and tenant scope now apply.
10. **Internal denial detail:** access failures now return controlled 401/403 responses and sanitize server-side database access failures. Denied browser routes use `/unauthorized`.
11. **Final Administrator composite bug:** a nullable field made a PostgreSQL composite `OLD IS NOT NULL` check unreliable. The redundant test was removed and a direct database deletion test proves enforcement.
12. **Parallel client authority:** an obsolete client module hard-coded an Administrator, a Chief, broad permissions, and one user ID. The module was removed. Range records now use the authenticated user ID returned by the tenant-bound workspace API.

## Dead, misleading, duplicated, or overbroad controls

- Removed runtime references: `view_training_alerts`, `manage_training_alerts`, `approve_off_duty_requests`, `return_off_duty_requests`, and `deny_off_duty_requests`. The first two were later confirmed as manually provisioned production catalog rows; none was in the tracked migration catalog.
- `manage_qualifications` no longer controls certification tables.
- `manage_range_days` and `manage_certifications` no longer control agency-training writes.
- `manage_firearms` no longer implies final personal-rifle approval or off-duty command review.
- Role labels and Fleet notification assignment roles remain presentation/routing data. They do not authorize a mutation.
- No live integration/API-key administration capability exists in this repository. The landing page describes integrations as roadmap concepts, so no inert permission was added.

## Migration and compatibility

`202609050002_granular_permission_authority.sql` is additive and idempotent. It registers four catalog permissions, translates previously effective qualification/training/chief behavior into explicit editable grants, replaces authorization helpers/RPCs, corrects targeted RLS policies, and adds guards. It does not rewrite or delete assignments, custody, inspections, maintenance, qualifications, range records, approvals, audit events, or agency settings. Existing redundant Administrator rows are ignored rather than deleted.

Deployment order is migration first, then application, because older application code tolerates the additive catalog and stricter helpers while the new application expects the new permission rows and RPC return value. This branch and its Preview do not apply the migration to production.

## Validation design

- `granular-permissions.test.ts` generates catalog/coverage assertions and scans server, API, Settings, RLS/RPC, role-shortcut and error-semantic surfaces.
- `permission-controlled-editing.test.ts` covers direct Fleet, Equipment and Range API enforcement, audit details, tenant filters, history preservation, drill-association deletion semantics and UI gating.
- `validate-clean-bootstrap.mjs` applies all 58 migrations to disposable PostgreSQL, reapplies the authority migration for idempotence, and generates positive/negative checks for every permission across explicit grant, no grant, inactive, cross-tenant, Administrator and platform-without-membership actors. It also exercises atomic replacement, immediate effect, platform explicit-department save, Administrator set-difference updates, final-Administrator direct-write denial, expected RLS/trigger definitions and fixture cleanup by database disposal.
- Settings repository tests cover support aggregation, security gates, tenant rejection and provider behavior.

## Validation results

- Focused authorization/settings suite: **21 passed, 0 failed**.
- Generated database actor coverage: **21 catalog permissions**, with granted/no-grant, inactive, cross-tenant, Administrator, and platform-without-membership outcomes; passed.
- Clean bootstrap: **58 ordered migrations**, followed by a second application of this migration for idempotence; passed. The disposable database is removed after every run.
- TypeScript: `tsc --noEmit`; passed.
- Focused lint: canonical permission, Settings API/repository, proxy, controlled-page and generated-test files; passed. A changed-line scan across every edited TypeScript file found **0 lint messages on added lines**.
- Production build: Next.js 16.2.6, **79 routes/pages**; passed.
- Broad test discovery: **140 passed**. Two legacy test files cannot be parsed by Node's strip-only TypeScript runner because their existing repository cores use constructor parameter properties; neither reached a test assertion.
- Broad lint was inspected and remains existing repository debt: **441 errors and 54 warnings**, led by 377 `no-explicit-any`, 47 unused-variable, and 40 React effect findings. No added line contributes to that count.
