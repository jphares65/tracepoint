# TracePoint Audit: Range & Qualifications

**Scope:** Range Days (`src/app/range-days/page.tsx`, 7,415 lines), Drill Library and Drill Documents, range scoring, malfunction logging, Qualifications (`src/app/qualifications/page.tsx`), qualification evidence and the camera component, remediation, `src/lib/range`, `src/lib/qualifications`, `src/lib/tracepoint/qualification-readiness.ts` and `firearm-qualification-lockout.ts`, and the related migrations and API routes.

**Method:** This audit is based only on reading the code. I did not run the app, the tests, or any database. I did not modify any repository file. Every "Confirmed defect" below comes from handler code, client code, and SQL that I read and traced by hand. Line numbers refer to the files as they are in `/home/user/tracepoint` at the time of the audit.

**Main architectural fact.** All Range Day planning, rosters, drill assignments, scores and malfunctions live in one JSONB document per department (`pilot_range_workspaces.workspace`). The browser rewrites that document in full on every state change (a debounced `PUT /api/pilot/range-workspace`, page.tsx:474-498 and 2465-2492). Nothing in the application writes the relational tables `range_days`, `range_day_drills`, `drill_run_results`, `range_day_roster`, `firearm_malfunctions` or `qualification_results` from a Range Day. The only writer of `qualification_results` is the historical onboarding import. Many of the findings below follow from this design.

---

## 1. Workflow inventory

| Workflow | Route(s) / API | Operational purpose | Primary roles |
|---|---|---|---|
| Range Day list, create, archive | `/range-days` (list view, page.tsx:3816-4205); `GET/PUT /api/pilot/range-workspace` | Schedule range days, filter by status and type, archive | Range Master (`manage_range_days`) |
| Range Day details (overview, staffing, status, packet status, attendance mode) | `/range-days`, overview tab (page.tsx:4531-4900) | Date, location, lead and assistant instructors, status lifecycle | Range Master |
| Pre-range readiness checklist | readiness tab (page.tsx:2119-2256, 4903) | Checks lead instructor, roster, attendance, firearms, drills, equipment, packet | Range Master, lead instructor |
| Scheduled roster and firearm selection | roster tab (page.tsx:5016-5193) | Add officers one at a time, mark present, choose assigned firearms | Range Master (manage only) |
| Open / rolling attendance (walk-ups) | scoring tab (page.tsx:6115-6280); `src/lib/range/attendance-mode.ts`, `open-attendance-*.ts` | Add an arriving shooter and a firearm (assigned or shared) | Range Master (needs manage **and** score) |
| Drill library (templates, qualification components, department standards) | drills tab, library panel (page.tsx:5195-5990); stored in workspace `drillLibrary` | Reusable courses of fire, scoring format, pass thresholds | Range Master |
| Add or remove a drill on a Range Day | `DELETE /api/pilot/range-workspace/drills`; `src/lib/range/drill-removal.ts` | Build the day's plan; removal is blocked if scored or finalized | Range Master |
| Drill documents (diagrams, PDFs) | `DrillDocuments.tsx`; `GET/POST /api/drill-library/[id]/documents`; `DELETE /api/drill-documents/[id]`; `GET /api/drill-documents/[id]/[view\|download]` | Course-of-fire diagrams at the line | Range Master (upload), all members (view) |
| Equipment checklist | equipment tab (page.tsx:5991) | Pack list, required items | Range Master |
| Live scoring board (batch per drill and run) | scoring tab (page.tsx:6092-7058); `handleSaveBatchResults` (page.tsx:3225-3495) | Enter a line of shooters' score, time or hits; automatic pass/fail; notes | Instructor (`score_range_days`), Range Master |
| Malfunction logging at the line | scoring row toggle → workspace `malfunctions` (page.tsx:3448-3462) | Record failures linked to a result and a firearm | Instructor |
| Target photo evidence | `QuickQualificationCamera.tsx`, `QualificationEvidence.tsx`; `GET/POST /api/qualifications/[resultId]/evidence`; `attachments` table | Photograph Q-targets for the record | Instructor, Range Master (upload needs manage permission) |
| Print packet | `handleGeneratePacket` (page.tsx:3497) → `window.print()` | Paper roster and score sheet backup | Range Master |
| Results and AAR | results tab (page.tsx:7061), AAR tab (page.tsx:7291) | Per-officer summary, malfunction list, lessons learned | Range Master |
| Close-out / finalize | status select (`Completed` / `Locked` / `Archived`) or packet status `Ready`; enforced in `workspace-mutation.ts` and the DB trigger `protect_pilot_range_workspace_mutation` | Freeze range history | Range Master |
| Qualification status board | `/qualifications`; `GET /api/qualifications` (historical imports only) + `GET /api/pilot/range-workspace`; `qualification-readiness.ts` | Day and night currency per officer; Current, Due Soon, Overdue, Failed | Supervisors, command, Range Master |
| Historical qualification import | `POST /api/settings/onboarding/qualification-history` | Load legacy qualifications into `qualification_results` | Admin |
| Remediation | `/training-alerts` (`TrainingAlertsClient.tsx`); `GET/PUT /api/pilot/remediations` (whole-array JSON in `pilot_remediation_workspaces`) | Assign and track remedial training after a failure | Training manager (`manage_training`) |
| Analytics and command dashboard | `GET /api/pilot/performance-summary`; `/command-dashboard` | Qualification coverage, drill trends, upcoming range days, firearm alerts | Command staff, analytics viewers |
| Agency range rules | Settings → `RangeQualificationRulesPanel.tsx`; `department_rules.range_qualification_rules` | Day/night requirements, lockout threshold, remediation due days | Admin |

---

## 2. Role-based end-to-end assessments

### A. Range Master plans a qualification day (desktop)
1. `New Range Day` (1 tap). The day is created only in client state (`range-${Date.now()}`, page.tsx:2779) and autosaved 650 ms later.
2. Overview: edit title, date, times (free text "0800", not a time input), location, type. About 6 fields. Changing the type does not change the drills.
3. Drills tab → `Add Drill` → library panel → `Add to range day` per drill (2 taps per drill). If the library is empty, the full template form has about 25 fields, including qualification components and department-standard fields that duplicate the agency standards in Settings.
4. Roster tab: pick an officer from one `<select>` listing every department member, then `Add Officer`. That is 2 taps plus scrolling, **per officer**. There is no bulk add by unit, shift or "due for qualification". For 30 officers this is about 60 taps plus about 30 firearm-chip taps.
5. Equipment: tick the required items.
6. Readiness: the checklist warns until **Packet status = Ready**. Setting it to Ready **finalizes and locks the day before anyone shoots** (RNG-03).

Roughly 100+ interactions for a 30-officer day, and the readiness checklist itself leads the user into a lock.

