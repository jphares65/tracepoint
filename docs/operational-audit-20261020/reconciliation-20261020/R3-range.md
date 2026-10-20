# Range & Qualifications (RNG-01..RNG-36): reconciliation against the current code line

- **Audit baseline:** origin/main @ a3677a6 (Oct 7), from docs/operational-audit-20261020/appendix-b-range-qualifications.md
- **Current line checked:** origin/codex/staging-mobile-api-release-20261007 @ 555f061 (Oct 9), read-only worktree at `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current`. Its merge base with main is 6588576.
- **Method:** I re-read every cited file in the current worktree. I reviewed the diff a3677a6..555f061 for range files. I scanned all 41 remote branches for fixes. I ran a scratch harness against the real `authorizeRangeWorkspaceMutation` (see section 3). No repository file was modified and no network service was contacted.

## 0. What changed between the audit baseline and the current line (range scope)

- `src/lib/range/workspace-mutation.ts` is **byte-identical** on main and 555f061, and on all branches except a few early-September ones.
- `src/app/range-days/page.tsx`: the only change is a `formatDate` refactor (−16 lines). This shifts audit line numbers after line ~1170 by about −16. There are no behavioural changes.
- `src/app/api/pilot/range-workspace/route.ts`, `qualification-readiness.ts`, `TrainingAlertsClient.tsx`, the remediation, evidence and drill-document routes, and the range trigger migration are all unchanged.
- **New in 555f061:**
  - mobile range routes: `api/mobile/range-days`, `range-days/[rangeDayId]`, `range-workspace` (GET and PUT) and `drill-documents/[id]/view`
  - `src/lib/tracepoint/mobile-workflows.ts` (read payload shaping only)
  - `database/aws/*` (001–037), which do not touch range tables except 012, a historical-import RLS policy
- **Mobile scoring path:** `PUT /api/mobile/range-workspace` (mobile/range-workspace/route.ts:16-28) accepts a **whole `workspace` document**. It calls the **same `authorizeRangeWorkspaceMutation`** (line 22) and uses the **same server-read `updated_at` compare-and-swap** (lines 20, 24-26). It has:
  - no client version or If-Match
  - no per-result endpoint
  - no idempotency key
  - no merge
  - no offline queue semantics on the server

  It skips the pilot route's `normalizeWorkspace` and stores `body.workspace` verbatim. It also accepts the `qualifications` feature alone, where the pilot PUT requires `range_training`. The one improvement: the decision's 409 or 403 text is returned to the native client (route.ts:23). The web autosave swallows it. The native client code is not in the repository, so its payload construction (stable IDs or not) and offline queue **cannot be verified**.
- **Fix found on another branch but not in the latest line:**
  - Branches: `origin/codex/aws-staging-full-native-integration-20260917` and `origin/codex/aws-staging-readiness-20260902`
  - Commit: 04668a1 "feat: autosave range day workspace"
  - What it adds: `src/lib/range/workspace-autosave.ts` (`LatestWorkspaceSaveQueue`), which serializes saves. The page then shows a saving / saved / error pill with the server error text (page.tsx:4524-4530 on that branch), plus a `retry()`.
  - Which findings it touches: the "rejection is hidden" part of RNG-01, RNG-13 and RNG-11, and part of RNG-02.
  - It is **not** an ancestor of 555f061 or of main. It does not change result IDs, merging, offline caching or finalization rules.
- **AWS-native nuance:**
  - On the Postgres provider, writes run under `set local role authenticated` with `tracepoint.subject_id` set (server-access-postgres.ts:24-25), and database/aws/004 rewrites `auth.uid()` to `tracepoint_auth.subject_id()`.
  - So the trigger `protect_pilot_range_workspace_mutation` is **not** bypassed on AWS. Its bypass list is `service_role`, `postgres` and `supabase_admin` only (202609060002:89).
  - On AWS the packet-Ready and finalized rules (RNG-03, RNG-04) are therefore enforced **twice**, in TypeScript and in the database. This also changes the RNG-34 premise.
  - This requires runtime verification against an AWS staging database.
