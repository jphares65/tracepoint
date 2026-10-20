# Remediation batch B3 — range save integrity

Base: `claude/fix-b0-proof-foundation` (on `codex/staging-mobile-api-release-20261007` @ `555f061`). Scope and evidence: `docs/operational-audit-20261020/reconciliation-20261020/README.md` §5 (B3) and `R3-range.md`, including the 25-scenario harness `evidence/verify-range.ts`.

Range data is one JSON document per agency (`pilot_range_workspaces`). It is written by `PUT /api/pilot/range-workspace` (web) and by `PUT /api/mobile/range-workspace` (the native client, whose code is not in this repository). Both routes use `authorizeRangeWorkspaceMutation`. The server contract stays backward-compatible: every payload the native client could send before is handled the same way, or is now accepted where it used to be wrongly refused.

## Defects addressed

| ID | Defect | Change |
|---|---|---|
| RNG-01 (Critical) | Correcting a saved score, or a same-day re-shoot, gave every re-saved result a new ID. The server treated that as deleting saved results and returned 409 for every role. The web autosave swallowed the 409. | **Server** (`workspace-mutation.ts`): a removed result counts as a *correction* when a new result (an ID not already stored) holds the same range day, drill, run and officer key. Its malfunctions may then be removed too. Deleting a result with no replacement is still refused with the same 409. **History:** both PUT routes store `withRangeResultRevisions(...)`, which appends the previous version of every changed or replaced result or malfunction to `workspace.resultRevisions` (with revisedAt, revisedByUserId and replacedById). The server rebuilds this history from the stored copy on every write and ignores anything a client sends, so it can never shrink or change. Clients that do not know about it keep working. **Web** (`range-days/page.tsx`): re-saving the same key reuses the existing result ID and malfunction ID, so a correction is an in-place update. Saving no longer deletes results of officers who have no entry in the batch. |
| RNG-23 (Medium) | A re-save reset the malfunction type and notes to "Failure to Feed" and empty notes. | Batch rows are prefilled from the existing malfunction. A re-save keeps that malfunction's ID, date and reporter, and keeps any additional malfunction IDs on the result. |
| RNG-03 (Critical) | Packet status "Ready" counted as finalized, so the day locked before anyone shot. | Removed "Ready" from the lock rule everywhere it was copied: `isFinalized` (API), `drill-removal.ts`, the relational branch of `drills/route.ts`, and the page (`selectedRangeDayFinalized`, the Archive button, `handleChangeRangeDayStatus`). The database triggers that duplicate the rule are fixed in `database/aws/042` (see below). The readiness checklist, the "Packets Ready" stat and the command dashboard only *display* packet readiness, and they are unchanged. |
| RNG-08 (High) | Scores typed but not yet saved were discarded whenever the roster or workspace changed and the batch-row effect ran again. | The page records which officers' rows have unsaved edits. When the effect rebuilds rows for the same day, drill and run, those rows are kept (`preserveUnsavedBatchRows`). Officers who are no longer attending are dropped as before. Changing the day, drill or run, or saving, clears the record. |
| RNG-11 (High) | Load-time normalization (attendance mode, outline, checklist, AAR, lead instructor, qualification run counts) changed `rangeDays`, `drillLibrary` and `rangeDayDrills` in local state. The next autosave sent those changes back: 409 for a finalized day, 403 for a scorer-only user. Every later autosave then failed the same way. | The page keeps the stored and normalized copies from load. When saving, any record the user has not changed since load is sent exactly as stored (`withStoredCopiesOfUnchangedRecords`). Normalization alone therefore never reaches the server. The server rules are unchanged. |
| RNG-01/02/13 (hidden failures) | The autosave `.catch(console.warn)` hid every server rejection. "Saved" came from local state. | Ported the save queue from `04668a1` (`src/lib/range/workspace-autosave.ts` and its tests, unmodified). Saves are serialized and the newest snapshot is sent next. A visible status shows "Saving…", "Saved" only after the server confirms, or "Save failed: \<server message\>" with **Retry**. It appears in the day header, the day list header, and next to both batch-save buttons. The explicit "Save Range Day" button goes through the same queue. Not ported from 04668a1: persisting the selected day, drill and run, and the immediate/debounced priority. The batch message now says results were "recorded"; the status shows whether the server has them. |
| RNG-13 (Critical) | Compare-and-swap used the `updated_at` the server had just read, so a stale planning write from a second device silently overwrote another user's change. | Optional optimistic concurrency. Both PUT routes accept `baseUpdatedAt` in the body (the `updatedAt` from GET, or `null` when nothing was stored). If it does not match the stored version, they return **409** with `code: "stale_workspace"` and the message "This range workspace was changed on another device or by another user after you loaded it. Reload…". If it is absent, behaviour is unchanged (the current native client). Successful PUTs now return `updatedAt`. Mobile GET now also returns `updatedAt` (additive). The web client sends its base and updates it after each save. On `stale_workspace` it shows a **Reload** prompt instead of retrying. The drill DELETE now also uses compare-and-swap on `updated_at` (it used none) and returns the new `updatedAt`. No merge logic was added. |
| RNG-04 (High) | Completed, Locked or Archived was one unconfirmed tap and irreversible. | A confirmation dialog appears before the status select or the Archive button sets Completed, Locked or Archived. The dialog states that scores, roster, malfunctions and the AAR will be locked, even for an administrator. **Deferred:** an amendment or unlock path is a new capability and was not built. Final days stay immutable, as the tests assert. |
| RNG-22 (Medium) | Removing an officer from the roster deleted their results locally without confirmation. The server rejected that, so the screen and the server disagreed. | A confirmation dialog shows how many saved results will be kept. Only the roster entry is removed. Saved results stay. |

