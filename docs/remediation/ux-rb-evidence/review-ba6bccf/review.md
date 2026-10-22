## Review of ba6bccf (range conflict handling)

I wrote three proofs in proofs.test.ts.txt. Each one asserts the faulty behaviour, and all three pass against ba6bccf. Run them with `cd /home/user/tracepoint && node --import tsx --test <that file>`. I modified no repository files.

### High

**R4-H1. The old "an edit decides the conflict" rule still runs during recovery, so this device's score is lost without any notice.**
- **Scenario:**
  1. A conflict exists: this device has 44, the other device has 46, and the workspace holds 46.
  2. The instructor edits that officer's row (for example a note) and batch-saves it. The record changes locally.
  3. That autosave hits `stale_workspace`, because another device saved anything at all in the meantime. This is the normal two-instructor case.
  4. `recoverWorkspace` treats the record as replayed and drops the earlier conflict.
- **Result:** the 44 existed only in the conflict and is now gone. Nothing tells the instructor.
- **Why it matters:** ba6bccf removed `liveConflicts` from the page, but this second copy of the R2-M1 rule remains. It also brings back 3177a83 P2 (editing another field discards this device's value) on the recovery path. It contradicts the documented rule that a conflict stands until the instructor chooses.
- **Where:** `src/lib/range/workspace-device-copy.ts:155-156` (the `replayed` set and the `earlier` filter). Both the load path (`page.tsx:2521`) and the recovery path (`page.tsx:3175`) call it.
- **Proof:** `R4-H1`.
- **Minimal fix:** stop filtering out `input.conflicts` because a record was replayed. Keep every earlier conflict and let `reconcileConflicts` refresh it. Drop a conflict only when its `local` equals the record's new value.

**R4-H2 (data integrity). Field-level "Use this device's value" mixes this device's score with the other device's derived pass/fail fields, which can record a false failed qualification.**
- **Scenario:**
  - The base is 45 (pass). This device corrected it to 43, still a pass, so `passed`, `finalPassed` and `deficiencyObserved` equal the base. The other device entered 30 (fail).
  - `conflictingFields` excludes every field where this device's value equals the base. Only `score` is applied.
- **Result:** `{score: 43, passed: false, finalPassed: false, deficiencyObserved: true}`. This needs no later edits, and the record autosaves as is.
- **Where:** `src/lib/range/workspace-merge.ts:166-169` and `:252-256`.
- **Proof:** `R4-M2`.
- **Minimal fix:** for `results`, treat the score-and-outcome fields as one unit. If any of them conflicts, apply all of this device's values for: score, timeSeconds, hitCount, passed, finalPassed, completed, departmentStandardPassed, departmentStandardSnapshot, deficiencyObserved, remedialTrainingRecommended, firearmId, firearmTypeSnapshot, scoringFormatSnapshot and instructorId. Alternatively, apply this device's whole record minus `malfunctionIds` and `notes` merges.

### Medium

**R4-M1. A conflict keeps a stale `server` value after later local edits. The panel then shows wrong values, and "Use this device" overwrites a newer saved entry and can corrupt the outcome.**
- **Scenario:**
  1. A conflict exists: 44 here against 46.
  2. The instructor corrects the row to 30 (fail), and it saves with no stale refusal.
  3. The panel still says "this device 44, other device 46", because `describeWorkspaceConflict` reads `conflict.server`. `conflict.server` is refreshed only in `reconcileConflicts` during recovery.
- **Result:**
  - "Keep other device's value" keeps 30, not the 46 shown.
  - "Use this device's value" writes 44 over the instructor's saved 30, and the fields are computed against the stale 46. The record becomes 44 with `passed: false`.
- **Where:** `page.tsx:3226-3232` (labels) and `workspace-merge.ts:243-257` (`conflictingFields` uses `conflict.server` instead of the current record).
- **Proof:** `R4-M1`.
- **Minimal fix:** display and compute against the record as it is now, `byId(workspace)[id]`, not `conflict.server`. Or refresh `server` on every applied workspace change. A related Low: `reconcileConflicts` refreshes `server` but never `base`. A field this device set equal to the other device's value at conflict time is later re-applied over that device's newer change.

### Checked and sound
- **Batch skip (`page.tsx:3715`):**
  - Every row edit path adds the officer to `unsavedBatchOfficerIds`: metric, firearm, pass, completion, notes and the malfunction toggle, type and notes. `setBatchScoreRows` is called from only three sites, and only `updateBatchScoreRow` mutates rows.
  - The firearm-mismatch "cancel" returns before the set is cleared.
  - Edited rows survive rebuilds via `preserveUnsavedBatchRows`.
  - A result that exists only because of a merge, for an officer whose row was not touched, is now left alone. That is correct.
  - "N recorded" counts only rebuilt rows; no edit is skipped.
  - Context switching clears typed rows, but that is unchanged from before and not caused by this commit.
- **"Keep other device's value":** it writes nothing except the `malfunctionIds` union, so no malfunction is lost.
- **Deletions and missing bases:**
  - Deletions and new records work as expected: when `local` is null the record is removed, and when the current record or `server` is missing, this device's whole record is restored.
  - Conflicts without a base (held back, unknown-base, legacy, or persisted by older builds) fall back to "every field that differs from server". That equals the earlier whole-record behaviour and loses nothing.
- **Conflict accumulation:** conflicts stay one per record (keyed reconcile), never block saves, and drop when this device's value equals the server's.
- **L-c ordering:** fixed; this user's own conflicts win.
- **Drill removal:** the functional `setRangeDayDrills` keeps concurrent changes. The selection fallback reads the latest state and excludes the removed drill, so it is sound.
