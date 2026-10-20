# Remediation batch B10: qualification computation and range roles

Base: `claude/integration-defects-20261020` (`7f7f85f`; includes B3, DC and TV). Evidence: `docs/operational-audit-20261020/reconciliation-20261020/R3-range.md` (RNG-07, 09, 10, 12, 14, 15, 24). Plan: `plan-b7-b11.md`, section B10. Migration number `051`.

Scope: defects only. Nothing new is configurable. **This batch changes some officers' qualification status**, so it must be announced. Before merging, run the before/after report on staging (see "Announcement" below).

## Defects addressed

| ID | Defect | Change |
|---|---|---|
| RNG-07 (High) | The default Instructor role (`score_range_days`) could not mark attendance, add walk-ups or upload target evidence, so it could not run a line. The page gated these on `manage_range_days`. The authorizer and the database trigger refused any `rangeRoster` change by a scorer. The evidence route required `manage_qualifications` or `manage_range_days`. | **Page:** `canTakeSelectedRangeDayAttendance` (manage or score, day not final) gates the roster tab and **Mark Present**. Walk-ups (`canManageOpenAttendance`) need score permission and a non-final open-attendance day; manage permission is no longer also required. Add Officer, firearm selection and Remove stay manager-only and are disabled for scorers. **Authorizer** (`workspace-mutation.ts`, used by the web and mobile PUT): for a non-manager, `rangeRoster` may change only as follows. Every stored entry is kept, and only `attended`/`attendanceTime` change. A new entry needs an id, an officer, `attended: true`, and an **Open / Rolling Attendance** day, and must not duplicate an officer already on that day. `rangeDays`, `drillLibrary` and `rangeDayDrills` stay manager-only, unchanged. **DB (`051`):** the same rule is in `range_workspace_scorer_roster_change_allowed`, used by `protect_pilot_range_workspace_mutation`. **Evidence:** see RNG-12. |
| RNG-09 (High) | A qualification drill with firearm type "Any" (the form default) never counted toward handgun currency. Readiness compared "any" with "handgun" and excluded it. The page also never matched an "Any" drill to the agency's handgun standard, so its results had no standard snapshot. | **Rule** (`qualification-readiness.ts`): an attempt on an "Any" drill counts toward (1) the class of the firearm recorded on the result (`firearmTypeSnapshot`), else (2) the firearm class of the agency standard it was scored against (from its standard snapshot), else (3) the class being evaluated. Drills with a specific type are unchanged. **Page:** an "Any" drill is matched to the agency standard for the class of the firearm used (`standardFirearmType`). The pass, the standard snapshot and the preview use that standard. Each saved result now records `firearmTypeSnapshot` from the Armory record of the firearm used. |
| RNG-10 (High) | A same-day remedial re-shoot could not clear "Failed": failures and passes were compared by date only, and a failure won ties. | Since B3, re-saving the same drill, run and officer corrects the result in place, so the failed result is replaced. That path already clears. A re-shoot on a different drill or range day on the same date is a new result, appended to `workspace.results`. The array keeps save order: B3 corrections keep their position, and TV's own-record filter keeps the order. Workspace attempts therefore carry `sequence` (their index), and same-date events are ordered by it. Results carry no timestamp. `resultRevisions.revisedAt` exists only for corrections. A failure from one source (workspace or `qualification_results`) tied on date with a pass from the other still counts as the newer one, as before (conservative). |
| RNG-12 (High) | Target-photo evidence failed for imported results and for instructors. The route looked up the result only in `pilot_range_workspaces.results`, so imported `qualification_results` ids (used by the Qualifications page) returned 404, and it refused `score_range_days`. | **Key:** evidence stays keyed to the result id, which B3 keeps stable across corrections (verified: the web reuses `existingResult.id`, and B3 tests 1e and 1f). The id lookup (`TenantBoundEvidenceReadRepository.qualificationResult`) falls back to `qualification_results` (uuid ids only, scoped to the agency). The evidence GET, POST and attachment download share it. **Permission:** POST accepts `score_range_days`. **DB (`051`):** additive policies let `score_range_days` insert qualification attachments and their `qualification_evidence_uploaded` audit row. Before this, an instructor upload would also have failed RLS on AWS-native. `attachments_select` (048) also lets the officer of an imported result read its evidence. |
| RNG-14 (Medium) | There was no score range or type validation. | The authorizer (both PUT routes) refuses a **new or changed** result with **400** and a message such as "Score 61 for Handgun Qualification is above the maximum of 60." The rules: `score` must be a number (or numeric string) ≥ 0 and ≤ the run's component `maximumScore`, else the drill's `maxScore`, when configured. `timeSeconds` must be a number > 0. `hitCount` must be a whole number ≥ 0. Stored results that do not change are not re-judged, so legacy data never blocks a save. |
| RNG-15 (Medium) | The Complete/Incomplete toggle was ignored except for Completion drills: other formats were always saved `completed: true`. | `resolveRunCompletion`: the toggle is saved for every format. Completion drills still default to incomplete, others to complete. An incomplete run never passes (`passed`/`finalPassed`/`departmentStandardPassed` are false). Readiness already ignores incomplete attempts (`excluded.incomplete`), so an incomplete run is neither a pass nor a failure there. |
| RNG-24 (Medium) | Qualification status counted results from range days that were not closed. | Only results on days whose status is **Completed, Locked or Archived** count. These are the final statuses that lock history in B3's authorizer and trigger. Planned and In Progress days, and days with no status, are ignored for passes **and** failures. |

