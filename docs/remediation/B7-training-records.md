# Remediation batch B7: training records

Base: `claude/integration-defects-20261020` (includes DC and TV). Evidence: `docs/operational-audit-20261020/reconciliation-20261020/R4-training-notifications.md`, `appendix-c-training-notifications.md` and `evidence/trn02*`. Plan: `plan-b7-b11.md`, section B7. Migration `050` (047 is reserved by another branch).

Scope: defects only.
- TRN-05 (due-soon email default) is **not changed**: the owner decided to keep it disabled.
- Notification routing is not changed.
- TV's visibility rules are not widened. No read in this batch returns more rows than before. The new reads are the department's own `timezone` and the course or certification type being validated.

## Defects addressed

| ID | Defect | Change |
|---|---|---|
| TRN-02 (High) | The editor sent `datetime-local` text with no zone, and the server parsed it in its own zone (UTC). The editor redisplayed in the browser zone, so each save shifted the time by the UTC offset. Closeout also took the issue date from `starts_at::date` in the database zone, and the certificate PDF formatted the date in UTC. | Event times are department wall-clock times, using the existing `departments.timezone` (not null, default `America/New_York`, the same default used by agency creation and Settings). There is one shared helper, `src/lib/agency-training/event-time.ts`. **Server (POST/PATCH):** offset-less values are interpreted in the department zone. Values that carry `Z` or an offset are still instants (unchanged for API clients). Unparseable values are rejected. **Display:** the events GET returns `timeZone`. The editor fills and re-sends wall time in that zone; its labels show the zone. The list and detail format in that zone with a zone abbreviation. The certificate PDF date also uses the department zone. **Closeout (`050`):** the issue date is the start date in the department zone. |
| TRN-03 (High) | Closeout issues certifications only when the event has `certification_type_id`. The editor never sent it, and PATCH could not set it. | **Editor:** choosing a library course copies the course's `certificationTypeId` and `certificationValidDays`. A "Certification issued at closeout" select (types from the existing `/api/training/certification-types`) lets the coordinator keep, change or clear it, and editing an event keeps its value. A new library course also stores the selected type. **PATCH:** accepts `certificationTypeId` (an active type of the same department) and `certificationValidDays`. The existing closeout issuance is unchanged. |
| TRN-04 (High) | Choosing any outcome silently set attendance to Present. | The board no longer changes attendance. **Roster PUT:** rejects Completed or Passed unless attendance is Present (400, "An attendee can be marked Completed or Passed only when attendance is Present."). **Closeout RPC (`050`):** refuses the same combination, so rows written any other way cannot issue credentials. Failed, Incomplete and Remedial with No Show or Excused remain allowed. |
| TRN-11 | A roster that contained a since-deactivated officer could not be saved, and removing the officer hard-deleted their attendance. | Only **newly added** user IDs must be active members; existing attendees are kept whatever their status. Removing a row whose attendance or outcome is recorded (not Assigned/Pending) is refused with 409, and the row stays. Unrecorded rows can still be removed. |
| TRN-12 | Every save rewrote `recorded_by`, `recorded_at`, `created_by` and `updated_*` on every row (an upsert of all rows), and the audit trigger logged each one. | The server diffs against the stored rows. Unchanged rows are not written. Changed rows get `updated_*`, and they get `recorded_*` only when attendance or outcome changed. `created_by` is set only on insert. New rows get `recorded_*` only if they are entered with a non-default attendance or outcome. |
| TRN-18 | Complete Event posted closeout even with unsaved roster edits. | The roster board tracks unsaved edits and passes `hasUnsavedChanges` to the closeout panel. Complete Event then shows the prompt "The roster has unsaved changes. Save All before completing this event." and does not post. **Server:** verified that the closeout RPC reads only the saved `agency_training_attendees` rows; the route posts no roster. |
| TRN-27 | Reopen deactivated the credentials closeout issued but not the earlier credentials that closeout had superseded. Officers were left with no active credential. | **`050`** adds `training_certifications.superseded_by_training_event_id`. Closeout supersedes only **active** prior credentials and records the event on them. Reopen deactivates the event's own credentials (as before) and reactivates exactly the inactive ones that event superseded. Re-closing supersedes them again. |
| TRN-29 | The certification API stored any date text (garbage became a raw 500), accepted expiration before issue (a raw DB error), and accepted any `documentUrl`. PATCH could move a credential to another officer, including closeout-issued ones. | Dates must be real `YYYY-MM-DD` dates (400 otherwise). Expiration before issue gets a clear 400. `documentUrl` must be http(s). **PATCH:** the officer cannot change (400; the web form disables the officer field when editing). A closeout-issued credential keeps its certification type and issue date (400: "Reopen the training event to correct them"). |
| TRN-30 | The event and requirement APIs accepted invalid state. | **Events:** POST refuses status `completed` (only closeout sets it). POST and PATCH validate `courseId` against the department. PATCH refuses a blank title, an invalid or `completed` status (it was silently ignored), an empty or invalid start, an invalid end, and an end before the start (checked against the stored value when only one side is sent). **Courses:** POST validates `certificationTypeId`. **Roster:** an invalid status returns 400 (it threw outside any `try`, giving a 500). **Requirements:** scope, due basis and interval unit must be valid values. A completion-based requirement needs an interval. A fixed annual date needs a valid month and day. The course must belong to the department, and `selectedMemberIds` must be department members. A unit sent with an empty interval is ignored (the form always sent "months", which the DB constraint rejected). |