Authorization is unchanged: the same permissions allow the same writes, and the scorer-planning restriction, tenant checks and finalized-day locks are identical. Scorers could already edit a result in place; corrections now leave history as well.

### Database (AWS-native): `database/aws/042_range_packet_ready_is_not_final.sql`

**Why it is needed.** R3 said the triggers enforce the API rules a second time on AWS. The local app-session test confirmed it: the trigger fires for `tracepoint_runtime` → `set local role authenticated` with `tracepoint.subject_id`, because its bypass list is only service_role, postgres and supabase_admin. Without 042, the RNG-03 fix would still fail on AWS staging and production at the database.

**What it does.**
- Recreates `protect_pilot_range_workspace_mutation()`. The body is identical to `202609060002` except that the packet-ready clause is removed.
- Recreates `protect_range_day_drill_history()` (the relational drill trigger from `202609030001`) without the packet-ready clause.

**Properties.**
- It uses `create or replace` only, so the existing triggers stay attached.
- It is idempotent (applied three times locally without error) and owns its `begin;`/`commit;`.
- **Numbering:** this number was allocated for B3. 039–041 belong to other batches. The runner only requires strictly increasing, unique versions, so the gap is valid.

**Not changed.**
- No Supabase-lineage migration was added. In Supabase mode the API writes as `service_role` and bypasses the workspace trigger.
- The relational drill trigger keeps "Ready" as a lock on Supabase-only environments. That table has no web writer (RNG-06).

**Validator.** The clean-bootstrap validator AWS stage now asserts `range_packet_ready_not_final`.

## Tests added

| Test | What it proves |
|---|---|
| `src/lib/range/workspace-mutation.test.ts` | The R3 harness converted into repo tests that assert **correct** behaviour: RNG-01 (1a–1f, with both the old/native regenerated-ID payload and the new stable-ID payload, plus revision content); deletion without replacement is still refused; the revision history cannot be shrunk or forged, and a client that omits it keeps it; RNG-03 (3a–3f); RNG-04 (4a–4f, which stay final); RNG-13 (13a–13c, plus `rangeWorkspaceVersionConflict` for string, Date and Postgres formats, null, invalid and absent bases); RNG-11 (11a, 11b); RNG-22; RNG-23. A source-contract test checks that both PUT routes run the version check before authorization and store the revision history. The old "packet-finalized history" case was changed to Completed only. |
| `src/lib/range/drill-removal.test.ts` | A Locked day still blocks drill removal; a packet-Ready Planned day does not. |
| `src/lib/range/workspace-client-state.test.ts` | Unchanged records are sent as stored, while edited and new records are sent as edited (RNG-11). Unsaved typed rows survive a rebuild, and only for officers still present (RNG-08). |
| `src/lib/range/workspace-autosave.test.ts` | Ported with the queue from 04668a1: serialization, latest snapshot, error then explicit retry, and no stale "saved". |
| `scripts/validate-clean-bootstrap.mjs` | AWS-stage check `range_packet_ready_not_final`. |

