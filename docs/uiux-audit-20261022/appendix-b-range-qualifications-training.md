> **Appendix to the [TracePoint UI/UX audit](README.md).** Baseline: release candidate `origin/claude/integration-defects-20261020` @ 5b6cc00 ("RC"). Unless stated, `path:line` references point into that tree (`src/...`). "OA" is the operational defect audit on `origin/claude/tracepoint-operational-audit-w567t8` (`docs/operational-audit-20261020/`). First-pass IDs were assigned against `origin/main` and are kept for traceability.

# Group B: Range, Qualifications & Training (UI/UX audit, read-only) — re-verified against the release candidate

**Baseline:** RC = `origin/claude/integration-defects-20261020` @ 5b6cc00 (candidate merge 5b9ec98), extracted to `<RC>/src`. **Every `path:line` below points into that RC tree** (`app/...` = `rc/src/app/...`, `lib/...` = `rc/src/lib/...`). The first pass (`B-range-training.md`) was written against `origin/main` (2026-10-07). Remediation notes are cited as `docs/remediation/<file>` under `rc/`. The operational audit (OA) is cited by ID (RNG-xx = appendix B, TRN-xx = appendix C).

Nothing was checked in a running app. **[Source-evident]** means the code clearly renders or behaves this way. **[Suspected]** means it needs live confirmation.

OA ref notation: `= RNG-03` means the OA records the same issue (our report defers to it and only adds the UX angle). `~ RNG-04` means related or overlapping.

---

## Re-baseline summary

**First-pass findings (B-01 to B-68): 68.**

| RC status | Count | IDs |
|---|---|---|
| Fixed in RC | 4 | B-06, B-10, B-22, B-54 |
| Partly fixed | 10 | B-01, B-02, B-04, B-07, B-11, B-17, B-21, B-42, B-50, B-51 |
| Present | 54 | all others |
| Obsolete | 0 | — |

- **34** first-pass findings have an OA ID reference: 19 are duplicates (`=`) and 15 are related (`~`). B-36 and B-47 also overlap the OA terminology tables, which have no IDs.
- **New RC findings:** B-69 to B-78 (10 findings). Two are High: B-69 and B-70. Four are Medium (B-71, B-74, B-75, B-78), and four are Low (B-72, B-73, B-76, B-77). None is Critical.

**What changed in scope in the RC:**
- **B3 (range save integrity):**
  - New serialized save queue (`lib/range/workspace-autosave.ts`) with a visible "Saving… / Saved / Save failed: … Retry" status (`app/range-days/page.tsx:3896-3927`). It appears in the list header, the day header and next to both batch-save buttons.
  - Optimistic concurrency (`baseUpdatedAt`), with a "Reload" prompt when the workspace is stale.
  - Packet "Ready" no longer locks the day.
  - Completed, Locked and Archived now ask for confirmation through a native `confirm`.
  - Re-saving a run keeps result and malfunction IDs.
  - Unsaved typed rows survive a roster rebuild.
  - Roster removal asks for confirmation and keeps the officer's results.
- **B10:**
  - Scorers (the default Instructor role) can mark attendance and add walk-ups.
  - Evidence upload is allowed for scorers.
  - The server rejects impossible scores with 400.
  - The Complete/Incomplete toggle now applies to every scoring format.
  - "Any"-firearm drills match the agency standard.
- **B7:**
  - Event times are shown in the department time zone, and the editor labels show the zone.
  - The editor has a new "Certification issued at closeout" select.
  - Choosing an outcome no longer forces Present, and the server now rejects Completed/Passed without Present.
  - Complete Event is blocked while the roster is dirty.
  - The server refuses to remove recorded attendees (409).
  - Certification dates are validated, and the officer field is locked when editing.
- **TV (record visibility):** users without the matching permission now get only their own rows on Range Days, Qualifications, Certifications and the Agency Training roster. The Qualifications page then lists only the caller.
- **DC (date contract):** a shared `formatDate` is used on Range Days, Qualifications, Certifications and Evidence. Certification expiry no longer shows raw ISO text.
- **Unchanged in the RC:**
  - `TrainingAlertsClient.tsx`, the `/training` hub, Analytics `page.tsx`, `DrillDocuments.tsx` and `QuickQualificationCamera.tsx`.
  - `RangeQualificationRulesPanel.tsx` changed only its data transport (Supabase client → `/api/settings/visual-configuration`). There is no UX change.

---

## Range Days (`/range-days`)

### Screens inspected (RC line numbers)
- `/range-days` list/overview: `app/range-days/page.tsx:3928-4300`. The list header now carries the save status (`:3957`ff, `{workspaceSaveStatus}`).
- `/range-days` → selected day:
  - Header (Print Packet, Save Range Day + save status): `:4515-4644`.
  - Overview `:4647-5016`, Readiness `:5018-5129`, Roster/"Attendance / Manage" `:5131-5310`, Drills/Library/Template editor `:5312-6106`, Equipment `:6108-6207`.
  - **Scoring board** `:6209-7180`: mobile cards `:6457-6752`, sticky save + status `:6741-6751`, desktop grid `:6756-7111`, footer save + status `:7113-7177`.
  - Results `:7182-7409`, AAR `:7412-7506`.
- Printable packet: `:1510-1790`, `:4307-4513`.
- The page is now 7,536 lines. RC logic was moved into `lib/range/workspace-autosave.ts`, `workspace-client-state.ts` and `scoring-rules.ts`.

### Observed patterns (RC)
- **Persistence:**
  - Every change still writes the whole workspace to `localStorage` and queues a whole-workspace `PUT` 650 ms later (`:2490-2505` → `queueRangeDayWorkspaceSave`).
  - The queue serializes saves and always sends the newest snapshot (`lib/range/workspace-autosave.ts:11-23`).
  - The PUT carries `baseUpdatedAt` (`:498`). A `stale_workspace` 409 shows the server's sentence plus **Reload** (`:3898-3907`). Any other failure shows "Save failed: \<server message\>" plus **Retry** (`:3913-3923`).
  - All status text is 11px (`:3897`).
- **Finalized state:**
  - Only Completed, Locked or Archived finalize the day (`:1969-1971`).
  - Reaching those statuses now goes through `window.confirm` (`:2943-2947`, used at `:2961` and in the Status select `:4690-4707`).
  - The editable tabs are still wrapped in `pointer-events-none opacity-70` (`:4648`, `:6109`, `:6210`, `:7413`). There is still no lock banner and no unlock.