### Migration `database/aws/050_training_closeout_records.sql`

The migration is idempotent and wrapped in `begin`/`commit`.

1. `add column if not exists superseded_by_training_event_id` (FK to the event, `on delete set null`), plus a partial index.
2. `create or replace` of `close_agency_training_event_internal` and `reopen_agency_training_event_internal`. These are the bodies `008` wraps. The authorization wrappers from `008` are unchanged. The bodies are the original ones with only the changes listed above. `create or replace` keeps owner and grants, and the `revoke`s are re-stated.
3. The department zone is validated against `pg_timezone_names`. If it is invalid, it falls back to `America/New_York`.

### How existing rows are interpreted (no data migration)

- `starts_at`/`ends_at` stay the stored instants and are now shown in the department zone.
  - Events created **before** this fix from a browser outside UTC were stored with the typed wall time read as UTC: 18:00 Pacific was stored as 18:00Z.
  - They now display at that instant in the department zone (11:00 Pacific). That is what Pacific browsers already showed, so nothing moves. But such events may have been saved at the wrong time, and they cannot be told apart automatically.
  - **Coordinators should check upcoming events once after deployment** (staging query below).
- Credentials issued earlier keep their `issue_date`. A **re-closeout** of an older event recomputes it in the department zone, so an evening event's credential may move one day earlier, to the correct local date.
- Credentials superseded before `050` carry no record. Reopening an event closed before `050` restores nothing, which is the previous behaviour. Every closeout after `050` is restorable.

## Verification (local, synthetic; no remote systems)

PostgreSQL 16 ran on 127.0.0.1:55651 as a non-root user. The full schema is 79 Supabase migrations plus `database/aws` 001–046, 048, 049 and 050: 128/128 files applied, and `050` applied twice more (idempotent).

### Handler tests

`src/lib/agency-training/training-records-routes.test.ts`, 8 tests. They run the real route handlers against an in-memory client in the repo style, with the server process in UTC like the container.

