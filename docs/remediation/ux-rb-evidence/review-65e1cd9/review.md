# Adversarial review: 65e1cd9 "fix(range): UX-RB-5/6 safe conflict recovery and row-level score validation"

Base: RC 5b6cc00. Reviewed: `src/lib/range/workspace-merge.ts`, `src/app/range-days/page.tsx` (load, save, recover, resolve),
`src/lib/range/workspace-autosave.ts`, `src/lib/range/workspace-mutation.ts`, `src/app/api/pilot/range-workspace/route.ts`.
No repo files were modified.

Proof script: `proofs.test.ts.txt (copy into src/lib/range/ as a .test.ts to run)`
Run: `cd /home/user/tracepoint && node --import tsx --test proofs.test.ts.txt (copy into src/lib/range/ as a .test.ts to run)`
Result: 8/8 pass. Each test asserts the faulty behaviour. P1–P3 go through the real PUT route with the same DB double as `simultaneous-instructors-route.test.ts`, and the device model matches `recoverRangeWorkspace`. The existing commit tests still pass (10/10).

Overall: the merge does what it is meant to when the base/local pair is consistent and the ids are distinct. But it makes the localStorage copy an input on every load. It also assumes that a merged workspace will be accepted, and that a "same score" always shares an id. None of these three assumptions holds.

---

## HIGH

### H1. A recovered save that the server refuses for authorization blocks every later save. No conflict is shown, and the block survives reloads (PROVEN P2, P3)
- Scenario A (finalize race). Device L (line instructor, scorer) and device D (lead) both load v1 of day-1 ("In Progress").
  1. D sets the status to Completed and saves (v2).
  2. L enters a score and autosaves with base v1, which returns 409 `stale_workspace`. `recoverRangeWorkspace` (page.tsx:3098) merges. The day is unchanged locally, so it takes the server's "Completed". The new result is local-only, so it is replayed (workspace-merge.ts:67-70).
  3. The PUT of the merged workspace is refused by `finalizedHistoryChanged`. The response is `409 {error}` with **no `code`** (workspace-mutation.ts:303-304, route.ts:163-167). page.tsx:551 therefore throws a plain `Error`. Recovery does not run and no conflict is created.
  4. Every later autosave is a whole-workspace snapshot that still holds the replayed result, so every save is refused. That includes edits to other range days. P2 shows that an unrelated attendance edit is also refused.
  5. A reload does not help. The sync-state base is now v2 and the local copy holds the result, so the load merge (page.tsx:2510-2517) replays it again. The device stays permanently "not synced", and there is no UI action that can discard the change. This is the B-R2 "stuck failing every save" failure that the commit says it fixes.
- Scenario B (open attendance, two scorers). Both devices add the same walk-up officer. Ids are `roster-${Date.now()}` (page.tsx:3304), so the ids differ. The merge keeps both entries, and `scorerRosterChangeAllowed` requires exactly one entry per officer per day (workspace-mutation.ts:236-239). The server returns 403 on every save from then on (P3).
- Same class of problem:
  - "Use this device's value" on a planning or range-day conflict from a scorer device returns 403.
  - "Use this device's value" for a day that the other device finalized returns 409.
  - A server-deleted roster entry re-added by a scorer returns 403.
  Each of these leaves the device stuck.
- Regression status: changed failure mode. In the RC the second device got a stale 409 and the only remedy was reload, which lost the score. Now the score is kept, but the whole device is wedged, including across reloads.
- Fix:
  1. Run the server's `authorizeRangeWorkspaceMutation` on the client against the fetched server copy before applying `merge.merged`. Turn each replayed record that would be refused into a listed conflict ("day was finalized on another device"), and keep it out of the workspace.
  2. Also make every non-stale refusal surface per-record, with a "discard this device's change" action, so that one bad record cannot block unrelated saves.
  3. Dedupe walk-ups by (rangeDayId, officerId) when merging.

### H2. The local copy and the sync state are separate, non-atomic localStorage keys shared by every tab (and every user) on the device. A mismatched pair silently reverts saved work and deletes other people's records (PROVEN P4)
- `tracepoint.rangeDays.workspace.v1` is written on every state change (page.tsx:3154). `...v1.sync` is written on load, save success, recovery and conflict updates (page.tsx:2519, 3082-3086, 3114). The load path merges `syncState.base` with the local copy as if they were one consistent snapshot (page.tsx:2510-2516).
- Scenario (two tabs on the same device):
  1. Tab 1 corrects officer A's score from 40 to 46, adds roster entry R, and saves (v2). The sync state now has base equal to tab 1's state.
  2. Tab 2 still shows v1. The user edits anything in it, so the shared local-copy key now holds tab 2's state (40, no R).
  3. Either tab reloads. `merge(base = tab 1, local = tab 2, server = v2)` reads 46→40 as "this device changed it" and R as "this device deleted it". Both changes are replayed with no conflict, and the server accepts the PUT. Result: the saved correction is reverted and R is deleted (P4). If R were a result, deleting it would instead trigger the H1 wedge.