- **Roles:**
  - New `canTakeSelectedRangeDayAttendance` (manage or score, day not final) gates the Roster tab and Mark Present (`:1973-1974`, `:5132`, `:3213`).
  - Add Officer, firearm chips and Remove are disabled for scorers (`:5145-5173`, `:5244`, `:5297-5304`).
- Local `StatusPill`/`StatCard` remain (`:1401`, `:1425`). Labels are still mostly not tied to inputs. No `dark:` variants.

### Findings

| ID | RC status | OA ref | Screen | Finding | Type | Impact | Evidence (RC) | Label | Recommendation | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| B-01 | Partly fixed | = RNG-01 (hidden-failure part); ~ RNG-02 | `/range-days` → any tab | **Fixed:** remote save failures are no longer silent. A status shows Saving…, then Saved only after the server confirms, or Save failed with Retry. It appears in the list header, the day header and next to both scoring Save buttons. **Still present:** (a) the per-officer **"Saved" pill still means "the result exists in local state"**, so it stays green while the server rejects the save. It also stays green for a row the instructor has edited but not re-saved, because B3 now keeps those dirty rows. (b) The status is a small 11px line, and "Save failed" is amber, not red. (c) The batch message now says "N officer results **recorded**", which is accurate, but it still occupies the header Save button label. | Functional defect | High (was Critical) | Status `app/range-days/page.tsx:3896-3927`, used at `:3957`, `:4572`, `:6750`, `:7175`; queue `lib/range/workspace-autosave.ts:11-60`; pill `:6517-6521` (`existingResult ? "Saved" : "Not Saved"`); message `:3568-3572` | Source-evident | Make the per-row pill reflect sync state ("Saved" only when the server has this version; "Edited" for dirty rows; "Not synced" on failure). Show save failure as a prominent red banner, not an 11px line. | S |
| B-02 | Partly fixed | = RNG-13 | `/range-days` (multi-instructor) | **Fixed:** a stale whole-workspace write is now refused (`stale_workspace`) instead of silently overwriting another device. **Still present:** there is no merge. Two instructors scoring at once means the second one is told to **Reload**, and that loses their pending edits (see B-70). Every save is still the whole department workspace. | Functional defect | Medium (was Critical) | `:466`, `:498`, `:502-507` (`StaleRangeWorkspaceError`); Reload `:3898-3907`; `docs/remediation/B3-range-save-integrity.md` "Deferred: two-device concurrent scoring … no merge" | Source-evident | Merge results per officer/run on the server, or save per result. Until then, warn before scoring that another device has the day open. | L |
| B-03 | Present | ~ RNG-02 | `/range-days` → load | **Stale offline copy can still overwrite the server.** If the workspace GET fails, the page falls back to `localStorage`. `rangeWorkspaceBaseUpdatedAt` then stays `undefined`, and `JSON.stringify` drops the key, so the PUT carries **no base version**. The server only runs the stale check when a base is present. The new stale-write protection is therefore off in exactly the riskiest case. Autosave also sends the local normalized copies, because no load baseline was recorded. The server still refuses to delete saved results, but planning edits (days, drills, library) in the stale copy are accepted. Nothing tells the user they are looking at an offline copy. | Functional defect | High (was Critical) | Fallback `:2416-2417` (`remoteWorkspace ?? loadStoredRangeDayWorkspace()`); the base is set only on a successful GET `:486`; the base is undefined on failure `:479`, `:489-491`; the baseline is set only in `if (remoteWorkspace)` `:2419-2427`; autosave `:2493`; B3 doc: "If it is absent, behaviour is unchanged" | Source-evident (base missing); Suspected (field frequency) | When the GET failed, show "Offline copy from \<time\>" and don't autosave until a fresh GET succeeds, or send a sentinel base that forces a conflict. | S |
| B-04 | Partly fixed | = RNG-08 | `/range-days` → Scoring | **Fixed:** adding a walk-up or a roster or workspace change no longer wipes typed scores (`preserveUnsavedBatchRows`). **Still present:** changing the **Drill or Run select** (or the day) clears the unsaved set and rebuilds the rows from saved results. Typed scores are discarded with no "unsaved scores" warning. Draft rows are still not persisted, so a reload loses them. | Functional defect | Medium (was Critical) | Context reset `:2566-2571`, `:2559-2562`; merge `:2647-2649`; drill/run selects `:6400-6433`, no dirty check | Source-evident | Confirm before a drill/run switch when `unsavedBatchOfficerIds` is non-empty. Persist draft rows per day/drill/run. | S |
| B-05 | Present | ~ RNG-15 | `/range-days` → Scoring, "Completion" drills | The Complete/Incomplete toggle still **displays "Complete" by default** (`row.completed ?? true`), but `completed` stays `undefined` until it is tapped. For a Completion drill, an untouched row is not saved at all ("0 officer results recorded"). With a note typed, `resolveRunCompletion` stores it as **not completed** (Completion defaults to incomplete). RNG-15's fix made the toggle apply to all formats, but it did not fix this display/save mismatch. **New side effect:** on any format, "Incomplete" now forces the saved result to Fail, while the card's Result select and the standard chip can still show "Pass"/"Met". | Functional defect | Critical | Display `:6633-6648`, `:7005-7020`; prefill leaves `undefined` `:2628-2631`; hasEntry `:3409-3416`; `lib/range/scoring-rules.ts:6-17` (`completed ?? scoringFormat !== "Completion"`) | Source-evident | Prefill `completed` from `resolveRunCompletion` so that what's shown equals what's saved, or use a tri-state "Not recorded / Complete / Incomplete". Show "Incomplete → Fail" in the Result column. | S |
| B-06 | Fixed in RC | = RNG-03 | `/range-days` → Packet Status | "Ready" no longer finalizes or locks the day, in the page, the API and DB migration 042. | — | — | `:1969-1971`; list Archive `:4141`; `docs/remediation/B3-range-save-integrity.md` (RNG-03) | Source-evident | — | — |
| B-07 | Partly fixed | = RNG-04 | `/range-days` → Overview "Status" select / Archive | **Fixed:** choosing Completed, Locked or Archived now asks for confirmation. **Still present:** the confirmation is a native `window.confirm` that warns the lock applies "even to an administrator" but gives no summary (unscored officers, missing photos, AAR not written). Terminal statuses are still options in the same plain select as Planned and In Progress. There is still no reopen (amendment deferred). | Usability | Medium (was High) | `:2943-2947`; select `:4690-4707`; `RANGE_STATUSES` options unchanged; B3 doc "Deferred: amendment / unlock path" | Source-evident | Replace it with a "Finalize range day" step that shows a summary in an in-app dialog, and keep terminal statuses out of the select. | M |
| B-08 | Present | ~ RNG-04 | `/range-days` → finalized day | Scores still cannot be corrected after finalization, and there is no lock banner or explanation. Controls are just dimmed. The confirmation text now says it is permanent, but once the day is closed, nothing on screen says so. | Usability | High | Wrappers `:4648`, `:6210`, `:7413`; Results `:7182-7409` has no edit control | Source-evident | Add a "Finalized on … by …" banner and a "Request correction" path. (The reopen capability belongs to RNG-04.) | M |
| B-09 | Present | = RNG-21 | `/range-days` → AAR | The AAR is still locked once the day is Completed. The new finalize confirmation even lists "the after-action report" as locked. | Functional defect | High | `:7413`; confirm text `:2946` | Source-evident | (OA owns the fix.) UX angle: at minimum, prompt for the AAR inside the finalize step. | S |
| B-10 | Fixed in RC | = RNG-22 | `/range-days` → Roster "Remove" | Removal now asks for confirmation with a result count, and saved results are kept. Residual: it uses native `confirm` (see B-35). | — | — | `:3178-3196` | Source-evident | — | — |
| B-11 | Partly fixed | ~ RNG-30 | `/range-days` → Scoring (mobile) | **Fixed:** the sync status now renders under the sticky "Save Run N" (`:6750`). **Still present:** *validation* messages ("Select a firearm before saving results for: …", "Mark at least one rostered officer present…", "Results were not saved. Review the selected firearms.") and the success message still go only into the **header** Save button label, which is off-screen on a phone, plus an `sr-only` region. | Usability | Medium (was High) | Messages `:3311`, `:3342`, `:3393`, `:3568`; rendered `:4571`, `:4574` | Source-evident | Render `saveMessage` next to the sticky save too, and highlight the blocking officer cards. | S |
| B-12 | Present | ~ RNG-30 | `/range-days` → header Save button | `saveMessage` still replaces the Save button's label (long errors, "N officer results recorded…", "Removing drill…"). It only clears on the next explicit Save Range Day click. The new status line next to it is the right pattern, so now there are two status channels. | Usability | Medium | `:4566-4574`; the only reset is `:3025` | Source-evident | Fixed label; route all messages to the status area. | S |
| B-13 | Present | — | `/range-days` → Scoring | There are still two Save buttons on mobile: the sticky one (never disabled) and the footer "Save All", which is disabled when firearms are missing. | Usability | Medium | Sticky `:6741-6749` (no `disabled`); footer `:7162-7174` | Source-evident | One save per breakpoint with the same rules. | S |
| B-14 | Present | = RNG-30 | `/range-days` → tabs (phone) | The 8 tabs still stack one per row below `md`, under 6 stat cards. | Usability | High | `:4614`; stat cards `:4578-4610` | Source-evident | (OA owns.) UX angle: make Score the first tab while In Progress. | S |
| B-15 | Present | — | `/range-days` → Scoring | No "Save & next run". Drill/run options show no completion counts. No "unscored only" filter or name search. | Usability | Medium | Selects `:6400-6433`; cards in roster order `:6467`; save handler `:3552-3572` | Source-evident | As first pass. | M |
| B-16 | Present | — | `/range-days` → Scoring "Result" select | The automatic Pass/Fail is still written into `row.passed` while typing, so a manual override is silently replaced on the next edit. Override and auto look the same. RC adds a second hidden rule: Incomplete forces Fail at save (see B-05). | Functional defect | High | `:3272-3299`; select `:6605-6626`; save `:3443-3449` | Source-evident | Store the override separately and show "Auto: Pass" vs "Override: Fail". | S |
| B-17 | Partly fixed | = RNG-14 | `/range-days` → Scoring numeric entry | **Fixed (server):** impossible score, time or hit values are now refused with 400 and a message. **Still present (UX):** nothing is validated inline. The bad value is accepted, the row turns "Saved", and the error appears only later as "Save failed: Score 61 … is above the maximum of 60" in the status line, without naming the row (see B-69). The desktop/tablet input still has no `inputMode` or `aria-label`. | Functional defect | Medium (was High) | Mobile `:6574-6575`; desktop `:6946-6967`; B10 doc RNG-14 | Source-evident | Validate inline (red border + message), block the batch save, and add `inputMode` and `aria-label` on desktop. | S |
| B-18 | Present | ~ RNG-30 | `/range-days` → Scoring (lg+ tablets) | Desktop grid `min-w-[1040px]`. 10px firearm select. Targets about 28-32px. | Usability | Medium | `:6756-6768`, `:6859-6861`; select `:6899-6903` | Source-evident | As first pass. | M |
| B-19 | Present | — | `/range-days` → Scoring (phone) | The department standard (Met/Failed/Pending) is still shown only in the desktop grid. | Usability | Medium | Desktop `:7022-7043`; mobile card `:6499-6737` | Source-evident | Add a standard chip to the card header. | S |
| B-20 | Present | ~ RNG-12, ~ RNG-30 | `/range-days` → Scoring, target photos | Still two photo flows per card. The 32px camera icon still renders for non-qualification drills and uses `window.alert`. | Usability | Medium | `:6523-6525`, `:6874-6883`; `app/components/QuickQualificationCamera.tsx:20-27`, `:108` | Source-evident | As first pass. | S |
| B-21 | Partly fixed | = RNG-12 | `/range-days` → re-saving a scored run | **Fixed:** a re-save keeps the result ID, so photos stay attached. The evidence route also finds imported results. **Still present:** the camera is enabled as soon as the result exists *locally*, so a photo taken before the autosave confirms still gets "Qualification result not found". The B10 doc lists this as a residual ("retrying works"), and the user isn't told to wait for "Saved". | Functional defect | Low (was High) | `:3420-3433` (`existingResult?.id ?? …`); camera `:6523`; `docs/remediation/B10-qualification-range-roles.md` "Deferred … Evidence" | Source-evident | Enable capture only when the save status is "Saved" for that row. | S |
| B-22 | Fixed in RC | = RNG-07 | `/range-days` → Scoring (scorer role) | Scorers can now mark attendance (Roster tab) and add walk-ups. Residual: see B-73. | — | — | `:1973-1974`, `:1993-1994`, `:3213`, `:5132` | Source-evident | — | — |
| B-23 | Present | = RNG-29 | `/range-days` → Roster | Still one officer at a time, one "Mark Present" per officer. | Usability | Medium | `:5145-5173`, `:5285-5296` | Source-evident | (OA owns; deferred.) UX angle: reuse the Agency Training multi-select. | M |
| B-24 | Present | ~ RNG-02 | `/range-days` → list | Still no loading state: an empty "No range days match those filters." with zeroed stats. The load is still gated on `currentUserId`. The new save status shows nothing until a save runs. | Functional defect | High | Initial state `:294-297`; `if (!currentUserId) return;` `:2411`; empty state `:4282-4292` | Source-evident | Skeleton + error/offline state. | S |
| B-25 | Present | — | `/range-days` → "New Range Day" | One click still creates and saves a real record. There is no delete, only Archive. | Usability | Medium | `handleCreateRangeDay` `:2807`ff | Source-evident | As first pass. | S |
| B-26 | Present | — | `/range-days` → list card Archive | The Archive button is still nested inside a `role="button"` card, with no confirmation for *Restore*. Archive itself now confirms through `window.confirm`. | Usability | Low | `:4101-4159` | Source-evident | As first pass. | S |
| B-27 | Present | — | `/range-days` → list | The cards are still very tall, and "Lead:" appears twice. | Usability | Low | `:4177-4275` (`:4189-4192`, `:4215-4218`) | Source-evident | As first pass. | S |
| B-28 | Present | — | `/range-days` → Overview | Start/End are still free text ("0800"). The Lead select lists all personnel. | Usability | Low | `:4710-4738`; `:4891-4901` | Source-evident | As first pass. | S |
| B-29 | Present | — | `/range-days` → forms | Labels are still not programmatically tied to inputs, and the flip-text toggles have no `aria-pressed`. | Usability (a11y) | Medium | e.g. `:4664-4674`, `:7428-7440`; toggles `:5958-5988` | Source-evident | As first pass. | M |
| B-30 | Present | = RNG-31 | `/range-days` → Drills → Library | The library and template editor are still three levels deep inside a day. Archived templates are mixed in, with no search. | Usability | Medium | `:5325-5333`, `:5391-5417`, `:6013-6103`; `:6081` | Source-evident | (OA owns.) UX angle: searchable picker that hides archived templates and marks drills already added. | M |
| B-31 | Present | = RNG-25 | `/range-days` → Drill template | A name containing "qualification" still forces the Qualification format. | Functional defect | Medium | `:595-616` (`:598`) | Source-evident | (OA owns.) UX angle: show the effective format in the editor. | S |
| B-32 | Present | — | `/range-days` → Library card | Library cards still show the legacy `defaultScoringMode` labels. | Aesthetic / terminology | Low | `:6039-6042` vs `:5366` | Source-evident | As first pass. | S |
| B-33 | Present | — | `/range-days` → Results | The Performance Summary officer still comes from the Roster-tab selection, and the standard label still uses the scoring tab's drill. RC adds: officers removed from the roster now keep results (B-10 fix) but can't be selected here. | Functional defect | Medium | `:7192-7200`; `:7383-7391` | Source-evident | As first pass. | S |
| B-34 | Present | — | `/range-days` → AAR | The roadmap placeholder copy ("Later, TracePoint can mine AARs…") is still there. | Aesthetic / terminology | Low | `:7489-7499` (`:7497`) | Source-evident | Remove. | S |
| B-35 | Present | — | `/range-days` → native dialogs | Native dialogs are now **more** common: firearm mismatch `:3379`, drill removal `:3864`, plus new finalize `:2945` and roster removal `:3188`. | Usability | Low | lines cited | Source-evident | Shared ConfirmDialog. | S |
| B-36 | Present | ~ OA App. B §4 terminology (no ID) | `/range-days` → header/terminology | H1/activePage "Range & Training" vs nav "Range Days". "Attendance / Manage" vs "Roster & Firearms". "current shooter(s)" vs "attending officer(s)". | Usability / terminology | Low | `:3947`, `:4516`, `:4527`, `:4620`, `:5136`, `:6224-6225` | Source-evident | As first pass. | S |
| B-37 | Present | — | `/range-days` → Print Packet | Still logs the packet to the console and doesn't record that it was printed. | Usability | Low | `:3576-3590` (`:3579`) | Source-evident | As first pass. | S |
| B-38 | Present | = RNG-29 | `/range-days` → Roster firearms | A scheduled-mode officer without an assigned weapon is still stuck with no loaner option. | Usability | Medium | `:5211-5278`; open-mode `:6357-6388` | Source-evident | (OA owns.) | M |
| B-39 | Present | — | `/range-days` → personnel message | "N department personnel records available." is still shown in blue. | Aesthetic | Low | `:2386-2392`, `:5143` | Source-evident | As first pass. | S |
| B-69 | **New** | ~ RNG-14, ~ RNG-01 | `/range-days` → any save | **One rejected change stalls all syncing, and the user can't see which row caused it.** The queue always sends the full newest snapshot. If the server refuses part of it (a score above the maximum under B10, or a 403/409 rule), every later autosave carries the same bad record and fails too. Everything else typed meanwhile (other runs, other officers, planning edits) stays local only. The only signal is the 11px amber "Save failed: …" line. The offending officer card keeps its green "Saved" pill, nothing scrolls to it or highlights it, and Retry resends the same failing snapshot. | Functional defect | High | Queue `lib/range/workspace-autosave.ts:11-23` (newest snapshot replaces pending), `:39-55`; status `app/range-days/page.tsx:3913-3923`; pill `:6517-6521`; server 400 on new or changed results: `docs/remediation/B10-qualification-range-roles.md` (RNG-14) | Source-evident (mechanism); Suspected (frequency) | Validate inline before saving (B-17). When a save fails on a specific result, mark that row "Not synced" with the server message, and keep a red banner up until it is resolved. | M |
| B-70 | **New** | ~ RNG-13, ~ RNG-02 | `/range-days` → "changed on another device" → Reload | The stale-workspace prompt's only action is **Reload** (`window.location.reload()`). There is no warning that unsaved typed scores (draft rows are never persisted) and the edits the server just refused will be thrown away. After the reload, the remote copy overwrites `localStorage`. On a shared range line, the instructor who loses the race silently loses their run. The message is the server's long sentence in 11px amber text. | Functional defect | High | `:3898-3907`; draft rows exist only in state `:1950`; remote overwrites local on load `:2419-2440` | Source-evident | Before reloading, list what will be lost ("3 unsaved scores on Run 2"). Offer "Reload and re-apply my scores" (re-key the local rows onto the fresh copy), or at least keep the draft rows across the reload. | M |
| B-71 | **New** | ~ RNG-02 | `/range-days` → offline save | With no signal, `fetch` rejects and the raw browser text is shown ("Save failed: Failed to fetch" in Chrome, "Load failed" in Safari). There is no offline wording, no count of pending changes, and no `beforeunload` guard, so closing the tab while it shows "Save failed" loses the unsynced edits without a prompt. | Usability | Medium | `saveRemoteRangeDayWorkspace` `:494-507` (network errors propagate as-is); message passed through `workspace-autosave.ts:49-53`; no `beforeunload`/`navigator.onLine` in the page (grep) | Source-evident | Map network errors to "Offline – N changes not yet saved; will retry". Add a `beforeunload` guard while a save is failed or pending. | S |
| B-72 | **New** | — | `/range-days` → save status | The status says "Saving… → Saved" every time the page opens, because autosave fires right after load with no user change. Once it says "Saved", it **keeps** saying "Saved" during the 650 ms debounce of the next edit, since `schedule()` doesn't report a pending state. So "Saved" sometimes means "not yet sent". | Usability | Low | Effect `:2490-2505`; `lib/range/workspace-autosave.ts:11-23` (no `onState` on schedule) | Source-evident | Skip the post-load save when nothing changed. Show "Unsaved changes…" as soon as an edit is scheduled. | S |
| B-73 | **New** | — | `/range-days` → Roster (scorer role) | Scorers now reach the Roster tab (B-22 fix), but Add Officer, the firearm chips and Remove are just disabled. Nothing explains that they need range-management permission, and the officer select shows the normal list. | Usability (role/access confusion) | Low | `:5145-5173`, `:5244`, `:5297-5304` | Source-evident | Hide the manager-only controls for scorers, or add "Only the range manager can change the roster". | S |