### Migration `database/aws/051_range_instructor_line_actions.sql`

It is idempotent (applied three times locally), has `begin;`/`commit;`, and uses `create or replace` and `drop policy if exists`/`create policy` only.

- `range_workspace_scorer_roster_change_allowed(old, new)`: the RNG-07 roster rule.
- `protect_pilot_range_workspace_mutation()`: the body is identical to `042`, except that the `rangeRoster` clause also accepts that rule. The trigger stays attached.
- `attachments_insert_qualification_evidence` and `audit_events_insert_qualification_evidence`: additive insert policies for `score_range_days`, limited to qualification evidence and its audit action. The existing policies are unchanged.
- `attachments_select`: the 048 body, plus own-officer read for imported `qualification_results`.

## Tests added

| Test | What it proves |
|---|---|
| `src/lib/tracepoint/qualification-readiness.test.ts` (3 new) | RNG-09: "Any" counts through the standard snapshot or the recorded firearm class, and a rifle used on an "Any" drill does not count for handgun. RNG-10: fail→pass on the same day is Current, pass→fail is Failed, and a cross-source tie stays conservative. RNG-24: Planned/In Progress days count for nothing; Completed/Locked/Archived count. The existing fixture now gives its range days `status: "Completed"`. |
| `src/lib/range/workspace-mutation.test.ts` (2 new) | RNG-07: an instructor marks attendance and adds a walk-up. Refused (403): a walk-up on a scheduled day, an absent walk-up, a duplicate, an id-less entry, removal, firearm, officer, range-day, drill and library changes. Managers are unaffected, and final days still return 409. RNG-14: the valid and invalid value matrix with messages, legacy values not re-judged, and a correction judged. |
| `src/lib/range/instructor-line-routes.test.ts` (new, 4) | The real route handlers on an in-memory client. Web **and** mobile PUT: instructor attendance and walk-up return 200; planning and removal return 403; an impossible score returns 400 with the message and nothing is written. Evidence POST by an instructor on a workspace result and on an imported result returns 201, keyed to the id. Other cases: officer 403, missing id 404, another agency's uuid 404. The imported result's officer can list and download its evidence; another officer gets 403. |
| `src/lib/range/scoring-rules.test.ts` (new, 4) | `resolveRunCompletion` for every format (RNG-15); `standardFirearmType` (RNG-09). Source contracts check that the page's save uses both, records `firearmTypeSnapshot` and resolves every standard call with the firearm used, and that the RNG-07 gates are as described. |
| `scripts/validate-local-range-instructor-line.sql` (validator AWS stage) | On AWS-native RLS and the trigger, the 11 workspace writes and the evidence cases listed under "Database" below. |

## Verification (local, synthetic; no remote systems)

### Repo tests: fail before, pass after

The test files ran against the pre-fix source: the changed non-test files were reverted with a saved patch, and `scoring-rules.ts` was removed.