- **Audit citation errors:** workspace-mutation.ts is 156 lines on every branch, so the cited lines :400-403, :427-446, :440, :449-462, :465, :475 and :490-502 do not exist. The real locations are:

  | Function or check | Real lines |
  |---|---|
  | `isFinalized` | 50-53 |
  | `finalizedHistoryChanged` | 77-97 |
  | `!nextDay \|\| !same(...)` | 90 |
  | `historicalEvidenceRemoved` | 99-113 |
  | the authorizer | 115 |
  | `canScore` | 125 |
  | the scorer planning check | 140-153 |

  The substance of each claim still holds.

## 1. Summary counts (36 findings)

| Classification | Count | IDs |
|---|---|---|
| Confirmed applicable defect | 26 | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 19, 21, 22, 23, 24, 25, 27, 32, 36 |
| Partially resolved | 1 | 28 (mobile routes are gated; web routes are not) |
| Enhancement rather than defect | 8 | 18, 20, 29, 30, 31, 33, 34, 35 |
| Requires runtime verification | 1 | 26 |
| Already resolved | 0 | none |
| Not applicable to current architecture | 0 | none |

**Priority revisions:**
- **RNG-13: High → Critical.** The mobile release adds a second class of concurrent full-document writer through the same authorizer.
- **RNG-30: Medium → Low.** Phone use is meant to move to the native client. Pending verification.
- **RNG-16: High → Medium.** It is a workflow gap, and the audit itself classed it as a usability problem.

The isolated harness reproduced RNG-01, RNG-03, RNG-04 and RNG-13 exactly as described, plus the server-side halves of RNG-11, 21, 22 and 23: 25 of 25 scenarios matched.

## 2. Findings table

Paths are relative to the current worktree. "page" means `src/app/range-days/page.tsx` @ 555f061.