---

## Qualification History (`/qualifications`)

### Screens inspected
- `/qualifications` (`app/qualifications/page.tsx`, about 1,245 lines). RC changes:
  - shared `formatDate`;
  - `ownRecordsUserId`: with `recordScope: "own"` the page lists only the caller (`:206-241`, `:944-951`).

### Findings

| ID | RC status | OA ref | Screen | Finding | Type | Impact | Evidence (RC) | Label | Recommendation | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| B-40 | Present | — | `/qualifications` | Still no loading state: "No qualification records found" plus an amber "No qualification history is available yet…" while loading. | Functional defect | Medium | `:1047-1049`, `:1060-1067` | Source-evident | Skeleton; show the empty banner only after a successful load. | S |
| B-41 | Present | — | `/qualifications` (phone) | Master/detail still stacks below `xl`. Tapping an officer doesn't scroll to the detail. The first officer is auto-selected. | Usability | Medium | `:1070`, `:1112`, `:1000-1005` | Source-evident | As first pass. | S |
| B-42 | Partly fixed | ~ TRN-26 / RNG-28 (TV), ~ TRN-14 | `/qualifications` (officer view) | **Fixed for plain officers:** without a range-record permission, the API returns only their own rows and the page lists only them. **Still present:** (a) the page keeps the department framing for that one person: search box, status filter, "Needs Action" metrics, master/detail list (see B-78). (b) Users *with* department-wide permission (instructors, supervisors) still land on the department list with the first officer auto-selected. There is still no "My qualifications" default. | Usability (role/access confusion) | Medium (was High) | `:944-951`; `:794-1005` (no current-user default for permitted users) | Source-evident | Single-person view (no list or search) for own scope. Default to self, with "All personnel" for permitted users. | S |
| B-43 | Present | — | `/qualifications` | Severity colours are inconsistent ("Missing Night" blue, "Missing Day" and "No Record" slate, all counted as "Needs Action"). | Usability | Medium | `:341-348`; `:1021-1023` | Source-evident | As first pass. | S |
| B-44 | Present | ~ RNG-17 | `/qualifications`, `/range-days` | Settings still lets admins configure rifle familiarization and "Qualification Restricted", but neither page shows them. The Rifle card always shows "No record". The RC changed only the panel's data transport. | Usability | Medium | `app/settings/components/RangeQualificationRulesPanel.tsx:495-591`; `qualifications/page.tsx:1170-1173` | Suspected | As first pass. (Enforcement belongs to RNG-17.) | M |
| B-45 | Present | — | `/qualifications` → timeline | Every row still embeds the full `QualificationEvidence` widget (upload and Archive) with no permission prop. The Archive icon button has only `title`. Under TV, plain officers now see their own evidence and the same upload/archive controls; the server refuses uploads that need a permission. | Usability | Medium | `qualifications/page.tsx:788`; `app/components/QualificationEvidence.tsx:22`, `:226-240` | Source-evident | Read-only mode unless the user can manage evidence. Add `aria-label`. | S |

