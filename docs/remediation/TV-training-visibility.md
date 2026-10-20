# Remediation TV: training, range and qualification record visibility (TRN-26, RNG-28)

Base: `claude/integration-defects-20261020` (`97a4710`). Migration `048` (047 is reserved by another branch; the runner needs only increasing numbers).

Owner decision applied: "Officers may access their own training records. Supervisors, instructors, and administrators may access other records only within their authorized responsibilities. Enforce restrictions at the API/database level."

The product has no supervisor-to-team/unit scoping, and this batch does not build one. "Authorized responsibilities" is read from the existing permission catalog (`src/lib/tracepoint/permissions.ts`).

## Defects

| ID | Defect | Fix |
|---|---|---|
| TRN-26 (High) | Any department member could read every officer's certifications, agency-training outcomes (scores, result and remedial notes), certificates and qualification results. The SELECT policies were `is_department_member(department_id)`, carried into AWS-native unchanged by `004`; R7 T8 reproduced it. The roster GET, the files GET (certificate list) and the certifications GET returned department-wide rows with only a session check. | `database/aws/048_training_record_visibility.sql` replaces the member-wide SELECT policies with own-row OR permission policies. The routes filter to the caller's own rows unless the caller holds the mapped permission (`src/lib/tracepoint/training-record-visibility.ts`). |
| RNG-28 (Medium) | Every member could read all range results. The web `GET /api/pilot/range-workspace` (feature check only) returned the whole department document: all results, roster notes, malfunctions and result revisions. `GET /api/qualifications` had no permission check. Qualification evidence listing had a feature check only. The normalized range tables kept `select_member` RLS. | Without a range-record permission, the workspace GET returns planning data plus only the caller's own roster entries, results, malfunctions and result revisions; every other key is withheld. It adds `recordScope: "own" \| "department"`. `/api/qualifications` returns own rows. The evidence GET requires the result's officer or an evidence permission. `048` scopes `qualification_results`, `drill_run_results`, `range_day_roster`, `remedial_training_recommendations`, `range_packets` and qualification `attachments`. The mobile range routes already required range permissions (unchanged; now tested). |
| Found while fixing | The attachment download route matched the result's officer by `officerUserId`/`officer_user_id`. Workspace results store `officerId`, so an officer could never download evidence for their own result unless they had uploaded it. | Also accepts `officerId` (one expression). |

## Permission mapping (please confirm)

`administer_department` (and platform Support Mode, which resolves to it) covers everything. Everyone else, including holders of any permission not listed, sees **own records only**.

