# Legacy production permission audit — 2026-09-05

## Outcome

The six production catalog codes are not part of TracePoint's current application permission authority. An active non-Administrator with only one of these codes receives no effective application permission, no Training Alerts navigation item, no direct page access, and no Training Alerts API access. Adding the suspected broader permission produces exactly the same application behavior whether or not the legacy code is also present.

Production's generic `has_department_permission` database function still returns `true` for a valid legacy grant because the rows exist in the production catalog. No production RPC or RLS policy names any of the six codes, however, so that truth value authorizes no data operation. The live `pilot_remediation_workspaces` table has RLS enabled and zero policies; direct authenticated access is denied even to an Administrator. The application reaches it only through a service-role API after application authorization.

The three remediation codes are functionally duplicated by `manage_training` for the current pilot's single bulk-write operation. `view_training_alerts` is functionally duplicated by `view_analytics` for the current generated department feed, but its original routed-recipient semantics do not exist. `manage_training_alerts` and `view_command_training_alerts` describe server-persisted and command-scoped capabilities that do not exist.

No production catalog row or assignment was changed during this audit. All production queries were read-only and returned only catalog metadata and aggregate counts.

## Source and history trace

### Historical legacy references

The only checked-in references to the six literal codes before this audit were documentation or manually executed SQL, not tracked migrations:

- `docs/training-alert-permissions.sql` defines all six catalog rows and intended global role defaults. Its header says to run it manually in the Supabase SQL Editor.
- `docs/training-alert-permission-hardening.md` describes the original page-only gate.
- `docs/pilot-remediation-workspace.sql` uses `create_remediations`, `manage_remediations`, and `resolve_remediations` in proposed pilot-table policies. It also says to run manually.
- `docs/permission-coverage-audit-20260905.md` records the granular rollout's replacement of the legacy runtime checks.

Commit `874ae80` introduced the six-code page gate and catalog SQL on 2026-07-02. Commit `0f84cab` added the pilot remediation API/table SQL later that day. Commit `e2f5488` removed the six-code page check on 2026-09-05 and replaced it with canonical broader permissions.

There are no literal references to any of the six codes in application runtime files, tracked migrations, generated database types, notification/background code, RPC definitions, or checked-in RLS policies. `permissions.code`, `role_permissions.permission_code`, and `department_role_permissions.permission_code` are generated as plain `string`, so generated types cannot provide code-level evidence.

### Current executable application paths

| Surface | Exact path | Current authority and behavior |
|---|---|---|
| Canonical application catalog and route rule | `src/lib/tracepoint/permissions.ts` | The six codes are absent from `TRACEPOINT_PERMISSIONS`; unknown granted strings are filtered. `/training-alerts` accepts `manage_training` or `view_analytics`. |
| Effective permission calculation | `src/lib/tracepoint/permission-authority.ts` | Active non-Administrators receive only recognized canonical codes. Exact `administrator` inherits all canonical TypeScript codes, not arbitrary production catalog rows. |
| Membership/tenant resolution | `src/lib/tracepoint/server-access.ts` | Requires the selected department and an active membership before role grants are loaded. Other-department and inactive assignments do not cross the boundary. |
| Navigation | `src/app/components/TracePointShell.tsx` | Training Alerts appears for `manage_training` or `view_analytics`, subject to the `range_training` feature. |
| Direct page | `src/app/training-alerts/layout.tsx`, `src/app/training-alerts/page.tsx` | Requires active access, `range_training`, and `manage_training` or `view_analytics`; otherwise redirects. |
| Generated training-alert feed | `src/app/api/pilot/performance-summary/route.ts` | Requires `view_analytics`; reads department personnel, qualifications, range days, drills, and results through the tenant-bound range repository. |
| Remediation read | `src/app/api/pilot/remediations/route.ts` `GET` | Requires `manage_training` or `view_analytics`; reads the selected department's single JSON workspace. |
| Remediation write | `src/app/api/pilot/remediations/route.ts` `PUT` | Requires `manage_training`; replaces the selected department's entire remediation JSON array with a service-role upsert and appends an `audit_events` summary. |
| Data-access helper | `src/lib/range/read-repository-core.ts`, `src/lib/range/read-repository-supabase.ts` | Enforces the selected department ID; contains no additional permission decision. |
| Client workflow | `src/app/training-alerts/TrainingAlertsClient.tsx` | Loads both APIs concurrently. Alert acknowledgment/resolution is browser `localStorage` only. Remediation create/assign/note/status/resolve updates the JSON array and debounces the bulk `PUT`. All action buttons render for every page viewer. |
| Proxy | `src/lib/supabase/proxy.ts`, `src/proxy.ts` | Enforces session/active-access boundaries; route-specific authority is the canonical page/API check. |