---

## Training hub (`/training`) and navigation split

### Screens inspected
- `/training` (`app/training/page.tsx`, unchanged). Nav (`app/components/TracePointShell.tsx`): the RC changed feature-gate plumbing and added "My Notifications" and "Inventory". The Training/Readiness grouping is unchanged.

### Findings

| ID | RC status | OA ref | Screen | Finding | Type | Impact | Evidence (RC) | Label | Recommendation | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| B-46 | Present | ~ TRN-31, ~ TRN-21 | `/training` | Still two cards → `/qualifications`, no Agency Training card, and "Training Requirements – Coming next". | Functional defect (dead/duplicate links) | High | `app/training/page.tsx:11-49` (`:15`, `:21`, `:35`) | Source-evident | (TRN-31 owns the requirements-access part.) UX angle: fix the card set. | S |
| B-47 | Present | ~ OA App. C terminology (no ID) | Nav / page titles | The same naming split as in the first pass ("Range & Training", "Qualification History", "Certification Readiness", …). | Usability / terminology | Medium | `range-days/page.tsx:3947`, `:3955`; `qualifications/page.tsx:1038-1040`; `training/certifications/page.tsx:555-557`; `TracePointShell.tsx` Training/Readiness groups | Source-evident | As first pass. | S |
| B-48 | Present | — | Cross-module | Range attendance is still boolean, while Agency Training has four states. | Usability | Medium | `range-days/page.tsx:3121-3123`, `:5285-5296`; `AgencyTrainingRosterBoard.tsx:27`, `:317-327` | Source-evident | As first pass. | M |