| Test | Before | After |
|---|---|---|
| readiness RNG-09, RNG-10, RNG-24 | **3 fail** (8 existing pass) | 11/11 pass |
| authorizer RNG-07, RNG-14 | **2 fail** (16 existing pass) | 18/18 pass |
| route tests (4) | **4 fail** | 4/4 pass |
| scoring-rules (4) | **fail** (helpers absent; the page forced `completed: true` and matched "Any" to no standard) | 4/4 pass |

### Database (PostgreSQL 16, user ubuntu, 127.0.0.1:55652)

Before = Supabase lineage + `database/aws` 001–049 (127 migrations); after = + `051` (128). Each case runs as `tracepoint_runtime` → `authenticated` with the subject and agency set. The validation script stops at its first failure. Before 051, that was the first case. The other roster cases in the "Before" column follow from the same 042 clause, which refuses every scorer roster change. The evidence rows were run separately against the before database.

| Case | Before 051 | After 051 |
|---|---|---|
| Instructor marks attendance | ERROR 42501 "planning changes require range management permission" | **updated** |
| Instructor adds a present walk-up on an open day | 42501 | **updated** |
| Instructor walk-up on a scheduled day / absent walk-up / same officer twice / removal / firearm change / range-day change | 42501 | 42501 |
| Instructor attendance on a Completed day | 42501 | 23514 (final) |
| Officer edits attendance | refused (by the 042 trigger body) | refused (42501, or the update policy filters the row) |
| Range master removes a roster entry | updated | updated |
| Instructor inserts qualification evidence and its audit row | ERROR: new row violates RLS (attachments) | **inserted** |
| Instructor inserts a firearm attachment | refused | refused (42501) |
| Officer reads evidence on own imported result / other officer | 0 / 0 | **1** / 0 |

- `db:validate-bootstrap` through the local shim **passes**: "79 ordered migrations and 49 AWS-native migrations", including the new range-instructor-line stage.

### Required checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 682 tests, 678 pass. The 4 failures are the `xlsx`-stub importer tests (`ai-importer/workbook.test.ts`). 17 embedded-PostgreSQL files ran no tests (root sandbox): the TV set plus B9's `separated-custody-native.test.ts`. |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 349 tests, 348 pass. The failure is the SheetJS XLSX round trip (environment). |
| `npx eslint` on changed files | No new findings. New files are clean. `range-days/page.tsx` has 5 errors and 13 warnings, identical to the base; `evidence/read-repository-core.ts` has 2 errors, identical to the base. The evidence route went from 1 error to 0. |

## Announcement: before/after qualification status

**Method:** `scripts/qualification-status-snapshot.sql` (read-only, one JSON document) and `scripts/qualification-status-diff.mjs`.

- The script evaluates every active member with the readiness module **at a git ref** ("before") and **in this checkout** ("after").
- Both are evaluated the way the performance summary and Command Dashboard do it: the agency's standards, rules and required components, the range workspace, and `qualification_results`.
- It prints, per agency, the status counts before and after and every officer whose status changes, with the new reason.
- It flags results on days that are not closed (RNG-24) and on "Any" drills (RNG-09).
- RNG-15 cannot change stored data. RNG-10 changes appear without a flag.

```sh
# in the authorised environment, from a checkout of this branch:
psql "$DATABASE_URL" -X -At -v department_id= -f scripts/qualification-status-snapshot.sql > snapshot.json   # department_id=<uuid> for one agency
node --import tsx scripts/qualification-status-diff.mjs snapshot.json --before 7f7f85f   # add --json for machine output
rm snapshot.json   # it holds names and scores
```

**Synthetic run** (local database, one agency, eight officers, one per scenario; output verbatim):

```
B10 synthetic agency (5e100000-0000-4000-8000-00000000000a): 8 active members, 4 status change(s)
  before: {"Current":3,"No Record":2,"Failed":3}
  after:  {"Current":5,"No Record":2,"Failed":1}
  - B Open-day passes: Current -> No Record. No completed passing qualification result matches the required standard, firearm, and component scope. [2 result(s) on days not closed (RNG-24)]
  - C Any-firearm drill: No Record -> Current. All required qualification components match the configured standard and firearm scope and are current. [2 result(s) on "Any" firearm drills (RNG-09)]
  - D Same-day re-shoot: Failed -> Current. All required qualification components match the configured standard and firearm scope and are current.
  - G Open-day failure: Failed -> Current. All required qualification components match the configured standard and firearm scope and are current. [1 result(s) on days not closed (RNG-24)]
```