There are no relevant Server Actions. The workflow uses Route Handlers and browser state.

### Current database, notifications, and adjacent functionality

The production database was inspected read-only through the linked project on 2026-09-05:

- No function definition contains one of the six literal codes.
- No RLS `USING` or `WITH CHECK` expression contains one of the six literal codes.
- `pilot_remediation_workspaces` exists, has RLS enabled, and has zero policies. It has 2 department workspace rows containing 2 remediation JSON records in aggregate.
- `alerts` has 0 rows. Its foundational policies allow any department member to select; insert uses `view_command_dashboard`, `manage_firearms`, or `manage_range_days`; update uses `view_command_dashboard` or record assignment; delete uses `administer_department`.
- `remedial_training_recommendations` has 0 rows. Its policies allow department-member reads, `score_range_days` or `manage_qualifications` inserts/updates, and `administer_department` deletes.

The last two tables are adjacent concepts, not persistence for the current `/training-alerts` pilot. The client feed is generated on request and the pilot remediations live in a separate JSON workspace.

`src/app/api/notifications/route.ts` and `src/lib/tracepoint/agency-training-notifications.ts` implement a separate notification inbox. Department readiness/training visibility is derived from `manage_training`, `manage_certifications`, `manage_qualifications`, `manage_equipment`, `view_command_dashboard`, `view_analytics`, range permissions, or armory permissions depending on source. Notification event RLS is user-owned. None of the six legacy codes controls notification generation, routing, acknowledgement, snoozing, email queuing, or background dispatch.

## Intended function, actual controller, classification, and disposition

| Legacy code | Intended function from production description | Actual current function/controller | Classification | Recommendation |
|---|---|---|---|---|
| `create_remediations` | Create remediation records from failures, trends, or concerns. | The client creates a JSON record from a generated alert; `PUT /api/pilot/remediations` persists the complete array under `manage_training`. `score_range_days` or `manage_qualifications` controls inserts to the separate, unused `remedial_training_recommendations` table. | **Functionally duplicated by a broader permission.** | Deprecate and safely remove. Document `manage_training` as the current pilot write authority. Do not auto-grant it from legacy rows because it also grants full agency-training administration. |
| `manage_remediations` | Assign, update, document, and manage remediation records. | Assign, start, escalate, and add-note operations all become the same bulk JSON `PUT` under `manage_training`. There is no field/action-level authorization. | **Functionally duplicated by a broader permission.** | Deprecate and safely remove without translating grants. If separate remediation delegation becomes necessary, design a new canonical CRUD permission and enforce it at UI, API, and RLS layers. |
| `resolve_remediations` | Close remediation after successful completion or administrative resolution. | Completion is a client status change followed by the same `manage_training` bulk `PUT`; linked alert resolution remains browser-local. `view_command_dashboard` updates the separate foundational `alerts` table, and `score_range_days`/`manage_qualifications` update separate recommendations. | **Functionally duplicated by a broader permission.** | Deprecate and safely remove without translating grants. Add a dedicated transition RPC/API only if resolution needs distinct approval authority. |
| `view_training_alerts` | View alerts routed to a user, role, or command group. | The current feed is department-wide performance analytics generated by `GET /api/pilot/performance-summary`, which requires `view_analytics`. Recipient labels are presentation strings; user/role routing is not enforced. | **Functionally duplicated by a broader permission** for the existing feed; the narrower routed-recipient intent is unimplemented. | Deprecate and safely remove without auto-granting `view_analytics`. If routed visibility is built, define a new scoped permission after the data model and recipient policies exist. |
| `manage_training_alerts` | Acknowledge, assign, resolve, dismiss, or escalate alerts. | Acknowledge and resolve are local browser state. Dismissal and alert assignment are absent. Escalation is a remediation JSON status. `view_analytics` users see all buttons; only remediation persistence is rejected without `manage_training`. | **Intended for functionality that does not yet exist.** | Retire the misleading active catalog row now. Reserve the concept for a future server-persisted alert workflow with explicit state transitions, audit records, and action-level enforcement. |
| `view_command_training_alerts` | View high-severity, escalated, command-visible alerts. | Every page viewer sees high-severity alerts and `commandNotified` remediations. `view_command_dashboard` alone cannot open `/training-alerts`; there is no command-only query or filter. | **Intended for functionality that does not yet exist.** | Retire the current row. Reserve and clarify a future code such as `view_escalated_training_alerts` only after command visibility is represented and enforced in storage/query policy. |