---

## Certifications (`/training/certifications`)

### Findings

| ID | RC status | OA ref | Screen | Finding | Type | Impact | Evidence (RC) | Label | Recommendation | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| B-49 | Present (exposure increased) | — | `/training/certifications` → modal Save | Save errors still go to the page banner behind the overlay. Under B7 the server now returns more 400s, and all of them land invisibly behind the modal: invalid date, expiration before issue, non-http URL, and "Reopen the training event to correct them" for closeout-issued credentials. | Functional defect | High | `saveCredential` `:354-385`; banner `:587-591`; modals `:878`, `:1136`, `:1313` show no `{error}`; `docs/remediation/B7-training-records.md` (TRN-29) | Source-evident | Show errors in the modal footer. Explain locked fields for closeout-issued credentials before Save. | S |
| B-50 | Partly fixed | = TRN-36 (table part) | `/training/certifications` (phone) | **Fixed:** expiry is now formatted (`formatDate`). **Still present:** `min-w-[980px]` table, and no search, filter, sort or "Expiring soon". | Usability | Medium | `:722`; `:825-826` | Source-evident | Card list + filters. | M |
| B-51 | Partly fixed | ~ TRN-26 | `/training/certifications` (officer view) | **Fixed (data):** without `manage_certifications`, only your own credentials are returned. **Still present:** the same department-table layout (Officer column, "Officer Certifications") for a single person, with no "My certifications" framing (see B-78). | Usability (role/access confusion) | Low (was Medium) | `docs/remediation/TV-training-visibility.md`; table `:722`ff | Source-evident | Own-scope card view. | S |
| B-52 | Present | — | `/training/certifications` | Requirements are still editable in both Settings and this page. | Usability | Medium | `settings/components/CertificationRulesPanel.tsx`; `training/certifications/page.tsx:593-691`, `:1313-1457` | Source-evident | As first pass. | M |
| B-53 | Present | — | `/training/certifications` | Icon-only buttons have no `aria-label`. A Trash icon is used for Archive. The modals have no Escape or focus trap. The document field is a URL. The officer select is now disabled when editing (good) but has no hint why. | Usability (a11y) | Low | `:845-865`; `:895-912`; `:1044` | Source-evident | As first pass. | M |