### B. Line instructor scores a qualification course on a phone (role `instructor` = `score_range_days` only)
- The instructor cannot mark attendance (the roster tab needs `manage_range_days`, page.tsx:3122-3133 and 5017). Scoring lists only `attendingRoster`, so with a scheduled roster nothing can be scored until a Range Master marks officers present (RNG-07).
- Once officers are present: choose the drill (1), choose the run/component ("Day", then "Night") (1), then for each shooter tap the score field and type 2-3 digits (≈1 tap + digits). Pass/fail is set automatically. Then `Save Day` (1). For a 10-shooter line that is about **13 taps plus digits per component**. There is no per-stage or per-string entry; the whole course is one total number per component.
- The camera icon on each card (32 px) is enabled once the result exists **locally**. An `instructor` gets "Qualification-management permission is required" when uploading (RNG-12).
- Any unsaved typed scores are discarded if someone adds a walk-up, the workspace reloads, or the drill or run is switched (RNG-08).

### C. Officer arrives who is not on the roster
- **Scheduled Roster day:** the Range Master must go to the roster tab, add the officer (2), toggle a firearm (1), mark present (1), and return to scoring (1). That is about 5 taps, but only for a manage-permission user. If the officer has no armory assignment there is **no loaner or shared firearm option** in scheduled mode (the roster firearm chips only show assigned firearms, page.tsx:5100-5108), so the officer cannot be scored.
- **Open/Rolling day:** use the officer combobox, pick a firearm, `Add Shooter`. About 4 taps. This requires the user to have both manage and score permission (page.tsx:1980-1981). Adding the shooter changes `rangeRoster`, which re-runs the batch-row effect and **clears all scores typed but not yet saved for the line** (RNG-08).

### D. Officer fails and re-shoots the same day (remediation)
- Option 1: re-enter the same drill and run. `handleSaveBatchResults` deletes the earlier results and creates new IDs (page.tsx:3355 and 3464-3476). The server rejects this as "Saved scores … cannot be removed" (RNG-01), and the failure is only logged to the console. The first attempt is also no longer kept as a failed attempt in history.
- Option 2: add a second copy of the qualification drill and score it there. The readiness engine still reports **Failed**, because a failure dated on or after the pass date wins and both share the Range Day's date with no time (RNG-10).
- A remediation record cannot be created from the range page. It must be created in Training Alerts, which requires `manage_training` (agency-training) permission, not a range permission (RNG-16).

### E. Weapon malfunction mid-course
- Toggle `No Malfunction` → `Malfunction Logged`, choose the type, add notes, then save the line (3 or more taps).
- A malfunction record is written only into the workspace JSON. `removedFromService` is set only for "Catastrophic Failure". **Nothing changes the armory firearm's `condition_status`**, nothing notifies the armorer, and no armory code reads these malfunctions (RNG-05). The same firearm can be selected for the next shooter or the next day: open attendance filters only on `condition_status === "In Service"` (open-attendance-firearms.ts:44-46).

### F. Connection drops mid-scoring
- Each state change is written to `localStorage` (a global key that is not scoped by user or department), and the server PUT is debounced and fire-and-forget (page.tsx:486-498). A failed PUT goes to `console.warn` only. The "N results saved" message and the green "Saved" pill reflect **local** state.
- If the page is reloaded while offline, `currentUserId` comes only from a network call (page.tsx:1903-1925), so the workspace effect exits (`if (!currentUserId) return;`, page.tsx:2395) and **the page shows nothing**, even though data exists in the local cache.
- If the page is reloaded once the connection is back, the remote workspace is preferred and **overwrites the local cache**. Any results that never reached the server are lost (page.tsx:2399-2424) (RNG-02).

### G. Close-out
- Changing the Status select to `Completed` (1 tap, no confirmation, no checks for incomplete results) or tapping `Archive` on the list card freezes the day permanently. There is no unlock path for any role, including administrators (RNG-04).
- The AAR tab becomes read-only once the day is final (page.tsx:7292), so the AAR must be written **before** close-out (RNG-21).
- Nothing at close-out creates `qualification_results` rows, consumes ammunition, releases firearms, or creates remediation tasks.

### H. Supervisor or command reviews qualifications
- `/qualifications` recomputes status in the browser from the whole workspace JSON plus historical imports. Results from a day that is still **Planned or In Progress** count immediately. A qualification drill left at the default firearm type **"Any" never counts toward handgun currency** (RNG-09). Firearms appear as `Firearm <uuid>` with no serial number (RNG-19).
- The command dashboard's drill trends, "upcoming range days" and "incomplete packets" read relational tables that nothing populates, so they show zero (RNG-06). Firearm alerts flag every firearm that ever had a malfunction, and nothing clears the flag (RNG-05).

---

## 3. Findings

### RNG-01: Re-saving a scored line (score correction or same-day re-shoot) is permanently rejected by the server, and the rejection is hidden
- **Classification:** Confirmed defect
- **Priority:** Critical
- **Module:** Range Day scoring / workspace persistence
- **Scenario:** An instructor saves the line, notices a typo (shooter 4 entered "2240" instead of "224"), fixes it and taps Save again. The screen says "10 officer results saved". The server rejects every save from then on until the page is reloaded, and the reload throws away the local work.
- **Evidence:**
  - page.tsx:3355: `const resultId = \`result-${now}-${index}\`;`. Every save creates new IDs for **every** officer in the batch, because rows are pre-filled from existing results, so `hasEntry` is true for all of them.
  - page.tsx:3464-3476: `setResults((current) => [...current.filter((result) => !(… same drill/run/officer …)), ...savedResults])`. The old IDs are removed.
  - workspace-mutation.ts:136: `if (historicalEvidenceRemoved(existing, next)) return { ok:false, status:409, error:"Saved scores and malfunction history cannot be removed…" }`.
  - page.tsx:493-496: autosave `saveRemoteRangeDayWorkspace(workspace).catch((error) => { console.warn(...) })`. The user is never told.
  - page.tsx:3489-3493: the success message is set from local state.
- **Proposed correction:** Keep stable result IDs and update in place (append a `revisions[]` entry with the previous value, actor, timestamp and reason). Move results to row-level `drill_run_results` with an append-only correction table. Show save state persistently ("Saved to server 14:02" or "NOT SAVED – retry") and block navigation while saves are pending.
- **Benefit:** Corrections no longer silently break saving for the whole department, and every correction has an audit record.
- **Complexity:** M (in-place fix); L (relational move)

### RNG-02: No reliable offline or poor-connectivity behavior; local work can be lost or the page can render empty
- **Classification:** Confirmed defect
- **Priority:** Critical
- **Module:** Range Day persistence
- **Scenario:** An outdoor range with one bar of LTE. The instructor scores three relays while the PUTs fail, the phone locks, then reloads with signal back. The remote workspace overwrites the local cache and three relays of scores are gone. If the reload happens while still offline, the page lists no range days at all.
- **Evidence:**
  - page.tsx:2395: `if (!currentUserId) return;`. `currentUserId` is set only after a successful `fetch("/api/pilot/range-workspace")` (page.tsx:1903-1925).
  - page.tsx:2399-2424: `const remoteWorkspace = await loadRemoteRangeDayWorkspace(); … if (remoteWorkspace) { writeStoredRangeDayWorkspace({...remote}) }`. Remote replaces local with no merge and no check for unsynced changes.
  - page.tsx:408: `RANGE_DAY_WORKSPACE_STORAGE_KEY = "tracepoint.rangeDays.workspace.v1"`. The key is shared across users and departments on a shared tablet.
  - There is no `beforeunload`, `navigator.onLine`, retry queue or service worker anywhere in the range or qualifications pages (grep found none).