`manage_users` controls no path in this workflow. `manage_qualifications`, `score_range_days`, `view_command_dashboard`, `manage_range_days`, `manage_firearms`, and `administer_department` appear only in the adjacent foundational tables or the separate notification system as described above; none substitutes for a current Training Alerts page/API authority. No role name is an application shortcut.

## Disposable behavioral matrices

The matrices were exercised in two layers: the real application permission evaluators and a clean disposable PostgreSQL instance with all 58 ordered migrations. The database fixture then added the six production-only catalog rows, created the seven actors, and mirrored production's pilot table RLS metadata. It was destroyed at the end.

### Legacy plus `manage_training`

This applies to `create_remediations`, `manage_remediations`, `resolve_remediations`, and the suspected management mapping for `manage_training_alerts`.

| Actor | DB helper reports legacy | Nav | Direct page | Generated alerts API | Remediation GET | Remediation PUT | Full client load | Direct pilot-table read/update |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Legacy only | Yes | No | No | No | No | No | No | No |
| `manage_training` only | No | Yes | Yes | No | Yes | Yes | No | No |
| Both | Yes | Yes | Yes | No | Yes | Yes | No | No |
| Neither | No | No | No | No | No | No | No | No |
| Administrator | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No |
| Inactive membership with legacy assignment | No | No | No | No | No | No | No | No |
| Legacy assignment in another department | No | No | No | No | No | No | No | No |

The `manage_training`-only failure to complete the client load is current authority drift: the page and remediation endpoints accept it, but the concurrent performance-summary request requires `view_analytics`. This should be resolved before calling the module's read/edit split complete.

### Legacy plus `view_analytics`

This applies to `view_training_alerts` and the closest existing read authority for `view_command_training_alerts`.

| Actor | DB helper reports legacy | Nav | Direct page | Generated alerts API | Remediation GET | Remediation PUT | Full client load | Direct pilot-table read/update |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Legacy only | Yes | No | No | No | No | No | No | No |
| `view_analytics` only | No | Yes | Yes | Yes | Yes | No | Yes | No |
| Both | Yes | Yes | Yes | Yes | Yes | No | Yes | No |
| Neither | No | No | No | No | No | No | No | No |
| Administrator | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No |
| Inactive membership with legacy assignment | No | No | No | No | No | No | No | No |
| Legacy assignment in another department | No | No | No | No | No | No | No | No |

A `view_analytics` viewer can invoke every client alert/remediation button. Alert status changes remain local; remediation changes fail the server `PUT` and are only logged to the browser console. The UI does not present a read-only mode.

## Production assignment aggregates

The following contains no department or user identifiers. “Department rows” is the number of `(department, role, permission)` assignments. “Active holder rows” counts active membership-role rows covered by those assignments, not unique people.