| ID | Title | New classification | Revised priority | Current evidence | Note |
|---|---|---|---|---|---|
| RNG-01 | Score correction or re-shoot re-save rejected, rejection hidden | Confirmed applicable defect | Critical | page:3339 `` const resultId = `result-${now}-${index}` ``; page:3450-3463 filters old drill/run/officer results and appends new ones; page:2585-2588 prefilled `completed` is boolean, so `hasEntry` is true for every prefilled row; workspace-mutation.ts:136-137 returns 409 "Saved scores and malfunction history cannot be removed…"; page:494-497 `.catch(… console.warn …)`; page:3474 success message comes from local state | **Reproduced (tests 1b-1d, 1f):** 409 for instructor, Range Master and administrator. Control 1e shows that an in-place edit with a stable ID is accepted, so the fix is client ID stability plus a revision trail. **Mobile:** same authorizer (mobile/range-workspace/route.ts:22). The 409 text reaches the native client (route.ts:23), but the server offers no per-result or upsert path. Whether the native client reuses IDs is unknown because its code is absent. A fix for error visibility exists only on aws-staging-full-native-integration-20260917 (04668a1). |
| RNG-02 | No reliable offline behaviour; local work lost or page empty | Confirmed applicable defect | Critical | page:2379 `if (!currentUserId) return;` (currentUserId is set only at page:1907 after a fetch); page:2383-2410 remote preferred and `writeStoredRangeDayWorkspace` overwrites local; page:409 global key `"tracepoint.rangeDays.workspace.v1"`; no `beforeunload`, `navigator.onLine`, `serviceWorker` or `indexedDB` in range-days, qualifications or api/mobile | **Server side:** neither PUT has a client version, idempotency key or merge, so replay of an offline outbox from the native app is unsafe (last full document wins, or 409). Native offline queue: requires runtime verification (code absent). Branch 04668a1 adds save-state and retry only (no outbox), and it is not in the latest line. |
| RNG-03 | packetStatus "Ready" locks the day before shooting | Confirmed applicable defect | Critical | workspace-mutation.ts:50-53 `… \|\| field(rangeDay,"packetStatus","packet_status").toLowerCase() === "ready"`; page:1937-1941 `selectedRangeDayFinalized … \|\| packetStatus === "Ready"`; page:2223 readiness item warns until Ready; page:3814 "Packets Ready" stat; trigger 202609060002:118-119 same rule; drills/route.ts:66 same rule | **Reproduced (tests 3a-3f):** setting Ready is allowed. After that, the first score add, a Planned→In Progress change, attendance toggles, and reverting Ready (even by an administrator) all return 409. **Mobile:** `rangeDayPayload` exposes `packetStatus` (mobile-workflows.ts:15), and mobile PUT hits the same rule. On AWS the trigger is not bypassed, so the database also enforces it (runtime verification needed). |
| RNG-04 | Finalization is one unconfirmed tap, irreversible, no amendment | Confirmed applicable defect | High | page:4009-4025 Archive button with no confirm, rendered only when the day is not final, so the "Restore" branch is unreachable; page:2903 early return for final days; page:4560-4575 status `<select>` → `updateSelectedRangeDay`; workspace-mutation.ts:87-96 and :133-134 | **Reproduced (tests 4a-4f):** Completed is accepted in one write with no checks. Afterwards, a score edit (stable ID), an AAR edit, reopen to In Progress, Completed→Archived, and Archived→Planned all return 409, even for `administer_department`. No branch adds a reopen path. |
| RNG-05 | Malfunctions never reach armory; catastrophic failure not out-of-service | Confirmed applicable defect | High | page:3429-3444 malfunction pushed to the client array only, with `removedFromService: … === "Catastrophic Failure"`, `inspectionRequired: true`; grep "malfunction" in src/app/armory, src/app/api/armory and src/lib/armory finds nothing; open-attendance-firearms.ts:45 `condition_status === "In Service"`; command-dashboard/page.tsx:813 | The new custody and restriction modules (database/aws/028-031, firearm_custody.*) and inventory (035-037) do not reference malfunctions or range. |
| RNG-06 | Range results never reach relational tables; dashboard reads empty tables | Confirmed applicable defect | High | Only writers of `qualification_results` are onboarding/qualification-history/route.ts:255-313. drills/route.ts:54-77 only selects or deletes `range_days`, `range_day_drills` and `drill_run_results`. No insert or upsert anywhere in src. | Mobile routes also read only the JSON workspace (mobile/range-days/route.ts:10). The AWS migrations add no projection. |
| RNG-07 | Instructor role cannot run a line | Confirmed applicable defect | High | permission_matrix.sql:16 `('instructor','score_range_days')`; page:3120-3121 `handleToggleRosterAttendance` → `if (!canEditSelectedRangeDay) return;`; page:1964-1965 `canManageOpenAttendance = isOpenAttendance && canEditSelectedRangeDay && canScoreRangeDays`; pilot range-workspace/route.ts:80 `canScore` omits manage; workspace-mutation.ts:125 includes manage; :140-153 scorers blocked from roster; evidence/route.ts:91 | **Mobile:** GET is open to scorers (mobile/range-workspace/route.ts:6), but PUT uses the same authorizer, so a scorer-only device still cannot mark attendance (any `rangeRoster` change returns 403). The UI and API `canScore` mismatch remains. |
| RNG-08 | Unsaved typed scores silently discarded | Confirmed applicable defect | High | page:~2531-2597 effect rebuilds rows from saved results only and calls `setBatchScoreRows(nextRows)` (about line 2596); `setBatchScoreRows({})` about line 2530 | Web UI only. The native client equivalent cannot be assessed. |
| RNG-09 | Firearm type "Any" never counts toward handgun currency | Confirmed applicable defect | High | page:1827 `useState<…>("Any")`; qualification-readiness.ts:372 `normalized(scope.firearmType ?? "handgun")`; :392/:396 `excluded.wrongFirearm += 1` | qualification-readiness.ts is unchanged since the audit and has no test for "Any". |
| RNG-10 | Same-day re-shoot cannot clear Failed | Confirmed applicable defect | High | qualification-readiness.ts:297 `return getDateValue(failure.date) >= getDateValue(relevantPass?.date);`; results have no timestamp field (page:3383-3427 builds no `recordedAt`) | The RNG-01 path also prevents the re-shoot from being saved at all on the same drill and run (test 1f). |
| RNG-11 | Load normalization can make every autosave fail | Confirmed applicable defect | High | page:1124 `normalizeRangeDaysForWorkspace`; page:1094 `normalizeDrillLibraryForWorkspace`; applied on load at page:2389-2398; workspace-mutation.ts:90 `if (!nextDay \|\| !same(existingDay, nextDay)) return true;`; :147-152 | **Reproduced:** 11a (adding `attendanceMode` to a legacy Completed day) returns 409, and 11b (a scorer sends a normalized `defaultRunCount`) returns 403. Mobile PUT stores the client document verbatim. If the native app round-trips the GET body unchanged it avoids this, which requires runtime verification. |
| RNG-12 | Target-photo evidence tied to transient IDs; fails for imports and instructors | Confirmed applicable defect | High | page:6391 and :6588 `qualificationResultId={existingResult?.id}`; evidence/route.ts:22-36 looks up `pilot_range_workspaces.workspace.results`; :91 requires manage_qualifications or manage_range_days; qualifications/page.tsx:783 `<QualificationEvidence qualificationResultId={event.id} />`; QuickQualificationCamera.tsx:108 `h-8 w-8` | There is no mobile evidence-upload route (api/mobile/attachments only has a download route). Corrections still re-key results (RNG-01), which orphans photos. |
| RNG-13 | Concurrent devices lock each other out | Confirmed applicable defect | **Critical** (was High) | pilot route.ts:128-176 and mobile/range-workspace/route.ts:20-26 both compare-and-swap on the `updated_at` the server itself just read, with no client version; workspace-mutation.ts:99-113; drills/route.ts:39-43 update with **no** `updated_at` guard | **Reproduced (13a-13d):** B's PUT after A's lands returns 409 "Saved scores … cannot be removed". 13c (B merges first) succeeds. 13d: a stale **planning** write by a second manager is accepted and silently overwrites A's change (lost update, not just lock-out). The mobile release makes phone plus tablet plus desktop concurrency the normal case. |
| RNG-14 | No score range or type validation | Confirmed applicable defect | Medium | page:654 `return numericValue >= drill.passingScore;` (no maxScore); page:6442 `inputMode="decimal"`; page:3381-3399 NaN dropped silently | The server (both PUTs) does no result validation, so a native client is equally unchecked. |
| RNG-15 | Complete/Incomplete toggle ignored except for Completion drills | Confirmed applicable defect | Medium | page:3390-3393 `completed: scoringFormat === "Completion" ? row.completed ?? false : true`; page:6505-6514 and :6874-6883 toggle shown for all formats, default "Complete" | Audit line refs shifted (3406-3409 → 3390-3393). |
| RNG-16 | Remediation disconnected and weakly audited | Confirmed applicable defect | Medium (was High) | TrainingAlertsClient.tsx:177, :253, :262 alert state in `localStorage`; `remediation_due_days` and `qualification_failure_requires_remediation` are referenced only in RangeQualificationRulesPanel.tsx (plus an analytics config test) | Files unchanged since the audit. |
| RNG-17 | Firearm failure-lockout policy never enforced | Confirmed applicable defect | High | `evaluateFirearmQualificationAuthorization` in src/lib/tracepoint/firearm-qualification-lockout.ts has zero importers on every remote branch (`git grep` returns only the defining file) | The new firearm_possession_restrictions (AWS 030/031) are not driven by qualification failures. |
| RNG-18 | No instructor certification or assignment check | Enhancement rather than defect | Medium | grep `certif` in page returns nothing; page:3419 `instructorId: currentUserId` | Policy-dependent feature. |
| RNG-19 | Firearm serials missing on range and qualification screens | Confirmed applicable defect | Medium | page:1345 `` `${formatRangeFirearmType(...)} — ${firearm.make} ${firearm.model}` ``; qualifications/page.tsx:266 and :272 `` `Firearm ${firearmId}` `` | The mobile roster payload gives `assignedFirearmIds` only (mobile-workflows.ts:42); mobile labelling is unknown. |
| RNG-20 | Range ammunition does not update inventory | Enhancement rather than defect | Medium | page:267 "Ammunition staged" is the only reference; no ammunition or inventory call from range | New ammunition-persistence.ts and inventory phase 1/2a exist, but have no range linkage. |
| RNG-21 | AAR read-only after close-out | Confirmed applicable defect | Medium | page:7276 `aria-disabled={!canEditSelectedRangeDay} … pointer-events-none`; page:2866 `handleUpdateAar` | Harness test 4c: AAR edit on a Completed day returns 409 even for an administrator. |
| RNG-22 | Roster removal has no confirm and deletes results (server rejects) | Confirmed applicable defect | Medium | page:3090-3101 `handleRemoveOfficerFromRoster` → `setResults(... filter ...)`, no `confirm` | Harness test 22a returns 409 "Saved scores … cannot be removed", so the screen and the server desync. |
| RNG-23 | Re-save resets malfunction type and notes | Confirmed applicable defect | Medium | page:2590-2592 `malfunctionType: "Failure to Feed", malfunctionNotes: ""`; page:3465-3472 old malfunctions filtered out, new ones created | Harness test 23a: the re-save is rejected (409), so on web the corruption stays local until reload. A client that keeps IDs but rebuilds the row would persist the downgrade. |
| RNG-24 | Qualification status counts open (non-closed) days | Confirmed applicable defect | Medium | qualification-readiness.ts:152 `mapWorkspaceAttempts` has no status filter (file unchanged) | Combined with RNG-03 and RNG-04, close-out is risky, so open days are common. |
| RNG-25 | Qualification detection by name matching | Confirmed applicable defect | Medium | page:591 `name?.toLowerCase().includes("qualification")`; page:605 "always scored as qualifications"; qualifications/page.tsx:285 and :451 `isRifleDrill` | Unchanged. |
| RNG-26 | Drill-level components override agency standards | Requires runtime verification | Medium | page:897 `` id: `drill:${drill.id}` `` precedence; page:3341-3346 and :3360-3365 standard pass/snapshot | The code precedence is confirmed. Whether it is wrong depends on agency policy and data. |
| RNG-27 | Audit trail is whole-document snapshots | Confirmed applicable defect | Medium | 202609060002:183-186 `pilot_range_workspaces_accountability_audit`; page:3419 batch-wide `instructorId`; results have no `recordedAt` | Mobile PUT writes the same document-level row and stamps only `updated_by_user_id`. |
| RNG-28 | Every member can read all range results | Partially resolved | Medium | **Fixed on the mobile surface:** mobile/range-days/route.ts:8-9, mobile/range-workspace/route.ts:6 and mobile/drill-documents view route.ts:8 require a feature plus manage/score/manage_qualifications. **Still open on web:** pilot range-workspace/route.ts:59-74 (feature only); qualifications/route.ts:9-19 (no feature or permission check); drill-library documents GET:21-30 and drill-documents/[id]/[disposition] GET:7 (no feature check); RLS select_members unchanged | |
| RNG-29 | Roster built one officer at a time; no loaner in scheduled mode | Enhancement rather than defect | Medium | page:3019 `handleAddOfficerToRoster` adds one entry; firearm chips filtered by `assigned_to_user_id === entry.officerId` | The new SearchablePicker component is not used by range-days. |
| RNG-30 | Mobile layout: stacked tabs, small targets | Enhancement rather than defect | Low (was Medium) | page:4482 `grid gap-2 md:grid-cols-4 xl:grid-cols-8`; QuickQualificationCamera.tsx:108 `h-8 w-8` | The native client is intended for phones (not verifiable). |
| RNG-31 | Drill library only inside a Range Day; edits overwrite authorship | Enhancement rather than defect | Low | page:3520 `createDrillLibraryTemplate(`; page:3639-3653 propagation by `scoredDrillIds` and name match | |
| RNG-32 | Drill documents hard-deleted; upload error leaves UI stuck | Confirmed applicable defect | Low | drill-documents/[documentId]/route.ts:24 `.from("drill_documents").delete()`; DrillDocuments.tsx:38-57 `setBusy(true)` … `await fetch` … `setBusy(false)` with no try/finally | The mobile view route is read-only. |
| RNG-33 | Printed packet is the only offline fallback | Enhancement rather than defect | Low | page:3485 `console.log("Generated range packet:", packet)`; :3496 `window.print()` | The console leak is a minor defect worth folding into any fix. |
| RNG-34 | workspace-write-policy.ts dead code; rules in three places | Enhancement rather than defect | Low | `validateWorkspaceWrite` is imported only by workspace-write-policy.test.ts; trigger bypass 202609060002:89 | The premise "enforcement rests only on TS" **does not hold on AWS-native**, because writes run as `authenticated` (server-access-postgres.ts:24) and 004 remaps `auth.uid()`, so the trigger fires. That needs runtime verification. There are now four rule copies: TS, trigger, drills/route.ts:66, and the client predicates. |
| RNG-35 | Stale page copies at repo root | Enhancement rather than defect | Low | root still has range-days-page.txt, qualifications-page.txt, command-dashboard-page.txt, training-alerts-client.txt and 7 more; src/app/settings/import-export/page.tsx.before-* | |
| RNG-36 | Test coverage misses high-risk paths | Confirmed applicable defect | Medium | src/lib/range has tests only for helpers and the authorizer; no tests for handleSaveBatchResults, the lockout evaluator, "Any", same-day fail→pass, or the **new mobile PUT**; mobile-workflows.test.ts covers only payload shaping and QR | Branch 04668a1 adds workspace-autosave.test.ts (not in the latest line). |