| Record | Department-wide in the API (detail views) | Department-wide in the database (048) | Why the database set is wider |
|---|---|---|---|
| Certifications (`training_certifications`): `/api/training/certifications` | `manage_certifications` | `manage_certifications`, `view_command_dashboard`, `view_analytics` | `/api/readiness/certifications` (Command Dashboard) is already gated to these three, and certification-readiness alerts are department-wide for them |
| Agency training attendance, outcomes, scores, remedial notes (`agency_training_attendees`): roster GET, event CSV | `manage_training` | `manage_training`, `view_command_dashboard` | Command Dashboard operations count attendees per event; training-requirement staff alerts |
| Event attendance counts (events list) | `manage_training`, `view_command_dashboard` | same | Summary only |
| Training-requirement members (`agency_training_requirement_members`) | not returned by any GET | `manage_training`, `view_command_dashboard` | Staff alerts |
| Agency training certificates (`agency_training_certificates`): files GET list, PDF download | `manage_training` | `manage_training` | — |
| Range and qualification results, roster, malfunctions, remedial (`pilot_range_workspaces` JSON, `qualification_results`, `drill_run_results`, `range_day_roster`, `remedial_training_recommendations`): range workspace GET, `/api/qualifications` | `manage_range_days`, `score_range_days`, `manage_qualifications`, `manage_training`, `view_analytics`, `view_command_dashboard` | same | `manage_training`/`view_analytics`: performance summary and Training Alerts (already gated to them), and the "Range Training Records" and "Qualification History" reports. `view_command_dashboard`: the Command Dashboard computes qualification readiness from the workspace, and the "Range Days" report. |
| Range packets (`range_packets`, every officer's sheets; not read by the app today) | — | the range set above (no own-row access) | — |
| Qualification evidence (`attachments` with `entity_type='qualification'`): evidence list, download | result's officer, uploader (download), `manage_qualifications`, `manage_range_days`, `score_range_days`, `view_analytics` | same, plus the result's officer resolved from the workspace JSON | Matches the existing download rule; other attachment kinds keep the member read |

Decisions taken that the owner should confirm:

- **Command oversight sees summaries, not detail views.** `view_command_dashboard` and `view_analytics` keep every dashboard and analytics page working. They still get the full range workspace, because the Command Dashboard and the reports compute per-officer readiness from it. They do **not** get the certifications list, the agency-training roster scores, or certificates. At the database level they can read the underlying rows that those summaries need.
- **Instructors assigned to an agency-training event** (listed in `agency_training_event_instructors`) but without `manage_training` now see only their own roster row. They could already not record outcomes (that needs `manage_training`). Granting assigned instructors their events' rosters would be a per-event scope; it was not built here.
- Range scoring was not narrowed to the range days an instructor works: `score_range_days` sees the department's range records, as the catalog defines.

## Behavior changes by role

| Page / feature | Who | Before | After |
|---|---|---|---|
| Certifications page | members without `manage_certifications` (including command and analytics) | every officer's credentials | their own credentials. Command and analytics keep the readiness summary on the Command Dashboard |
| Agency Training: roster, closeout panel certificate list | members without `manage_training` | every attendee's attendance, outcome, score and notes; all certificates | their own row and certificate |
| Agency Training: event list counts ("N assigned", completed/assigned) | members without `manage_training`/`view_command_dashboard` | department counts | counts of their own enrolment (0 or 1) |
| Range Days page, Qualifications page | members without a range-record permission | every officer's results, roster entries, malfunctions and notes | planning data plus their own rows. The Qualifications page lists only the caller instead of every officer (others would otherwise appear as "No Record") |
| Qualification target evidence | members without an evidence permission | evidence for any result | evidence for their own results (download now also works for them) |
| Notifications: certification readiness, department scope | `manage_qualifications`-only or `manage_equipment`-only holders | department-wide certification alerts | their own (equipment and qualification department alerts unchanged) |
| Notifications: agency-training requirement staff alerts | `manage_certifications`-only holders | other officers' missing/overdue training | their own |

No change for range managers, scorers, qualification managers (Range Days, live scoring and mobile), training coordinators (rosters, closeout, CSV, certificates), certification managers, Command Dashboard, Analytics, Training Alerts, performance summary, reports, or department administrators.

## Residual (documented, not changed)

- `pilot_range_workspaces` stays member-readable at the database level. It is one JSON document per department, so RLS cannot remove rows from inside it. The API filter enforces the rule, and only the application holds database credentials. Off-duty review (`review_off_duty_requests`) and the evidence and drill-document lookups read the document server-side, and keep working.
- In bridge (Supabase service-role) mode, only the API filters apply. Both the API and the database apply on AWS-native.
- RNG-28's other notes (drill-library documents and drill-document routes have no feature check) concern training material, not officer records. They are unchanged.

## Verification (local, synthetic; no remote systems)

PostgreSQL 16 on 127.0.0.1:55643 as a non-root user. The full schema is 79 Supabase migrations plus `database/aws` 001–046 and 048. `048` was applied twice to show it is idempotent. Sessions use `tracepoint_runtime` → `authenticated` with a subject and agency set per transaction.

| Check | Before | After |
|---|---|---|
| New `scripts/validate-local-training-record-visibility.sql` (validator AWS stage). It covers 10 tables × 12 subjects: two officers, one subject per permission, an administrator, an inactive officer, and agency B's view_analytics officer and administrator. It also checks own-row content, cross-tenant evidence with a colliding result id, and that permitted writers still see their inserts and updates | Without 048: fails, "Training record visibility for officer 1 is {3,2,2,2,2,2,2,2,1,3}, expected {1,1,1,1,1,1,1,1,0,2}" (reproduces R7 T8) | Passes |
| `db:validate-bootstrap` through the local shim | — | Passes: "79 ordered migrations and 47 AWS-native migrations" |
| New `src/lib/tracepoint/training-record-visibility-routes.test.ts`: 7 tests on the real route handlers with an in-memory client (range workspace GET for an officer and for 7 staff permissions; filtered GET → PUT round trip; mobile live scoring; `/api/qualifications`; evidence GET; certifications and readiness; roster, certificates and event counts) | Route code reverted: 5/7 fail. The round-trip and mobile tests pass before as well: the authorizer already refused a non-scorer's PUT, and these tests guard that | 7/7 pass |
| New `src/lib/tracepoint/training-record-visibility.test.ts`: 8 tests (mapping table, `ownRows`, workspace filter including revisions and unknown keys, round trip against the real `authorizeRangeWorkspaceMutation` including "every permission that may save receives the document unfiltered", event counts, evidence lookup, and route/summary-gate source guards) | Route and repository code reverted: 3/8 fail | 8/8 pass |
| `npx tsc --noEmit` | — | 0 errors |
| `node scripts/run-application-tests.mjs` | — | 651 tests, 647 pass. The 4 failures are the `xlsx`-stub importer tests (environment). 16 embedded-PostgreSQL files ran no tests (cannot start as root): the same set as on the integration branch |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | — | 348/349. The failure is the SheetJS round trip (environment) |
| `eslint` on changed files | — | New files clean; changed files have the same error counts as before (existing `no-explicit-any` in `notifications/route.ts` 48, roster 13, `agency-training-notifications.ts` 7, files 3, evidence core 2, and 1 each in three others) |

## Staging

- Runtime change: the routes listed above, plus the Qualifications page. Schema change: `048` (new; `begin`/`commit`; `drop policy if exists`/`create policy`; idempotent).
- `scripts/migrate-db.ps1 staging -Action status` (expect 048 pending after 046, with 047 possibly pending from its own branch), then `apply`, then deploy the image.
- Reconciliation README §8, with `acceptance-<UUID>` tenants only:
  1. **S9:** as a plain officer, call `GET /api/training/certifications`, `/api/qualifications`, `/api/pilot/range-workspace` and `/api/agency-training/events/<id>/roster`. Each returns only the officer's own rows (`recordScope: "own"` on the workspace). The evidence GET for another officer's result returns 403.
  2. As the same officer, `PUT /api/pilot/range-workspace` with the filtered document: 403, and a scorer's subsequent GET still shows every result.
  3. As a scorer, range manager and training coordinator: Range Days scoring (**S5**), the roster board and closeout behave as before.
  4. As a `view_command_dashboard` user: the Command Dashboard loads with department readiness and training counts. As `view_analytics`: Analytics and Training Alerts load.
  5. **S10** tenant-negative suite: still all-deny.
- Production needs separate authorization.

## Rollback

- Application: revert the commit.
- Schema: the ledger is hash-checked, so roll back with a **new** forward migration that restores the member-wide reads:

  ```sql
  drop policy if exists training_certifications_select_own_or_authorized on public.training_certifications;
  create policy "department members can view training certifications" on public.training_certifications for select using (public.is_department_member(department_id));
  -- likewise for agency_training_attendees / _requirement_members / _certificates
  -- ("department members can view agency training attendees|requirement members|certificates"),
  -- and qualification_results, drill_run_results, range_day_roster,
  -- remedial_training_recommendations, range_packets (<table>_select_member, to authenticated,
  -- using (public.is_department_member(department_id))); attachments_select:
  -- to authenticated using (public.is_department_member(department_id)).
  ```