- **Proposed correction:** Keep an outbox of pending mutations in IndexedDB keyed by department and user, and replay it when the connection returns. Show a connectivity banner and a pending-count badge. Load the cached workspace when the network fails. Never overwrite unsynced local changes on load. Scope storage keys by department and user, and clear them on sign-out.
- **Benefit:** Field scoring survives the connectivity typical of outdoor ranges.
- **Complexity:** L

### RNG-03: Setting "Packet Status: Ready" (a planning milestone) permanently locks the Range Day before shooting
- **Classification:** Confirmed defect
- **Priority:** Critical
- **Module:** Range Day lifecycle
- **Scenario:** Following the readiness checklist, which shows "Packet" as a warning until Ready, the Range Master sets the packet to Ready the night before. On the morning of the range day the scoring board, roster and overview are all disabled, and the server rejects every change to that day. There is no way to undo it.
- **Evidence:**
  - page.tsx:1954-1957: `selectedRangeDayFinalized = … ["Completed","Locked","Archived"].includes(status) || selectedRangeDay.packetStatus === "Ready"`.
  - page.tsx:2236-2240: readiness item `status: selectedRangeDay.packetStatus === "Ready" ? "ready" : "warning"`.
  - page.tsx:3822-3824: the list stat card reads "Packets Ready / Ready to print".
  - workspace-mutation.ts:400-403 `isFinalized(...) || packetStatus === "ready"`, and the DB trigger (202609060002:113-115) uses the same rule.
  - page.tsx:6093: the scoring panel gets `pointer-events-none` when finalized.
- **Proposed correction:** Separate packet readiness from record finalization. Finalization should be an explicit "Close Out Range Day" action with confirmation. Remove `packetStatus` from all finalization predicates (client, API and trigger).
- **Benefit:** Ranges cannot be locked by accident before they happen.
- **Complexity:** S

### RNG-04: Finalization (Completed, Locked, Archived) is one unconfirmed tap, irreversible, and has no amendment path
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Range Day close-out and correction
- **Scenario:** A gloved tap on "Archive" on a list card, or picking "Completed" in the status select, while officers are still on the line. Later, a supervisor finds a transcription error in a finalized qualification. There is no unlock, reopen or amendment with a reason, even for administrators.
- **Evidence:**
  - page.tsx:4025-4041: the Archive button calls `handleChangeRangeDayStatus(... "Archived")` with no `confirm`. Its "Restore" branch can never be reached, because the button is hidden once the status is Archived.
  - page.tsx:2919: `if (currentDay && (["Completed","Locked","Archived"].includes(currentDay.status) || …)) return;`.
  - page.tsx:4575-4590: the status `<select>` writes directly through `updateSelectedRangeDay`.
  - The server and trigger reject any change to a finalized day (workspace-mutation.ts:427-446; trigger 202609060002:113-129). There is no close-out validation for unscored attendees or incomplete components.
- **Proposed correction:** Add a close-out wizard (summary of unscored attendees, open malfunctions and required AAR, then confirm). Add a "Reopen for correction" action limited to Range Master or admin, requiring a reason and writing an audit event, or append-only amendments. Make Archive reversible.
- **Benefit:** Prevents accidental locks and gives a defensible way to correct records.
- **Complexity:** M

### RNG-05: Range malfunctions never reach the armory; catastrophic failures do not take the weapon out of service
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Malfunction logging ↔ Armory
- **Scenario:** An officer's duty pistol has a catastrophic failure during the night course. The record says "Armorer inspection required". The armory still shows the pistol "In Service", it can be issued or selected for the next shooter, and the armorer is not notified. Meanwhile the command dashboard flags this firearm, and every other firearm with any logged malfunction, permanently.
- **Evidence:**
  - page.tsx:3448-3462: the malfunction is pushed only to the client array, `removedFromService: row.malfunctionType === "Catastrophic Failure", inspectionRequired: true`.
  - A grep for `malfunction` under `src/app/armory` and `src/app/api/armory` returns nothing. No code writes `firearm_malfunctions` or `firearms.condition_status` from the range.
  - open-attendance-firearms.ts:44-46 `isEligibleRangeDayFirearm` checks only `condition_status === "In Service"`.
  - command-dashboard/page.tsx:819-825 counts as unresolved any malfunction with `inspectionRequired || removedFromService || resolvedOnRange === false`. `inspectionRequired` is always true and there is no resolve UI, so the alert never clears.
  - page.tsx:7108: the text "Armorer inspection required" is shown without any linked workflow.
- **Proposed correction:** On save, write a server-side `firearm_malfunctions` row and, by severity or policy, change the firearm's status (Out of Service / Needs Inspection) with status history and a notification to the armorer. Add "Resolved on range (cleared)" and "Removed from service" choices in the scoring row. Let the armory close malfunctions through inspections.
- **Benefit:** Weapon safety and chain-of-custody integrity.
- **Complexity:** M

### RNG-06: Range Day results never reach the relational record; the dashboard and analytics read empty tables
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Range ↔ Qualifications ↔ Analytics / Command Dashboard
- **Scenario:** Command opens the dashboard after a busy qualification month. "Upcoming range days", "incomplete packets", drill performance trends and drill-trend training alerts show nothing.
- **Evidence:**
  - read-repository-supabase.ts:16-19 reads `range_days`, `range_day_drills`, `drill_run_results` and `range_day_roster`.
  - performance-summary/route.ts:563-590 builds `drillTrends`, `rangeSummary` and alerts from those inputs.
  - A grep for writes to those tables finds only a select or delete in `range-workspace/drills/route.ts`. Nothing inserts.
  - `qualification_results` is written only by `/api/settings/onboarding/qualification-history`, and `/api/qualifications` returns only `record_origin = 'historical_import'` (history-repository-core.ts:168-173).
  - Migration comments acknowledge the gap: "while the Range UI finishes moving to relational tables" (202609060002:3-5), and "until Range Days moves from pilot_range_workspaces JSON" (202609010001:1-2).
- **Proposed correction:** Finish the relational migration. At minimum, project the workspace into the relational tables on close-out (server-side), and write `qualification_results` (with `expires_on`, `firearm_id`, `range_day_id`) when a qualification day closes.
- **Benefit:** Command metrics reflect what actually happened at the range.
- **Complexity:** L