## 3. Isolated verification (RNG-01, RNG-03, RNG-04, RNG-13; also RNG-11, 21, 22, 23)

### Reproduction steps

1. `mkdir -p /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/recon/work-range`
2. `ln -sfn /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/runtime/work/node_modules /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/recon/work-range/node_modules`
3. The script `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/recon/work-range/verify-range.ts` imports `authorizeRangeWorkspaceMutation` directly from `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current/src/lib/range/workspace-mutation.ts`, which is the 555f061 worktree and is byte-identical to main.
4. Its `batchSave()` mirrors page.tsx:3308-3472 at 555f061:
   - ID `` `result-${now}-${index}` `` and `` `malfunction-${now}-${index}` ``
   - remove existing results for the same rangeDay, drill, run and attending officer, then append the new ones
   - drop malfunctions whose `drillRunId` was replaced

   I confirmed that the current page still does this (page:3339, 3357, 3450-3472). Because pre-filled rows carry a boolean `completed` (page:2585-2588), every officer already scored is re-keyed on every save.
5. **Mobile payload:** the server cannot build one. `PUT /api/mobile/range-workspace` takes the client's full `workspace` and passes it unchanged to the same function (mobile route.ts:18-22). The harness's next-workspace inputs are therefore exactly what either surface would submit, assuming the native client uses the web's ID scheme, which cannot be verified.
6. Run: `cd /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/recon/work-range && ./node_modules/.bin/tsx verify-range.ts` (tsx v4.23.13, node v22.22.0). Output is saved to `/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/recon/work-range/verify-range.out`.