---

## Agency Training (`/agency-training`)

### Screens inspected
- `agency-training/page.tsx` (915 lines). RC: department time zone in list/detail with a zone abbreviation.
- `AgencyTrainingEventEditor.tsx`: the zone label on Starts/Ends, and the new "Certification issued at closeout" select (`:732`).
- `AgencyTrainingRosterBoard.tsx`: dirty tracking; outcome no longer forces Present (`:338-347`).
- `AgencyTrainingCloseoutPanel.tsx`: dirty guard (`:47-55`).

### Findings

| ID | RC status | OA ref | Screen | Finding | Type | Impact | Evidence (RC) | Label | Recommendation | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| B-54 | Fixed in RC | = TRN-18 | `/agency-training` → Complete Event | Complete Event now refuses while the roster is dirty ("Save All before completing this event."). Residual UX: it is shown through `window.alert` + banner, and there is no "Save & Complete". | — | — | `AgencyTrainingCloseoutPanel.tsx:47-55`; `AgencyTrainingRosterBoard.tsx:161`, `:421` | Source-evident | Optional: one "Save & Complete". | S |
| B-55 | Present | — | `/agency-training` | Switching events or pressing Refresh still remounts the board and drops unsaved edits without a warning, even though the board now has a `dirty` flag that could drive a guard. | Functional defect | High | `agency-training/page.tsx:619` (`key={selectedEvent.id}`), `:406-409`, `:328-334`; dirty `AgencyTrainingRosterBoard.tsx:86` | Source-evident | Lift `dirty` to the page and confirm on event switch, Refresh and route leave. | S |
| B-56 | Present | — | `/agency-training` → detail tiles | The duplicate Roster / "Attendance & Results" tiles are still there, and so is the dead "Files & Certificates" tile ("next build phase"). | Functional defect (dead control) | Medium | `:577-611` | Source-evident | As first pass. | S |
| B-57 | Present | = TRN-36, ~ TRN-17 | `/agency-training` → Roster (phone/tablet) | Still a `min-w-[1050px]` table with no bulk actions. Remedial notes are still sent but not editable. After B7, missing bulk "mark all present" costs more (see B-74). | Usability | Medium | `AgencyTrainingRosterBoard.tsx:296`; `remedialNotes` `:203`, no input in `:301-390` | Source-evident | (OA owns.) UX angle: remedial-notes field when Remedial Required. | M |
| B-58 | Present | — | `/agency-training` → Closeout / roster | `window.prompt` (file removal reason) and `window.confirm`, now plus `window.alert` for the dirty guard. A persistent "Saved" banner. The roster trash removes without confirmation (see B-75). | Usability | Low | `AgencyTrainingCloseoutPanel.tsx:39`, `:52`, `:55`; `AgencyTrainingRosterBoard.tsx:392-404` | Source-evident | Shared dialogs + toast. | S |
| B-59 | Present | — | `/agency-training` | `rose-*` vs `red-*`, and a different header style. | Aesthetic | Low | `:310-324`, `:369-374` | Source-evident | Shared PageHeader/Alert. | S |
| B-74 | **New** | ~ TRN-04 | `/agency-training` → Roster outcome | After the TRN-04 fix (correct for records), picking Completed or Passed no longer sets attendance. The row doesn't stop or flag the invalid pair: you can pick "Completed" while attendance is still "Assigned". **Save All then fails for the whole roster** with one banner ("An attendee can be marked Completed or Passed only when attendance is Present."), with no row highlighted. The common case (officer present and completed) now takes two selects per officer, and there is still no "mark all present". | Usability | Medium | `AgencyTrainingRosterBoard.tsx:338-347` (outcome onChange no longer touches attendance); save error `:210-213`, `:226-227`; `docs/remediation/B7-training-records.md` (TRN-04 server rule) | Source-evident | Disable Completed/Passed until attendance is Present, or ask "Also mark Present?". Highlight the offending rows. Add "Mark all present". | S |
| B-75 | **New** | ~ TRN-11 | `/agency-training` → Roster trash | The trash icon is still enabled on rows that already have recorded attendance or outcome. The server now refuses to remove them (409), so the whole Save All fails. The B7 doc notes that the row "stays removed locally until Refresh", so the board disagrees with the server. | Functional defect | Medium | `AgencyTrainingRosterBoard.tsx:392-404`; `docs/remediation/B7-training-records.md` "Residual … After a 409 on removing a recorded attendee, the board keeps the row removed locally until Refresh" | Source-evident | Hide or disable trash for recorded rows ("Mark Excused instead"). On a 409, restore the row. | S |
| B-76 | **New** | ~ TRN-02 | `/agency-training` → event editor | Starts/Ends labels show the raw IANA zone ID ("Starts (America/New_York)"), while the list and detail show an abbreviation ("6:00 PM EDT"). The zone ID is technical, and two formats are used for the same thing. Nothing tells a coordinator in another zone that the time is the *department's*. | Usability / terminology | Low | `AgencyTrainingEventEditor.tsx:553-554`; `agency-training/page.tsx:147-160` (`timeZoneName: "short"`) | Source-evident | "Starts (department time, EDT)". | S |
| B-77 | **New** | ~ TRN-03 | `/agency-training` → event editor "Certification issued at closeout" | When the type isn't in the loaded list (Certifications feature off, or the fetch failed silently), the select shows the placeholder "Linked certification type". Changing the type clears `certificationValidDays`, which has no input anywhere in the form, so validity is invisible and can't be set from the event. | Usability | Low | `AgencyTrainingEventEditor.tsx:732` (`certificationValidDays: ""` on change; "Linked certification type" option); fetch errors swallowed `:252-264`; no valid-days input (grep) | Source-evident (UI); Suspected (effect of cleared days on issuance) | Show the type name (fetch it by id) and the validity ("valid 730 days"), with an override field. | S |