- Conflicts are kept only in the sync key, so tab 2's `persistRangeDaySyncState` also overwrites tab 1's unresolved conflicts. Values this device kept as conflicts are then lost on the next reload.
- A single tab hits the same bug in two ways:
  - The sync state is written before the local copy is refreshed: recovery writes it at page.tsx:3114, and the local copy is only written later in the autosave effect after `applyMergeableWorkspace`. Initial load has the same order at page.tsx:2519. Closing or reloading inside that window gives the same mismatch.
  - A quota failure on one key but not the other gives the same result. Both writes are swallowed with `console.warn`, and the commit doubles the storage used by keeping a second full copy of the workspace.
- Also: the key is not scoped by user or department, and sign-out never clears it. On a shared range tablet, user A's unsynced workspace (other officers' scores) is shown to user B, merged in, and saved under B's id. This includes an "own-records" user (`ownRangeWorkspace`, route.ts:94). If the department differs, A's records are uploaded into B's department when their rangeDays carry no `departmentId`; when they do carry one, B gets a permanent 403 (validateTenantReferences).
- Regression: yes. The RC used the local copy only when the GET failed, and it ignored the copy when the server returned a workspace.
- Fix:
  1. Store `{workspace, base, baseUpdatedAt, conflicts, userId, departmentId, writerTabId, seq}` in one key with one `setItem`.
  2. Ignore or quarantine a copy whose user or department does not match.
  3. Detect other tabs (a `storage` event or a BroadcastChannel). Either make the page single-writer, or keep one key per tab and merge each tab's own pair.
  4. If a write fails, block saving rather than continuing with a stale pair.

### H3. The same officer/drill/run scored fresh on two devices is saved as two results, with no conflict (PROVEN P1)
- New results get the id `result-${Date.now()}-${index}` (page.tsx:3616). The merge matches records by id only (workspace-merge.ts:34-41, 59), so two devices that each score officer A on run 1 produce two distinct ids. Both are replayed and both are accepted by the server. The workspace now holds two different scores for one officer and run (46 and 31 in P1), and nobody is asked to choose.
- Later corrections use `results.find(...)` (page.tsx:3606-3612) and change only the first one. Which one reports and qualification use depends on array order.
- The commit's tests hide this by using deterministic ids (`result-${officer}` in simultaneous-instructors-route.test.ts and workspace-merge.test.ts). The claim "same-officer conflict resolved without loss" holds only for an already-existing result.
- Regression: new silent duplication. In the RC the second save was refused and lost.
- Fix: in `mergeRangeWorkspace`, match results by the server's `resultKey` (rangeDayId|drillId|runNumber|officerId) as well as by id. Do the same for roster entries (rangeDayId|officerId) and drills. When two records share a key but have different ids, treat them as a conflict on one logical record. Alternatively, make result ids deterministic from that key.

## MEDIUM

### M1. A copy with an unknown base resurrects records the other device deleted (PROVEN P5)
- A device whose first load failed and that has no sync state (old-format storage, or the very first session) uses `EMPTY_MERGEABLE_WORKSPACE` as the base (page.tsx:2526). Clicking "Load and merge" (or the `remote.workspace === null` path) merges with that empty base.
- A record that the server no longer has and that is still in the old local copy satisfies `same(s, b)` because both are undefined. It is replayed and the deleted record comes back (P5: a deleted roster entry). With a missing base, a local-only record cannot be told apart from one the other side deleted.
- This is an improvement over the RC, which overwrote the whole workspace, but it is still a stale write.
- Fix: when there is no base, turn every local-only record that has no server counterpart into a conflict (or "restore?" prompt) instead of replaying it. Results are the exception, because the server never deletes them.

### M2. Conflicts duplicate and accumulate. Choosing a stale entry applies a value the user has since replaced (PROVEN P7)
- Conflict lists are concatenated without dedupe: page.tsx:3114 (`[...workspaceConflictsRef.current, ...merge.conflicts]`) and page.tsx:2517 on every load.
- If the same record conflicts twice, it is listed twice, which gives duplicate React keys `${collection}:${id}` and can mis-render the list. "Use this device's value" on the older entry applies the older local value (44) over the user's newer 48 (P7).
- After a reload inside the H2 window, the same conflict can be added again.
- Fix: key conflicts by collection and id. A new conflict for the same key replaces the old one. Drop conflicts whose local value now equals the server value.

