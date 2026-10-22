# Independent review of f85ba7a (range merge fixes)

Reviewer: an independent agent with no access to the fix author's conclusions. Read-only; proofs in `proofs.test.ts.txt` (6 tests; each asserts the faulty behaviour, so a pass means the defect is present). All 6 passed against `f85ba7a` (`proofs-before.txt`).

## High
- **R2-H1.** Removing a drill (`DELETE /api/pilot/range-workspace/drills`) had no version check; the page adopted the returned `updatedAt` and replaced `rangeDayDrills` with the server's list without merging. The next autosave silently reverted another instructor's saved work (for example attendance) and dropped this device's unsaved drills. Pre-existing since 6ff687f.
- **R2-H2.** On a shared device the next user's (or another agency's) first load overwrote the single device record, destroying the previous user's unsynced scores.

## Medium
- **R2-M1.** A conflict outlived later edits; both conflict buttons then wrote stale values over newer saved work.
- **R2-M2.** Matching results by logical key renamed this device's result to the server's id but left its malfunction pointing at the old id (a permanent orphan).
- **R2-M3.** A refusal the client preview could not predict (agency/reference check) still blocked every save, survived reloads and listed nothing to discard. A held-back parent range day could leave its child result replayed.
- **R2-M4.** Unsynced work under the earlier storage keys was never read after the upgrade.

## Low
- L1 "Use this device's value" offered on a held-back conflict; L2 a load or recovery always sends a PUT; L3 several unsynced tabs replace each other's backup; L4 holding back runs one preview per change (cost); L5 range-day and equipment ids used `Date.now()`; L6 a copy with no agency was usable for any agency; L7 (pre-existing) a result on a drill another device removed is saved as an orphan; L8 two records with the same id collapse to one.

## Checked and found sound
H1 for predictable refusals, H2 pairing, H3, M1, M2 dedupe, M4 epochs, L3 and L4 of the first review; preview and server agree except the agency/reference check; no autonomous save or recover loop.