---

## Training Alerts (`/training-alerts`)

`TrainingAlertsClient.tsx` is unchanged in the RC, so its line numbers equal the first pass.

| ID | RC status | OA ref | Screen | Finding | Type | Impact | Evidence (RC) | Label | Recommendation | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| B-60 | Present | = TRN-20 | `/training-alerts` → Acknowledge / Resolve | Alert status and audit are still in localStorage only. | Functional defect | Critical | `TrainingAlertsClient.tsx:174-188`, `:250-262`, `:338-355` | Source-evident | (OA owns.) UX angle: until fixed, label it "Saved on this device only". | M |
| B-61 | Present | ~ TRN-20 | `/training-alerts` → Resolve/Complete/Escalate | One tap with no reason. "Dismissed with Reason" is unreachable. Audit entries have no actor or time. | Usability | High | `:676-688`, `:839-868`, `:310`, `:317`, `:351`, `:375` | Source-evident | Require a reason; expose Dismiss. | S |
| B-62 | Present | ~ TRN-20 | `/training-alerts` → Remediation "Assign" | Still hard-coded "Range Master" / "Next scheduled range block". | Functional defect | High | `:387-405` (`:394-395`) | Source-evident | Instructor + due-date picker. | M |
| B-63 | Present | — | `/training-alerts` | No loading state, no filter or sort, and every card is fully expanded. | Usability | Medium | `:126`, `:601-614`, `:616-778` | Source-evident | As first pass. | M |
| B-64 | Present | — | `/training-alerts` | Developer/status copy ("per-alert role routing is not currently implemented"), and the wrong permission is named. | Usability / terminology | Low | `:998-1002`, `:501-505`, `:521-527` | Source-evident | As first pass. | S |

---

## Analytics (`/analytics`)

`page.tsx` is unchanged (the RC only touched `layout.tsx` feature gating).

| ID | RC status | OA ref | Screen | Finding | Type | Impact | Evidence (RC) | Label | Recommendation | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| B-65 | Present | — | `/analytics` | Officer rows aren't links. | Usability | Medium | `analytics/page.tsx:544-575` | Source-evident | Link to `/qualifications?officer=`. | S |
| B-66 | Present | — | `/analytics` | Static explainer sections take up space on a command dashboard. | Usability / aesthetic | Low | `:764-807`, `:810-843` | Source-evident | As first pass. | S |
| B-67 | Present | — | Analytics / Alerts / Qualifications | Three separate readiness presentations with no cross-links. B10 changes the readiness computation (only closed days count, and "Any" drills count), so the three lists may now disagree temporarily during rollout. | Usability | Medium | `analytics/page.tsx:241-247`, `:276-280`; `TrainingAlertsClient.tsx:982-991`; `qualifications/page.tsx:1052-1057` | Source-evident | As first pass. | M |

---

## Drill Documents / Evidence components

| ID | RC status | OA ref | Screen | Finding | Type | Impact | Evidence (RC) | Label | Recommendation | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| B-68 | Present | ~ RNG-32 | `/range-days` → Drills (DrillDocuments) | A fetch per card, layout shift, a modal with no Escape, and 26px icon targets. (`DrillDocuments.tsx` is unchanged.) | Usability | Low | `components/DrillDocuments.tsx:24-36`, `:59-60`, `:68-72`, `:81` | Source-evident | As first pass. | S |

---

## Cross-module (new in RC)