### RNG-07: The permission model prevents the default "Instructor" role from running a line
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Permissions (UI vs API vs RLS)
- **Scenario:** A certified instructor (role `instructor` = `score_range_days` only) runs relay 2. They cannot mark officers present, so the scoring board is empty. They cannot add walk-ups and cannot upload target photos. Conversely, a user holding only `manage_range_days` can plan but finds the scoring board disabled, even though the API would accept their scores.
- **Evidence:**
  - permission_matrix.sql:15-17: `('instructor','score_range_days')` only.
  - page.tsx:3122-3133: `handleToggleRosterAttendance` begins `if (!canEditSelectedRangeDay) return;`, which requires manage. page.tsx:5017 disables the roster tab the same way.
  - page.tsx:3240-3243: scoring uses `attendingRoster` only ("Mark at least one rostered officer present before scoring.").
  - page.tsx:1980-1981: `canManageOpenAttendance = isOpenAttendance && canEditSelectedRangeDay && canScoreRangeDays`.
  - range-workspace/route.ts:80 sets `canScore` from `["score_range_days","manage_qualifications"]` only, while workspace-mutation.ts:475 lets managers score (`canScore = canManage || …`).
  - evidence/route.ts:91: POST requires `manage_qualifications` or `manage_range_days`.
  - The server also blocks scorers from any change to the roster (workspace-mutation.ts:490-502), so this cannot be fixed in the UI alone.
- **Proposed correction:** Allow `score_range_days` to change the attendance fields (attended, attendanceTime, walk-up add with firearm) and to upload evidence. Make the UI and API derivations of `canScore` identical. Optionally restrict scoring to the day's `instructorIds`.
- **Benefit:** The role that actually runs the line can use the tool.
- **Complexity:** M

### RNG-08: Scores typed but not yet saved are silently discarded
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Scoring board
- **Scenario:** An instructor has typed 8 of 10 scores. Another instructor adds a walk-up, a remote change arrives, or the instructor switches to the "Night" run to check something. All 8 entries vanish without a prompt.
- **Evidence:**
  - page.tsx:2546-2619: the `useEffect` rebuilds `nextRows` **only from saved results**, then calls `setBatchScoreRows(nextRows)`, with dependencies `[attendingRoster, selectedDrill, selectedRangeDay, selectedRangeResults, selectedRunNumber]`.
  - `batchScoreRows` is never saved to local storage.
  - The drill and run selects (page.tsx:6286-6320) change without any unsaved-changes check.
- **Proposed correction:** Merge rather than replace (keep rows that have unsaved edits). Keep draft rows in local storage per day, drill and run. Warn before switching drill or run with unsaved edits. Consider saving each officer row on blur.
- **Benefit:** No re-entry of scores, and fewer disputes about lost results.
- **Complexity:** S

### RNG-09: Qualification drills with firearm type "Any" (the form default) never count toward handgun currency
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Qualification readiness engine
- **Scenario:** A Range Master creates "Annual Handgun Qualification" and leaves the default firearm type "Any". Every officer passes, yet the Qualifications board shows them as "No Record" or "Overdue", and Training Alerts fire for all of them.
- **Evidence:**
  - page.tsx:1838-1839: the default `newDrillFirearmType` is `"Any"`.
  - qualification-readiness.ts:210: `firearmType: text(get(drill,"firearmType")) || undefined`, which gives "Any".
  - qualification-readiness.ts:372: `expectedFirearmType = normalized(scope.firearmType ?? "handgun")`.
  - qualification-readiness.ts:395-398: `if (expectedFirearmType && attempt.firearmType && normalized(attempt.firearmType) !== expectedFirearmType) { excluded.wrongFirearm += 1; return false; }`.
  - There is no test covering "Any".
  - A related risk: attempts are also excluded when the snapshot name (`"<drill name> - Day"`, page.tsx:1022) does not prefix-match the active agency standard name (qualification-readiness.ts:407-413).