### Scenarios, expected result, actual result

"Expected" means the behaviour the audit claims.

| # | Scenario | Expected per audit | Actual |
|---|---|---|---|
| 1a | Empty day → save 2 results (instructor) | ok | ok:score |
| 1b | Same 2 results replaced with new IDs and corrected score (2240→224), instructor | 409 | 409 "Saved scores and malfunction history cannot be removed from the range workspace." |
| 1c | Same as 1b, Range Master | 409 | 409 (same) |
| 1d | Same as 1b, administrator | 409 | 409 (same) |
| 1e | Control: correct the score in place, same ID | (should be ok) | ok:score |
| 1f | Same-day re-shoot of one officer (new ID) | 409 | 409 (same) |
| 3a | Range Master sets packetStatus Ready on a Planned day | ok | ok:manage |
| 3b | First score added on the Ready day (instructor) | 409 | 409 "Completed, locked, archived, or finalized range records cannot be changed." |
| 3c | Same as 3b, administrator | 409 | 409 (same) |
| 3d | Planned→In Progress on the Ready day | 409 | 409 |
| 3e | Revert Ready→In Progress (administrator) | 409 | 409 |
| 3f | Attendance toggle on the Ready day | 409 | 409 |
| 4a | Set Completed (no validation) | ok | ok:manage |
| 4b | Edit a score on the Completed day, stable ID, administrator | 409 | 409 |
| 4c | Add AAR after close-out (RNG-21) | 409 | 409 |
| 4d | Reopen Completed→In Progress, administrator | 409 | 409 |
| 4e | Completed→Archived | 409 | 409 |
| 4f | Restore Archived→Planned, administrator | 409 | 409 |
| 13a | Device A PUT (server = base) | ok | ok:score |
| 13b | Device B PUT after A landed (B lacks A's result) | 409 | 409 "Saved scores … cannot be removed…" |
| 13c | Control: B merges A's results first | ok | ok:score |
| 13d | Stale planning write by manager B after A's title edit | (lost update) | ok:manage, so A's edit is silently overwritten |
| 11a | Normalization adds attendanceMode to a legacy Completed day | 409 | 409 |
| 11b | Scorer-only PUT with normalized defaultRunCount | 403 | 403 "Range-day planning and drill-library changes require range management permission." |
| 22a | Roster removal that drops the officer's results | 409 | 409 |
| 23a | Re-save line recreating the malfunction with a new ID and type | 409 | 409 |

All 25 scenarios matched the audit's described behaviour.

### Raw output (abridged to the decision lines; the full text is in verify-range.out)

```
[MATCH] 1a first save of 2 results (control)  actual=ok:score
    saved ids: result-1000-0, result-1000-1
    corrected ids: result-2000-0, result-2000-1
[MATCH] 1b corrected re-save (new IDs, old filtered) as instructor  actual=409 Saved scores and malfunction history cannot be removed from the range workspace.
[MATCH] 1c corrected re-save as Range Master  actual=409 Saved scores and malfunction history cannot be removed from the range workspace.
[MATCH] 1d corrected re-save as administrator  actual=409 Saved scores and malfunction history cannot be removed from the range workspace.
[MATCH] 1e control: in-place correction keeping stable ID  actual=ok:score
[MATCH] 1f same-day re-shoot of officer-A only (new ID replaces failed attempt)  actual=409 Saved scores ...
[MATCH] 3a Range Master sets packetStatus Ready the night before (allowed)  actual=ok:manage
[MATCH] 3b first score add on the 'Ready' (not completed) day, instructor  actual=409 Completed, locked, archived, or finalized range records cannot be changed.
[MATCH] 3c ... administrator  actual=409 Completed, locked, archived, or finalized ...
[MATCH] 3d status Planned->In Progress on the Ready day  actual=409 ...
[MATCH] 3e revert packetStatus Ready->In Progress (unlock attempt), administrator  actual=409 ...
[MATCH] 3f roster attendance change on the Ready day  actual=409 ...
[MATCH] 4a set status Completed (one write, no extra checks)  actual=ok:manage
[MATCH] 4b edit a score on the Completed day (stable ID), administrator  actual=409 Completed, locked, archived, or finalized ...
[MATCH] 4c add AAR text after close-out (RNG-21)  actual=409 ...
[MATCH] 4d reopen Completed->In Progress, administrator  actual=409 ...
[MATCH] 4e Completed->Archived  actual=409 ...
[MATCH] 4f restore Archived->Planned, administrator  actual=409 ...
[MATCH] 13a device A PUT (server state = base)  actual=ok:score
[MATCH] 13b device B PUT after A landed (server state = A), B lacks A's result  actual=409 Saved scores and malfunction history cannot be removed ...
[MATCH] 13c control: B merges A's results then PUTs  actual=ok:score
[MATCH] 13d stale planning write by B after A's title edit (lost update, accepted)  actual=ok:manage
[MATCH] 11a load-time normalization adds attendanceMode to a legacy Completed day  actual=409 ...
[MATCH] 11b library normalization (defaultRunCount) sent by scorer-only user  actual=403 Range-day planning and drill-library changes require range management permission.
[MATCH] 22a roster removal that also deletes the officer's results  actual=409 Saved scores ...
[MATCH] 23a re-save line recreating the malfunction with new ID/type  actual=409 Saved scores ...
```

### Limits of this verification

- This exercises the TypeScript authorizer only. It does not exercise the HTTP route wrappers, the `updated_at` compare-and-swap, the database trigger, or the native client.
- The audit's claim that the web client swallows these 409s rests on code reading (page:494-497).
- On AWS-native, whether the database trigger also fires requires a staging database run.
- The native client's ID scheme and offline queue cannot be assessed from this repository.