| ID | RC status | OA ref | Screen | Finding | Type | Impact | Evidence (RC) | Label | Recommendation | Effort |
|---|---|---|---|---|---|---|---|---|---|---|
| B-78 | **New** | ~ TRN-26 / RNG-28 | `/range-days`, `/qualifications`, `/training/certifications`, `/agency-training` roster (own-records scope) | TV now gives users without the matching permission **only their own rows**, but none of these pages says so. Each keeps its department framing: Qualifications keeps search, status filter and "Needs Action" counts for one person; Certifications keeps the "Officer Certifications" table; the Agency Training roster shows one row; event counts become "0 or 1 assigned". On Range Days, roster and result counts on cards and stat tiles reflect only the caller's own entries, so a day with 30 shooters can read as "1". Without a label, an officer or a commander missing a permission can read these as missing data. | Usability (role/access confusion) | Medium | `qualifications/page.tsx:241`, `:944-951`; range workspace `recordScope` is never read by `range-days/page.tsx` (grep: `recordScope` appears only in qualifications); `docs/remediation/TV-training-visibility.md` "Behavior changes by role" | Source-evident (no label); Suspected (Range Days card counts) | When `recordScope === "own"`, show "Showing your records only" and switch to a personal layout (no search, filter or department counts). | S |

---

## Consolidation / reuse opportunities (updated to RC)
1. **StatusPill / StatCard / MetricCard / Pill:** still about 9 local copies (`range-days:1401,1425`, `qualifications:350,687`, `analytics:147`, `training-alerts:74,90`, `agency-training:164`, plus inline spans in certifications). A shared `StatusBadge` fixes B-43. A sync-state variant of the badge would fix the B-01 "Saved" pill.
2. **Save/sync status:** the RC introduced a good pattern, `renderWorkspaceSaveStatus` (`range-days:3896-3927`). It is local to Range Days, it runs alongside the older `saveMessage`-in-button channel (B-12), and Agency Training, Certifications and Training Alerts each have their own banners. Promote it to a shared `SyncStatus`/toast component and remove the button-label channel.
3. **Modal / ConfirmDialog / ReasonDialog:** native dialogs **grew** in the RC: `range-days:2945` (finalize), `:3188` (roster remove), `:3379`, `:3864`; `AgencyTrainingCloseoutPanel:39,52,55`; `QuickQualificationCamera:22,74`; `QualificationEvidence:105`; `DrillDocuments:50`; `certifications:389`. The modal implementations listed in the first pass remain (`certifications:878,1136,1313`, `AgencyTrainingRosterBoard:431`, `AgencyTrainingEventEditor:516,537`, `DrillDocuments:68`).
4. **Dead code:** the legacy Create Training Event modal in `agency-training/page.tsx:654-902` is still present (TRN-38, deferred). The B7 doc notes it still builds browser-local times.
5. **Personnel picker:** unchanged. Range roster single select (`range-days:5145`), open-attendance combobox (`:6240`ff), Agency multi-select (`AgencyTrainingRosterBoard:431-503`).
6. **Photo/evidence capture:** unchanged (B-20). Merge `QuickQualificationCamera` and `QualificationEvidence`, and add a read-only mode (B-45).
7. **Requirement configuration:** unchanged (B-52, B-44).
8. **Data loaders:** still copied (`range-days:470-543`, `qualifications:162-249`). Range Days still calls the workspace GET twice (`:470-491`, `:1900-1948`). Only one of them sets the concurrency base, which contributes to B-03. A shared hook would handle loading, error, base version and `recordScope` (B-24, B-40, B-03, B-78) in one place.
9. **Dates:** done in the RC. `lib/format/date` (`formatDate`, `formatDateTime`) now replaces the local formatters in Range Days, Qualifications, Certifications and Evidence. Agency Training uses `Intl` with the department zone.
10. **Field + label:** unchanged (B-29). **Page header:** unchanged (B-59).

## Workflow simplification opportunities (RC)
- **Score a run (phone):** still Open day → scroll past 6 stat cards and 8 stacked tabs → Scoring → Drill → Run → enter scores → Save → read the result in the off-screen header → Run again. The sync status now sits next to the sticky Save, which helps. Remaining steps: a horizontal tab strip (B-14), inline validation messages next to Save (B-11), "Save & next run" with completion counts (B-15), and a dirty-check on drill/run switch (B-04).
- **Recover from a failed or stale save:** today it's read an 11px line → Retry (which resends the same failing snapshot, B-69), or Reload (which discards drafts, B-70). Instead: flag the failing row, keep drafts across a reload, and use offline wording (B-71).
- **Finalize a day:** a native confirm now prevents accidents (B-07). Replace it with one "Finalize range day" summary step that includes the AAR prompt (B-09) and a lock banner afterwards (B-08).
- **Roster:** multi-select add and "Mark all present" (B-23) are still missing. Scorers can now take attendance themselves (B-22 fixed).
- **Agency Training roster:** after TRN-04, the present-and-completed path costs two selects per officer. "Mark all present" plus disabling invalid outcome combinations (B-74) restores it to one action per officer or fewer. Guard event switching with the existing `dirty` flag (B-55).
- **Officer self-service:** data is now own-scoped (TV). Finish it with a personal layout and a scope label (B-42, B-51, B-78).
- **Commander follow-up:** unchanged. Link Analytics rows and Alerts to Qualifications (B-65, B-67).

## Quick wins (RC; low risk, high benefit)
1. **B-05:** prefill `completed` from `resolveRunCompletion` so the toggle shows what will be saved. One-line fix, and it prevents wrong Completion records.
2. **B-69 / B-17:** inline score range validation using the same rule the server now enforces, and flag the failing row instead of only an 11px status.
3. **B-70:** confirm before Reload with the count of unsaved scores, and keep draft rows across the reload.
4. **B-01:** make the per-row "Saved" pill reflect server sync, and show "Edited" for dirty rows.
5. **B-03:** don't autosave after a failed GET (offline copy) until a fresh GET succeeds.
6. **B-04:** confirm before a drill/run switch when `unsavedBatchOfficerIds` is non-empty (the set already exists).
7. **B-49:** render certification modal errors inside the modal. More server 400s now hit this.
8. **B-55:** use the board's existing `dirty` flag to guard event switch and Refresh.
9. **B-74 / B-75:** disable Completed/Passed until Present, and disable trash on recorded rows.
10. **B-11 / B-12 / B-13:** move `saveMessage` out of the button label next to the sticky save, and use one save button per breakpoint.
11. **B-46:** fix the duplicate and missing Training hub cards.
12. **B-24 / B-40 / B-63:** loading skeletons instead of empty states.
13. **B-34 / B-39 / B-56 / B-64:** remove roadmap, dev and status copy and the dead tile.
14. **B-78:** a "Showing your records only" label when `recordScope === "own"`.