| Test | Before (route/UI code reverted) | After |
|---|---|---|
| TRN-02 round trip in 6 zones plus UTC: LA; NY on the repeated fall-back hour and on the spring-forward day; Chicago the night before the change; Kolkata (+05:30); Honolulu across the year end. Create, then 3 saves of the redisplayed value. Also a time skipped by DST, and an ISO value with `Z` | **Fail**: LA create stored `2026-10-24T18:00:00.000Z`, expected `2026-10-25T01:00:00.000Z` | Pass: stable on every save |
| TRN-03 editor sends the course's type; POST and PATCH store it; a foreign type is refused | **Fail** | Pass |
| TRN-04 No Show / Excused / Assigned + Completed refused; No Show + Incomplete saved as entered; the board no longer forces Present | **Fail**: no_show + completed returned 200 | Pass |
| TRN-11 roster with an inactive attendee saves; a new non-member is refused; a recorded row cannot be removed; an unrecorded row can | **Fail**: 400 "not active department members" | Pass |
| TRN-12 an unchanged row is byte-identical after save; a changed status gets new `recorded_*` and keeps `created_by`; a notes-only change keeps `recorded_*` | **Fail**: unchanged row rewritten | Pass |
| TRN-18 the board passes its dirty state, and closeout checks it before the POST | **Fail** | Pass |
| TRN-30 invalid event, roster and requirement inputs refused; valid fixed-date and interval requirements accepted | **Fail**: POST `completed` returned 201 | Pass |
| TRN-29 invalid and impossible dates, expiration before issue, `javascript:` URL, officer change, closeout-issued type/date edit | **Fail**: 201 for `2026-02-30` | Pass |

### Real-PostgreSQL tests

**`scripts/validate-local-training-closeout.sql`** runs in the validator AWS stage. It runs closeout and reopen through the AWS wrappers as `tracepoint_runtime` → `authenticated`, as a `manage_training` subject, in a Pacific department. A second tenant is present.

| Check | Without `050` | With `050` |
|---|---|---|
| No Show + Completed blocks closeout | **Fail**: "closeout accepted a no-show marked Completed" | Pass |
| Issue date of an 18:00 Pacific event | **Fail**: `2026-10-25` (UTC date) | Pass: `2026-10-24` |
| Supersession recorded; an already-inactive credential and another type are untouched; the other tenant is untouched | **Fail**: no record (column absent) | Pass |
| Reopen: officer's CPR credentials (prior, issued) | **Fail**: both inactive, so no active CPR | Pass: prior active again, issued inactive; the older inactive one stays inactive |
| Re-closeout supersedes again | — | Pass |

**`src/lib/agency-training/training-closeout-native.test.ts`** is embedded-postgres in the repo style, with 2 tests:
- It runs the SQL above.
- At 5 department zones (including evening events and the UK spring-forward night), the closeout issue date equals the editor's wall-clock date from `event-time.ts`.

This sandbox cannot start embedded PostgreSQL as root, so in `run-application-tests` this file "ran no tests". It was run against the local server with the B9/F1 shim (scratch `b7native/native.test.ts`): **without `050`, 0/2 pass; with `050`, 2/2 pass.**

### Required checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 678 tests, 674 pass. The 4 failures are the sandbox `xlsx` stub (import parsing and inference). 18 embedded-postgres files ran no tests (the integration set plus the new `training-closeout-native.test.ts`) |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 348/349. The failure is the SheetJS round trip (`xlsx` stub) |
| `eslint` on changed files | New files are clean. The roster route went from 13 to 11 `no-explicit-any`. The other files keep their existing findings, identical before and after: page, closeout panel and board `set-state-in-effect`; editor `rules-of-hooks` on the existing `useCourse` helper; board unescaped `'`; certificate route 2, certifications routes 1 each |
| Clean apply (`bootstrap.mjs --aws`) | 128/128; `050` applied twice |
| Validator shim (`validate-clean-bootstrap.mjs` against 127.0.0.1:55651, cluster reset first) | "Clean bootstrap passed: 79 ordered migrations and 49 AWS-native migrations; permission and retirement matrices passed" (includes the new closeout SQL) |

## Contract notes (native client and API callers)