## Verification (local, synthetic; no remote systems)

### R3 harness `verify-range.ts`, before and after

The harness ran unchanged against the pre-fix module and the fixed module. Its own "expected" column records the *defect*, so "after" is the column to read.

| # | Scenario | Before | After | Note |
|---|---|---|---|---|
| 1a | First save, 2 results | ok | ok | |
| 1b | Correction with new IDs, instructor | 409 | **ok** | RNG-01 fixed for a native/regenerated payload |
| 1c | Same, Range Master | 409 | **ok** | |
| 1d | Same, administrator | 409 | **ok** | |
| 1e | In-place correction, stable ID | ok | ok | Now what the web client sends |
| 1f | Re-shoot of officer A (harness payload) | 409 | 409 | The harness's re-shoot payload also deletes officer B's saved result with no replacement, because its filter drops every attending officer. Refusing that deletion is correct. A re-shoot that replaces only A is accepted (repo test 1f), and the fixed page never drops unscored officers. |
| 3a | Set packet Ready | ok | ok | |
| 3b | First score on a Ready day, instructor | 409 | **ok** | RNG-03 |
| 3c | Same, administrator | 409 | **ok** | |
| 3d | Planned→In Progress on a Ready day | 409 | **ok** | |
| 3e | Revert Ready | 409 | **ok** | |
| 3f | Attendance on a Ready day | 409 | **ok** | |
| 4a | Set Completed | ok | ok | Web now asks for confirmation first (RNG-04) |
| 4b–4f | Edit, AAR, reopen, archive, restore on a final day | 409 | 409 | Intended: final days are immutable; amendment is deferred |
| 13a | Device A save | ok | ok | |
| 13b | Device B save without A's result | 409 | 409 | A's evidence is protected. With a base version, B gets `stale_workspace` first (Reload prompt) |
| 13c | B merges first | ok | ok | |
| 13d | Stale planning write | ok (lost update) | ok at the authorizer → **409 `stale_workspace` at the route** when the client sends `baseUpdatedAt` (web does) | RNG-13. The native client is unchanged until it sends a base |
| 11a | Normalized legacy Completed day | 409 | 409 for that payload | The web no longer sends it: the stored copy is sent → ok (repo test 11a) |
| 11b | Normalized library from a scorer | 403 | 403 for that payload | Same: the web sends the stored copy → ok (repo test 11b) |
| 22a | Roster removal that also deletes results | 409 | 409 | Deleting is still refused; the web now removes only the roster entry → ok (repo test RNG-22) |
| 23a | Re-save recreating a malfunction with new IDs | 409 | **ok** | RNG-23 (native payload); the old malfunction is preserved in `resultRevisions` |

### Repo tests: fail before, pass after

The test files ran against the pre-fix `workspace-mutation.ts` and `drill-removal.ts`. Placeholder exports reproduced the old route behaviour: no revision history and no version check.

| Test | Before | After |
|---|---|---|
| drill-removal: blocks finalized but not ready packets | **fail** | pass |
| RNG-01: correction/re-shoot accepted and keeps old result | **fail** | pass |
| RNG-01: revision history append-only | **fail** | pass |
| RNG-03: Ready does not lock | **fail** | pass |
| RNG-13: stale base detected | **fail** | pass |
| RNG-23: malfunction kept with history | **fail** | pass |
| RNG-08 / RNG-11 client helpers | **fail** (the helpers did not exist; the page rebuilt rows unconditionally and sent normalized records) | pass |
| Deletion still refused, RNG-04 final, RNG-22 server half, and existing authorizer tests | pass | pass (unchanged guarantees) |

### Database (PostgreSQL 16, user ubuntu, 127.0.0.1:55613)

Both databases were built from the Supabase lineage plus `database/aws`: before = 117/117 migrations; after = 118/118 (with 042). Writes ran as `tracepoint_runtime` → `set local role authenticated` with `tracepoint.subject_id` set, the same way `server-access-postgres.ts` writes.