- **Proposed correction:** Require a specific firearm type for qualification-category drills. Treat "Any" as "use the firearm actually used" (look up the result's `firearmId` type). Link the drill to a specific `department_qualification_standards.id` instead of matching names.
- **Benefit:** Currency status becomes trustworthy.
- **Complexity:** S

### RNG-10: A same-day remedial re-shoot cannot clear a "Failed" status
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Qualification readiness / remediation
- **Scenario:** An officer fails Day Qualification in the morning, gets coaching, and passes at 14:00 on the same Range Day, or on a separate "Remedial" day with the same date. The status stays **Failed**.
- **Evidence:**
  - qualification-readiness.ts:292-297: `return getDateValue(failure.date) >= getDateValue(relevantPass?.date);`. Equal dates mean the failure wins.
  - Attempts carry only the Range Day date (qualification-readiness.ts:184), and results have no timestamp field at all (range-day-types.ts:153-168).
  - The existing test only covers a failure **after** a pass on a different date (qualification-readiness.test.ts:114-116).
- **Proposed correction:** Record `recordedAt` (ISO timestamp) and `attemptNumber` per result. Order attempts by timestamp. Add a test for a failure then a pass on the same day.
- **Benefit:** Remediation outcomes appear immediately and correctly.
- **Complexity:** S

### RNG-11: Normalization on load can make every later autosave fail (data-dependent)
- **Classification:** Confirmed defect (code path confirmed; it triggers when legacy records exist)
- **Priority:** High
- **Module:** Workspace load and save
- **Scenario:** A department has a Completed day created before attendance modes existed. On load, the client adds `attendanceMode`, `outline`, `aar` and similar fields to that day. The next autosave changes a finalized day, the server returns 409, and every save for the department fails silently. A scorer-only user hits the same problem through library normalization (`defaultRunCount`), which returns 403.
- **Evidence:**
  - page.tsx:1123-1158: `normalizeRangeDaysForWorkspace` sets `attendanceMode`, `staffingNotes`, `outline`, `equipmentChecklist` and `aar`.
  - page.tsx:1093-1121: library and drill normalization rewrites `defaultRunCount` and `runCount`.
  - attendance-mode.ts:15-22: the comment "Existing days without a stored mode retain…" confirms legacy days lack the field.
  - workspace-mutation.ts:440: `if (!nextDay || !same(existingDay, nextDay)) return true;`.
  - workspace-mutation.ts:497-501: the planning-change check for scorers.
  - Editing a library template also rewrites unscored drills on finalized days (page.tsx:3657-3672 skips only `scoredDrillIds`), with the same effect.
- **Proposed correction:** Normalize for display only and never write normalized copies back. Have the server ignore finalized and protected collections in the PUT (or accept per-entity PATCH) instead of comparing the whole document.
- **Benefit:** One legacy record can no longer stop all range saving.
- **Complexity:** M

### RNG-12: Target-photo evidence is fragile: tied to transient result IDs, fails for imports and instructors, and goes missing after corrections
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** QualificationEvidence / QuickQualificationCamera / evidence API
- **Scenario:**
  1. An instructor saves a line and immediately taps the camera. The upload returns 404, because the 650 ms debounced PUT has not completed.
  2. On the Qualifications page, every **historical-import** row shows a "Target Evidence" panel that errors with "Qualification result not found".
  3. A score is corrected, which creates a new result ID. The photo stays linked to the old ID.
  4. A line instructor receives a permission error.
- **Evidence:**
  - page.tsx:6406-6408: `<QuickQualificationCamera qualificationResultId={existingResult?.id} />`. The result exists locally only.
  - evidence/route.ts:17-42 checks existence only in `pilot_range_workspaces.workspace.results`. GET does the same through read-repository-core.ts:11.
  - qualifications/page.tsx:791: `<QualificationEvidence qualificationResultId={event.id} />` is also rendered for historical events, whose IDs are `qualification_results` UUIDs.
  - evidence/route.ts:91: manage permission is required.
  - QualificationEvidence.tsx:232-239: the Archive button is shown to every viewer, and the server decides.
  - QuickQualificationCamera.tsx:357: the button is `h-8 w-8` (32 px).
- **Proposed correction:** Key evidence to a durable qualification or attempt ID. Queue photos locally and upload them after the result is confirmed on the server. Allow evidence on imported records or hide the panel for them. Allow `score_range_days` to upload. Compress images on the client. Hide Archive without permission. Make tap targets at least 44 px.
- **Benefit:** Photo evidence that holds up when a score is challenged.
- **Complexity:** M

### RNG-13: Concurrent instructors on separate devices lock each other out (last-writer conflict)
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Workspace concurrency
- **Scenario:** Two instructors score relays 1 and 2 on two tablets. Tablet A saves first. Tablet B's next save lacks A's results, so the server answers 409 "Saved scores … cannot be removed". Tablet B shows success but nothing it does is saved. When B reloads, its relay is lost.
- **Evidence:**
  - Every PUT sends the full document (page.tsx:2465-2481).
  - The server's optimistic check uses the `updated_at` it read itself moments earlier, not a version from the client (range-workspace/route.ts:128-176), so it only detects races inside the request.
  - Missing peer results cause `historicalEvidenceRemoved` to return 409 (workspace-mutation.ts:449-462). B's failure is swallowed (page.tsx:493-496).
  - The drill DELETE route rewrites the whole document with **no** concurrency guard (range-workspace/drills/route.ts:39-46), so it can wipe results saved in the meantime.
- **Proposed correction:** Use per-entity writes (results upserted by ID) or a client-supplied version with merge-and-retry, and add a concurrency guard to the drill DELETE. Pull other devices' changes periodically.
- **Benefit:** Real multi-instructor ranges work.
- **Complexity:** L

### RNG-14: No validation of score ranges or input types
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Scoring
- **Scenario:** "2400" is typed for a 250-point course and auto-passes. "-5" or "8o" is accepted, and the stored score becomes undefined while the result is still marked completed and passed (if Result was set manually).
- **Evidence:**
  - page.tsx:6458: `inputMode="decimal"`, with no min/max.
  - page.tsx:3397-3415: `Number(row.metricValue)`; a NaN is dropped silently.
  - page.tsx:646-652: the automatic pass is `numericValue >= drill.passingScore` with no `maxScore` check.
  - The drill form `type="number"` fields (page.tsx:5404-5440) also have no min or max.
- **Proposed correction:** Validate 0 ≤ score ≤ max, time > 0, and hits ≤ round count. Highlight invalid rows and block the save.
- **Benefit:** Prevents false passes caused by typos.
- **Complexity:** S

### RNG-15: The "Complete / Incomplete" toggle is ignored except for Completion drills, so DNFs are stored as completed
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Scoring
- **Scenario:** An officer stops partway through the qualification (injury, malfunction). The instructor toggles "Incomplete". The record still says completed, and with a score entered it can pass.
- **Evidence:**
  - page.tsx:3406-3409: `completed: scoringFormat === "Completion" ? row.completed ?? false : true`.
  - page.tsx:6516-6530: the toggle is shown for every format, and its default display is "Complete" (`row.completed ?? true`).
- **Proposed correction:** Respect `completed` for all formats. An incomplete qualification should mean not passed and be excluded from currency. Add a reason (malfunction, medical, alibi).
- **Benefit:** Accurate attempt records.
- **Complexity:** S

### RNG-16: Remediation is disconnected from the range and its records are weakly audited
- **Classification:** Verified usability problem
- **Priority:** High
- **Module:** Remediation (Training Alerts ↔ Range)
- **Scenario:** An officer fails qualification. The range page marks "Remediation recommended", but the Range Master cannot create a remediation (that needs `manage_training`). A training manager must find the alert separately. Marking remediation "Completed – Successful" closes the alert without any passing re-qualification on record. Alert status lives in that browser's localStorage.
- **Evidence:**
  - remediations/route.ts:37 and 81: `TRAINING_ALERTS_WORKFLOW_PERMISSIONS`. permissions.ts:43 lists `/api/pilot/remediations` under `manage_training`.
  - remediations/route.ts:101-116: the whole array is upserted with no concurrency check. The only audit row is a count (`remediation_count`).
  - TrainingAlertsClient.tsx:174-185 and 255-261: alert status and `auditLog` are kept in `localStorage`.
  - TrainingAlertsClient.tsx:407-430: "Completed - Successful" sets the outcome text and resolves the alert with no link to a range result.
  - Settings `qualification_failure_requires_remediation` and `remediation_due_days` have no consumer outside the settings panel (grep).
- **Proposed correction:** When a failed qualification is saved, create a remediation automatically (with a due date from the rule). Link it to the failed attempt. Close it only when a passing re-qualification attempt is linked. Store remediations as rows with an actor-stamped history. Let `manage_range_days` create and own range remediations.
- **Benefit:** A closed-loop, defensible failure-to-requalification record.
- **Complexity:** M

### RNG-17: The configured firearm failure-lockout policy is never enforced
- **Classification:** Confirmed defect
- **Priority:** High
- **Module:** Qualification policy
- **Scenario:** The agency enables "2 consecutive failures restricts officer/firearm" (it is enabled by default). An officer fails twice with the duty pistol and is still shown as authorized everywhere. Nothing displays or applies the restriction.
- **Evidence:**
  - 202608230002_firearm_failure_lockout_rules.sql:16-24 sets the default `"firearm_failure_lockout_enabled": true, "firearm_failure_lockout_threshold": 2`.
  - `src/lib/tracepoint/firearm-qualification-lockout.ts` (`evaluateFirearmQualificationAuthorization`) has **no importers and no tests**.
  - Rule keys such as `firearm_failure_lockout_enabled` and `require_rifle_qualification` are referenced only in `RangeQualificationRulesPanel.tsx`.
- **Proposed correction:** Evaluate authorization on result save and in the qualification, armory assignment and readiness views. Show a restriction badge and require supervisor release where the policy says so. Otherwise, hide the settings until they are implemented.
- **Benefit:** Policy settings match actual behavior, which avoids a liability exposure.
- **Complexity:** M

### RNG-18: No instructor certification or assignment check to run or score a range
- **Classification:** Potential gap requiring operational validation
- **Priority:** Medium
- **Module:** Range Day staffing
- **Scenario:** Any member with `score_range_days` (including supervisors and command by default) can score any day, whether or not they are listed instructors or hold a current firearms-instructor certification.
- **Evidence:**
  - A grep for `certif` in range-days/page.tsx returns nothing.
  - The lead instructor is any personnel record (`availableInstructorUsers = personnel.filter(...)`, page.tsx:2009-2015).
  - Results record `instructorId: currentUserId` (page.tsx:3435) without checking against `instructorIds`.
  - foundation.sql:311-342 grants `score_range_days` to supervisor, command_staff, chief and administrator.
- **Proposed correction:** Filter lead and assistant pickers by a current instructor certification from training certifications, warn or block when it has expired, and restrict scoring to assigned instructors (with an override and reason).
- **Benefit:** POST/standards compliance.
- **Complexity:** M

### RNG-19: Firearm serial numbers are missing wherever a firearm is identified on range and qualification screens
- **Classification:** Verified usability problem
- **Priority:** Medium
- **Module:** Scoring, roster, packet, Qualifications
- **Scenario:** An officer carries two Glock 17s (duty and backup). The roster and scoring select both show "Handgun — Glock 17". The printed packet cannot be checked against the weapon. The Qualifications page shows `Firearm 3f9c…` (a UUID).
- **Evidence:**
  - page.tsx:1354-1362: `return \`${formatRangeFirearmType(...)} — ${firearm.make} ${firearm.model}\``, with no serial or asset number.
  - qualifications/page.tsx:279-289: `getFirearmName` returns `` `Firearm ${firearmId}` ``.
  - The open-attendance label does include the asset or serial (open-attendance-firearms.ts:118-122), so the screens are inconsistent.
- **Proposed correction:** Show "Make Model · S/N xxxx (Asset #)" everywhere, including the packet and Qualifications (load the armory list there).
- **Benefit:** Confirms which weapon was qualified with, and a cleaner audit.
- **Complexity:** S

### RNG-20: Ammunition used at the range does not update ammunition inventory
- **Classification:** Potential gap requiring operational validation
- **Priority:** Medium
- **Module:** Range ↔ Ammunition
- **Scenario:** 30 officers × 2 components × 50 rounds = 3,000 rounds fired. Ammunition inventory is unchanged, and reconciliation must be done by hand in another module.
- **Evidence:** In the range page, the only ammunition references are the checklist item "Ammunition staged" (page.tsx:266) and a per-drill `roundCount` that appears on the printed packet (page.tsx:1679). There is no call to `/api/pilot/ammunition` and no lot selection.
- **Proposed correction:** Compute planned rounds (roundCount × runs × roster) during planning. At close-out, post a consumption transaction against a chosen lot, with an override for actual counts.
- **Benefit:** Accurate inventory and budgeting.
- **Complexity:** M

### RNG-21: The AAR becomes read-only once the day is closed; the tab order works against the real sequence
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** AAR / close-out
- **Scenario:** The Range Master closes the day at the range and writes the AAR back at the office. The AAR tab is disabled.
- **Evidence:**
  - page.tsx:7292: `aria-disabled={!canEditSelectedRangeDay} … pointer-events-none`.
  - `handleUpdateAar` → `updateSelectedRangeDay`, which returns when `!canEditSelectedRangeDay` (page.tsx:2833).
  - The server rejects any change to a finalized day's record (workspace-mutation.ts:440).
- **Proposed correction:** Allow AAR edits after close-out (a separate, append-only field with author and time), or make the AAR a required step in the close-out wizard.
- **Benefit:** Lessons-learned documentation actually gets captured.
- **Complexity:** S

### RNG-22: Removing an officer from the roster has no confirmation and deletes their results locally (the server rejects it, causing silent desync)
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Roster
- **Scenario:** A mis-tap on "Remove" next to "Mark Present" on a phone. The officer and all of their scores disappear from the screen immediately. The autosave is rejected (RNG-01 path), so the screen and the server now disagree.
- **Evidence:**
  - page.tsx:3106-3121: `setResults(current => current.filter(r => !(r.rangeDayId === … && r.officerId === entryToRemove.officerId)))`, with no `confirm`.
  - page.tsx:5180-5187: the Remove button sits beside the attendance toggle.
- **Proposed correction:** Add a confirmation. Block removal when results exist and offer "Mark absent / withdrawn" instead.
- **Benefit:** Prevents loss of the record from a single tap.
- **Complexity:** S

### RNG-23: Re-saving a line replaces each logged malfunction's type and notes with "Failure to Feed" / blank
- **Classification:** Confirmed defect
- **Priority:** Medium
- **Module:** Malfunction logging
- **Scenario:** A "Catastrophic Failure" is logged. Later the line is re-saved to add a note for another shooter. The malfunction is recreated as "Failure to Feed" with no notes, and `removedFromService` becomes false.
- **Evidence:**
  - page.tsx:2603-2608: pre-filled rows set `malfunctionOccurred: Boolean(existingResult?.malfunctionIds?.length), malfunctionType: "Failure to Feed", malfunctionNotes: ""`.
  - page.tsx:3478-3486: the old malfunctions linked to the replaced results are filtered out and new ones are created from the row.
- **Proposed correction:** Pre-fill from the existing malfunction record and update it in place. Treat malfunctions as their own entities that are not recreated when results change.
- **Benefit:** Keeps weapon failure history intact.
- **Complexity:** S

### RNG-24: Qualification status counts results from Range Days that are not closed
- **Classification:** Verified usability problem
- **Priority:** Medium
- **Module:** Qualifications
- **Scenario:** Day-1 scores entered on an In Progress day immediately make officers "Current". Scores entered on a mis-dated or future Planned day also count, dated by the planned date.
- **Evidence:** Neither qualification-readiness.ts:163-215 (`mapWorkspaceAttempts`) nor qualifications/page.tsx:452-489 checks the Range Day status. Only the date is used.
- **Proposed correction:** Count attempts only from closed (Completed or Locked) days, or label provisional results clearly. Use the actual attempt timestamp rather than the planned date.
- **Benefit:** The official status reflects verified results.
- **Complexity:** S

### RNG-25: Qualification detection relies on name matching ("qualification" in the name)
- **Classification:** Verified usability problem
- **Priority:** Medium
- **Module:** Drill library / readiness
- **Scenario:** A warm-up drill named "Pre-Qualification Warm-up" is forced into Qualification scoring with Day/Night components and counts toward currency. A course named "Annual Handgun Course" with category "Marksmanship" never counts. The Qualifications page also treats any drill containing "rifle" as a qualification event.
- **Evidence:**
  - page.tsx:587-592: `category === "Qualification" || name?.toLowerCase().includes("qualification")`.
  - page.tsx:603-608: "Qualification activities are always scored as qualifications", which overrides the configured `scoringFormat`.
  - qualifications/page.tsx:262-276 (`isRifleDrill`) and 456 (`if (!isQualificationDrill(drill) && !isRifleDrill(drill)) return null`).
- **Proposed correction:** Add an explicit `isQualification` flag plus a link to an agency standard. Stop inferring from names.
- **Benefit:** Predictable classification.
- **Complexity:** S

### RNG-26: Drill-level qualification components override the agency's official standards
- **Classification:** Potential gap requiring operational validation
- **Priority:** Medium
- **Module:** Drill library vs `department_qualification_standards`
- **Scenario:** The agency sets an official passing score of 80% in Settings. A Range Master's drill template has the default components (Points, pass 80, max 100) or edits them to 70. Range scoring uses the drill's 70, ignoring the agency standard.
- **Evidence:**
  - page.tsx:890-910: `if (configuredComponent) { return { standard: { id: \`drill:${drill.id}\` … } } }` takes precedence over the DB standards.
  - page.tsx:390-399: every qualification template gets default components (Day/Night, pass 80/100).
  - page.tsx:3388-3393: these are the source of the snapshot and `departmentStandardPassed`.
- **Proposed correction:** Pull thresholds from the agency standard (read-only in the drill). Allow drill-level overrides only with explicit permission and visible labeling.
- **Benefit:** A single source of truth for pass criteria.
- **Complexity:** M

### RNG-27: The audit trail is a whole-document snapshot, written roughly every 650 ms of editing
- **Classification:** Verified usability problem
- **Priority:** Medium
- **Module:** Audit / accountability
- **Scenario:** An internal-affairs review asks who changed Officer X's score on 3/14. The only evidence is a series of `pilot_range_workspaces update` audit rows, each containing the full previous and new JSON for every range day the department has ever run. They have to be diffed by hand. Result `instructorId` is overwritten by whoever re-saves the batch, and results carry no timestamp.
- **Evidence:**
  - 202609060002:183-186: `write_audit_event` trigger on `pilot_range_workspaces`.
  - 20260826173000:84-108: inserts `previous_value = to_jsonb(old)`, `new_value = to_jsonb(new)`.
  - The autosave fires on every state change (page.tsx:2465-2492), including keystrokes in the title or notes.
  - range-day-types.ts:153-168: no `recordedAt` or `updatedBy` on a result.
  - page.tsx:3435: `instructorId: currentUserId` is applied to every row in the batch.
- **Proposed correction:** Write per-result audit events (old and new value, actor, reason). Add `recordedAt`, `recordedBy`, `lastModifiedBy` and `lastModifiedAt`. Throttle or skip document-level audit snapshots for drafts.
- **Benefit:** A defensible chain of evidence and audit-table growth that stays under control.
- **Complexity:** M

### RNG-28: Every department member can read all range results, notes and deficiencies
- **Classification:** Potential gap requiring operational validation
- **Priority:** Medium
- **Module:** API authorization
- **Scenario:** A patrol officer with the Qualifications feature enabled can open `/qualifications`, or call `GET /api/pilot/range-workspace`, and see peers' scores, failures, "remediation recommended" flags and instructor notes.
- **Evidence:**
  - range-workspace/route.ts:59-74: the GET checks only the feature (`range_training || qualifications`), not a permission.
  - qualifications/route.ts:9-25: GET has no feature or permission check.
  - RLS `pilot_range_workspaces_select_members` uses `is_active_department_member` (202609060002:25-27).
  - Drill-document routes also skip the feature check (drill-library documents GET:21-31; view/download:7-27).
- **Proposed correction:** Restrict detailed results to range, qualification and supervisor permissions, give officers a view of their own record only, and add feature checks to the document routes.
- **Benefit:** Personnel-record privacy, and alignment with union and CBA expectations.
- **Complexity:** M

### RNG-29: Building a roster is one officer at a time, and scheduled mode has no shared or loaner firearm option
- **Classification:** Verified usability problem
- **Priority:** Medium
- **Module:** Roster
- **Scenario:** Rostering a 40-officer annual qualification takes about 80 select-and-click operations. A recruit with no issued firearm cannot be rostered with a range gun on a scheduled day; the planner must switch the whole day to Open attendance.
- **Evidence:**
  - page.tsx:5031-5054: a single `<select>` plus `Add Officer`.
  - page.tsx:3060-3080 (`handleAddOfficerToRoster`) adds one entry.
  - page.tsx:5100-5108: firearm chips are filtered to `active_assignment?.assigned_to_user_id === entry.officerId`. Shared firearms exist only in open attendance (open-attendance-firearms.ts:72-87).
- **Proposed correction:** Multi-select and "Add all due/overdue officers", "Add unit", and "Copy roster from previous day". Offer a shared-firearm picker in both modes.
- **Benefit:** Cuts planning time substantially.
- **Complexity:** M

### RNG-30: Mobile layout: stacked tabs, small text and small tap targets for gloved, outdoor use
- **Classification:** Verified usability problem
- **Priority:** Medium
- **Module:** Range Day UI
- **Scenario:** On a phone the 8 detail tabs stack into a single column (about 8 × 52 px) above the content. Much of the text is 10-12 px slate-500 on slate-900, which is hard to read in sunlight. Icon buttons are 26-32 px.
- **Evidence:**
  - page.tsx:4498: `grid gap-2 md:grid-cols-4 xl:grid-cols-8` (one column below `md`).
  - Labels use `text-[10px] … text-slate-600` throughout (for example page.tsx:6286-6289).
  - QuickQualificationCamera.tsx:357 `h-8 w-8`; QualificationEvidence.tsx:228-237 `p-1.5` icon buttons.
  - DrillDocuments.tsx:81 `p-1.5`.
  - The Save button label is replaced by `saveMessage`, which can be a long error text (page.tsx:4456-4458).
  - On the positive side, the mobile scoring cards use `py-3` and `text-[16px]` inputs and a sticky Save button (page.tsx:6455-6631).
- **Proposed correction:** Use a horizontally scrolling tab strip or a bottom tab bar on phones. Add a high-contrast "range mode" theme. Make tap targets at least 44 px. Show save status in a separate banner rather than in the button.
- **Benefit:** Fewer input errors on the line.
- **Complexity:** S

### RNG-31: Drill library is reachable only inside a Range Day; template edits overwrite authorship and are not versioned
- **Classification:** Verified usability problem
- **Priority:** Low
- **Module:** Drill library
- **Scenario:** To revise the agency's course of fire, the Range Master must open (or create) a range day and then go to Drills → Add Drill. Saving an edit replaces `createdAt` and `createdByUserId` with the editor's, and changes matching drills on other days by **name and category**, including unrelated days.
- **Evidence:**
  - The library panel renders only in the selected-day view (page.tsx:5275, after the list view returns at page.tsx:3816).
  - page.tsx:3622-3634: `savedTemplate = {...createdTemplate, id, status}`, where `createdTemplate` comes from `createDrillLibraryTemplate({... createdByUserId: currentUserId})`.
  - page.tsx:3658-3665: matching on `drill.name === existingTemplate?.name && drill.category === …`.
- **Proposed correction:** Add a standalone Drill Library page and template versioning (version stamped on each Range Day drill). Propagate edits only by `sourceTemplateId`, and only to days the user selects.
- **Benefit:** Controlled course-of-fire changes.
- **Complexity:** M

### RNG-32: Drill documents are hard-deleted without versioning; an upload error can leave the UI stuck
- **Classification:** Confirmed defect
- **Priority:** Low
- **Module:** DrillDocuments
- **Scenario:** A Range Master deletes an outdated course diagram that past qualifications were shot against, and the file and its row are gone. Separately, on a flaky connection an upload throws a network error and the button stays "Working…" until the page is reloaded.
- **Evidence:**
  - drill-documents/[documentId]/route.ts:95-99 removes the object and then `.delete()`s the row. Compare the qualification evidence "archive" (QualificationEvidence.tsx:103-111).
  - DrillDocuments.tsx:38-47: `setBusy(true); … await fetch(...)` with no try/finally, so a thrown fetch leaves `busy` true. `remove` has the same problem (lines 49-57).
  - Uploading to a template created moments ago returns 404 until autosave lands (route.ts:42-44 `verifyTemplate` reads the server workspace).
  - PDFs are shown in an `<iframe>`, which renders poorly on iOS Safari.
- **Proposed correction:** Archive instead of deleting, and keep versions. Wrap the fetches in try/finally. Queue uploads until the template is saved on the server.
- **Benefit:** Course-of-fire records stay intact.
- **Complexity:** S

### RNG-33: The printed packet is the only offline fallback, and its results must be re-typed
- **Classification:** Optional improvement
- **Priority:** Low
- **Module:** Packet
- **Scenario:** The connection is poor, so instructors use paper score sheets and later type every score into the scoring board (duplicate entry, with transcription risk). The packet also lacks serial numbers (RNG-19).
- **Evidence:** page.tsx:3497-3511 (`handleGeneratePacket` → `console.log("Generated range packet:", packet)` → `window.print()`). There is no import or scan path back into results.
- **Proposed correction:** Add a "Bulk entry from packet" grid with keyboard-only navigation, or an OCR or CSV import. Remove the `console.log`, which leaks the packet to the console.
- **Benefit:** Less duplicate data entry.
- **Complexity:** M

### RNG-34: `workspace-write-policy.ts` is dead code with its own tests; the rules are duplicated in three places
- **Classification:** Optional improvement
- **Priority:** Low
- **Module:** `src/lib/range`
- **Evidence:**
  - `validateWorkspaceWrite` (workspace-write-policy.ts:8) has no importers; only workspace-write-policy.test.ts uses it.
  - The production path uses `authorizeRangeWorkspaceMutation` (workspace-mutation.ts:465).
  - The DB trigger repeats the rules, but skips them entirely for `service_role` (202609060002:87), which is how every API write connects. Enforcement therefore rests only on the TypeScript check.
- **Proposed correction:** Delete the dead module. Keep one rule implementation, tested against the actual route.
- **Complexity:** S

### RNG-35: Stale page copies are committed at the repository root
- **Classification:** Optional improvement
- **Priority:** Low
- **Module:** Repository hygiene
- **Evidence:**
  - `range-days-page.txt` (5,563 lines) compared with `src/app/range-days/page.tsx` (7,415 lines): about 3,186 differing lines. The `.txt` imports `MOCK_FIREARMS, MOCK_USERS` from `@/app/lib/tracepoint/mock-data` (line 55-57), a module that no longer exists, and has none of the permission gating, attendance-mode or drill-removal code.
  - `qualifications-page.txt` (1,171 lines) is an older version that uses `DEMO_DEPARTMENT, MOCK_FIREARMS, MOCK_USERS` and lacks `evaluateCanonicalQualificationReadiness`, historical results and evidence.
  - Both were last touched in commit `e5efa02`. They are excluded from Docker builds (`.dockerignore: *.txt`), so there is no runtime impact.
  - Similar stale files: `command-dashboard-page.txt`, `training-alerts-client.txt`, `tracepoint-auth.txt`, `current-user.txt`, and many `src/app/settings/import-export/page.tsx.before-*` backups inside the app tree.
- **Proposed correction:** Delete them. Git history already preserves prior versions. They mislead reviewers and grep-based audits (for example, my searches for "malfunction" matched them).
- **Complexity:** S

### RNG-36: Test coverage misses every high-risk path
- **Classification:** Verified usability problem (quality risk)
- **Priority:** Medium
- **Module:** Tests
- **Evidence:**
  - The existing tests cover pure helpers: attendance mode, open-attendance pickers, drill removal, the mutation authorizer, history-repository mapping, drill-document validation, and readiness ordering.
  - Not covered: `handleSaveBatchResults` (IDs, replacement, malfunction pre-fill), the autosave and failure path, normalization on load (RNG-11), evidence routes, the "Any" firearm type (RNG-09), a same-day fail then pass (RNG-10), the lockout evaluator (RNG-17), the remediation PUT, and the performance summary with an empty relational source.
  - All scoring logic lives inside the 7,400-line client component, which cannot be unit-tested without extraction.
- **Proposed correction:** Extract the scoring and persistence logic into `src/lib/range` and add tests for the scenarios above. Add an end-to-end test for "score, correct, reload, still saved".
- **Complexity:** M

---

## 4. Cross-module integration gaps and terminology

### Integration gaps

| From → To | Expected | Actual (code) |
|---|---|---|
| Range result → `qualification_results` | Close-out writes official qualification rows with `expires_on`, firearm and range day | Never written; only the historical import writes them (RNG-06) |
| Range result → command dashboard and analytics drill trends | Trends, upcoming days and packet counts | Read from empty relational tables (RNG-06) |
| Range malfunction → Armory firearm status and armorer notification | Out of service / inspection required, with status history | JSON flag only; armory unaware; dashboard flag never clears (RNG-05) |
| Range ammunition → ammunition inventory | Consumption transaction | None (RNG-20) |
| Failed qualification → remediation | Auto-created, linked, closed by a passing re-qualification | Manual, separate permission, not linked (RNG-16) |
| Failure threshold → officer/firearm restriction | Enforced per policy | Policy configurable but never evaluated (RNG-17) |
| Instructor certification → Range Day staffing and scoring | Required and current | Not checked (RNG-18) |
| Agency qualification standards → range pass thresholds | Single source of truth | Drill-level components override them (RNG-26) |
| Evidence → qualification record | Durable link | Linked to transient workspace result IDs; fails for imports (RNG-12) |
| Qualification readiness → notifications | Uses workspace + `qualification_results` | Integrated (notifications/route.ts:963-1010 uses range payload and history), but inherits RNG-09, RNG-10 and RNG-24 |

### Terminology inconsistencies
- **Run / Course / Component / String:** the scoring select is labeled "Run / Course" (page.tsx:6304). Qualification parts are "components" in the drill form and the agency standards, displayed as "Day Qualification"/"Night Qualification" or the component name. The packet says "Run". The Qualifications page only knows "Day/Night Qualification" and ignores custom component names (qualifications/page.tsx:292-299).
- **Roster vs Attendance vs Current shooters:** the tab is "Roster" or "Attendance / Manage" depending on mode. The scoring header says "attending officer(s)" or "current shooter(s)".
- **Packet status "Ready"** means both "ready to print" (list stat card) and "finalized" (lock logic) (RNG-03).
- **Status vocabulary differs between modules:** Range Day uses Planned / In Progress / Completed / Locked / Archived (there is no "Cancelled"). Qualifications use "Overdue", while the performance summary and dashboard rename it **"Expired"** (performance-summary/route.ts:168).
- **"Department Standard" vs "Qualification Standard":** drill-level "department standard" fields (page.tsx:93-105) duplicate the separate `department_qualification_standards` table, and both appear in snapshots as `departmentStandardName`.
- **"Saved" pill** means "in local state", not "saved to server" (page.tsx:6400-6404).
- **Archive:** qualification evidence and drill-library templates are archived reversibly, drill documents are hard-deleted, and Range Day "Archive" is a permanent lock whose "Restore" path cannot be reached.
- **Permissions naming:** the Settings description for `score_range_days` says "Enter and update drill and qualification results", but updating a saved result is effectively impossible (RNG-01) and attendance is excluded (RNG-07).