| Permission | Global default roles | Department rows | Department count | Active holder rows |
|---|---|---:|---:|---:|
| `create_remediations` | administrator, instructor, range_master, supervisor | 8 | 2 | 6 |
| `manage_remediations` | administrator, range_master | 4 | 2 | 6 |
| `resolve_remediations` | administrator, chief, command_staff, range_master | 8 | 2 | 9 |
| `view_training_alerts` | administrator, chief, command_staff, instructor, range_master, supervisor | 12 | 2 | 9 |
| `manage_training_alerts` | administrator, chief, command_staff, range_master, supervisor | 10 | 2 | 9 |
| `view_command_training_alerts` | administrator, chief, command_staff, supervisor | 8 | 2 | 9 |

Production overlap also disproves a safe blind translation:

| Legacy permission | Rows already having `manage_training` | Rows already having `view_analytics` |
|---|---:|---:|
| `create_remediations` | 4 / 8 | 6 / 8 |
| `manage_remediations` | 2 / 4 | 4 / 4 |
| `resolve_remediations` | 3 / 8 | 8 / 8 |
| `view_training_alerts` | 5 / 12 | 10 / 12 |
| `manage_training_alerts` | 5 / 10 | 10 / 10 |
| `view_command_training_alerts` | 3 / 8 | 8 / 8 |

Exact Administrator authority is inherited in the application and database, so the absence of a stored broader row for Administrator does not imply loss of authority. For ordinary roles, creating missing broader rows would expand authority beyond the old code's described scope.

## Inactive migration proposal

`supabase/proposals/202609050003_retire_legacy_training_alert_permissions.sql` is deliberately outside `supabase/migrations` and was not applied to any linked environment. If approved later, it:

1. Creates an RLS-protected retirement audit table.
2. Snapshots the six catalog definitions, global role defaults, and department role assignments, including original `granted_by` and `granted_at` metadata.
3. Records the current conceptual replacement where one exists, but inserts no broader permission grant.
4. Removes only the six legacy assignment and catalog rows.
5. Leaves `audit_events`, every broader permission assignment, role, membership, and operational record unchanged.

The clean-bootstrap harness applied the proposal twice after creating a production-shaped fixture. Both applications succeeded, all 30 fixture snapshots remained exactly once, all legacy rows were removed, and the combined `manage_training`/`view_analytics` assignment count was unchanged.

## Regression and validation evidence

- `src/lib/tracepoint/legacy-permissions.test.ts` scans runtime, migration, notification, and generated-type surfaces; exercises the application matrix; proves the client/server persistence split; and checks proposal safety structure.
- `scripts/validate-clean-bootstrap.mjs` exercises the generic database function for legacy-only, broader-only, both, neither, Administrator, inactive, and cross-department actors for every code. It verifies zero legacy RPC/RLS references, direct pilot-table denial, and proposal idempotence/history preservation.
- Current Training Alerts authorities are exported once from `src/lib/tracepoint/permissions.ts` and consumed by navigation, route requirements, the page, and both APIs without changing behavior.

Validation recorded on this branch:

- Focused permission/proxy tests: 20 passed, 0 failed.
- Clean bootstrap: 58 ordered migrations; canonical and six-code matrices passed; inactive proposal passed twice; disposable database removed.
- TypeScript: `tsc --noEmit`; passed.
- Focused lint over the audit tests, canonical permission module, touched page/remediation route, granular regression, and bootstrap validator: passed with 0 findings.
- Full repository lint: inspected; existing debt remains at 441 errors and 52 warnings. The failures include pre-existing `no-explicit-any` and React effect findings in the performance route and navigation shell touched only to consume shared constants.
- Broad test discovery: 152 passed. The two known repository-core files using constructor parameter properties fail before assertions under Node's strip-only TypeScript runner; the audit tests do not fail.
- Production build: Next.js 16.2.6, 79 static-generation steps across the listed app routes/assets; passed with the existing root-environment values injected without copying them into the worktree.

## Safe rollout recommendation

Do not apply the proposal until an owner accepts the two current module defects: `manage_training` cannot load the complete client by itself, and `view_analytics` receives mutation controls it cannot persist. Once the intended read/edit model is decided, re-run the production aggregate and require a human review of any ordinary-role assignment that would gain a broader permission. The default retirement path should archive and remove the dead rows with no automatic grants.