- The agency-training, roster and certification routes are web routes, not mounted under `/api/mobile`.
- `GET /api/agency-training/events` gains `timeZone`.
- **Behaviour change for API callers:** offset-less `startsAt`/`endsAt` are now department wall time, not server (UTC) time. ISO values with `Z` or an offset are unchanged. Date-only or other non-ISO strings are now rejected.
- New 400/409 responses as listed above. `POST` with `status: "completed"` is refused.
- `training_certifications` rows gain `superseded_by_training_event_id` wherever `select *` is returned (additive).
- **Bridge (Supabase) mode** keeps the original closeout functions. The API rules (TRN-04, TRN-11, TRN-12, TRN-29, TRN-30, TRN-02 entry and display) apply in both modes. The RPC attendance check, the zone-correct issue date and reopen restoration (TRN-27) apply on AWS-native, where `050` runs.

## Staging (reconciliation README §8)

1. `scripts/migrate-db.ps1 staging -Action status`: expect `050` pending (and `047` if its branch has not landed). Then `apply`, then deploy the image. Apply `050` before or with the image. The image alone works, but reopen will not restore credentials.
2. **Before deploying**, list upcoming events for coordinator review (TRN-02 drift from earlier saves):
   `select d.name, d.timezone, e.title, e.starts_at, e.starts_at at time zone d.timezone as local_start from agency_training_events e join departments d on d.id = e.department_id where e.starts_at > now() and e.status in ('draft','scheduled','in_progress') order by 1, 4;`
3. Add staging step **S19-B7** in an `acceptance-<UUID>` tenant whose timezone is not the tester's browser zone:
   1. Create an event at 18:00 local. It shows 18:00 with the zone abbreviation. Edit only the title three times; the time stays 18:00. In the DB, `starts_at` is 18:00 in the department zone.
   2. Pick a library course linked to a certification type. The type is preselected. Mark one officer Present + Passed. Mark a second No Show, try Completed (refused), then Incomplete; attendance stays No Show.
   3. Edit a score without saving, then click Complete Event. You are prompted and nothing posts. Save All, then Complete Event. The Passed officer gets a CPR credential dated the local event date, and their earlier CPR credential becomes inactive.
   4. Reopen with a reason. The issued credential becomes inactive, and the earlier one is active again. Close again.
   5. Deactivate a rostered officer, then save the roster. It saves. Removing them is refused (409), and their row remains.
   6. Certifications page: editing a closeout-issued credential's issue date is refused. The officer field is locked when editing. `2026-02-30` is refused.

Production needs separate authorization.

## Residual and owner items

- **Not changed (needs owner direction or a feature):**
  - A required reason on certification deactivation (TRN-29). This needs a column and a UI.
  - Soft delete of requirements (TRN-30g). Requirements are configuration, the unique name index would block re-creation, and there is no inactive filter in the panel.
  - Superseding only when the new expiration is later (TRN-27 note). This changes issuance rules.
  - TRN-28 separation of duties.
  - The dead quick-create modal on the Agency Training page (TRN-38). It is unreachable. It still builds browser-local times, which the server now reads as department time.
- When the event's officer is inactive, the certifications PATCH still requires an active member. That is unchanged existing behaviour. Since the officer can no longer change, the owner may want that check relaxed later.
- A stored `document_url` that is not http(s) must be corrected (or cleared) the next time that credential is edited.
- After a 409 on removing a recorded attendee, the board keeps the row removed locally until Refresh. The server keeps the record.

## Rollback

- Application: revert the commit; there is no data migration.
- Schema: `050` is additive. To restore the previous functions exactly, write a new forward migration that re-creates `close_agency_training_event_internal` / `reopen_agency_training_event_internal` from `supabase/migrations/20260828040000_agency_training_closeout.sql` (renamed to `_internal`, with the same `revoke`s as `008`). The column can stay. Do not edit `050`.