The officers with no change are:

- A: passes on a Completed day.
- E: a pass, then a same-day failure saved later, so still Failed.
- F: imported records only.
- H: no records.

**What agencies should be told:**

- Officers whose only passes are on range days still open (Planned or In Progress) lose currency until the day is closed out. A failure on an open day no longer marks an officer Failed. **Close out completed range days before deploying,** or expect "No Record" and "Missing" counts to rise.
- Qualifications shot on "Any" drills now count.
- A same-day remedial re-shoot clears the earlier failure.

## Native client contract (code not available)

- **New:** the PUT routes return **400** with a message when a new or changed result carries an impossible score, time or hit count. Numeric strings are still accepted.
- **Newly accepted:** scorer-only devices can mark attendance and add present walk-ups on open days. Before, they got 403.
- **New optional result field:** `firearmTypeSnapshot`, written by the web. Clients that ignore it lose nothing. If the native client wants "Any" drills attributed to the firearm used, it should send it too.
- No response shape changed.

## Staging (reconciliation README §8)

1. **Before applying anything**, run the snapshot and diff above on staging and record the per-agency changes (G4-style data-impact preview). Share them for the announcement.
2. Run `scripts/migrate-db.ps1 staging -Action status`. Expect `051` to be pending. Then run `apply`.
3. Verify the trigger: `select pg_get_functiondef('public.protect_pilot_range_workspace_mutation()'::regprocedure) like '%range_workspace_scorer_roster_change_allowed%'` → true.
4. Deploy the image, then run these checks with `acceptance-<UUID>` tenants:
   - **Instructor (default role, `score_range_days` only):**
     - Mark Present on a scheduled day and on an open day: "Saved".
     - Add a walk-up from Scoring on an open day: "Saved".
     - Remove, Add Officer and firearm selection are disabled.
     - Upload a target photo on a saved result: 201, and it lists.
     - On the Qualifications page, an imported record's evidence uploads for a range manager.
   - **Scores:**
     - A score above the drill's maximum shows "Save failed: Score … is above the maximum …".
     - An Incomplete toggle on a Points drill saves as incomplete.
   - **Qualifications:** compare the Command Dashboard / Qualifications status with step 1's "after" for two flagged officers.
   - S5 (range save) and S10 (tenant-negative) still pass.
5. Production needs separate authorization: run step 1 there first, then the same apply.

## Rollback

- **Application:** revert the commit and redeploy. Stored `firearmTypeSnapshot` fields are inert to older code. Statuses return to the old computation.
- **051:** the ledger is hash-checked, so roll back with a new forward migration:
  - re-run the 042 body of `protect_pilot_range_workspace_mutation()`;
  - `drop policy attachments_insert_qualification_evidence` and `audit_events_insert_qualification_evidence`;
  - recreate the 048 `attachments_select`.

  The helper function can stay.

## Deferred / owner decisions

- **Historical "Any" results scored without the agency standard.** Before this fix, an "Any" drill never matched the agency standard, so its results have no standard snapshot. Where the agency has an active handgun standard, readiness still excludes them, because their pass/fail was judged on the drill's own passing score, not the standard. New saves are scored against the standard. Counting the old results anyway is a policy choice; the diff report shows who is affected.
- **Cross-source ties (RNG-10):** a workspace result and an imported `qualification_results` row on the same date have no common save order. The failure still wins.
- **Evidence:**
  - A photo taken in the seconds before the autosave confirms the result returns "Qualification result not found"; retrying works.
  - A native client that corrects by regenerating the result id (accepted since B3) leaves earlier photos on the old id. That is a B3 residual. The web keeps ids stable.
- **Walk-up membership:** a walk-up's officer is not checked against active membership in the authorizer. The same is true for managers today. The page offers members only.
- **RNG-26** (drill-level components versus agency standards) is not in B10.