### M3. "Keep other device's value" does not restore anything; it only dismisses the conflict
- `resolveWorkspaceConflict` with `keepThisDevice = false` only filters the conflict list (page.tsx:3124-3127). That is correct only while the workspace still holds `conflict.server`.
- It stops being correct if the user edited the record after the merge, if an earlier duplicate entry was resolved with "this device" (M2), or if a later merge took a newer server value. The label then misstates what is kept.
- The conflict also shows an old "other device" value after a third device saves again.
- Fix: apply `conflict.server` explicitly, or re-read the current server record, and refresh `server` on each recovery.

### M4. A snapshot built before recovery can be sent with the new base version (suspected; analysis only)
- Snapshots carry no base tag. `rangeWorkspaceBaseUpdatedAt` is a module global that is read when the PUT is sent (page.tsx:544).
- Recovery sets the new version and clears `workspaceRecovering` (page.tsx:3110, 3120) before React re-renders and the autosave effect replaces the queue's pending snapshot. If the 650 ms timer for a snapshot taken before the merge fires in that gap, or the user presses Retry and the queue resends its `failed` pre-merge snapshot, that snapshot goes out with v2 and passes the version check.
- Effects: planning edits from the other device are reverted (until the next save puts them back), or the result-removal refusal triggers H1.
- The window is narrow, but the design is unsound.
- Fix: record the base version on each snapshot (in the queue item) and send that version. Drop any queued or failed snapshot whose base is not the current one.

### M5. Unsynced local work from the RC era is dropped on the first load of this build (pre-existing)
- With a local copy, no sync state and a non-null server workspace, the local copy is ignored (page.tsx:2510). Devices that were stuck in the RC (B-R2/B-69/B-70) with scores only in localStorage lose those scores when they upgrade.
- Fix: merge with an empty base under the conflict-only rule from M1. The commit's own test, "offline copy with no known base never silently overwrites", shows this is safe for differing records.

## LOW

- **L1. Id collision.** Two devices that save in the same millisecond produce the same `result-<ms>-<index>` for different officers. The merge reports one "conflict", and the description shows the local officer for both values. "Keep other" then drops officer A's score (PROVEN P6). The id scheme is pre-existing. Fix: use `crypto.randomUUID()` for result, malfunction and roster ids, together with the H3 key matching.
- **L2. Records without a string id** (workspace-merge.ts:79-80). Identical unkeyed records collapse into one, and an edited unkeyed record is kept twice. Numeric ids are treated as unkeyed (PROVEN P8). The page always assigns string ids, so this mainly affects legacy or imported data. Fix: `String(id)` for numbers; keep both sides' unkeyed records as they are (no dedupe by equality) or report them as conflicts.
- **L3. The second 409 is not recognized as stale.** The route's other 409, "workspace changed during validation" (route.ts:208-217), has no `code: "stale_workspace"`, so it is not recovered automatically. The next edit or Retry gets a real stale 409 and recovers then. Fix: add the code there as well.
- **L4. Misleading "Saved" pill.** A result whose value from this device is held only as a conflict shows "Saved", because the state holds the server's value. Fix: mark the result rows of conflicted records as "Conflict".
- **L5. Recovery fetch failure.** If the recovery fetch fails, `workspaceStale` stays true and every keystroke-triggered save returns 409 and starts another GET. This is bounded, and no data is lost.

## Checked and found sound
- `stable()` drops undefined keys, which matches what the JSON round-trip through localStorage and HTTP does. Key ordering is sorted. NaN and -0 serialize the same on both paths. I found no false "changed" result from serialization.
- The `normalize*ForWorkspace` functions are idempotent. Base, local and server are all normalized with the same `currentUserId`, so normalization alone does not create conflicts or local changes.
- `withStoredCopiesOfUnchangedRecords` is re-baselined from the fetched server copy on recovery (`setLoadedWorkspaceBaseline`, page.tsx:3108). Merged records that are unchanged go back as stored raw copies, so scorers do not trip the planning-change check through normalization alone.
- Typing during recovery: the merge reads `latestWorkspaceState` after the fetch. Saves made during recovery throw, and the queue is rescheduled by the effect after `applyMergeableWorkspace`. No loss found there, apart from M4.
- Batch rows that were typed but not saved stay outside `results` and are kept by `preserveUnsavedBatchRows`.
- A record deleted on the server and unchanged locally stays deleted (no resurrection when the base is known). A local edit to a record that was deleted on the server becomes a conflict that keeps the local value.
- Recovery does not loop by itself: each 409 means a real newer version, and the merge converges. The loops found are the authorization wedges in H1.