| # | Write | Before 042 | After 042 |
|---|---|---|---|
| T1 | Instructor adds the first score on a packet-Ready day | ERROR "Finalized range history cannot be changed." | **updated** |
| T2 | Range Master reverts Ready → In Progress | ERROR (same) | **updated** |
| T3 | Control: Range Master edits a score on a Completed day | ERROR | ERROR |
| T4 | Control: instructor changes planning | ERROR "planning changes require range management permission" | same |
| T5 | Control: officer with no range permission | 0 rows (RLS) | 0 rows |
| R1 | Delete a relational drill on a packet-Ready Planned day | ERROR | **deleted** |
| R2 | Control: delete a relational drill on a Completed day | ERROR | ERROR |

Other database checks:
- 042 applied twice more: no error, and both triggers are still attached.
- `db:validate-bootstrap` through the local shim: **passes** with "79 ordered migrations and 39 AWS-native migrations".
- Control (the same run with 042 removed): **fails** with "AWS-native schema checks failed: range_packet_ready_not_final".

### Required checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `node scripts/run-application-tests.mjs` | 574 tests, 570 pass. The 4 failures are xlsx-stub only (`ai-importer/workbook.test.ts` and inference). The 11 embedded-PostgreSQL files that ran no tests (root sandbox) are the same set listed in B0. |
| `node --test --test-concurrency=1 scripts/*.test.mjs` | 349 tests, 348 pass. The only failure is the SheetJS XLSX round trip. |
| `npx eslint` on the changed files | No new findings. `range-days/page.tsx` has 18 findings (5 errors, 13 warnings); all of them exist on the base branch, with the same messages. The new files are clean. |

## Native client contract (code not available)

- Payloads with regenerated result and malfunction IDs are now accepted as corrections. Before, they were refused.
- A payload that deletes a saved result without a same-key replacement still gets the same 409 and message.
- A PUT without `baseUpdatedAt` behaves exactly as before.
- New response fields: `updatedAt` on PUT and on mobile GET.
- New key in the stored document and in GET responses: `workspace.resultRevisions`. A client that drops it on save loses nothing, because the server re-attaches it. **Owner check:** confirm that the native decoder ignores unknown keys. The document already carries many fields the client does not model.
- **To get stale-write protection on mobile,** the native client should send `baseUpdatedAt` (from GET or from the previous PUT) and handle `409 code: "stale_workspace"` by reloading.

## Staging (reconciliation README §8)

1. Apply `042` to staging with `scripts/migrate-db.ps1 staging -Action status`, then `apply`. Expected: 042 is pending, and B3 needs no other change. Verify with `select pg_get_functiondef('public.protect_pilot_range_workspace_mutation()'::regprocedure) not like '%= ''ready''%'` → true.
2. Deploy the image. Run **S5**:
   - save scores, correct one, and save again: the status reads "Saved", with no 409;
   - `resultRevisions` holds the old score;
   - set Packet Ready, then score: saved.
3. **Stale write.** Open the same range day in two browsers. Edit the title in A and wait for "Saved". Edit the location in B. Expected:
   - B shows "changed on another device" with **Reload**;
   - A's title survives.
4. **Native client** (with the client owner), using a synthetic tenant:
   - score, then correct a score, through the app;
   - confirm 2xx, and that the app still loads the workspace with `resultRevisions` present.
5. **Confirmations.**
   - Status → Completed asks for confirmation, and Cancel leaves the status unchanged.
   - Removing an officer who has scores asks for confirmation, and the scores remain after reload.
6. Run S10 (tenant-negative): all denials still hold.

Production needs separate authorization and the same 042 apply. Production should currently match the 202609060002 body; verify with `pg_get_functiondef` before applying.

## Rollback

- **Application:** revert the image. Stored `resultRevisions` entries are inert for older code. Older routes would drop them on the next pilot PUT, because the old `normalizeWorkspace` keeps only six collections; the mobile route would keep them.
- **042:** to restore the old rule, re-run the two function bodies from `202609060002` and `202609030001` as a new migration. Do not edit 042. Restoring it re-locks every packet-Ready day.

## Deferred / owner decisions

- **RNG-04 amendment / unlock path:** a new capability, not built. Final days stay immutable.
- **RNG-21:** AAR after close-out is still refused. It is not in B3.
- **Two-device concurrent scoring:** devices now get a clear Reload prompt instead of silently overwriting each other, but there is no merge. Per-result writes or merge belong to the offline/multi-device capability (RNG-02, deferred).
- **Revision growth:** `resultRevisions` grows with each correction inside the single JSON document. That is acceptable at pilot scale. A relational projection (RNG-06) is the long-term home.
